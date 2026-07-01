"""Lambda handler for the AI Caller — wraps shared Mantle AI caller (streaming variant).

Provides a Lambda entry-point around the shared Mantle (OpenAI SDK) invocation logic.
In this streaming variant, the AI caller is invoked via the shared module's
invoke_mantle_streaming() generator. This handler exists for cases where the AI
caller needs to be invoked as a separate Lambda function (e.g., timeout isolation).

Environment variables:
- MANTLE_BASE_URL: Bedrock Mantle API endpoint URL
- MODEL_ID: Model identifier for Bedrock invocation
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import uuid
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext
from shared.ai_caller_mantle import invoke_mantle, invoke_mantle_streaming

logger = Logger(service="ai_caller")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Invoke Bedrock Mantle API and return the AI response.

    Supports both streaming and non-streaming modes. When invoked as a standalone
    Lambda, streaming is consumed fully and the complete result is returned
    (streaming delivery to clients is handled by the orchestrator).

    Args:
        event: Dict containing:
            - messages: Conversation message history list.
            - tools: Tool definitions for function calling.
            - correlationId: Optional request correlation identifier.
            - stream: Optional boolean to enable streaming mode (default: True).
        context: Lambda execution context.

    Returns:
        Dict with keys: output (list of output items), usage, status.
        On error: Dict with key: error.
    """
    messages = event.get("messages", [])
    tools = event.get("tools", [])
    correlation_id = event.get("correlationId", str(uuid.uuid4()))
    stream = event.get("stream", True)

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "AI Caller invoked (streaming variant)",
        extra={
            "messageCount": len(messages),
            "toolCount": len(tools),
            "stream": stream,
        },
    )

    try:
        if stream:
            # Consume the streaming generator and return the final result
            result = _consume_stream(messages, tools, correlation_id)
        else:
            result = invoke_mantle(
                messages=messages,
                tools=tools,
                correlation_id=correlation_id,
                stream=False,
            )
        return result
    except Exception as e:
        logger.error(
            "AI invocation failed",
            extra={
                "error": str(e),
                "stream": stream,
            },
        )
        return {"error": f"AI invocation failed: {e}"}


def _consume_stream(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    correlation_id: str,
) -> dict[str, Any]:
    """Consume the streaming generator fully and return the collected result.

    When the AI caller is invoked as a standalone Lambda (not inline),
    the stream must be consumed fully since Lambda cannot yield progressively.

    Args:
        messages: Conversation messages.
        tools: Tool definitions.
        correlation_id: Request correlation ID.

    Returns:
        Dict with output items, usage, and status.
    """
    assembled_text = ""
    function_calls: list[dict[str, Any]] = []
    usage: dict[str, int] = {}
    status = "unknown"

    stream_gen = invoke_mantle_streaming(
        messages=messages,
        tools=tools,
        correlation_id=correlation_id,
    )

    for event in stream_gen:
        event_type = event.get("type", "")
        if event_type == "text_delta":
            assembled_text += event.get("content", "")
        elif event_type == "function_call":
            function_calls.append(event)
        elif event_type == "done":
            usage = event.get("usage", {})
            status = event.get("status", "unknown")

    # Build output items
    output_items: list[dict[str, Any]] = []
    if assembled_text:
        output_items.append({"type": "message", "content": assembled_text})
    output_items.extend(function_calls)

    return {
        "output": output_items,
        "usage": usage,
        "status": status,
    }
