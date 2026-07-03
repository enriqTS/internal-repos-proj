"""FastAPI application entry point for ECS chatbot service.

Provides:
- GET /health — health check endpoint for ALB target group
- POST /chat — synchronous chat endpoint (non-streaming)

Supports graceful shutdown via SIGTERM: stops accepting new connections,
drains in-flight requests, and exits with code 0.

Configuration via environment variables:
- PORT: Server port (default: 8080)
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import os
import signal
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from aws_lambda_powertools import Logger
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.models import ChatRequest, ChatResponse, ErrorResponse
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
    title="Chatbot RAG — Bedrock Mantle (ECS)",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint for ALB/NLB target group.

    Returns HTTP 200 when the service is healthy and ready to accept requests.
    Returns HTTP 503 when the service is shutting down.
    """
    if _shutting_down:
        raise HTTPException(status_code=503, detail="Shutting down")
    return {"status": "healthy"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Process a chat message (REST non-streaming).

    Accepts a JSON request body with userId and message fields.
    Returns the complete AI-generated response.

    Args:
        request: Validated ChatRequest with userId and message.

    Returns:
        ChatResponse with response text, conversationId, and timestamp.

    Raises:
        HTTPException: 400 for validation errors, 500 for processing failures.
    """
    correlation_id = None

    try:
        result = process_message(
            user_id=request.userId,
            message_text=request.message,
            correlation_id=correlation_id,
        )

        return ChatResponse(
            response=result["response"],
            conversationId=result["conversationId"],
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    except Exception as e:
        logger.error(
            "Chat processing failed",
            extra={
                "userId": request.userId,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        raise HTTPException(
            status_code=500,
            detail="Processing failed — please retry",
        ) from e


@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc: ValidationError) -> JSONResponse:
    """Handle Pydantic validation errors with a structured 400 response."""
    errors = exc.errors()
    if errors:
        first_error = errors[0]
        field = first_error.get("loc", ["unknown"])[-1]
        msg = first_error.get("msg", "validation error")
        detail = f"Invalid message format: {field} — {msg}"
    else:
        detail = "Invalid request format"

    return JSONResponse(
        status_code=400,
        content=ErrorResponse(error=detail).model_dump(),
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
