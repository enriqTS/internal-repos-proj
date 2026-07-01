"""Unit tests for the shared message protocol module."""

from datetime import datetime, timezone

from shared.message_protocol import (
    build_chunk_message,
    build_done_message,
    build_error_message,
    build_message_response,
    build_status_message,
    validate_client_message,
)


class TestBuildChunkMessage:
    """Tests for build_chunk_message."""

    def test_basic_chunk(self) -> None:
        result = build_chunk_message("Hello")
        assert result == {"type": "chunk", "content": "Hello"}

    def test_empty_content(self) -> None:
        result = build_chunk_message("")
        assert result == {"type": "chunk", "content": ""}

    def test_only_type_and_content_fields(self) -> None:
        result = build_chunk_message("token")
        assert set(result.keys()) == {"type", "content"}


class TestBuildDoneMessage:
    """Tests for build_done_message."""

    def test_basic_done(self) -> None:
        result = build_done_message("user-123")
        assert result["type"] == "done"
        assert result["conversationId"] == "user-123"
        assert "timestamp" in result

    def test_timestamp_is_iso8601_utc(self) -> None:
        before = datetime.now(timezone.utc)
        result = build_done_message("user-1")
        after = datetime.now(timezone.utc)

        ts = datetime.fromisoformat(result["timestamp"])
        assert before <= ts <= after
        assert ts.tzinfo is not None

    def test_only_expected_fields(self) -> None:
        result = build_done_message("conv-id")
        assert set(result.keys()) == {"type", "conversationId", "timestamp"}


class TestBuildMessageResponse:
    """Tests for build_message_response."""

    def test_basic_response(self) -> None:
        result = build_message_response("AI reply", "user-456")
        assert result["type"] == "message"
        assert result["response"] == "AI reply"
        assert result["conversationId"] == "user-456"
        assert "timestamp" in result

    def test_timestamp_is_iso8601_utc(self) -> None:
        before = datetime.now(timezone.utc)
        result = build_message_response("text", "id")
        after = datetime.now(timezone.utc)

        ts = datetime.fromisoformat(result["timestamp"])
        assert before <= ts <= after

    def test_only_expected_fields(self) -> None:
        result = build_message_response("resp", "conv")
        assert set(result.keys()) == {"type", "response", "conversationId", "timestamp"}


class TestBuildStatusMessage:
    """Tests for build_status_message."""

    def test_basic_status(self) -> None:
        result = build_status_message("Processing...")
        assert result == {"type": "status", "message": "Processing..."}

    def test_only_expected_fields(self) -> None:
        result = build_status_message("msg")
        assert set(result.keys()) == {"type", "message"}


class TestBuildErrorMessage:
    """Tests for build_error_message."""

    def test_error_without_correlation_id(self) -> None:
        result = build_error_message("Something went wrong")
        assert result == {"type": "error", "message": "Something went wrong"}

    def test_error_with_correlation_id(self) -> None:
        result = build_error_message("Timeout", "req-abc-123")
        assert result == {
            "type": "error",
            "message": "Timeout",
            "correlationId": "req-abc-123",
        }

    def test_error_with_none_correlation_id(self) -> None:
        result = build_error_message("Fail", None)
        assert "correlationId" not in result

    def test_error_with_empty_correlation_id(self) -> None:
        result = build_error_message("Fail", "")
        assert "correlationId" not in result


class TestValidateClientMessage:
    """Tests for validate_client_message."""

    def test_valid_message(self) -> None:
        data = {"action": "sendMessage", "userId": "user-1", "message": "Hello"}
        is_valid, error = validate_client_message(data)
        assert is_valid is True
        assert error is None

    def test_missing_action(self) -> None:
        data = {"userId": "user-1", "message": "Hello"}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "action" in error

    def test_wrong_action(self) -> None:
        data = {"action": "otherAction", "userId": "user-1", "message": "Hello"}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "action" in error

    def test_missing_user_id(self) -> None:
        data = {"action": "sendMessage", "message": "Hello"}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "userId" in error

    def test_empty_user_id(self) -> None:
        data = {"action": "sendMessage", "userId": "", "message": "Hello"}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "userId" in error

    def test_user_id_too_long(self) -> None:
        data = {"action": "sendMessage", "userId": "x" * 257, "message": "Hello"}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "userId" in error

    def test_user_id_max_length_valid(self) -> None:
        data = {"action": "sendMessage", "userId": "x" * 256, "message": "Hello"}
        is_valid, error = validate_client_message(data)
        assert is_valid is True
        assert error is None

    def test_missing_message(self) -> None:
        data = {"action": "sendMessage", "userId": "user-1"}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "message" in error

    def test_empty_message(self) -> None:
        data = {"action": "sendMessage", "userId": "user-1", "message": ""}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "message" in error

    def test_message_too_long(self) -> None:
        data = {"action": "sendMessage", "userId": "user-1", "message": "x" * 4097}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "message" in error

    def test_message_max_length_valid(self) -> None:
        data = {"action": "sendMessage", "userId": "user-1", "message": "x" * 4096}
        is_valid, error = validate_client_message(data)
        assert is_valid is True
        assert error is None

    def test_non_dict_input(self) -> None:
        is_valid, error = validate_client_message("not a dict")  # type: ignore[arg-type]
        assert is_valid is False
        assert "JSON object" in error

    def test_user_id_not_string(self) -> None:
        data = {"action": "sendMessage", "userId": 123, "message": "Hello"}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "userId" in error

    def test_message_not_string(self) -> None:
        data = {"action": "sendMessage", "userId": "user-1", "message": 42}
        is_valid, error = validate_client_message(data)
        assert is_valid is False
        assert "message" in error
