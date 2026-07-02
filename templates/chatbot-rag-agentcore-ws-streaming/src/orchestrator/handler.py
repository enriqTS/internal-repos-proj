"""Lambda handler for the Orchestrator — WebSocket API Gateway direct integration (streaming).

Receives user messages directly from the WebSocket API Gateway sendMessage route,
invokes the AI Caller (AgentCore) in streaming mode, and progressively forwards
chunks to the client via the WebSocket connection.

Streaming: yields chunks from AgentCore and sends each as {"type": "chunk"} message.
After the stream completes, sends {"type": "done"} and saves the full assembled
response to conversation history.

Error mid-stream: sends {"type": "error"} to client, logs ERROR, discards partial.
Client disconnect mid-stream: aborts stream, logs WARN, discards partial — does NOT persist.

Environment variables:
- DYNAMODB_TABLE_NAME: DynamoDB table for user conversation context
- CONNECTION_TABLE_NAME: DynamoDB table for WebSocket connections
- WEBSOCKET_API_ENDPOINT: API Gateway Management API endpoint URL
- AGENT_RUNTIME_ARN: AgentCore runtime ARN
- AGENT_ALIAS_ID: Agent alias identifier
- AGENT_ID: Agent identifier
- MAX_CONVERSATION_HISTORY: Max messages retained (default: 50)
- MAX_CHUNK_SIZE: Max tokens per WebSocket frame (default: 1, max: 50)
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import json
import os
import uuid
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from shared.ai_caller_agentcore import invoke_agentcore_streaming
from shared.conversation_context import append_messages
from shared.message_protocol import (
    build_chunk_message,
    build_done_message,
    build_error_message,
)
from shared.message_sender import send_to_connection

logger = Logger(service="orchestrator")

MAX_CHUNK_SIZE: int = int(os.environ.get("MAX_CHUNK_SIZE", "1"))


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """WebSocket sendMessage route handler — streaming (direct integration).

    Event structure from WebSocket API Gateway:
    {
        "requestContext": {"connectionId": "abc123", "routeKey": "sendMessage", "requestId": "..."},
        "body": "{\"message\": \"Hello\", \"userId\": \"user-123\"}"
    }

    Flow:
    1. Parse userId, message, and connectionId from the WebSocket event
    2. Invoke AgentCore AI caller (streaming) with the current message only
    3. Forward each chunk to the client via WebSocket as {"type": "chunk"}
    4. Send {"type": "done"} after stream completes
    5. Save the full assembled response to conversation history for compliance

    If the client disconnects mid-stream, abort and discard the partial response
    without persisting to history.

    Args:
        event: WebSocket API Gateway event with requestContext and body.
        context: Lambda execution context.

    Returns:
        Dict with statusCode 200 for API Gateway integration response.
    """
    body = json.loads(event.get("body", "{}"))
    connection_id = event["requestContext"]["connectionId"]
    user_id = body.get("userId", "")
    message_text = body.get("message", "")
    correlation_id = event["requestContext"].get("requestId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Processing message (streaming)",
        extra={"userId": user_id, "messageLength": len(message_text)},
    )

    if not user_id or not message_text:
        logger.warning("Invalid message — missing userId or message")
        error_msg = build_error_message(
            "Invalid request — missing userId or message", correlation_id
        )
        send_to_connection(connection_id, error_msg)
        return {"statusCode": 200}

    # Invoke AgentCore (streaming — yields text chunks progressively)
    try:
        full_response = _stream_response_to_client(
            session_id=user_id,
            message=message_text,
            connection_id=connection_id,
            correlation_id=correlation_id,
        )
    except _ClientDisconnectedError:
        # Client disconnected mid-stream — already logged, don't save partial
        logger.warning(
            "Client disconnected mid-stream — discarding partial response",
            extra={"userId": user_id, "correlation_id": correlation_id},
        )
        return {"statusCode": 200}
    except Exception as e:
        logger.error(
            "Streaming AI invocation failed",
            extra={
                "correlation_id": correlation_id,
                "error": str(e),
            },
        )
        # Send error message to client
        error_msg = build_error_message(
            "Processing failed — please retry", correlation_id
        )
        send_to_connection(connection_id, error_msg)
        return {"statusCode": 200}

    # Send done message after full stream completes
    done_msg = build_done_message(user_id)
    send_to_connection(connection_id, done_msg)

    # Save conversation exchange to history for compliance (only on full completion)
    try:
        append_messages(
            user_id=user_id,
            user_message=message_text,
            assistant_response=full_response,
            correlation_id=correlation_id,
        )
    except Exception as e:
        logger.error(
            "Failed to save conversation exchange",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        # Non-blocking — response already delivered to client

    logger.info(
        "Streaming message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(full_response),
        },
    )

    return {"statusCode": 200}


class _ClientDisconnectedError(Exception):
    """Raised when the client disconnects mid-stream."""


def _stream_response_to_client(
    session_id: str,
    message: str,
    connection_id: str,
    correlation_id: str,
) -> str:
    """Stream AgentCore response chunks to the client via WebSocket.

    Consumes the AgentCore streaming generator and forwards each chunk
    to the client. Supports max_chunk_size batching. Handles:
    - Client disconnect (410 Gone): aborts stream, raises _ClientDisconnectedError
    - Mid-stream AI error: sends error message to client, re-raises

    Args:
        session_id: User/session ID for AgentCore session.
        message: Current user message text.
        connection_id: WebSocket connection ID for delivery.
        correlation_id: Request correlation ID for logging.

    Returns:
        Full assembled response text from all chunks.

    Raises:
        _ClientDisconnectedError: If client disconnects mid-stream.
        Exception: Propagated from AI caller errors.
    """
    assembled_chunks: list[str] = []
    chunk_buffer: list[str] = []
    buffer_token_count: int = 0
    disconnect_detected: bool = False

    try:
        for chunk_text in invoke_agentcore_streaming(
            session_id=session_id,
            message=message,
            correlation_id=correlation_id,
        ):
            assembled_chunks.append(chunk_text)
            chunk_buffer.append(chunk_text)
            buffer_token_count += 1

            # Send buffered chunks when max_chunk_size reached
            if buffer_token_count >= MAX_CHUNK_SIZE:
                combined_content = "".join(chunk_buffer)
                chunk_msg = build_chunk_message(combined_content)
                delivered = send_to_connection(connection_id, chunk_msg)

                if not delivered:
                    # Client disconnected — abort stream
                    disconnect_detected = True
                    logger.warning(
                        "Client disconnect detected mid-stream — aborting",
                        extra={
                            "connectionId": connection_id,
                            "correlation_id": correlation_id,
                            "chunksDelivered": len(assembled_chunks) - buffer_token_count,
                        },
                    )
                    raise _ClientDisconnectedError(
                        "Client disconnected during streaming"
                    )

                chunk_buffer = []
                buffer_token_count = 0

        # Flush remaining buffer
        if chunk_buffer:
            combined_content = "".join(chunk_buffer)
            chunk_msg = build_chunk_message(combined_content)
            delivered = send_to_connection(connection_id, chunk_msg)

            if not delivered:
                logger.warning(
                    "Client disconnect detected on final chunk flush — aborting",
                    extra={
                        "connectionId": connection_id,
                        "correlation_id": correlation_id,
                    },
                )
                raise _ClientDisconnectedError(
                    "Client disconnected during final chunk delivery"
                )

    except _ClientDisconnectedError:
        raise
    except Exception as e:
        if disconnect_detected:
            raise _ClientDisconnectedError(
                "Client disconnected during streaming"
            ) from e

        # AI error mid-stream — send error to client, discard partial
        logger.error(
            "Error during streaming — discarding partial response",
            extra={
                "correlation_id": correlation_id,
                "error": str(e),
                "chunksAssembled": len(assembled_chunks),
            },
        )
        error_msg = build_error_message(
            "Stream processing failed", correlation_id
        )
        send_to_connection(connection_id, error_msg)
        raise

    return "".join(assembled_chunks)
