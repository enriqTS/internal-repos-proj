"""Unit tests for shared message sender module.

Tests retry logic, 410 GoneException handling, expired connection
detection, and successful message delivery via API Gateway Management API.
"""

import os
import time
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

# Set environment variables before importing module
os.environ.setdefault("WEBSOCKET_API_ENDPOINT", "https://test.execute-api.us-east-1.amazonaws.com/dev")
os.environ.setdefault("CONNECTION_TABLE_NAME", "test-connections")
os.environ.setdefault("CONNECTION_TTL_SECONDS", "86400")
os.environ.setdefault("POWERTOOLS_SERVICE_NAME", "test")
os.environ.setdefault("POWERTOOLS_LOG_LEVEL", "DEBUG")

from shared.message_sender import (
    BACKOFF_BASE,
    MAX_RETRIES,
    send_to_connection,
)


def _make_client_error(code: str, message: str = "Error") -> ClientError:
    """Create a botocore ClientError with the given error code."""
    return ClientError(
        error_response={"Error": {"Code": code, "Message": message}},
        operation_name="PostToConnection",
    )


class TestSendToConnectionSuccess:
    """Tests for successful message delivery."""

    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_returns_true_on_successful_delivery(
        self, mock_get_client: MagicMock, mock_get_item: MagicMock
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-123",
            "expiresAt": int(time.time()) + 3600,
        }

        result = send_to_connection("conn-123", {"type": "message", "response": "hello"})

        assert result is True
        mock_client.post_to_connection.assert_called_once()
        call_kwargs = mock_client.post_to_connection.call_args[1]
        assert call_kwargs["ConnectionId"] == "conn-123"

    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_sends_json_encoded_payload(
        self, mock_get_client: MagicMock, mock_get_item: MagicMock
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-456",
            "expiresAt": int(time.time()) + 3600,
        }
        message = {"type": "chunk", "content": "hello world"}

        send_to_connection("conn-456", message)

        call_kwargs = mock_client.post_to_connection.call_args[1]
        payload = call_kwargs["Data"]
        assert payload == b'{"type": "chunk", "content": "hello world"}'

    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_connection_not_in_table_still_attempts_delivery(
        self, mock_get_client: MagicMock, mock_get_item: MagicMock
    ) -> None:
        """If connection item is not found, we still try to deliver (not expired)."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = None  # Not found in table

        result = send_to_connection("conn-new", {"type": "message", "response": "hi"})

        assert result is True
        mock_client.post_to_connection.assert_called_once()


class TestSendToConnectionGoneException:
    """Tests for 410 GoneException handling."""

    @patch("shared.message_sender.remove_connection")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_returns_false_on_gone_exception(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_remove: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-gone",
            "expiresAt": int(time.time()) + 3600,
        }
        mock_client.post_to_connection.side_effect = _make_client_error("GoneException")

        result = send_to_connection("conn-gone", {"type": "message", "response": "test"})

        assert result is False

    @patch("shared.message_sender.remove_connection")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_removes_connection_on_gone_exception(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_remove: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-stale",
            "expiresAt": int(time.time()) + 3600,
        }
        mock_client.post_to_connection.side_effect = _make_client_error("GoneException")

        send_to_connection("conn-stale", {"type": "message", "response": "test"})

        mock_remove.assert_called_once_with("conn-stale")

    @patch("shared.message_sender.remove_connection")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_does_not_retry_on_gone_exception(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_remove: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-gone",
            "expiresAt": int(time.time()) + 3600,
        }
        mock_client.post_to_connection.side_effect = _make_client_error("GoneException")

        send_to_connection("conn-gone", {"type": "done"})

        # Only one call — no retries for 410
        assert mock_client.post_to_connection.call_count == 1


class TestSendToConnectionRetryLogic:
    """Tests for transient error retry with exponential backoff."""

    @patch("shared.message_sender.time.sleep")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_retries_on_transient_error_then_succeeds(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-retry",
            "expiresAt": int(time.time()) + 3600,
        }
        # Fail twice, then succeed
        mock_client.post_to_connection.side_effect = [
            _make_client_error("ThrottlingException"),
            _make_client_error("InternalServerError"),
            None,  # Success
        ]

        result = send_to_connection("conn-retry", {"type": "message", "response": "ok"})

        assert result is True
        assert mock_client.post_to_connection.call_count == 3

    @patch("shared.message_sender.time.sleep")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_returns_false_after_max_retries_exhausted(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-fail",
            "expiresAt": int(time.time()) + 3600,
        }
        mock_client.post_to_connection.side_effect = _make_client_error("ThrottlingException")

        result = send_to_connection("conn-fail", {"type": "message", "response": "test"})

        assert result is False
        assert mock_client.post_to_connection.call_count == MAX_RETRIES

    @patch("shared.message_sender.time.sleep")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_exponential_backoff_timing(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-backoff",
            "expiresAt": int(time.time()) + 3600,
        }
        mock_client.post_to_connection.side_effect = _make_client_error("ThrottlingException")

        send_to_connection("conn-backoff", {"type": "message", "response": "test"})

        # Backoff: 0.5 * 2^0 = 0.5, 0.5 * 2^1 = 1.0 (only 2 sleeps, last attempt doesn't sleep)
        assert mock_sleep.call_count == MAX_RETRIES - 1
        mock_sleep.assert_any_call(BACKOFF_BASE * (2**0))  # 0.5s
        mock_sleep.assert_any_call(BACKOFF_BASE * (2**1))  # 1.0s

    @patch("shared.message_sender.time.sleep")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_first_attempt_success_no_sleep(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-ok",
            "expiresAt": int(time.time()) + 3600,
        }

        send_to_connection("conn-ok", {"type": "done"})

        mock_sleep.assert_not_called()


class TestSendToConnectionExpiredConnection:
    """Tests for expired connection handling (expiresAt < now)."""

    @patch("shared.message_sender.remove_connection")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_returns_false_for_expired_connection(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_remove: MagicMock,
    ) -> None:
        mock_get_item.return_value = {
            "connectionId": "conn-expired",
            "expiresAt": int(time.time()) - 3600,  # Expired 1h ago
        }

        result = send_to_connection("conn-expired", {"type": "message", "response": "hi"})

        assert result is False

    @patch("shared.message_sender.remove_connection")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_deletes_expired_connection_from_table(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_remove: MagicMock,
    ) -> None:
        mock_get_item.return_value = {
            "connectionId": "conn-expired",
            "expiresAt": int(time.time()) - 100,  # Just expired
        }

        send_to_connection("conn-expired", {"type": "message", "response": "hi"})

        mock_remove.assert_called_once_with("conn-expired")

    @patch("shared.message_sender.remove_connection")
    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_does_not_attempt_delivery_for_expired_connection(
        self,
        mock_get_client: MagicMock,
        mock_get_item: MagicMock,
        mock_remove: MagicMock,
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-expired",
            "expiresAt": int(time.time()) - 1,  # Just expired
        }

        send_to_connection("conn-expired", {"type": "chunk", "content": "test"})

        mock_client.post_to_connection.assert_not_called()


class TestSendToConnectionEdgeCases:
    """Tests for edge cases and configuration issues."""

    @patch("shared.message_sender.get_connection_item")
    def test_returns_false_when_endpoint_not_configured(
        self, mock_get_item: MagicMock
    ) -> None:
        mock_get_item.return_value = None  # Not found

        with patch("shared.message_sender.WEBSOCKET_API_ENDPOINT", ""):
            result = send_to_connection("conn-no-endpoint", {"type": "done"})

        assert result is False

    @patch("shared.message_sender.get_connection_item")
    @patch("shared.message_sender._get_apigw_client")
    def test_returns_false_on_unexpected_exception(
        self, mock_get_client: MagicMock, mock_get_item: MagicMock
    ) -> None:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_get_item.return_value = {
            "connectionId": "conn-err",
            "expiresAt": int(time.time()) + 3600,
        }
        mock_client.post_to_connection.side_effect = RuntimeError("Unexpected")

        result = send_to_connection("conn-err", {"type": "message", "response": "hi"})

        assert result is False

    def test_max_retries_constant_is_three(self) -> None:
        assert MAX_RETRIES == 3

    def test_backoff_base_is_half_second(self) -> None:
        assert BACKOFF_BASE == 0.5
