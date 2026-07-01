"""Orchestrator module for ECS WebSocket chatbot service — Mantle streaming variant.

Manages the conversation flow: retrieves history, invokes the AI caller
via direct in-process function call with streaming, handles the streaming
tool-use loop, and sends chunked responses to the WebSocket client.

Key differences from the non-streaming ECS WebSocket Mantle variant:
1. AI caller has streaming invoke function (invoke_mantle_streaming generator)
2. Streaming tool-use loop:
   - Consume full stream per iteration
   - If function_calls found: DON'T stream to client, send status msg, execute tools, follow-up
   - If text only (no function_calls): stream chunks to client
3. Only stream from the final iteration (no function_calls)
4. Send {"type": "status", "message": "Processing..."} once per tool-use iteration
5. MAX_TOOL_ITERATIONS exceeded: send error, log ERROR, don't save
6. Client disconnect: abort, log WARN, don't save partial
7. After success: save full response + tool results to conversation history
"""

import json
import os
import uuid
from typing import Any

from app.ai_caller import invoke_mantle_streaming
from app.logging_config import get_logger
from app.message_protocol import (
    build_chunk_message,
    build_done_message,
    build_error_message,
    build_status_message,
)
from app.message_sender import send_to_connection
from app.tool_executor import execute_tool

logger = get_logger("orchestrator")

# Maximum tool-use loop iterations before aborting
MAX_TOOL_ITERATIONS = int(os.environ.get("MAX_TOOL_ITERATIONS", "10"))

# Maximum tokens per WebSocket frame (1-50)
MAX_CHUNK_SIZE = int(os.environ.get("MAX_CHUNK_SIZE", "1"))

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


def process_message(
    user_id: str,
    message_text: str,
    connection_id: str,
    *,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """Process a user message with streaming tool-use loop.

    Orchestration flow (Mantle streaming tool-use loop with WebSocket delivery):
    1. Generate correlation ID if not provided
    2. Retrieve conversation history from DynamoDB (graceful degradation)
    3. Build messages list for AI invocation
    4. Streaming tool-use loop:
       a. Invoke Mantle streaming, consume full stream for iteration
       b. If function_calls found: DON'T stream to client, send status msg,
          execute tools, append results, next iteration
       c. If text only (no function_calls): stream chunks to client (final response)
    5. Send done message to client
    6. Save complete response and tool call history to conversation history
    7. Return result summary

    The tool-use loop iterates until:
    - The AI returns a text-only response without function_call items (success → stream it)
    - MAX_TOOL_ITERATIONS is reached (error sent to client, no save)

    Args:
        user_id: User identifier for conversation tracking.
        message_text: The user's message content.
        connection_id: WebSocket connection ID for sending response.
        correlation_id: Optional request correlation identifier. Generated if not provided.

    Returns:
        Dict with keys: response (str), conversationId (str), usage (dict), delivered (bool).
    """
    if not correlation_id:
        correlation_id = str(uuid.uuid4())

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Processing message (streaming)",
        extra={
            "userId": user_id,
            "messageLength": len(message_text),
            "connectionId": connection_id,
        },
    )

    ctx = _get_conversation_context()

    # Retrieve conversation history (returns [] on failure — graceful degradation)
    history = ctx.get_conversation_history(user_id, correlation_id=correlation_id)

    # Build messages list for AI invocation
    messages: list[dict[str, Any]] = [*history, {"role": "user", "content": message_text}]

    # Streaming tool-use loop
    final_content: str = ""
    final_usage: dict[str, Any] = {}
    tool_call_history: list[dict[str, Any]] = []
    delivered: bool = False

    for iteration in range(MAX_TOOL_ITERATIONS):
        logger.info(
            "Streaming tool-use loop iteration",
            extra={
                "correlationId": correlation_id,
                "iteration": iteration + 1,
                "maxIterations": MAX_TOOL_ITERATIONS,
            },
        )

        # Consume the full streaming response for this iteration
        text_chunks: list[str] = []
        function_calls: list[dict[str, Any]] = []
        iteration_usage: dict[str, Any] = {}

        try:
            for event in invoke_mantle_streaming(
                messages=messages,
                correlation_id=correlation_id,
            ):
                event_type = event.get("type", "")

                if event_type == "text_delta":
                    text_chunks.append(event.get("content", ""))

                elif event_type == "function_call":
                    function_calls.append({
                        "name": event.get("name", ""),
                        "arguments": event.get("arguments", ""),
                        "call_id": event.get("call_id", ""),
                    })

                elif event_type == "done":
                    iteration_usage = event.get("usage", {})

        except RuntimeError as e:
            # AI streaming error mid-stream — send error to client, discard partial
            logger.error(
                "Streaming error mid-stream",
                extra={
                    "correlationId": correlation_id,
                    "iteration": iteration + 1,
                    "error": str(e),
                },
            )
            error_msg = build_error_message(
                "AI service streaming error",
                correlation_id=correlation_id,
            )
            send_to_connection(connection_id, error_msg)
            return {
                "response": "",
                "conversationId": user_id,
                "usage": iteration_usage,
                "delivered": False,
            }

        final_usage = iteration_usage

        if not function_calls:
            # No tool calls — this is the FINAL response. Stream chunks to client.
            final_content = "".join(text_chunks)
            delivered = _stream_final_response(
                text_chunks=text_chunks,
                connection_id=connection_id,
                user_id=user_id,
                correlation_id=correlation_id,
            )
            break

        # Tool calls present — DON'T stream to client. Send status message.
        status_msg = build_status_message("Processing...")
        send_to_connection(connection_id, status_msg)

        logger.info(
            "Tool calls requested (streaming iteration)",
            extra={
                "correlationId": correlation_id,
                "iteration": iteration + 1,
                "toolCallCount": len(function_calls),
                "toolNames": [fc.get("name", "") for fc in function_calls],
            },
        )

        # Append the assistant's output (with tool calls) to messages
        for fc in function_calls:
            messages.append({
                "type": "function_call",
                "name": fc["name"],
                "arguments": fc["arguments"],
                "call_id": fc["call_id"],
            })
            tool_call_history.append(fc)

        # Execute each tool and append results
        for fc in function_calls:
            try:
                arguments = (
                    json.loads(fc["arguments"])
                    if isinstance(fc["arguments"], str)
                    else fc["arguments"]
                )
            except (json.JSONDecodeError, TypeError):
                arguments = {}

            tool_result = execute_tool(
                tool_name=fc["name"],
                arguments=arguments,
                correlation_id=correlation_id,
            )

            # Append tool result as function_call_output for next Mantle request
            messages.append({
                "type": "function_call_output",
                "call_id": fc["call_id"],
                "output": json.dumps(tool_result.get("result", tool_result)),
            })
    else:
        # Max iterations reached without a text-only response
        logger.error(
            "Streaming tool-use loop exceeded maximum iterations",
            extra={
                "correlationId": correlation_id,
                "maxIterations": MAX_TOOL_ITERATIONS,
                "userId": user_id,
            },
        )
        error_msg = build_error_message(
            "Maximum tool iterations exceeded",
            correlation_id=correlation_id,
        )
        send_to_connection(connection_id, error_msg)
        return {
            "response": "",
            "conversationId": user_id,
            "usage": final_usage,
            "delivered": False,
        }

    # Save conversation exchange to history (full response + tool results)
    # Only save if the response was delivered successfully
    if delivered:
        ctx.append_messages(
            user_id=user_id,
            user_message=message_text,
            assistant_response=final_content,
            correlation_id=correlation_id,
        )

    logger.info(
        "Streaming message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(final_content),
            "toolIterations": iteration + 1,
            "toolCallCount": len(tool_call_history),
            "delivered": delivered,
        },
    )

    return {
        "response": final_content,
        "conversationId": user_id,
        "usage": final_usage,
        "delivered": delivered,
    }


def _stream_final_response(
    text_chunks: list[str],
    connection_id: str,
    user_id: str,
    correlation_id: str,
) -> bool:
    """Stream the final assembled text chunks to the WebSocket client.

    Respects MAX_CHUNK_SIZE by batching tokens before sending each frame.
    After all chunks are sent, sends a done message.

    Args:
        text_chunks: List of text tokens/chunks from the AI stream.
        connection_id: WebSocket connection ID for sending response.
        user_id: User/conversation identifier.
        correlation_id: Request correlation identifier for logging.

    Returns:
        True if all chunks and done message were delivered successfully.
    """
    # Batch chunks according to MAX_CHUNK_SIZE
    buffer: str = ""
    chunk_count: int = 0

    for chunk_text in text_chunks:
        buffer += chunk_text
        chunk_count += 1

        if chunk_count >= MAX_CHUNK_SIZE:
            chunk_msg = build_chunk_message(buffer)
            success = send_to_connection(connection_id, chunk_msg)
            if not success:
                # Client disconnected mid-stream
                logger.warning(
                    "Client disconnected during streaming — aborting",
                    extra={
                        "correlationId": correlation_id,
                        "connectionId": connection_id,
                    },
                )
                return False
            buffer = ""
            chunk_count = 0

    # Send remaining buffer
    if buffer:
        chunk_msg = build_chunk_message(buffer)
        success = send_to_connection(connection_id, chunk_msg)
        if not success:
            logger.warning(
                "Client disconnected during streaming — aborting",
                extra={
                    "correlationId": correlation_id,
                    "connectionId": connection_id,
                },
            )
            return False

    # Send done message
    done_msg = build_done_message(user_id)
    return send_to_connection(connection_id, done_msg)
