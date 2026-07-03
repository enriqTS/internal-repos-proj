"""FastAPI application entry point for ECS WebSocket chatbot service.

Provides:
- GET /health — health check endpoint for NLB target group
- POST /ws/connect — handle API Gateway $connect event (forwarded via VPC Link)
- POST /ws/disconnect — handle API Gateway $disconnect event
- POST /ws/message — handle sendMessage route (processes message, sends response via @connections)

The API Gateway WebSocket API forwards lifecycle events as HTTP POST requests
to the ECS service via VPC Link -> NLB. The ECS service processes messages and
sends responses back via the API Gateway Management API (@connections endpoint).

Supports graceful shutdown via SIGTERM: stops accepting new connections,
drains in-flight requests, and exits with code 0.

Configuration via environment variables:
- PORT: Server port (default: 8080)
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
- CONNECTION_TABLE_NAME: DynamoDB table for WebSocket connections
- WEBSOCKET_API_ENDPOINT: API Gateway Management API endpoint
"""

import os
import signal
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from aws_lambda_powertools import Logger
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.connection_manager import remove_connection, store_connection
from app.message_sender import send_to_connection
from app.orchestrator import process_message

logger = Logger(service="main")

# Graceful shutdown state
_shutting_down = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle — setup and graceful shutdown."""
    logger.info("Service starting", extra={"port": os.environ.get("PORT", "8080")})
    yield
    global _shutting_down
    _shutting_down = True
    logger.info("Service shutting down — draining connections")


app = FastAPI(
    title="Chatbot RAG — Bedrock AgentCore (ECS, WebSocket)",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint for NLB target group.

    Returns HTTP 200 when the service is healthy and ready to accept requests.
    Returns HTTP 503 when the service is shutting down.
    """
    if _shutting_down:
        raise HTTPException(status_code=503, detail="Shutting down")
    return {"status": "healthy"}


@app.post("/ws/connect")
async def ws_connect(request: Request) -> JSONResponse:
    """Handle API Gateway $connect event forwarded via VPC Link.

    Extracts userId from the request body (forwarded by API Gateway integration)
    and stores the connection in the Connection_Table.

    Expected body:
    {
        "requestContext": {
            "connectionId": "abc123",
            "routeKey": "$connect"
        },
        "queryStringParameters": {
            "userId": "user-123"
        }
    }

    Returns:
        200 on success, 400 if userId missing, 500 if storage fails.
    """
    correlation_id = str(uuid.uuid4())
    logger.append_keys(correlation_id=correlation_id)

    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"statusCode": 400, "body": "Invalid request body"},
        )

    request_context = body.get("requestContext", {})
    connection_id = request_context.get("connectionId", "")
    query_params = body.get("queryStringParameters") or {}
    user_id = query_params.get("userId", "")

    logger.info(
        "WebSocket connect event",
        extra={"connectionId": connection_id, "userId": user_id},
    )

    if not user_id:
        logger.warning(
            "Connection rejected — missing userId",
            extra={"connectionId": connection_id},
        )
        return JSONResponse(
            status_code=400,
            content={"statusCode": 400, "body": "Missing userId parameter"},
        )

    try:
        store_connection(connection_id, user_id)
        logger.info(
            "Connection accepted",
            extra={"connectionId": connection_id, "userId": user_id},
        )
        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Connected"},
        )
    except Exception as e:
        logger.error(
            "Connection rejected — failed to store connection",
            extra={
                "connectionId": connection_id,
                "userId": user_id,
                "error": str(e),
            },
        )
        return JSONResponse(
            status_code=500,
            content={"statusCode": 500, "body": "Failed to establish connection"},
        )


@app.post("/ws/disconnect")
async def ws_disconnect(request: Request) -> JSONResponse:
    """Handle API Gateway $disconnect event forwarded via VPC Link.

    Removes the connection entry from the Connection_Table.
    Removal failures are logged at WARN level but do not fail the response.

    Expected body:
    {
        "requestContext": {
            "connectionId": "abc123",
            "routeKey": "$disconnect"
        }
    }

    Returns:
        200 always (disconnect is best-effort, TTL provides safety net).
    """
    correlation_id = str(uuid.uuid4())
    logger.append_keys(correlation_id=correlation_id)

    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Disconnected"},
        )

    request_context = body.get("requestContext", {})
    connection_id = request_context.get("connectionId", "")

    logger.info(
        "WebSocket disconnect event",
        extra={"connectionId": connection_id},
    )

    remove_connection(connection_id)

    return JSONResponse(
        status_code=200,
        content={"statusCode": 200, "body": "Disconnected"},
    )


@app.post("/ws/message")
async def ws_message(request: Request) -> JSONResponse:
    """Handle sendMessage route event forwarded via VPC Link.

    Processes the user message, invokes AgentCore, and sends the response
    back to the client via the API Gateway Management API (@connections).

    Expected body:
    {
        "requestContext": {
            "connectionId": "abc123",
            "routeKey": "sendMessage"
        },
        "body": "{\"action\":\"sendMessage\",\"userId\":\"user-123\",\"message\":\"Hello\"}"
    }

    Returns:
        200 on success (response delivered via @connections, not HTTP response).
    """
    correlation_id = str(uuid.uuid4())
    logger.append_keys(correlation_id=correlation_id)

    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"statusCode": 400, "body": "Invalid request body"},
        )

    request_context = body.get("requestContext", {})
    connection_id = request_context.get("connectionId", "")

    # Parse the message body (JSON string from API Gateway)
    import json

    raw_body = body.get("body", "")
    try:
        if isinstance(raw_body, str):
            message_data = json.loads(raw_body)
        else:
            message_data = raw_body
    except (json.JSONDecodeError, TypeError):
        _send_error(connection_id, "Invalid JSON format", correlation_id)
        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Error sent to client"},
        )

    # Validate message fields
    user_id = message_data.get("userId", "")
    message_text = message_data.get("message", "")

    if not user_id or not isinstance(user_id, str) or len(user_id) > 256:
        _send_error(
            connection_id,
            "Invalid message format: userId must be a non-empty string (1-256 chars)",
            correlation_id,
        )
        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Validation error sent to client"},
        )

    if not message_text or not isinstance(message_text, str) or len(message_text) > 4096:
        _send_error(
            connection_id,
            "Invalid message format: message must be a non-empty string (1-4096 chars)",
            correlation_id,
        )
        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Validation error sent to client"},
        )

    logger.info(
        "Processing WebSocket message",
        extra={
            "connectionId": connection_id,
            "userId": user_id,
            "messageLength": len(message_text),
        },
    )

    try:
        result = process_message(
            user_id=user_id,
            message_text=message_text,
            correlation_id=correlation_id,
        )

        # Send the response back via @connections (non-streaming: single message)
        response_message = {
            "type": "message",
            "response": result["response"],
            "conversationId": result["conversationId"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        send_to_connection(connection_id, response_message)

        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Message processed"},
        )

    except Exception as e:
        logger.error(
            "Message processing failed",
            extra={
                "connectionId": connection_id,
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        _send_error(
            connection_id,
            "Processing failed — please retry",
            correlation_id,
        )
        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Error sent to client"},
        )


def _send_error(connection_id: str, message: str, correlation_id: str | None = None) -> None:
    """Send an error message to a WebSocket client.

    Args:
        connection_id: API Gateway WebSocket connection ID.
        message: Human-readable error description.
        correlation_id: Optional request correlation identifier.
    """
    error_msg: dict[str, Any] = {"type": "error", "message": message}
    if correlation_id:
        error_msg["correlationId"] = correlation_id
    send_to_connection(connection_id, error_msg)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle HTTP exceptions with structured error response (no stack traces)."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


def _handle_sigterm(signum: int, frame) -> None:
    """Handle SIGTERM for graceful shutdown.

    Sets the shutting_down flag so the health endpoint returns 503,
    then raises SystemExit to trigger the lifespan shutdown.
    """
    global _shutting_down
    _shutting_down = True
    logger.info("SIGTERM received — initiating graceful shutdown")
    raise SystemExit(0)


# Register SIGTERM handler for ECS graceful shutdown
signal.signal(signal.SIGTERM, _handle_sigterm)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
