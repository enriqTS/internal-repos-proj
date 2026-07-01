"""Unit tests for shared connection manager module.

Tests DynamoDB store/remove/lookup for WebSocket connection lifecycle,
TTL calculation, error handling, and graceful degradation.
"""

import os
import time
from unittest.mock import MagicMock, patch

# Set environment variables before importing module
os.environ.setdefault("CONNECTION_TABLE_NAME", "test-connections")
os.environ.setdefault("CONNECTION_TTL_SECONDS", "86400")
os.environ.setdefault("POWERTOOLS_SERVICE_NAME", "test")
os.environ.setdefault("POWERTOOLS_LOG_LEVEL", "DEBUG")


from shared.connection_manager import (
    CONNECTION_TTL_SECONDS,
    get_connection_for_user,
    get_connection_item,
    remove_connection,
    store_connection,
)


class TestStoreConnection:
    """Tests for store_connection with mocked DynamoDB."""

    @patch("shared.connection_manager._get_table")
    def test_stores_connection_with_correct_fields(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        before = int(time.time())
        store_connection("conn-abc-123", "user-42")
        after = int(time.time())

        mock_table.put_item.assert_called_once()
        item = mock_table.put_item.call_args[1]["Item"]
        assert item["connectionId"] == "conn-abc-123"
        assert item["userId"] == "user-42"
        assert before <= item["connectedAt"] <= after
        assert item["expiresAt"] == item["connectedAt"] + CONNECTION_TTL_SECONDS

    @patch("shared.connection_manager._get_table")
    def test_ttl_is_24_hours_from_connected_at(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        store_connection("conn-ttl-test", "user-1")

        item = mock_table.put_item.call_args[1]["Item"]
        assert item["expiresAt"] - item["connectedAt"] == 86400

    @patch("shared.connection_manager._get_table")
    def test_raises_on_dynamodb_failure(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.put_item.side_effect = Exception("DynamoDB write error")

        try:
            store_connection("conn-fail", "user-1")
            assert False, "Should have raised"  # noqa: B011
        except Exception as e:
            assert "DynamoDB write error" in str(e)

    @patch("shared.connection_manager._get_table")
    def test_raises_when_table_not_configured(self, mock_get_table: MagicMock) -> None:
        mock_get_table.return_value = None

        try:
            store_connection("conn-no-table", "user-1")
            assert False, "Should have raised"  # noqa: B011
        except RuntimeError as e:
            assert "CONNECTION_TABLE_NAME not configured" in str(e)


class TestRemoveConnection:
    """Tests for remove_connection with mocked DynamoDB."""

    @patch("shared.connection_manager._get_table")
    def test_deletes_connection_entry(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        remove_connection("conn-to-remove")

        mock_table.delete_item.assert_called_once_with(Key={"connectionId": "conn-to-remove"})

    @patch("shared.connection_manager._get_table")
    def test_does_not_raise_on_delete_failure(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.delete_item.side_effect = Exception("DynamoDB delete error")

        # Should not raise — relies on TTL
        remove_connection("conn-fail-delete")

    @patch("shared.connection_manager._get_table")
    def test_no_op_when_table_not_configured(self, mock_get_table: MagicMock) -> None:
        mock_get_table.return_value = None

        # Should not raise
        remove_connection("conn-no-table")


class TestGetConnectionForUser:
    """Tests for get_connection_for_user with mocked DynamoDB."""

    @patch("shared.connection_manager._get_table")
    def test_returns_connection_id_for_active_connection(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        now = int(time.time())
        mock_table.query.return_value = {
            "Items": [
                {
                    "connectionId": "conn-active",
                    "userId": "user-1",
                    "connectedAt": now - 100,
                    "expiresAt": now + 86300,
                }
            ]
        }

        result = get_connection_for_user("user-1")

        assert result == "conn-active"
        mock_table.query.assert_called_once_with(
            IndexName="userId-index",
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": "user-1"},
        )

    @patch("shared.connection_manager._get_table")
    def test_returns_none_when_no_connections_exist(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.query.return_value = {"Items": []}

        result = get_connection_for_user("user-no-conn")

        assert result is None

    @patch("shared.connection_manager._get_table")
    def test_returns_none_when_all_connections_expired(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        now = int(time.time())
        mock_table.query.return_value = {
            "Items": [
                {
                    "connectionId": "conn-expired",
                    "userId": "user-1",
                    "connectedAt": now - 90000,
                    "expiresAt": now - 3600,  # expired 1h ago
                }
            ]
        }

        result = get_connection_for_user("user-1")

        assert result is None

    @patch("shared.connection_manager._get_table")
    def test_returns_most_recent_active_connection(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        now = int(time.time())
        mock_table.query.return_value = {
            "Items": [
                {
                    "connectionId": "conn-old",
                    "userId": "user-1",
                    "connectedAt": now - 5000,
                    "expiresAt": now + 81400,
                },
                {
                    "connectionId": "conn-newest",
                    "userId": "user-1",
                    "connectedAt": now - 100,
                    "expiresAt": now + 86300,
                },
                {
                    "connectionId": "conn-middle",
                    "userId": "user-1",
                    "connectedAt": now - 2000,
                    "expiresAt": now + 84400,
                },
            ]
        }

        result = get_connection_for_user("user-1")

        assert result == "conn-newest"

    @patch("shared.connection_manager._get_table")
    def test_filters_out_expired_connections_from_multiple(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        now = int(time.time())
        mock_table.query.return_value = {
            "Items": [
                {
                    "connectionId": "conn-expired",
                    "userId": "user-1",
                    "connectedAt": now - 90000,
                    "expiresAt": now - 3600,
                },
                {
                    "connectionId": "conn-still-active",
                    "userId": "user-1",
                    "connectedAt": now - 1000,
                    "expiresAt": now + 85400,
                },
            ]
        }

        result = get_connection_for_user("user-1")

        assert result == "conn-still-active"

    @patch("shared.connection_manager._get_table")
    def test_returns_none_on_query_failure(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.query.side_effect = Exception("DynamoDB query error")

        result = get_connection_for_user("user-1")

        assert result is None

    @patch("shared.connection_manager._get_table")
    def test_returns_none_when_table_not_configured(self, mock_get_table: MagicMock) -> None:
        mock_get_table.return_value = None

        result = get_connection_for_user("user-1")

        assert result is None


class TestGetConnectionItem:
    """Tests for get_connection_item with mocked DynamoDB."""

    @patch("shared.connection_manager._get_table")
    def test_returns_item_when_found(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        now = int(time.time())
        expected_item = {
            "connectionId": "conn-123",
            "userId": "user-1",
            "connectedAt": now - 100,
            "expiresAt": now + 86300,
        }
        mock_table.get_item.return_value = {"Item": expected_item}

        result = get_connection_item("conn-123")

        assert result == expected_item
        mock_table.get_item.assert_called_once_with(Key={"connectionId": "conn-123"})

    @patch("shared.connection_manager._get_table")
    def test_returns_none_when_not_found(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.get_item.return_value = {}

        result = get_connection_item("conn-missing")

        assert result is None

    @patch("shared.connection_manager._get_table")
    def test_returns_none_on_error(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.get_item.side_effect = Exception("DynamoDB error")

        result = get_connection_item("conn-err")

        assert result is None

    @patch("shared.connection_manager._get_table")
    def test_returns_none_when_table_not_configured(self, mock_get_table: MagicMock) -> None:
        mock_get_table.return_value = None

        result = get_connection_item("conn-no-table")

        assert result is None
