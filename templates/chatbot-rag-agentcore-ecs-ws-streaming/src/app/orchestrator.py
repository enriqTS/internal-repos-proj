"""Orchestrator module for ECS chatbot service — streaming variant.

Manages the conversation flow with streaming AI responses: retrieves history,
invokes the AI caller in streaming mode, and forwards each chunk progressively
to the client via the message sender.

Key differences from non-streaming ECS WebSocket variant:
- AI Caller is invoked in streaming mode (yields text chunks)
- Chunks are forwarded to the client progressively via message_sender
- After stream completes, sends {"type": "done"} and saves assembled response
- Client disconnect detection: if send_to_connection returns False, abort stream
- AgentCore handles tools internally — no application-level tool-use loop
"""

import uuid
from typing import Any

from app.ai_caller import invoke_agentcore_streaming
from app.logging_config import get_logger
from app.message_sender import send_to_connection
from app.tool_executor import execute_tool  # noqa: F401 — available for tool-use if needed

logger = get_logger("orchestrator")

# DynamoDB conversation context — imported lazily to keep module imports clean
_conversation_context = None


def _get_conversation_context():
    """Lazy import of conversation context module.

    We import at call time to allow patching env vars in tests
    before the module reads them.
    """
    global _conversation_context
    if _conversation_context is None:
        from app import conversation_context as ctx

        _conversation_context = ctx
    return _conversation_context


def process_message_streaming(
    user_id: str,
    message_text: str,
    connection_id: str,
    *,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """Process a user message and stream the AI response chunks to the client.

    Orchestration flow:
    1. Generate correlation ID if not provided
    2. Retrieve conversation history from DynamoDB (graceful degradation)
    3. Build messages list for AI invocation
    4. Invoke AgentCore in streaming mode
    5. Forward each chunk to client via message_sender as {"type": "chunk", "content": "..."}
    6. On client disconnect (send returns False), abort stream within 5s
    7. After stream completes, send {"type": "done"} and save assembled response

    Args:
        user_id: User identifier for conversation tracking.
        message_text: The user's message content.
        connection_id: WebSocket connection ID for sending chunks.
        correlation_id: Optional request correlation identifier. Generated if not provided.

    Returns:
        Dict with keys: response (str), conversationId (str), streamed (bool).

    Raises:
        RuntimeError: If the AI caller encounters an unrecoverable error.
    """
    if not correlation_id:
        correlation_id = str(uuid.uuid4())

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Processing message (streaming)",
        extra={"userId": user_id, "messageLength": len(message_text)},
    )

    ctx = _get_conversation_context()

    # Retrieve conversation history (returns [] on failure — graceful degradation)
    history = ctx.get_conversation_history(user_id, correlation_id=correlation_id)

    # Build messages list for AI invocation
    messages = [*history, {"role": "user", "content": message_text}]

    # Invoke AgentCore in streaming mode — yields text chunks
    chunks: list[str] = []
    client_disconnected = False

    try:
        for chunk_text in invoke_agentcore_streaming(
            session_id=user_id,
            messages=messages,
            correlation_id=correlation_id,
        ):
            # Forward chunk to client via WebSocket
            chunk_message = {"type": "chunk", "content": chunk_text}
            delivered = send_to_connection(connection_id, chunk_message)

            if not delivered:
                # Client disconnected mid-stream — abort
                client_disconnected = True
                logger.warning(
                    "Client disconnected mid-stream — aborting",
                    extra={
                        "userId": user_id,
                        "connectionId": connection_id,
                        "chunksDelivered": len(chunks),
                    },
                )
                break

            chunks.append(chunk_text)

    except Exception as e:
        # AI streaming error mid-stream
        logger.error(
            "Streaming AI call failed",
            extra={
                "userId": user_id,
                "connectionId": connection_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "chunksDelivered": len(chunks),
            },
        )
        # Send error to client (best-effort)
        error_message = {
            "type": "error",
            "message": "AI streaming failed — please retry",
            "correlationId": correlation_id,
        }
        send_to_connection(connection_id, error_message)

        # Discard partial response — do NOT save to conversation history
        return {
            "response": "",
            "conversationId": user_id,
            "streamed": False,
            "error": str(e),
        }

    if client_disconnected:
        # Do NOT save partial response to conversation history
        logger.info(
            "Stream aborted due to client disconnect — partial response discarded",
            extra={"userId": user_id, "chunksDelivered": len(chunks)},
        )
        return {
            "response": "",
            "conversationId": user_id,
            "streamed": False,
            "disconnected": True,
        }

    # Assemble full response from all chunks
    full_response = "".join(chunks)

    # Send "done" message to client
    from datetime import datetime, timezone

    done_message = {
        "type": "done",
        "conversationId": user_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    send_to_connection(connection_id, done_message)

    # Save conversation exchange to history
    ctx.append_messages(
        user_id=user_id,
        user_message=message_text,
        assistant_response=full_response,
        correlation_id=correlation_id,
    )

    logger.info(
        "Streaming message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(full_response),
            "totalChunks": len(chunks),
        },
    )

    return {
        "response": full_response,
        "conversationId": user_id,
        "streamed": True,
    }
