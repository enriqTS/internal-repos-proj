"""Lambda handler for the AI Caller — wraps shared Mantle AI caller.

Provides a Lambda entry-point around the shared Mantle (OpenAI SDK) invocation logic.
In this variant (non-streaming), the AI caller is invoked directly by the
orchestrator via the shared module import. This handler exists for cases
where the AI caller needs to be invoked as a separate Lambda function
(e.g., for timeout isolation or independent scaling).

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

from shared.ai_caller_mantle import invoke_mantle

logger = Logger(service="ai_caller")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Invoke Bedrock Mantle API and return the AI response.

    Args:
        event: Dict containing:
            - messages: Conversation message history list.
            - tools: Tool definitions for function calling.
            - correlationId: Optional request correlation identifier.
        context: Lambda execution context.

    Returns:
        Dict with keys: output (list of output items), usage, status.
        On error: Dict with key: error.
    """
    messages = event.get("messages", [])
    tools = event.get("tools", [])
    correlation_id = event.get("correlationId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "AI Caller invoked",
        extra={
            "messageCount": len(messages),
            "toolCount": len(tools),
        },
    )

    try:
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
            },
        )
        return {"error": f"AI invocation failed: {e}"}
