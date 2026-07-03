"""AI Caller module — Mantle streaming variant for ECS in-process use.

Wraps the Bedrock Mantle API via OpenAI SDK for direct function call use
within the ECS container. Uses the OpenAI-compatible endpoint (bedrock-mantle)
with stream=True for streaming WebSocket usage.

Configuration via environment variables:
- MANTLE_BASE_URL: Bedrock Mantle API base URL
- MODEL_ID: Bedrock model identifier

This module contains the same core logic as the Lambda AI caller variant.
The only differences are: (a) the `stream` parameter value (True for streaming),
(b) module import paths, and (c) absence of Lambda handler entry-point wrapper.
"""

import os
import time
from collections.abc import Generator
from typing import Any

from aws_lambda_powertools import Logger
from openai import OpenAI, OpenAIError

logger = Logger(service="ai_caller")

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


def _log_ai_interaction(
    *,
    correlation_id: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    latency_ms: float,
    finish_reason: str,
) -> None:
    """Log an AI interaction with structured fields.

    Emits a single structured INFO log entry after an AI service call completes.
    """
    logger.info(
        "AI interaction completed",
        extra={
            "logType": "ai-interaction",
            "correlation_id": correlation_id,
            "model": model,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
            "latencyMs": latency_ms,
            "finishReason": finish_reason,
        },
    )


def invoke_mantle(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    correlation_id: str = "",
    stream: bool = False,
) -> dict[str, Any]:
    """Invoke Mantle API via OpenAI SDK (non-streaming).

    Used for tool-use loop iterations where we need to consume the full
    response before deciding whether to stream to the client.

    Args:
        messages: Conversation message history in OpenAI format.
        tools: Tool definitions for function calling. Defaults to TOOL_DEFINITIONS.
        correlation_id: Request correlation identifier for logging.
        stream: If True, consumes the stream internally and returns assembled result.

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
            "stream": stream,
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
    _log_ai_interaction(
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
            function_calls.append(
                {
                    "name": item.name,
                    "arguments": item.arguments,
                    "call_id": item.call_id,
                }
            )
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


def invoke_mantle_streaming(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    correlation_id: str = "",
) -> Generator[dict[str, Any], None, None]:
    """Invoke Mantle API with streaming enabled (stream=True).

    Yields each chunk/event as it arrives from the Mantle API. The caller
    (orchestrator) is responsible for assembling chunks and deciding whether
    to forward them to the client.

    Each yielded dict has one of these structures:
    - {"type": "text_delta", "content": "..."} — text token/chunk
    - {"type": "function_call", "name": "...", "arguments": "...", "call_id": "..."} — tool call
    - {"type": "done", "usage": {...}, "finish_reason": "..."} — stream completed

    After the stream completes, a single AI interaction log entry is emitted
    with total token usage (Requirement 15.3).

    Args:
        messages: Conversation message history in OpenAI format.
        tools: Tool definitions for function calling. Defaults to TOOL_DEFINITIONS.
        correlation_id: Request correlation identifier for logging.

    Yields:
        Dict events representing text deltas, function calls, or completion.

    Raises:
        RuntimeError: If the Mantle API returns an error before streaming begins.
    """
    start_time = time.time()

    if tools is None:
        tools = TOOL_DEFINITIONS

    logger.info(
        "Invoking Mantle API (streaming)",
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
        stream = client.responses.create(
            model=MODEL_ID,
            instructions=SYSTEM_PROMPT,
            input=messages,
            tools=tools if tools else None,
            stream=True,
        )
    except OpenAIError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        logger.error(
            "Mantle API error (streaming)",
            extra={
                "correlationId": correlation_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "latencyMs": latency_ms,
            },
        )
        raise RuntimeError(f"Mantle API error: {type(e).__name__}: {e}") from e

    # Accumulate function_call data across events
    pending_function_calls: dict[str, dict[str, Any]] = {}
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: str = "stop"

    try:
        for event in stream:
            event_type = event.type if hasattr(event, "type") else ""

            # Text output delta — forward to caller
            if event_type == "response.output_text.delta":
                delta_text = event.delta if hasattr(event, "delta") else ""
                if delta_text:
                    yield {"type": "text_delta", "content": delta_text}

            # Function call argument delta — accumulate
            elif event_type == "response.function_call_arguments.delta":
                call_id = event.item_id if hasattr(event, "item_id") else ""
                delta = event.delta if hasattr(event, "delta") else ""
                if call_id not in pending_function_calls:
                    pending_function_calls[call_id] = {
                        "call_id": call_id,
                        "name": "",
                        "arguments": "",
                    }
                pending_function_calls[call_id]["arguments"] += delta

            # Function call completed
            elif event_type == "response.function_call_arguments.done":
                call_id = event.item_id if hasattr(event, "item_id") else ""
                if call_id in pending_function_calls:
                    fc = pending_function_calls[call_id]
                    # Name may come from output_item.added or be set already
                    yield {
                        "type": "function_call",
                        "name": fc["name"],
                        "arguments": fc["arguments"],
                        "call_id": fc["call_id"],
                    }

            # New output item added — capture function_call name
            elif event_type == "response.output_item.added":
                item = event.item if hasattr(event, "item") else None
                if item and hasattr(item, "type") and item.type == "function_call":
                    call_id = item.call_id if hasattr(item, "call_id") else ""
                    name = item.name if hasattr(item, "name") else ""
                    if call_id not in pending_function_calls:
                        pending_function_calls[call_id] = {
                            "call_id": call_id,
                            "name": name,
                            "arguments": "",
                        }
                    else:
                        pending_function_calls[call_id]["name"] = name

            # Response completed — extract usage
            elif event_type == "response.completed":
                resp = event.response if hasattr(event, "response") else None
                if resp and hasattr(resp, "usage") and resp.usage:
                    input_tokens = resp.usage.input_tokens or 0
                    output_tokens = resp.usage.output_tokens or 0
                if resp and hasattr(resp, "status"):
                    finish_reason = resp.status or "stop"

    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        logger.error(
            "Mantle streaming error mid-stream",
            extra={
                "correlationId": correlation_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "latencyMs": latency_ms,
            },
        )
        raise RuntimeError(f"Mantle streaming error: {type(e).__name__}: {e}") from e

    latency_ms = int((time.time() - start_time) * 1000)
    total_tokens = input_tokens + output_tokens

    # Log AI interaction once after stream completes (Requirement 15.3)
    _log_ai_interaction(
        correlation_id=correlation_id,
        model=MODEL_ID,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        latency_ms=latency_ms,
        finish_reason=finish_reason,
    )

    # Final done event with usage metadata
    yield {
        "type": "done",
        "usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
        },
        "finish_reason": finish_reason,
    }


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
            {"type": c.type, "text": c.text} for c in item.content if hasattr(c, "text")
        ]
    elif item.type == "function_call":
        serialized["name"] = item.name
        serialized["arguments"] = item.arguments
        serialized["call_id"] = item.call_id

    return serialized
