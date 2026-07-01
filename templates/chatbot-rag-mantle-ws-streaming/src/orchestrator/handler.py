"""Lambda handler for the Orchestrator — SQS-triggered (Mantle streaming).

Receives user messages from the SQS FIFO queue, retrieves conversation history,
invokes the AI Caller (Mantle) with streaming tool-use loop, and streams the final
response token-by-token to the client via the WebSocket Message Sender.

Streaming tool-use loop:
1. Call streaming AI → consume all events
2. If response has function_call items: DO NOT stream to client, send status message,
   execute tools, make follow-up streaming request
3. If response has text_delta without function_calls: THIS is the final response —
   stream chunks to client
4. Only stream tokens from the final iteration (the one without function_calls)

Environment variables:
- DYNAMODB_TABLE_NAME: DynamoDB table for user conversation context
- CONNECTION_TABLE_NAME: DynamoDB table for WebSocket connections
- WEBSOCKET_API_ENDPOINT: API Gateway Management API endpoint URL
- MANTLE_BASE_URL: Bedrock Mantle API endpoint URL
- MODEL_ID: Model identifier for Bedrock invocation
- MAX_CONVERSATION_HISTORY: Max messages retained (default: 50)
- MAX_TOOL_ITERATIONS: Max tool-use loop iterations (default: 10)
- MAX_CHUNK_SIZE: Max tokens per WebSocket frame (default: 1)
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import json
import os
import uuid
from datetime import UTC
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext
from shared.ai_caller_mantle import invoke_mantle_streaming
from shared.connection_manager import get_connection_for_user
from shared.conversation_context import (
    get_conversation_history,
    save_conversation_history,
    trim_history,
)
from shared.message_protocol import (
    build_chunk_message,
    build_done_message,
    build_error_message,
    build_status_message,
)
from shared.message_sender import send_to_connection
from shared.tool_executor import execute_tool

logger = Logger(service="orchestrator")

MAX_TOOL_ITERATIONS = int(os.environ.get("MAX_TOOL_ITERATIONS", "10"))
MAX_CHUNK_SIZE = int(os.environ.get("MAX_CHUNK_SIZE", "1"))
MAX_CONVERSATION_HISTORY = int(os.environ.get("MAX_CONVERSATION_HISTORY", "50"))

# Tool definitions for the Mantle API — RAG knowledge base search
TOOLS = [
    {
        "type": "function",
        "name": "search_knowledge_base",
        "description": "Search the RAG knowledge base for relevant documents",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query to find relevant documents in the knowledge base",
                },
            },
            "required": ["query"],
        },
    },
]


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Process SQS messages containing user chat requests (streaming variant).

    Each SQS record contains a JSON body with userId and message fields.
    For each record:
    1. Parse and validate the message
    2. Retrieve conversation history
    3. Invoke Mantle AI caller with streaming tool-use loop
    4. Stream final response tokens to the client via WebSocket
    5. Save the full assembled response and tool results to history

    Args:
        event: SQS event with Records list.
        context: Lambda execution context.

    Returns:
        Dict with batchItemFailures for partial batch failure handling.
    """
    batch_item_failures: list[dict[str, str]] = []

    for record in event.get("Records", []):
        message_id = record.get("messageId", "")
        try:
            _process_record(record)
        except Exception as e:
            logger.error(
                "Failed to process SQS record",
                extra={
                    "messageId": message_id,
                    "error": str(e),
                },
            )
            batch_item_failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": batch_item_failures}


def _process_record(record: dict[str, Any]) -> None:
    """Process a single SQS record containing a user message (streaming).

    Args:
        record: SQS record with body containing JSON chat message.

    Raises:
        Exception: Propagated from AI caller or critical failures.
    """
    body = json.loads(record.get("body", "{}"))
    user_id = body.get("userId", "")
    message_text = body.get("message", "")
    correlation_id = record.get("messageId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Processing message (streaming)",
        extra={"userId": user_id, "messageLength": len(message_text)},
    )

    if not user_id or not message_text:
        logger.warning("Invalid message — missing userId or message")
        return

    # Look up the active WebSocket connection for this user
    connection_id = get_connection_for_user(user_id)
    if not connection_id:
        logger.warning(
            "No active WebSocket connection for user — cannot deliver response",
            extra={"userId": user_id},
        )
        return

    # Retrieve conversation history (returns [] on failure — graceful degradation)
    history = get_conversation_history(user_id, correlation_id=correlation_id)

    # Build messages list for AI invocation (OpenAI format)
    messages: list[dict[str, Any]] = [
        *history,
        {"role": "user", "content": message_text},
    ]

    # Execute streaming tool-use loop
    try:
        assembled_response, tool_results = _execute_streaming_tool_use_loop(
            messages=messages,
            connection_id=connection_id,
            correlation_id=correlation_id,
            user_id=user_id,
        )
    except _ClientDisconnectedError:
        logger.warning(
            "Client disconnected mid-stream — aborting",
            extra={
                "correlation_id": correlation_id,
                "userId": user_id,
                "connectionId": connection_id,
            },
        )
        return
    except _MaxIterationsExceededError:
        # Error already sent to client in the loop
        logger.error(
            "Max tool iterations exceeded — response not saved",
            extra={
                "correlation_id": correlation_id,
                "userId": user_id,
            },
        )
        return
    except Exception as e:
        logger.error(
            "Streaming AI invocation failed",
            extra={
                "correlation_id": correlation_id,
                "error": str(e),
            },
        )
        error_msg = build_error_message(
            "Processing failed — please retry",
            correlation_id,
        )
        send_to_connection(connection_id, error_msg)
        raise

    # Send done message after successful streaming
    done_msg = build_done_message(user_id)
    send_to_connection(connection_id, done_msg)

    # Save complete assembled response + intermediate tool results to conversation history
    _save_conversation(
        user_id=user_id,
        user_message=message_text,
        assistant_response=assembled_response,
        tool_results=tool_results,
        history=history,
        correlation_id=correlation_id,
    )

    logger.info(
        "Streaming message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(assembled_response),
            "toolIterations": len(tool_results),
        },
    )


class _ClientDisconnectedError(Exception):
    """Raised when client disconnects mid-stream."""


class _MaxIterationsExceededError(Exception):
    """Raised when max tool iterations are exceeded."""


def _execute_streaming_tool_use_loop(
    messages: list[dict[str, Any]],
    connection_id: str,
    correlation_id: str,
    user_id: str,
) -> tuple[str, list[dict[str, Any]]]:
    """Execute the Mantle streaming tool-use loop until completion.

    Iterates the streaming AI call. For each iteration:
    - If response contains function_call items: does NOT stream to client,
      sends a status message, executes tools, prepares follow-up request.
    - If response contains text_delta without function_calls: THIS is the
      final response — stream each chunk to the client.

    Only streams tokens from the final iteration.

    Args:
        messages: Conversation messages including the latest user message.
        connection_id: WebSocket connection ID for streaming delivery.
        correlation_id: Request correlation ID for logging.
        user_id: User identifier for done message.

    Returns:
        Tuple of (assembled_response_text, list_of_tool_results).

    Raises:
        _ClientDisconnectedError: If client disconnects mid-stream.
        _MaxIterationsExceededError: If max iterations exceeded.
        RuntimeError: On AI invocation errors.
    """
    tool_results: list[dict[str, Any]] = []

    for iteration in range(MAX_TOOL_ITERATIONS):
        logger.info(
            "Streaming tool-use loop iteration",
            extra={
                "iteration": iteration + 1,
                "maxIterations": MAX_TOOL_ITERATIONS,
                "correlation_id": correlation_id,
            },
        )

        # Consume the streaming response fully
        assembled_text, function_calls = _consume_streaming_response(
            messages=messages,
            correlation_id=correlation_id,
        )

        if not function_calls:
            # Final iteration — stream the assembled text to the client
            streamed = _stream_text_to_client(
                text=assembled_text,
                connection_id=connection_id,
                correlation_id=correlation_id,
            )
            if not streamed:
                raise _ClientDisconnectedError("Client disconnected during streaming")
            return assembled_text, tool_results

        # Tool-use iteration: send status message, execute tools, prepare follow-up
        status_msg = build_status_message("Processing...")
        delivered = send_to_connection(connection_id, status_msg)
        if not delivered:
            raise _ClientDisconnectedError(
                "Client disconnected during tool-use status",
            )

        # Execute each requested tool
        iteration_results: list[dict[str, Any]] = []
        for call in function_calls:
            tool_name = call.get("name", "")
            arguments_str = call.get("arguments", "{}")
            call_id = call.get("call_id", "")

            try:
                arguments = json.loads(arguments_str)
            except json.JSONDecodeError:
                arguments = {}

            logger.info(
                "Executing tool (streaming loop)",
                extra={
                    "toolName": tool_name,
                    "callId": call_id,
                    "iteration": iteration + 1,
                },
            )

            tool_result = execute_tool(
                tool_name=tool_name,
                arguments=arguments,
                correlation_id=correlation_id,
            )
            iteration_results.append(
                {
                    "call_id": call_id,
                    "tool_name": tool_name,
                    "arguments": arguments,
                    "result": tool_result,
                },
            )

            # Append function call and result to messages for follow-up request
            messages.append(
                {
                    "type": "function_call",
                    "name": tool_name,
                    "arguments": arguments_str,
                    "call_id": call_id,
                },
            )
            messages.append(
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps(tool_result.get("result", "")),
                },
            )

        tool_results.extend(iteration_results)

    # Max iterations exceeded — send error to client
    logger.error(
        "Max tool iterations exceeded (streaming)",
        extra={
            "maxIterations": MAX_TOOL_ITERATIONS,
            "correlation_id": correlation_id,
        },
    )
    error_msg = build_error_message(
        "Maximum tool iterations exceeded",
        correlation_id,
    )
    send_to_connection(connection_id, error_msg)
    raise _MaxIterationsExceededError(
        f"Tool-use loop exceeded {MAX_TOOL_ITERATIONS} iterations",
    )


def _consume_streaming_response(
    messages: list[dict[str, Any]],
    correlation_id: str,
) -> tuple[str, list[dict[str, Any]]]:
    """Consume a streaming AI response fully, collecting text and function calls.

    Does NOT stream to client — this function only collects the response data.
    The caller decides whether to stream (final iteration) or handle tool calls.

    Args:
        messages: Current conversation messages.
        correlation_id: Request correlation ID.

    Returns:
        Tuple of (assembled_text, function_calls_list).

    Raises:
        RuntimeError: On AI streaming errors.
    """
    assembled_text = ""
    function_calls: list[dict[str, Any]] = []

    stream_gen = invoke_mantle_streaming(
        messages=messages,
        tools=TOOLS,
        correlation_id=correlation_id,
    )

    for event in stream_gen:
        event_type = event.get("type", "")

        if event_type == "text_delta":
            assembled_text += event.get("content", "")
        elif event_type == "function_call":
            function_calls.append(event)
        elif event_type == "done":
            # Stream finished — usage and status are in this event
            pass

    return assembled_text, function_calls


def _stream_text_to_client(
    text: str,
    connection_id: str,
    correlation_id: str,
) -> bool:
    """Stream assembled text to the client in chunks.

    Splits the text based on MAX_CHUNK_SIZE and sends each chunk as a
    WebSocket message of type "chunk".

    Args:
        text: The full assembled response text to stream.
        connection_id: WebSocket connection ID.
        correlation_id: Request correlation ID.

    Returns:
        True if all chunks were delivered, False if client disconnected.
    """
    if not text:
        return True

    # Split into chunks based on MAX_CHUNK_SIZE (token approximation: chars)
    chunks = _split_into_chunks(text, MAX_CHUNK_SIZE)

    for chunk in chunks:
        chunk_msg = build_chunk_message(chunk)
        delivered = send_to_connection(connection_id, chunk_msg)
        if not delivered:
            logger.warning(
                "Failed to deliver chunk — client may have disconnected",
                extra={
                    "connectionId": connection_id,
                    "correlation_id": correlation_id,
                },
            )
            return False

    return True


def _split_into_chunks(text: str, chunk_size: int) -> list[str]:
    """Split text into chunks of approximately chunk_size tokens.

    Uses simple character-based splitting as a token approximation.
    Each chunk will be at most chunk_size characters.

    Args:
        text: Text to split.
        chunk_size: Maximum characters per chunk.

    Returns:
        List of text chunks.
    """
    if chunk_size <= 0:
        chunk_size = 1

    if len(text) <= chunk_size:
        return [text]

    chunks: list[str] = []
    for i in range(0, len(text), chunk_size):
        chunks.append(text[i : i + chunk_size])
    return chunks


def _save_conversation(
    user_id: str,
    user_message: str,
    assistant_response: str,
    tool_results: list[dict[str, Any]],
    history: list[dict[str, Any]],
    correlation_id: str,
) -> None:
    """Save the complete conversation exchange including tool results.

    Appends the user message, any tool interaction records, and the final
    assistant response to the conversation history and persists it.

    Args:
        user_id: User identifier.
        user_message: Original user message text.
        assistant_response: Full assembled AI response.
        tool_results: List of intermediate tool call results.
        history: Existing conversation history.
        correlation_id: Request correlation ID.
    """
    from datetime import datetime

    now = datetime.now(UTC).isoformat()

    # Build updated messages list
    updated_messages = [*history]

    # Add user message
    updated_messages.append(
        {"role": "user", "content": user_message, "timestamp": now},
    )

    # Add tool interaction records if any
    if tool_results:
        updated_messages.append(
            {
                "role": "assistant",
                "content": "",
                "timestamp": now,
                "tool_calls": [
                    {
                        "call_id": r["call_id"],
                        "tool_name": r["tool_name"],
                        "arguments": r["arguments"],
                    }
                    for r in tool_results
                ],
                "tool_results": [
                    {
                        "call_id": r["call_id"],
                        "result": r["result"],
                    }
                    for r in tool_results
                ],
            },
        )

    # Add final assistant response
    updated_messages.append(
        {"role": "assistant", "content": assistant_response, "timestamp": now},
    )

    # Trim and save
    trimmed = trim_history(updated_messages, MAX_CONVERSATION_HISTORY)
    save_conversation_history(user_id, trimmed, correlation_id=correlation_id)
