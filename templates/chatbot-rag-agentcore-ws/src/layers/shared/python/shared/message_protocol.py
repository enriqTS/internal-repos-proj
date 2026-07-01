"""WebSocket message protocol builders — consistent across Lambda and ECS variants."""

from datetime import datetime, timezone

# Validation constraints
_MIN_USER_ID_LENGTH = 1
_MAX_USER_ID_LENGTH = 256
_MIN_MESSAGE_LENGTH = 1
_MAX_MESSAGE_LENGTH = 4096
_VALID_ACTION = "sendMessage"


def build_chunk_message(content: str) -> dict:
    """Build a streaming chunk message."""
    return {"type": "chunk", "content": content}


def build_done_message(conversation_id: str) -> dict:
    """Build a stream completion message."""
    return {
        "type": "done",
        "conversationId": conversation_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def build_message_response(response: str, conversation_id: str) -> dict:
    """Build a non-streaming complete message response."""
    return {
        "type": "message",
        "response": response,
        "conversationId": conversation_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def build_status_message(message: str) -> dict:
    """Build a processing status message (tool-use loop)."""
    return {"type": "status", "message": message}


def build_error_message(message: str, correlation_id: str | None = None) -> dict:
    """Build an error message."""
    msg: dict = {"type": "error", "message": message}
    if correlation_id:
        msg["correlationId"] = correlation_id
    return msg


def validate_client_message(data: dict) -> tuple[bool, str | None]:
    """
    Validate a client-to-server WebSocket message.

    Returns (is_valid, error_description).
    """
    if not isinstance(data, dict):
        return False, "Message must be a JSON object"

    action = data.get("action")
    if action != _VALID_ACTION:
        return False, "Invalid action: must be 'sendMessage'"

    user_id = data.get("userId")
    if (
        not user_id
        or not isinstance(user_id, str)
        or len(user_id) < _MIN_USER_ID_LENGTH
        or len(user_id) > _MAX_USER_ID_LENGTH
    ):
        return False, "Invalid message format: userId must be a non-empty string (1-256 chars)"

    message = data.get("message")
    if (
        not message
        or not isinstance(message, str)
        or len(message) < _MIN_MESSAGE_LENGTH
        or len(message) > _MAX_MESSAGE_LENGTH
    ):
        return False, "Invalid message format: message must be a non-empty string (1-4096 chars)"

    return True, None
