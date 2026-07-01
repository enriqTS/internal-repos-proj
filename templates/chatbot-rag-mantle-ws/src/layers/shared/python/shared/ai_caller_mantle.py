"""Shared AI Caller — Mantle variant (OpenAI-compatible Bedrock endpoint).

Core AI calling logic for all Mantle-based template variants. Uses the OpenAI SDK
with the bedrock-mantle base URL to invoke models via the Responses API.

This module is shared across Lambda and ECS variants. The only permitted differences
between variants are: (a) the stream parameter (streaming variants), (b) import paths,
and (c) the Lambda handler wrapper (absent in ECS).

Configuration via environment variables:
- MANTLE_BASE_URL: Bedrock Mantle API endpoint (default: us-east-1)
- MODEL_ID: Bedrock model identifier to invoke
"""

import os
import time
from collections.abc import Generator
from typing import Any

from openai import OpenAI, OpenAIError

from shared.logging_config import get_logger, log_ai_interaction

logger = get_logger("ai_caller")

# PLACEHOLDER: Replace this system prompt with domain-specific instructions for your chatbot.
SYSTEM_PROMPT = "You are a helpful assistant. Replace this prompt with your own instructions."

MANTLE_BASE_URL = os.environ.get("MANTLE_BASE_URL", "https://bedrock-mantle.us-east-1.api.aws/v1")
MODEL_ID = os.environ.get("MODEL_ID", "your-model-id")

# Module-level client for connection reuse across invocations
_client = OpenAI(
    base_url=MANTLE_BASE_URL,
    api_key="bedrock",  # AWS auth handled by SDK credentials
)


def invoke_mantle(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    correlation_id: str = "",
    stream: bool = False,
) -> dict[str, Any]:
    """Call Bedrock Mantle API via OpenAI SDK (non-streaming).

    Invokes `client.responses.create()` with the system prompt as `instructions`
    and returns the parsed response including output items and usage.

    Args:
        messages: Conversation message history in OpenAI format.
        tools: Tool definitions for function calling.
        correlation_id: Request correlation ID for logging.
        stream: Must be False for non-streaming invocation.

    Returns:
        Dict with keys: output (list of serialized output items), usage (token counts),
        status (finish reason).

    Raises:
        RuntimeError: When the Mantle API returns an error.
    """
    start_time = time.time()

    logger.info(
        "Invoking Mantle API",
        extra={
            "correlation_id": correlation_id,
            "messageCount": len(messages),
            "toolCount": len(tools),
            "stream": stream,
        },
    )

    try:
        response = _client.responses.create(
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
                "correlation_id": correlation_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "latencyMs": latency_ms,
            },
        )
        raise RuntimeError(f"Mantle API error: {type(e).__name__}: {e}") from e

    latency_ms = int((time.time() - start_time) * 1000)

    # Extract token usage
    input_tokens = response.usage.input_tokens if response.usage else 0
    output_tokens = response.usage.output_tokens if response.usage else 0
    total_tokens = response.usage.total_tokens if response.usage else 0
    finish_reason = response.status if hasattr(response, "status") else "unknown"

    # Single AI interaction log entry after call completes
    log_ai_interaction(
        logger,
        correlation_id=correlation_id,
        model=MODEL_ID,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        latency_ms=latency_ms,
        finish_reason=finish_reason,
    )

    # Serialize output items
    output_items = [_serialize_output_item(item) for item in response.output]

    return {
        "output": output_items,
        "usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
        },
        "status": finish_reason,
    }


def invoke_mantle_streaming(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    correlation_id: str = "",
) -> Generator[dict[str, Any], None, dict[str, Any]]:
    """Call Bedrock Mantle API with streaming enabled — yields chunks.

    Uses `client.responses.create(stream=True)` and yields each event from
    the streaming response. After the stream finishes, emits a single AI
    interaction log entry with total token usage and latency.

    Yields:
        Dict for each streaming event:
        - {"type": "text_delta", "content": "..."} for text chunks
        - {"type": "function_call", ...} for tool-use items (not streamed to client)
        - {"type": "done", "usage": {...}, "status": "..."} at stream end

    Returns:
        Final result dict with output items, usage, and status (accessible via
        generator .send() or StopIteration.value).

    Raises:
        RuntimeError: When the Mantle API returns an error.
    """
    start_time = time.time()

    logger.info(
        "Invoking Mantle API (streaming)",
        extra={
            "correlation_id": correlation_id,
            "messageCount": len(messages),
            "toolCount": len(tools),
        },
    )

    try:
        stream = _client.responses.create(
            model=MODEL_ID,
            instructions=SYSTEM_PROMPT,
            input=messages,
            tools=tools if tools else None,
            stream=True,
        )
    except OpenAIError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        logger.error(
            "Mantle API streaming error",
            extra={
                "correlation_id": correlation_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "latencyMs": latency_ms,
            },
        )
        raise RuntimeError(f"Mantle API error: {type(e).__name__}: {e}") from e

    # Accumulate state during streaming
    assembled_text = ""
    function_calls: list[dict[str, Any]] = []
    usage_data: dict[str, int] = {}
    finish_reason = "unknown"

    try:
        for event in stream:
            event_type = getattr(event, "type", None)

            # Text delta — yield chunk to caller for streaming to client
            if event_type == "response.output_text.delta":
                delta = getattr(event, "delta", "")
                assembled_text += delta
                yield {"type": "text_delta", "content": delta}

            # Function call output — collect for tool-use loop
            elif event_type == "response.function_call_arguments.done":
                call_data = {
                    "type": "function_call",
                    "name": getattr(event, "name", ""),
                    "arguments": getattr(event, "arguments", ""),
                    "call_id": getattr(event, "call_id", ""),
                }
                function_calls.append(call_data)
                yield call_data

            # Response completed — extract final usage and status
            elif event_type == "response.completed":
                response_obj = getattr(event, "response", None)
                if response_obj:
                    if hasattr(response_obj, "usage") and response_obj.usage:
                        usage_data = {
                            "inputTokens": response_obj.usage.input_tokens,
                            "outputTokens": response_obj.usage.output_tokens,
                            "totalTokens": response_obj.usage.total_tokens,
                        }
                    if hasattr(response_obj, "status"):
                        finish_reason = response_obj.status

    except OpenAIError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        logger.error(
            "Mantle API streaming error mid-stream",
            extra={
                "correlation_id": correlation_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "latencyMs": latency_ms,
                "assembledTextLength": len(assembled_text),
            },
        )
        raise RuntimeError(f"Mantle API streaming error: {type(e).__name__}: {e}") from e

    latency_ms = int((time.time() - start_time) * 1000)

    # Single AI interaction log entry AFTER stream completes (Req 15.3)
    log_ai_interaction(
        logger,
        correlation_id=correlation_id,
        model=MODEL_ID,
        input_tokens=usage_data.get("inputTokens", 0),
        output_tokens=usage_data.get("outputTokens", 0),
        total_tokens=usage_data.get("totalTokens", 0),
        latency_ms=latency_ms,
        finish_reason=finish_reason,
    )

    # Build final result — accessible via StopIteration.value
    output_items: list[dict[str, Any]] = []
    if assembled_text:
        output_items.append({"type": "message", "content": assembled_text})
    output_items.extend(function_calls)

    # Yield done event so the caller knows the stream is complete
    yield {
        "type": "done",
        "usage": usage_data,
        "status": finish_reason,
    }

    return {
        "output": output_items,
        "usage": usage_data,
        "status": finish_reason,
    }


def has_function_calls(output_items: list[dict[str, Any]]) -> bool:
    """Check if the response contains function_call items (tool-use loop detection).

    Used by the orchestrator to determine if another iteration of the tool-use
    loop is needed. Returns True if any output item has type 'function_call'.

    Args:
        output_items: List of serialized output items from invoke_mantle response.

    Returns:
        True if function_call items are present, False otherwise.
    """
    return any(item.get("type") == "function_call" for item in output_items)


def get_function_calls(output_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract function_call items from the response output.

    Args:
        output_items: List of serialized output items from invoke_mantle response.

    Returns:
        List of function_call dicts with name, arguments, and call_id.
    """
    return [item for item in output_items if item.get("type") == "function_call"]


def get_text_content(output_items: list[dict[str, Any]]) -> str:
    """Extract text content from the response output.

    Concatenates all text content from message-type output items.

    Args:
        output_items: List of serialized output items from invoke_mantle response.

    Returns:
        Combined text content from all message items.
    """
    parts: list[str] = []
    for item in output_items:
        if item.get("type") == "message":
            content = item.get("content", "")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                # Handle content as list of content parts
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        parts.append(part.get("text", ""))
    return "".join(parts)


def _serialize_output_item(item: Any) -> dict[str, Any]:
    """Serialize a response output item to a dict.

    Converts OpenAI SDK response output objects into plain dicts
    for cross-component communication.

    Args:
        item: OpenAI ResponseOutputItem (union type).

    Returns:
        Serialized dict with type and type-specific fields.
    """
    serialized: dict[str, Any] = {"type": item.type}

    if item.type == "message":
        content_parts = []
        for c in item.content:
            if hasattr(c, "text"):
                content_parts.append({"type": c.type, "text": c.text})
        serialized["content"] = content_parts
    elif item.type == "function_call":
        serialized["name"] = item.name
        serialized["arguments"] = item.arguments
        serialized["call_id"] = item.call_id

    return serialized
