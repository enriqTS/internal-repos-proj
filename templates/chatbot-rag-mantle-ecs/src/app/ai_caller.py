"""AI Caller module — Mantle variant for ECS in-process use.

Wraps the Bedrock Mantle API via OpenAI SDK for direct function call use
within the ECS container. Uses the OpenAI-compatible endpoint (bedrock-mantle)
with stream=False for non-streaming REST usage.

Configuration via environment variables:
- MANTLE_BASE_URL: Bedrock Mantle API base URL
- MODEL_ID: Bedrock model identifier

This module contains the same core logic as the Lambda AI caller variant.
The only differences are: module import paths and absence of Lambda handler
entry-point wrapper.
"""

import os
import time
from typing import Any

from openai import OpenAI, OpenAIError

from app.logging_config import get_logger, log_ai_interaction

logger = get_logger("ai_caller")

# PLACEHOLDER: Replace this system prompt with your own instructions.
SYSTEM_PROMPT = "You are a helpful assistant. Replace this prompt with your own instructions."

MANTLE_BASE_URL = os.environ.get("MANTLE_BASE_URL", "https://bedrock-mantle.us-east-1.api.aws/v1")
MODEL_ID = os.environ.get("MODEL_ID", "your-model-id")

# Tool definitions for the Mantle API (RAG knowledge base search)
TOOL_DEFINITIONS: list[dict[str, Any]] = [
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


def invoke_mantle(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    correlation_id: str = "",
    stream: bool = False,
) -> dict[str, Any]:
    """Invoke Mantle API via OpenAI SDK (non-streaming).

    Uses the OpenAI Python SDK with bedrock-mantle base URL. Calls the
    responses.create endpoint with stream=False for complete response.

    Args:
        messages: Conversation message history in OpenAI format.
        tools: Tool definitions for function calling. Defaults to TOOL_DEFINITIONS.
        correlation_id: Request correlation identifier for logging.
        stream: Unused in this non-streaming variant. Reserved for interface consistency.

    Returns:
        Dict with keys:
        - output: List of output items (message content and/or function_calls).
        - usage: Dict with inputTokens, outputTokens, totalTokens.
        - status: Response status from the API.
        - function_calls: List of function call dicts (name, arguments, call_id) if any.
        - content: Text content from the response (empty string if only tool calls).

    Raises:
        RuntimeError: If the Mantle API returns an error.
    """
    start_time = time.time()

    if tools is None:
        tools = TOOL_DEFINITIONS

    logger.info(
        "Invoking Mantle API",
        extra={
            "correlationId": correlation_id,
            "messageCount": len(messages),
            "toolCount": len(tools),
        },
    )

    client = OpenAI(
        base_url=MANTLE_BASE_URL,
        api_key="bedrock",  # AWS auth handled by SDK credentials
    )

    try:
        response = client.responses.create(
            model=MODEL_ID,
            instructions=SYSTEM_PROMPT,
            input=messages,
            tools=tools if tools else None,
            stream=False,
        )
    except OpenAIError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        logger.error(
            "Mantle API error",
            extra={
                "correlationId": correlation_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "latencyMs": latency_ms,
            },
        )
        raise RuntimeError(f"Mantle API error: {type(e).__name__}: {e}") from e

    latency_ms = int((time.time() - start_time) * 1000)

    # Extract usage information
    input_tokens = response.usage.input_tokens if response.usage else 0
    output_tokens = response.usage.output_tokens if response.usage else 0
    total_tokens = response.usage.total_tokens if response.usage else 0

    # Log AI interaction (single entry after response completes — Req 15.3)
    log_ai_interaction(
        logger,
        correlation_id=correlation_id,
        model=MODEL_ID,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        latency_ms=latency_ms,
        finish_reason=response.status if hasattr(response, "status") else "stop",
    )

    # Parse output items — extract function_calls and text content
    function_calls: list[dict[str, Any]] = []
    content_parts: list[str] = []

    for item in response.output:
        if item.type == "function_call":
            function_calls.append({
                "name": item.name,
                "arguments": item.arguments,
                "call_id": item.call_id,
            })
        elif item.type == "message":
            for content_block in item.content:
                if hasattr(content_block, "text") and content_block.text:
                    content_parts.append(content_block.text)

    content_text = "".join(content_parts)

    if function_calls:
        logger.info(
            "AI requested tool calls",
            extra={
                "correlationId": correlation_id,
                "toolCallCount": len(function_calls),
                "toolNames": [fc["name"] for fc in function_calls],
            },
        )

    result: dict[str, Any] = {
        "output": [_serialize_output_item(item) for item in response.output],
        "usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
        },
        "status": response.status if hasattr(response, "status") else None,
        "function_calls": function_calls,
        "content": content_text,
    }

    return result


def _serialize_output_item(item: Any) -> dict[str, Any]:
    """Serialize a response output item to a dict for internal use.

    Args:
        item: OpenAI ResponseOutputItem (union type).

    Returns:
        Dict representation of the output item.
    """
    serialized: dict[str, Any] = {"type": item.type}

    if item.type == "message":
        serialized["content"] = [
            {"type": c.type, "text": c.text}
            for c in item.content
            if hasattr(c, "text")
        ]
    elif item.type == "function_call":
        serialized["name"] = item.name
        serialized["arguments"] = item.arguments
        serialized["call_id"] = item.call_id

    return serialized
