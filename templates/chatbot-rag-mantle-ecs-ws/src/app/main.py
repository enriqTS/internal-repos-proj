"""FastAPI application entry point for ECS WebSocket chatbot service.

Provides:
- GET /health — health check endpoint for NLB target group
- POST /connect — handles WebSocket $connect from API Gateway via VPC Link
- POST /disconnect — handles WebSocket $disconnect from API Gateway via VPC Link
- POST /message — handles sendMessage route from API Gateway via VPC Link

API Gateway WebSocket routes are forwarded as HTTP POST requests to the ECS
service through a VPC Link + NLB integration.

Supports graceful shutdown via SIGTERM: stops accepting new connections,
drains in-flight requests, and exits with code 0.

Configuration via environment variables:
- PORT: Server port (default: 8080)
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import json
import os
import signal
import uuid
from contextlib import asynccontextmanager

from aws_lambda_powertools import Logger
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.connection_manager import remove_connection, store_connection
from app.message_protocol import build_error_message, validate_client_message
from app.message_sender import send_to_connection
from app.models import ErrorResponse
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
    title="Chatbot RAG — Bedrock Mantle (ECS, WebSocket)",
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


@app.post("/connect")
async def handle_connect(request: Request) -> JSONResponse:
    """Handle WebSocket $connect event forwarded from API Gateway.

    Extracts connectionId from requestContext and userId from queryStringParameters.
    Stores the connection in the Connection_Table.

    Args:
        request: HTTP POST request containing the API Gateway WebSocket event.

    Returns:
        JSON response with statusCode indicating success or failure.
    """
    body = await request.json()
    request_context = body.get("requestContext", {})
    connection_id = request_context.get("connectionId", "")
    correlation_id = request_context.get("requestId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)

    # Extract userId from query string
    query_params = body.get("queryStringParameters") or {}
    user_id = query_params.get("userId", "")

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
            "Connection rejected — failed to store",
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


@app.post("/disconnect")
async def handle_disconnect(request: Request) -> JSONResponse:
    """Handle WebSocket $disconnect event forwarded from API Gateway.

    Removes the connection entry from the Connection_Table.
    Failures are logged at WARN level — TTL provides safety net.

    Args:
        request: HTTP POST request containing the API Gateway WebSocket event.

    Returns:
        JSON response with statusCode 200.
    """
    body = await request.json()
    request_context = body.get("requestContext", {})
    connection_id = request_context.get("connectionId", "")
    correlation_id = request_context.get("requestId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Disconnect event received",
        extra={"connectionId": connection_id},
    )

    remove_connection(connection_id)

    return JSONResponse(
        status_code=200,
        content={"statusCode": 200, "body": "Disconnected"},
    )


@app.post("/message")
async def handle_message(request: Request) -> JSONResponse:
    """Handle sendMessage route event forwarded from API Gateway.

    Validates the client message, processes via orchestrator (tool-use loop),
    and sends the response back through the WebSocket connection.

    Args:
        request: HTTP POST request containing the API Gateway WebSocket event.

    Returns:
        JSON response with statusCode 200 (response delivered via WebSocket).
    """
    body = await request.json()
    request_context = body.get("requestContext", {})
    connection_id = request_context.get("connectionId", "")
    correlation_id = request_context.get("requestId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)

    # Parse the message body
    raw_body = body.get("body", "")
    try:
        if isinstance(raw_body, str):
            message_data = json.loads(raw_body)
        else:
            message_data = raw_body
    except (json.JSONDecodeError, TypeError):
        error_msg = build_error_message("Invalid JSON format", correlation_id=correlation_id)
        send_to_connection(connection_id, error_msg)
        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Error sent to client"},
        )

    # Validate client message format
    is_valid, error_description = validate_client_message(message_data)
    if not is_valid:
        error_msg = build_error_message(
            error_description or "Invalid message format",
            correlation_id=correlation_id,
        )
        send_to_connection(connection_id, error_msg)
        return JSONResponse(
            status_code=200,
            content={"statusCode": 200, "body": "Validation error sent to client"},
        )

    user_id = message_data["userId"]
    message_text = message_data["message"]

    logger.info(
        "Processing sendMessage",
        extra={
            "connectionId": connection_id,
            "userId": user_id,
            "messageLength": len(message_text),
        },
    )

    try:
        process_message(
            user_id=user_id,
            message_text=message_text,
            connection_id=connection_id,
            correlation_id=correlation_id,
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
        error_msg = build_error_message(
            "Processing failed — please retry",
            correlation_id=correlation_id,
        )
        send_to_connection(connection_id, error_msg)

    return JSONResponse(
        status_code=200,
        content={"statusCode": 200, "body": "Message processed"},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle HTTP exceptions with structured error response (no stack traces)."""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(error=exc.detail).model_dump(),
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
