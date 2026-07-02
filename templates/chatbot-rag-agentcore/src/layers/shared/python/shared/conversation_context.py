"""Shared conversation context management module.

Manages per-user conversation history in DynamoDB with graceful degradation.
Shared across all template variants (Lambda and ECS). The only permitted
differences between variants are module import paths and the Lambda handler
entry-point wrapper.

Configuration via environment variables:
- DYNAMODB_TABLE_NAME: Name of the DynamoDB table storing user context
- MAX_CONVERSATION_HISTORY: Maximum messages retained (default: 50)
"""

import os
import time
from datetime import datetime, timezone
from typing import Any

import boto3

from shared.logging_config import get_logger

logger = get_logger("conversation_context")

# Configuration from environment variables
DYNAMODB_TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "")
MAX_CONVERSATION_HISTORY = int(os.environ.get("MAX_CONVERSATION_HISTORY", "50"))

# boto3 DynamoDB resource at module level for connection reuse across invocations.
# Lazy initialization to allow import without valid AWS credentials (testing).
_dynamodb_resource: Any = None
_table: Any = None


def _get_table() -> Any:
    """Get or create the DynamoDB table resource (lazy singleton).

    Returns None if DYNAMODB_TABLE_NAME is not configured.
    """
    global _dynamodb_resource, _table  # noqa: PLW0603
    if not DYNAMODB_TABLE_NAME:
        return None
    if _table is None:
        _dynamodb_resource = boto3.resource("dynamodb")
        _table = _dynamodb_resource.Table(DYNAMODB_TABLE_NAME)
    return _table


def _get_conversation_history(
    user_id: str,
    *,
    correlation_id: str = "",
) -> list[dict[str, Any]]:
    """Retrieve conversation history from DynamoDB, trimmed to max length.

    Internal helper — used by append_messages() for the read-append-write
    pattern. Not part of the public API; the Orchestrator no longer calls
    this directly for pre-invocation retrieval (AgentCore Runtime manages
    conversation context via sessionId).

    Returns an empty list on read failure (graceful degradation), logging
    the error at ERROR level.

    Args:
        user_id: User identifier (DynamoDB partition key).
        correlation_id: Request correlation identifier for structured logging.

    Returns:
        List of message dicts with role, content, and timestamp fields.
        Trimmed to MAX_CONVERSATION_HISTORY most recent messages.
    """
    table = _get_table()
    if table is None:
        logger.error(
            "DYNAMODB_TABLE_NAME not configured — returning empty history",
            extra={"correlationId": correlation_id, "userId": user_id},
        )
        return []

    try:
        response = table.get_item(Key={"userId": user_id})
        item = response.get("Item", {})
        messages: list[dict[str, Any]] = item.get("messages", [])

        # Trim to MAX_CONVERSATION_HISTORY (keep most recent)
        messages = trim_history(messages, MAX_CONVERSATION_HISTORY)

        logger.info(
            "Retrieved conversation history",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "messageCount": len(messages),
            },
        )
        return messages

    except Exception as e:
        logger.error(
            "Failed to retrieve conversation history — proceeding with empty history",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        return []


def save_conversation_history(
    user_id: str,
    messages: list[dict[str, Any]],
    *,
    correlation_id: str = "",
) -> None:
    """Save updated conversation history to DynamoDB.

    On failure, logs ERROR but does not raise. The AI response is still
    returned to the user — conversation persistence must never block the
    response path.

    Args:
        user_id: User identifier (DynamoDB partition key).
        messages: Full conversation message list to persist.
        correlation_id: Request correlation identifier for structured logging.
    """
    table = _get_table()
    if table is None:
        logger.error(
            "DYNAMODB_TABLE_NAME not configured — skipping history save",
            extra={"correlationId": correlation_id, "userId": user_id},
        )
        return

    try:
        # Trim before saving to avoid unbounded growth
        trimmed_messages = trim_history(messages, MAX_CONVERSATION_HISTORY)

        table.put_item(
            Item={
                "userId": user_id,
                "messages": trimmed_messages,
                "updatedAt": int(time.time()),
            }
        )
        logger.info(
            "Saved conversation history",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "messageCount": len(trimmed_messages),
            },
        )
    except Exception as e:
        logger.error(
            "Failed to save conversation history — response still returned to user",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )


def trim_history(
    messages: list[dict[str, Any]],
    max_messages: int,
) -> list[dict[str, Any]]:
    """Trim conversation history to the most recent messages.

    Removes oldest messages first to preserve recency. If the list is
    already within the limit, returns it unchanged.

    Args:
        messages: Full message history list.
        max_messages: Maximum number of messages to retain.

    Returns:
        Trimmed list containing at most `max_messages` entries,
        preserving the most recent ones.
    """
    if max_messages <= 0:
        return []
    if len(messages) <= max_messages:
        return messages
    return messages[-max_messages:]


def append_messages(
    user_id: str,
    user_message: str,
    assistant_response: str,
    *,
    correlation_id: str = "",
) -> list[dict[str, Any]]:
    """Append user and assistant messages to the conversation history.

    Retrieves the current history, appends both messages with timestamps,
    trims to MAX_CONVERSATION_HISTORY, and saves the updated history.
    Returns the updated message list.

    On read failure: proceeds with empty history (logs ERROR).
    On write failure: logs ERROR but still returns the updated list.

    Args:
        user_id: User identifier (DynamoDB partition key).
        user_message: The user's message text.
        assistant_response: The AI assistant's response text.
        correlation_id: Request correlation identifier for structured logging.

    Returns:
        Updated conversation history list with the new messages appended.
    """
    now = datetime.now(timezone.utc).isoformat()

    # Retrieve existing history (returns [] on failure)
    messages = _get_conversation_history(user_id, correlation_id=correlation_id)

    # Append user message
    messages.append(
        {
            "role": "user",
            "content": user_message,
            "timestamp": now,
        }
    )

    # Append assistant response
    messages.append(
        {
            "role": "assistant",
            "content": assistant_response,
            "timestamp": now,
        }
    )

    # Trim and save
    messages = trim_history(messages, MAX_CONVERSATION_HISTORY)
    save_conversation_history(user_id, messages, correlation_id=correlation_id)

    return messages
