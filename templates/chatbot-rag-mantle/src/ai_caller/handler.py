"""AI Caller Lambda — invokes Bedrock Mantle API via OpenAI SDK."""

import json
import os
import time
from typing import Any

from openai import OpenAI, OpenAIError
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit
from shared.logging_config import get_logger, log_ai_interaction

logger = get_logger("ai_caller")
metrics = Metrics(namespace="ChatbotRAG", service="ai-caller")

# PLACEHOLDER: Replace this system prompt with your own instructions.
SYSTEM_PROMPT = "You are a helpful assistant. Replace this prompt with your own instructions."

MANTLE_BASE_URL = os.environ.get(
    "MANTLE_BASE_URL", "https://bedrock-mantle.us-east-1.api.aws/v1"
)
MODEL_ID = os.environ.get("MODEL_ID", "your-model-id")


@metrics.log_metrics(capture_cold_start_metric=True)
@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:  # context: aws_lambda_powertools.utilities.typing.LambdaContext
    """Invoke Mantle API with conversation and return response.

    Expected event payload:
    {
        "correlationId": "msg-abc-123",
        "messages": [...],
        "tools": [...]
    }
    """
    correlation_id = event.get("correlationId")
    logger.set_correlation_id(correlation_id)

    messages = event.get("messages", [])
    tools = event.get("tools", [])

    logger.info(
        "AI Caller invoked",
        extra={
            "messageCount": len(messages),
            "toolCount": len(tools),
        },
    )

    try:
        response = invoke_mantle(messages, tools, correlation_id)
        return response
    except Exception as e:
        logger.error(
            "AI Caller failed",
            extra={
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        raise


def invoke_mantle(messages: list[dict[str, Any]], tools: list[dict[str, Any]], correlation_id: str) -> dict[str, Any]:
    """Call Mantle POST /responses with OpenAI SDK (stream=False)."""
    start_time = time.time()

    # Log AI interaction BEFORE request
    input_token_estimate = sum(len(str(m)) // 4 for m in messages)
    log_ai_interaction(
        logger,
        correlationId=correlation_id,
        model=MODEL_ID,
        phase="request",
        inputMessageCount=len(messages),
        inputTokenEstimate=input_token_estimate,
        timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
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
            tools=tools,
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
        raise RuntimeError(
            f"Mantle API error: {type(e).__name__}: {str(e)}"
        ) from e

    latency_ms = int((time.time() - start_time) * 1000)
    metrics.add_metric(name="AIModelLatency", unit=MetricUnit.Milliseconds, value=latency_ms)

    # Log AI interaction AFTER response
    log_ai_interaction(
        logger,
        correlationId=correlation_id,
        model=MODEL_ID,
        phase="response",
        inputTokens=response.usage.input_tokens if response.usage else None,
        outputTokens=response.usage.output_tokens if response.usage else None,
        totalTokens=response.usage.total_tokens if response.usage else None,
        latencyMs=latency_ms,
        finishReason=response.status if hasattr(response, "status") else None,
    )

    # Check for tool calls in output and log at INFO level
    tool_calls = [
        item for item in response.output if item.type == "function_call"
    ]
    if tool_calls:
        tool_names = [tc.name for tc in tool_calls]
        logger.info(
            "AI requested tool calls",
            extra={
                "correlationId": correlation_id,
                "toolCallCount": len(tool_calls),
                "toolNames": tool_names,
            },
        )

    # Build response payload for the orchestrator
    result = {
        "output": [
            _serialize_output_item(item) for item in response.output
        ],
        "usage": {
            "inputTokens": response.usage.input_tokens if response.usage else None,
            "outputTokens": response.usage.output_tokens if response.usage else None,
            "totalTokens": response.usage.total_tokens if response.usage else None,
        },
        "status": response.status if hasattr(response, "status") else None,
    }

    return result


def _serialize_output_item(item: Any) -> dict[str, Any]:  # item: openai.types.responses.ResponseOutputItem (union type)
    """Serialize a response output item to a dict for Lambda response."""
    serialized = {"type": item.type}

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
