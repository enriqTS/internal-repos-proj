"""Unit tests for shared conversation context module.

Tests DynamoDB read/write, history trimming, message appending,
and graceful degradation on failures.
"""

import os
from datetime import datetime
from unittest.mock import MagicMock, patch

# Set environment variables before importing module
os.environ.setdefault("DYNAMODB_TABLE_NAME", "test-user-context")
os.environ.setdefault("MAX_CONVERSATION_HISTORY", "50")
os.environ.setdefault("POWERTOOLS_SERVICE_NAME", "test")
os.environ.setdefault("POWERTOOLS_LOG_LEVEL", "DEBUG")


from shared.conversation_context import (
    append_messages,
    get_conversation_history,
    save_conversation_history,
    trim_history,
)


class TestTrimHistory:
    """Tests for trim_history — pure function, no mocks needed."""

    def test_returns_empty_list_when_max_is_zero(self) -> None:
        messages = [{"role": "user", "content": "hi", "timestamp": "t1"}]
        assert trim_history(messages, 0) == []

    def test_returns_unchanged_when_within_limit(self) -> None:
        messages = [
            {"role": "user", "content": "hello", "timestamp": "t1"},
            {"role": "assistant", "content": "hi", "timestamp": "t2"},
        ]
        result = trim_history(messages, 10)
        assert result == messages

    def test_returns_unchanged_when_exactly_at_limit(self) -> None:
        messages = [
            {"role": "user", "content": f"msg{i}", "timestamp": f"t{i}"}
            for i in range(5)
        ]
        result = trim_history(messages, 5)
        assert result == messages

    def test_trims_oldest_messages_preserving_recency(self) -> None:
        messages = [
            {"role": "user", "content": f"msg{i}", "timestamp": f"t{i}"}
            for i in range(10)
        ]
        result = trim_history(messages, 3)
        assert len(result) == 3
        assert result[0]["content"] == "msg7"
        assert result[1]["content"] == "msg8"
        assert result[2]["content"] == "msg9"

    def test_handles_empty_list(self) -> None:
        assert trim_history([], 10) == []

    def test_handles_negative_max(self) -> None:
        messages = [{"role": "user", "content": "hi", "timestamp": "t1"}]
        assert trim_history(messages, -1) == []

    def test_single_message_trimmed_to_one(self) -> None:
        messages = [
            {"role": "user", "content": "old", "timestamp": "t1"},
            {"role": "assistant", "content": "new", "timestamp": "t2"},
        ]
        result = trim_history(messages, 1)
        assert len(result) == 1
        assert result[0]["content"] == "new"


class TestGetConversationHistory:
    """Tests for get_conversation_history with mocked DynamoDB."""

    @patch("shared.conversation_context._get_table")
    def test_returns_messages_from_dynamodb(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        messages = [
            {
                "role": "user",
                "content": "hello",
                "timestamp": "2024-01-01T00:00:00+00:00",
            },
            {
                "role": "assistant",
                "content": "hi there",
                "timestamp": "2024-01-01T00:00:01+00:00",
            },
        ]
        mock_table.get_item.return_value = {
            "Item": {"userId": "user-1", "messages": messages}
        }

        result = get_conversation_history("user-1", correlation_id="corr-123")

        assert result == messages
        mock_table.get_item.assert_called_once_with(Key={"userId": "user-1"})

    @patch("shared.conversation_context._get_table")
    def test_returns_empty_list_for_new_user(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.get_item.return_value = {}

        result = get_conversation_history("new-user", correlation_id="corr-456")

        assert result == []

    @patch("shared.conversation_context.MAX_CONVERSATION_HISTORY", 50)
    @patch("shared.conversation_context._get_table")
    def test_trims_history_to_max(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        messages = [
            {"role": "user", "content": f"msg{i}", "timestamp": f"t{i}"}
            for i in range(100)
        ]
        mock_table.get_item.return_value = {
            "Item": {"userId": "user-1", "messages": messages}
        }

        result = get_conversation_history("user-1", correlation_id="corr-789")

        assert len(result) == 50
        # Preserves most recent
        assert result[0]["content"] == "msg50"
        assert result[-1]["content"] == "msg99"

    @patch("shared.conversation_context._get_table")
    def test_graceful_degradation_on_read_failure(
        self, mock_get_table: MagicMock
    ) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.get_item.side_effect = Exception("DynamoDB timeout")

        result = get_conversation_history("user-1", correlation_id="corr-err")

        assert result == []

    @patch("shared.conversation_context._get_table")
    def test_returns_empty_when_table_not_configured(
        self, mock_get_table: MagicMock
    ) -> None:
        mock_get_table.return_value = None

        result = get_conversation_history("user-1", correlation_id="corr-no-table")

        assert result == []


class TestSaveConversationHistory:
    """Tests for save_conversation_history with mocked DynamoDB."""

    @patch("shared.conversation_context._get_table")
    def test_saves_messages_to_dynamodb(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        messages = [
            {"role": "user", "content": "hello", "timestamp": "t1"},
            {"role": "assistant", "content": "hi", "timestamp": "t2"},
        ]

        save_conversation_history("user-1", messages, correlation_id="corr-save")

        mock_table.put_item.assert_called_once()
        item = mock_table.put_item.call_args[1]["Item"]
        assert item["userId"] == "user-1"
        assert item["messages"] == messages
        assert "updatedAt" in item

    @patch("shared.conversation_context.MAX_CONVERSATION_HISTORY", 10)
    @patch("shared.conversation_context._get_table")
    def test_trims_before_saving(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        messages = [
            {"role": "user", "content": f"msg{i}", "timestamp": f"t{i}"}
            for i in range(100)
        ]

        save_conversation_history("user-1", messages, correlation_id="corr-trim")

        item = mock_table.put_item.call_args[1]["Item"]
        assert len(item["messages"]) == 10
        assert item["messages"][-1]["content"] == "msg99"

    @patch("shared.conversation_context._get_table")
    def test_does_not_raise_on_write_failure(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.put_item.side_effect = Exception("DynamoDB write error")

        # Should not raise
        save_conversation_history(
            "user-1",
            [{"role": "user", "content": "hi", "timestamp": "t1"}],
            correlation_id="corr-fail",
        )

    @patch("shared.conversation_context._get_table")
    def test_no_op_when_table_not_configured(self, mock_get_table: MagicMock) -> None:
        mock_get_table.return_value = None

        # Should not raise
        save_conversation_history(
            "user-1",
            [{"role": "user", "content": "hi", "timestamp": "t1"}],
            correlation_id="corr-no-table",
        )


class TestAppendMessages:
    """Tests for append_messages — integrates get/save/trim."""

    @patch("shared.conversation_context._get_table")
    def test_appends_user_and_assistant_messages(
        self, mock_get_table: MagicMock
    ) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        existing = [
            {
                "role": "user",
                "content": "previous",
                "timestamp": "2024-01-01T00:00:00+00:00",
            },
        ]
        mock_table.get_item.return_value = {
            "Item": {"userId": "user-1", "messages": existing}
        }

        result = append_messages(
            "user-1",
            "What is AI?",
            "AI is artificial intelligence.",
            correlation_id="corr-append",
        )

        assert len(result) == 3
        assert result[0]["content"] == "previous"
        assert result[1]["role"] == "user"
        assert result[1]["content"] == "What is AI?"
        assert result[2]["role"] == "assistant"
        assert result[2]["content"] == "AI is artificial intelligence."

    @patch("shared.conversation_context._get_table")
    def test_appended_messages_have_timestamps(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.get_item.return_value = {}

        result = append_messages(
            "user-1",
            "hello",
            "hi there",
            correlation_id="corr-ts",
        )

        assert len(result) == 2
        # Timestamps should be valid ISO 8601
        for msg in result:
            ts = msg["timestamp"]
            assert "T" in ts
            # Should be parseable
            datetime.fromisoformat(ts)

    @patch("shared.conversation_context.MAX_CONVERSATION_HISTORY", 50)
    @patch("shared.conversation_context._get_table")
    def test_trims_after_appending(self, mock_get_table: MagicMock) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        existing = [
            {"role": "user", "content": f"msg{i}", "timestamp": f"t{i}"}
            for i in range(49)
        ]
        mock_table.get_item.return_value = {
            "Item": {"userId": "user-1", "messages": existing}
        }

        result = append_messages(
            "user-1",
            "new question",
            "new answer",
            correlation_id="corr-trim-append",
        )

        # 49 + 2 = 51, trimmed to 50
        assert len(result) == 50
        # Most recent messages preserved
        assert result[-1]["content"] == "new answer"
        assert result[-2]["content"] == "new question"

    @patch("shared.conversation_context._get_table")
    def test_proceeds_with_empty_history_on_read_failure(
        self, mock_get_table: MagicMock
    ) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.get_item.side_effect = Exception("Read failed")

        result = append_messages(
            "user-1",
            "hello",
            "hi",
            correlation_id="corr-read-fail",
        )

        # Should still have the 2 new messages
        assert len(result) == 2
        assert result[0]["role"] == "user"
        assert result[1]["role"] == "assistant"

    @patch("shared.conversation_context._get_table")
    def test_returns_messages_even_on_write_failure(
        self, mock_get_table: MagicMock
    ) -> None:
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table
        mock_table.get_item.return_value = {}
        mock_table.put_item.side_effect = Exception("Write failed")

        result = append_messages(
            "user-1",
            "hello",
            "hi",
            correlation_id="corr-write-fail",
        )

        # Should still return messages despite write failure
        assert len(result) == 2
        assert result[0]["content"] == "hello"
        assert result[1]["content"] == "hi"
