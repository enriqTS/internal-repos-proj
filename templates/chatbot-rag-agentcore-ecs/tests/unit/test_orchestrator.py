"""Unit tests for orchestrator.py in the ECS REST variant.

Tests verify:
- No get_conversation_history() call before AI invocation
- invoke_agentcore called with message=str, session_id=str
- append_messages() called with user + assistant messages post-invocation
- DynamoDB write failure (exception on append_messages) does NOT prevent response
"""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture()
def mock_ai_caller():
    """Mock invoke_agentcore to return a predictable response."""
    with patch("app.orchestrator.invoke_agentcore") as mock:
        mock.return_value = {
            "response": "I can help with that!",
            "usage": {"inputTokens": 10, "outputTokens": 20, "totalTokens": 30},
            "finishReason": "end_turn",
            "sessionId": "user-1",
        }
        yield mock


@pytest.fixture()
def mock_context():
    """Mock conversation context module."""
    with patch("app.orchestrator._get_conversation_context") as mock:
        ctx = MagicMock()
        ctx.append_messages.return_value = []
        mock.return_value = ctx
        yield ctx


class TestOrchestratorNoHistoryRetrieval:
    """Tests that orchestrator does NOT retrieve history before AI invocation."""

    def test_no_get_conversation_history_call(self, mock_ai_caller, mock_context):
        """process_message does NOT call get_conversation_history before AI call."""
        from app.orchestrator import process_message

        process_message(
            user_id="user-1",
            message_text="Hello",
            correlation_id="corr-1",
        )

        # Verify get_conversation_history was NOT called
        mock_context.get_conversation_history.assert_not_called()

    def test_ai_caller_invoked_with_string_message(self, mock_ai_caller, mock_context):
        """Orchestrator passes message as a plain string, not a list."""
        from app.orchestrator import process_message

        process_message(
            user_id="user-1",
            message_text="What time is it?",
            correlation_id="corr-1",
        )

        mock_ai_caller.assert_called_once_with(
            session_id="user-1",
            message="What time is it?",
            correlation_id="corr-1",
            stream=False,
        )

    def test_ai_caller_not_called_with_messages_list(self, mock_ai_caller, mock_context):
        """Verify AI caller is NOT called with a messages array."""
        from app.orchestrator import process_message

        process_message(
            user_id="user-1",
            message_text="Hello",
            correlation_id="corr-1",
        )

        # Check that no 'messages' kwarg was passed
        call_kwargs = mock_ai_caller.call_args[1] if mock_ai_caller.call_args[1] else {}
        call_args_all = {
            **dict(
                zip(
                    ["session_id", "message"],
                    mock_ai_caller.call_args[0] if mock_ai_caller.call_args[0] else [],
                    strict=False,
                )
            ),
            **call_kwargs,
        }
        assert "messages" not in call_args_all


class TestOrchestratorAppendMessages:
    """Tests that orchestrator saves conversation exchange after AI response."""

    def test_append_messages_called_after_response(self, mock_ai_caller, mock_context):
        """append_messages() is called with user message and AI response."""
        from app.orchestrator import process_message

        process_message(
            user_id="user-1",
            message_text="Hello",
            correlation_id="corr-1",
        )

        mock_context.append_messages.assert_called_once_with(
            user_id="user-1",
            user_message="Hello",
            assistant_response="I can help with that!",
            correlation_id="corr-1",
        )

    def test_response_returned_even_if_append_messages_fails(self, mock_ai_caller, mock_context):
        """DynamoDB write failure does NOT prevent response from being returned."""
        mock_context.append_messages.side_effect = Exception("DynamoDB write failed")

        from app.orchestrator import process_message

        # The function should still return the AI response despite DynamoDB failure
        result = process_message(
            user_id="user-1",
            message_text="Hello",
            correlation_id="corr-1",
        )

        assert result["response"] == "I can help with that!"
        assert result["conversationId"] == "user-1"
