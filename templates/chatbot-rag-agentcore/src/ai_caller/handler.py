"""Lambda handler for the AI Caller — wraps shared AgentCore AI caller.

Provides a Lambda entry-point around the shared AgentCore invocation logic.
In this variant (REST/non-streaming), the AI caller is invoked by the
orchestrator via Lambda invocation. This handler delegates to the shared
module for the actual AgentCore Runtime interaction.

Environment variables:
- AGENT_RUNTIME_ARN: AgentCore runtime ARN
- AGENT_ALIAS_ID: Agent alias identifier (default: TSTALIASID)
- AGENT_ID: Agent identifier
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from shared.ai_caller_agentcore import invoke_agentcore

logger = Logger(service="ai_caller")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Invoke AgentCore Runtime and return the AI response.

    Args:
        event: Dict containing:
            - message: Current user message text (string, not history array).
            - sessionId: User/session identifier for AgentCore session management.
            - correlationId: Request correlation identifier.
        context: Lambda execution context.

    Returns:
        Dict with keys: response, usage, finishReason, sessionId.

    Raises:
        Exception: Re-raises any error from AgentCore invocation after logging.
    """
    message = event.get("message", "")
    session_id = event.get("sessionId", "")
    correlation_id = event.get("correlationId", "")

    logger.set_correlation_id(correlation_id)
    logger.info(
        "AI Caller invoked",
        extra={"sessionId": session_id},
    )

    try:
        response = invoke_agentcore(
            session_id=session_id,
            message=message,
            correlation_id=correlation_id,
        )
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
