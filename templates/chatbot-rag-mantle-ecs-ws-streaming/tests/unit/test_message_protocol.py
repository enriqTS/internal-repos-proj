"""Unit tests for WebSocket message protocol builders and validation."""

from app.message_protocol import (
    build_chunk_message,
    build_done_message,
    build_error_message,
    build_message_response,
    build_status_message,
    validate_client_message,
)


def test_build_message_response_contains_required_fields() -> None:
    """build_message_response includes type, response, conversationId, timestamp."""
    msg = build_message_response("Hello world", "user-123")
    assert msg["type"] == "message"
    assert msg["response"] == "Hello world"
    assert msg["conversationId"] == "user-123"
    assert "timestamp" in msg


def test_build_chunk_message() -> None:
    """build_chunk_message returns type=chunk with content."""
    msg = build_chunk_message("partial")
    assert msg == {"type": "chunk", "content": "partial"}


def test_build_done_message() -> None:
    """build_done_message returns type=done with conversationId and timestamp."""
    msg = build_done_message("user-1")
    assert msg["type"] == "done"
    assert msg["conversationId"] == "user-1"
    assert "timestamp" in msg


def test_build_status_message() -> None:
    """build_status_message returns type=status with message."""
    msg = build_status_message("Processing...")
    assert msg == {"type": "status", "message": "Processing..."}


def test_build_error_message_without_correlation() -> None:
    """build_error_message without correlationId."""
    msg = build_error_message("Something broke")
    assert msg == {"type": "error", "message": "Something broke"}


def test_build_error_message_with_correlation() -> None:
    """build_error_message with correlationId."""
    msg = build_error_message("Something broke", correlation_id="req-123")
    assert msg == {"type": "error", "message": "Something broke", "correlationId": "req-123"}


def test_validate_valid_message() -> None:
    """Valid sendMessage passes validation."""
    data = {"action": "sendMessage", "userId": "user-1", "message": "Hello"}
    is_valid, error = validate_client_message(data)
    assert is_valid is True
    assert error is None


def test_validate_missing_action() -> None:
    """Missing action fails validation."""
    data = {"userId": "user-1", "message": "Hello"}
    is_valid, error = validate_client_message(data)
    assert is_valid is False
    assert "action" in error


def test_validate_missing_userId() -> None:
    """Missing userId fails validation."""
    data = {"action": "sendMessage", "message": "Hello"}
    is_valid, error = validate_client_message(data)
    assert is_valid is False
    assert "userId" in error


def test_validate_message_too_long() -> None:
    """Message exceeding 4096 chars fails validation."""
    data = {"action": "sendMessage", "userId": "u", "message": "x" * 4097}
    is_valid, error = validate_client_message(data)
    assert is_valid is False
    assert "message" in error


def test_validate_userId_too_long() -> None:
    """userId exceeding 256 chars fails validation."""
    data = {"action": "sendMessage", "userId": "u" * 257, "message": "hi"}
    is_valid, error = validate_client_message(data)
    assert is_valid is False
    assert "userId" in error
