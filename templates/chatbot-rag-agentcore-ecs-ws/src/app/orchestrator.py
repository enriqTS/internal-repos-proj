"""Orchestrator module for ECS chatbot service.

Manages the conversation flow: invokes the AI caller via direct in-process
function call, saves the exchange for compliance, and returns the response.
AgentCore Runtime manages conversation context natively via sessionId.

This module contains the same orchestration logic as the Lambda variant.
The key differences are:
- AI Caller and Tool Executor are called directly (no Lambda invocations)
- No SQS event processing — called directly from FastAPI route handler
- No WebSocket message delivery — returns response to the HTTP caller
"""

import uuid
from typing import Any

from aws_lambda_powertools import Logger

from app.ai_caller import invoke_agentcore
from app.tool_executor import execute_tool  # noqa: F401 — available for tool-use if needed

logger = Logger(service="orchestrator")

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

    Orchestration flow:
    1. Generate correlation ID if not provided
    2. Invoke AgentCore with current message (AgentCore manages history via sessionId)
    3. Save conversation exchange to history for compliance
    4. Return the response

    Args:
        user_id: User identifier for conversation tracking.
        message_text: The user's message content.
        correlation_id: Optional request correlation identifier. Generated if not provided.

    Returns:
        Dict with keys: response (str), conversationId (str), usage (dict).

    Raises:
        RuntimeError: If the AI caller encounters an unrecoverable error.
    """
    if not correlation_id:
        correlation_id = str(uuid.uuid4())

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Processing message",
        extra={"userId": user_id, "messageLength": len(message_text)},
    )

    ctx = _get_conversation_context()

    # Invoke AgentCore (non-streaming — waits for complete response)
    # AgentCore manages full conversation history via sessionId natively.
    result = invoke_agentcore(
        session_id=user_id,
        message=message_text,
        correlation_id=correlation_id,
        stream=False,
    )
    ai_response = result.get("response", "")

    # Save conversation exchange to history (non-blocking — Requirement 2.4)
    try:
        ctx.append_messages(
            user_id=user_id,
            user_message=message_text,
            assistant_response=ai_response,
            correlation_id=correlation_id,
        )
    except Exception as e:
        logger.error(
            "Failed to save conversation exchange — response still returned",
            extra={
                "userId": user_id,
                "correlationId": correlation_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )

    logger.info(
        "Message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(ai_response),
        },
    )

    return {
        "response": ai_response,
        "conversationId": user_id,
        "usage": result.get("usage", {}),
    }
