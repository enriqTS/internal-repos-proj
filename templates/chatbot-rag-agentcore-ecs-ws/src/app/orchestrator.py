"""Orchestrator module for ECS chatbot service.

Manages the conversation flow: retrieves history, invokes the AI caller
via direct in-process function call, and returns the response. Reuses
the shared conversation context module pattern adapted for ECS.

This module contains the same orchestration logic as the Lambda variant.
The key differences are:
- AI Caller and Tool Executor are called directly (no Lambda invocations)
- No SQS event processing — called directly from FastAPI route handler
- No WebSocket message delivery — returns response to the HTTP caller
"""

import uuid
from typing import Any

from app.ai_caller import invoke_agentcore
from app.logging_config import get_logger
from app.tool_executor import execute_tool  # noqa: F401 — available for tool-use if needed

logger = get_logger("orchestrator")

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
    2. Retrieve conversation history from DynamoDB (graceful degradation)
    3. Build messages list for AI invocation
    4. Invoke AgentCore (non-streaming — complete response)
    5. Save conversation exchange to history
    6. Return the response

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

    # Retrieve conversation history (returns [] on failure — graceful degradation)
    history = ctx.get_conversation_history(user_id, correlation_id=correlation_id)

    # Build messages list for AI invocation
    messages = [*history, {"role": "user", "content": message_text}]

    # Invoke AgentCore (non-streaming — waits for complete response)
    result = invoke_agentcore(
        session_id=user_id,
        messages=messages,
        correlation_id=correlation_id,
        stream=False,
    )
    ai_response = result.get("response", "")

    # Save conversation exchange to history
    ctx.append_messages(
        user_id=user_id,
        user_message=message_text,
        assistant_response=ai_response,
        correlation_id=correlation_id,
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
