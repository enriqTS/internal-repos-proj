"""Orchestrator module for ECS chatbot service — Mantle variant.

Manages the conversation flow: retrieves history, invokes the AI caller
via direct in-process function call, handles the tool-use loop, and returns
the response. Reuses the shared conversation context module pattern adapted
for ECS.

Key differences from the AgentCore variant:
- Implements a tool-use loop (iterate until no function_call items, max iterations)
- AI Caller and Tool Executor are called directly (no Lambda invocations)
- No SQS event processing — called directly from FastAPI route handler
- No WebSocket message delivery — returns response to the HTTP caller
"""

import json
import os
import uuid
from typing import Any

from app.ai_caller import invoke_mantle
from app.logging_config import get_logger
from app.tool_executor import execute_tool

logger = get_logger("orchestrator")

# Maximum tool-use loop iterations before aborting
MAX_TOOL_ITERATIONS = int(os.environ.get("MAX_TOOL_ITERATIONS", "10"))

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
    *,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """Process a user message and return the AI response.

    Orchestration flow (Mantle tool-use loop):
    1. Generate correlation ID if not provided
    2. Retrieve conversation history from DynamoDB (graceful degradation)
    3. Build messages list for AI invocation
    4. Tool-use loop: invoke Mantle, handle function_calls until text response
    5. Save conversation exchange to history
    6. Return the response

    The tool-use loop iterates until:
    - The AI returns a response without function_call items (success)
    - MAX_TOOL_ITERATIONS is reached (error)

    Args:
        user_id: User identifier for conversation tracking.
        message_text: The user's message content.
        correlation_id: Optional request correlation identifier. Generated if not provided.

    Returns:
        Dict with keys: response (str), conversationId (str), usage (dict).

    Raises:
        RuntimeError: If the AI caller encounters an unrecoverable error or
            the tool-use loop exceeds MAX_TOOL_ITERATIONS.
    """
    if not correlation_id:
        correlation_id = str(uuid.uuid4())

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Processing message",
        extra={"userId": user_id, "messageLength": len(message_text)},
    )

    ctx = _get_conversation_context()

    # Retrieve conversation history (returns [] on failure — graceful degradation)
    history = ctx.get_conversation_history(user_id, correlation_id=correlation_id)

    # Build messages list for AI invocation
    messages: list[dict[str, Any]] = [*history, {"role": "user", "content": message_text}]

    # Tool-use loop: iterate until we get a text-only response or hit max iterations
    final_content: str = ""
    final_usage: dict[str, Any] = {}
    tool_call_history: list[dict[str, Any]] = []

    for iteration in range(MAX_TOOL_ITERATIONS):
        logger.info(
            "Tool-use loop iteration",
            extra={
                "correlationId": correlation_id,
                "iteration": iteration + 1,
                "maxIterations": MAX_TOOL_ITERATIONS,
            },
        )

        # Invoke Mantle API (non-streaming)
        result = invoke_mantle(
            messages=messages,
            correlation_id=correlation_id,
            stream=False,
        )

        function_calls = result.get("function_calls", [])
        final_usage = result.get("usage", {})

        if not function_calls:
            # No tool calls — we have a final text response
            final_content = result.get("content", "")
            break

        # Tool calls present — execute each tool and build follow-up messages
        logger.info(
            "Tool calls requested",
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
                arguments = json.loads(fc["arguments"]) if isinstance(fc["arguments"], str) else fc["arguments"]
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
            "Tool-use loop exceeded maximum iterations",
            extra={
                "correlationId": correlation_id,
                "maxIterations": MAX_TOOL_ITERATIONS,
                "userId": user_id,
            },
        )
        raise RuntimeError(
            f"Maximum tool iterations exceeded ({MAX_TOOL_ITERATIONS})"
        )

    # Save conversation exchange to history
    ctx.append_messages(
        user_id=user_id,
        user_message=message_text,
        assistant_response=final_content,
        correlation_id=correlation_id,
    )

    logger.info(
        "Message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(final_content),
            "toolIterations": iteration + 1 if function_calls else 1,
        },
    )

    return {
        "response": final_content,
        "conversationId": user_id,
        "usage": final_usage,
    }
