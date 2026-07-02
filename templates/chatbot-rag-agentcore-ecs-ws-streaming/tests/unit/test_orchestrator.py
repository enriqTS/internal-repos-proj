"""Unit tests for orchestrator.py in the ECS WebSocket streaming variant.

Tests verify:
- No get_conversation_history() call before AI invocation
- invoke_agentcore_streaming called with message=str (not messages list)
- append_messages() called with user + assistant messages post-invocation
- DynamoDB write failure (exception on append_messages) does NOT prevent response
"""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture()
def mock_ai_caller():
    """Mock AgentCore streaming to yield predictable chunks."""
    with patch("app.orchestrator.invoke_agentcore_streaming") as mock:
        mock.return_value = iter(["Hello", " world"])
        yield mock


@pytest.fixture()
def mock_send():
    """Mock send_to_connection to track sent messages."""
    with patch("app.orchestrator.send_to_connection") as mock:
        mock.return_value = True
        yield mock


@pytest.fixture()
def mock_context():
    """Mock conversation context module."""
    with patch("app.orchestrator._get_conversation_context") as mock:
        ctx = MagicMock()
        ctx.append_messages.return_value = []
        mock.return_value = ctx
        yield ctx


class TestStreamingOrchestratorNoHistoryRetrieval:
    """Tests that streaming orchestrator does NOT retrieve history before AI invocation."""

    def test_no_get_conversation_history_call(self, mock_ai_caller, mock_send, mock_context):
        """process_message_streaming does NOT call get_conversation_history."""
        from app.orchestrator import process_message_streaming

        process_message_streaming(
            user_id="user-1",
            message_text="Hello",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        # Verify get_conversation_history was NOT called
        mock_context.get_conversation_history.assert_not_called()

    def test_ai_caller_invoked_with_string_message(self, mock_ai_caller, mock_send, mock_context):
        """Orchestrator passes message as a plain string to streaming caller."""
        from app.orchestrator import process_message_streaming

        process_message_streaming(
            user_id="user-1",
            message_text="What time is it?",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        mock_ai_caller.assert_called_once_with(
            session_id="user-1",
            message="What time is it?",
            correlation_id="corr-1",
        )

    def test_ai_caller_not_called_with_messages_list(self, mock_ai_caller, mock_send, mock_context):
        """Verify streaming AI caller is NOT called with a messages array."""
        from app.orchestrator import process_message_streaming

        process_message_streaming(
            user_id="user-1",
            message_text="Hello",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        call_kwargs = mock_ai_caller.call_args[1] if mock_ai_caller.call_args[1] else {}
        assert "messages" not in call_kwargs


class TestStreamingOrchestratorAppendMessages:
    """Tests that streaming orchestrator saves conversation exchange after AI response."""

    def test_append_messages_called_after_stream_completes(
        self, mock_ai_caller, mock_send, mock_context
    ):
        """append_messages() is called with assembled response after stream completes."""
        from app.orchestrator import process_message_streaming

        process_message_streaming(
            user_id="user-1",
            message_text="Hello",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        mock_context.append_messages.assert_called_once_with(
            user_id="user-1",
            user_message="Hello",
            assistant_response="Hello world",
            correlation_id="corr-1",
        )

    def test_response_returned_even_if_append_messages_fails(
        self, mock_ai_caller, mock_send, mock_context
    ):
        """DynamoDB write failure does NOT prevent response from being returned."""
        mock_context.append_messages.side_effect = Exception("DynamoDB write failed")

        from app.orchestrator import process_message_streaming

        # The function should still return the streamed response despite DynamoDB failure
        result = process_message_streaming(
            user_id="user-1",
            message_text="Hello",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        assert result["response"] == "Hello world"
        assert result["streamed"] is True
        assert result["conversationId"] == "user-1"
