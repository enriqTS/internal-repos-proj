"""Lambda handler for the Orchestrator — SQS-triggered message processing (Mantle variant).

Receives user messages from the SQS FIFO queue, retrieves conversation history,
invokes the AI Caller (Mantle) with tool-use loop, and sends the complete response
back to the client via the WebSocket Message Sender.

Non-streaming: iterates tool-use loop until no function_call items remain, then
sends the final text response as a single "message" type.

Environment variables:
- DYNAMODB_TABLE_NAME: DynamoDB table for user conversation context
- CONNECTION_TABLE_NAME: DynamoDB table for WebSocket connections
- WEBSOCKET_API_ENDPOINT: API Gateway Management API endpoint URL
- MANTLE_BASE_URL: Bedrock Mantle API endpoint URL
- MODEL_ID: Model identifier for Bedrock invocation
- MAX_CONVERSATION_HISTORY: Max messages retained (default: 50)
- MAX_TOOL_ITERATIONS: Max tool-use loop iterations (default: 10)
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import json
import os
import uuid
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from shared.ai_caller_mantle import (
    get_function_calls,
    get_text_content,
    has_function_calls,
    invoke_mantle,
)
from shared.connection_manager import get_connection_for_user
from shared.conversation_context import append_messages, get_conversation_history
from shared.message_protocol import build_error_message, build_message_response
from shared.message_sender import send_to_connection
from shared.tool_executor import execute_tool

logger = Logger(service="orchestrator")

MAX_TOOL_ITERATIONS = int(os.environ.get("MAX_TOOL_ITERATIONS", "10"))

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
                }
            },
            "required": ["query"],
        },
    }
]


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Process SQS messages containing user chat requests.

    Each SQS record contains a JSON body with userId and message fields.
    For each record:
    1. Parse and validate the message
    2. Retrieve conversation history
    3. Invoke Mantle AI caller with tool-use loop
    4. Send the complete response to the client via WebSocket
    5. Save the conversation exchange to history

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
    """Process a single SQS record containing a user message.

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
        "Processing message",
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

    # Execute tool-use loop: iterate until no function_call items or max iterations
    try:
        ai_response = _execute_tool_use_loop(
            messages=messages,
            connection_id=connection_id,
            correlation_id=correlation_id,
        )
    except Exception as e:
        logger.error(
            "AI invocation failed",
            extra={
                "correlation_id": correlation_id,
                "error": str(e),
            },
        )
        error_msg = build_error_message(
            "Processing failed — please retry", correlation_id
        )
        send_to_connection(connection_id, error_msg)
        raise

    # Send the complete response as a single "message" type (non-streaming)
    response_msg = build_message_response(ai_response, user_id)
    delivered = send_to_connection(connection_id, response_msg)

    if not delivered:
        logger.warning(
            "Failed to deliver response — connection may be stale",
            extra={"connectionId": connection_id, "userId": user_id},
        )

    # Save conversation exchange to history
    append_messages(
        user_id=user_id,
        user_message=message_text,
        assistant_response=ai_response,
        correlation_id=correlation_id,
    )

    logger.info(
        "Message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(ai_response),
            "delivered": delivered,
        },
    )


def _execute_tool_use_loop(
    messages: list[dict[str, Any]],
    connection_id: str,
    correlation_id: str,
) -> str:
    """Execute the Mantle tool-use loop until completion.

    Calls invoke_mantle repeatedly. If the response contains function_call items,
    executes the tools and appends results to messages for the next iteration.
    Continues until no function_call items remain or MAX_TOOL_ITERATIONS is reached.

    Args:
        messages: Conversation messages including the latest user message.
        connection_id: WebSocket connection ID for status updates.
        correlation_id: Request correlation ID for logging.

    Returns:
        Final text response from the AI.

    Raises:
        RuntimeError: If max iterations exceeded or AI invocation fails.
    """
    for iteration in range(MAX_TOOL_ITERATIONS):
        logger.info(
            "Tool-use loop iteration",
            extra={
                "iteration": iteration + 1,
                "maxIterations": MAX_TOOL_ITERATIONS,
                "correlation_id": correlation_id,
            },
        )

        result = invoke_mantle(
            messages=messages,
            tools=TOOLS,
            correlation_id=correlation_id,
            stream=False,
        )

        output_items = result.get("output", [])

        if not has_function_calls(output_items):
            # Final text response — extract and return
            text_response = get_text_content(output_items)
            return text_response

        # Execute requested tools and append results to messages
        function_calls = get_function_calls(output_items)

        for call in function_calls:
            tool_name = call.get("name", "")
            arguments_str = call.get("arguments", "{}")
            call_id = call.get("call_id", "")

            try:
                arguments = json.loads(arguments_str)
            except json.JSONDecodeError:
                arguments = {}

            logger.info(
                "Executing tool",
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

            # Append the function call and result to messages for follow-up request
            messages.append(
                {
                    "type": "function_call",
                    "name": tool_name,
                    "arguments": arguments_str,
                    "call_id": call_id,
                }
            )
            messages.append(
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps(tool_result.get("result", "")),
                }
            )

    # Max iterations exceeded
    logger.error(
        "Max tool iterations exceeded",
        extra={
            "maxIterations": MAX_TOOL_ITERATIONS,
            "correlation_id": correlation_id,
        },
    )
    error_msg = build_error_message(
        "Maximum tool iterations exceeded", correlation_id
    )
    send_to_connection(connection_id, error_msg)
    raise RuntimeError(
        f"Tool-use loop exceeded {MAX_TOOL_ITERATIONS} iterations"
    )
