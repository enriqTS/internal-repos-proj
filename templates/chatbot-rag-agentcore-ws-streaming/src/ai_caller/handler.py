"""Lambda handler for the AI Caller — wraps shared AgentCore AI caller.

Provides a Lambda entry-point around the shared AgentCore invocation logic.
In this variant (streaming), the AI caller is invoked in streaming mode
by the orchestrator via the shared module import. This handler exists for
cases where the AI caller needs to be invoked as a separate Lambda function
(e.g., for timeout isolation or independent scaling).

Environment variables:
- AGENT_RUNTIME_ARN: AgentCore runtime ARN
- AGENT_ALIAS_ID: Agent alias identifier (default: TSTALIASID)
- AGENT_ID: Agent identifier
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import uuid
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from shared.ai_caller_agentcore import invoke_agentcore

logger = Logger(service="ai_caller")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Invoke AgentCore Runtime in streaming mode and return the assembled AI response.

    When invoked as a standalone Lambda, consumes the full stream and returns
    the assembled response. For progressive streaming to clients, the orchestrator
    uses invoke_agentcore_streaming() directly.

    Args:
        event: Dict containing:
            - sessionId: User/session identifier for AgentCore session management.
            - messages: Conversation message history list.
            - correlationId: Optional request correlation identifier.
            - tools: Optional tool definitions (AgentCore handles internally).
        context: Lambda execution context.

    Returns:
        Dict with keys: response, usage, finishReason, sessionId.
        On error: Dict with key: error.
    """
    session_id = event.get("sessionId", "")
    messages = event.get("messages", [])
    correlation_id = event.get("correlationId", str(uuid.uuid4()))
    tools = event.get("tools")

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "AI Caller invoked (streaming mode)",
        extra={
            "sessionId": session_id,
            "messageCount": len(messages),
        },
    )

    try:
        result = invoke_agentcore(
            session_id=session_id,
            messages=messages,
            tools=tools,
            correlation_id=correlation_id,
            stream=True,
        )
        return result
    except Exception as e:
        logger.error(
            "AI invocation failed",
            extra={
                "sessionId": session_id,
                "error": str(e),
            },
        )
        return {"error": f"AI invocation failed: {e}"}
