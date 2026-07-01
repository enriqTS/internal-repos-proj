"""Unit tests for streaming orchestrator behavior.

Tests the streaming-specific logic in the orchestrator handler:
- Progressive chunk delivery via message_sender
- Full response assembly after stream completes
- Client disconnect detection and stream abort
- Error mid-stream handling
- max_chunk_size batching behavior
"""

import json
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    """Set required environment variables for all tests."""
    monkeypatch.setenv("DYNAMODB_TABLE_NAME", "test-user-context")
    monkeypatch.setenv("CONNECTION_TABLE_NAME", "test-connections")
    monkeypatch.setenv("WEBSOCKET_API_ENDPOINT", "https://test.execute-api.us-east-1.amazonaws.com/dev")
    monkeypatch.setenv("AGENT_ID", "test-agent")
    monkeypatch.setenv("AGENT_ALIAS_ID", "TSTALIASID")
    monkeypatch.setenv("MAX_CHUNK_SIZE", "1")
    monkeypatch.setenv("POWERTOOLS_SERVICE_NAME", "orchestrator")
    monkeypatch.setenv("POWERTOOLS_LOG_LEVEL", "DEBUG")


def _make_sqs_event(user_id: str, message: str) -> dict:
    """Create a mock SQS event with a single record."""
    return {
        "Records": [
            {
                "messageId": "test-msg-001",
                "body": json.dumps({"userId": user_id, "message": message}),
            }
        ]
    }


class TestStreamingOrchestrator:
    """Tests for the streaming orchestrator handler."""

    @patch("shared.message_sender.send_to_connection")
    @patch("shared.ai_caller_agentcore.invoke_agentcore_streaming")
    @patch("shared.conversation_context.append_messages")
    @patch("shared.conversation_context.get_conversation_history")
    @patch("shared.connection_manager.get_connection_for_user")
    def test_streams_chunks_to_client(
        self,
        mock_get_conn,
        mock_get_history,
        mock_append,
        mock_stream,
        mock_send,
    ):
        """Verify each chunk from AI is forwarded as a chunk message."""
        mock_get_conn.return_value = "conn-123"
        mock_get_history.return_value = []
        mock_stream.return_value = iter(["Hello", " world", "!"])
        mock_send.return_value = True

        from orchestrator.handler import handler

        event = _make_sqs_event("user-1", "Hi")
        result = handler(event, MagicMock())

        assert result["batchItemFailures"] == []

        # Should have sent 3 chunk messages + 1 done message
        assert mock_send.call_count == 4

        # Verify chunk messages
        chunk_calls = mock_send.call_args_list[:3]
        for call in chunk_calls:
            msg = call[0][1]
            assert msg["type"] == "chunk"

        assert chunk_calls[0][0][1]["content"] == "Hello"
        assert chunk_calls[1][0][1]["content"] == " world"
        assert chunk_calls[2][0][1]["content"] == "!"

        # Verify done message
        done_call = mock_send.call_args_list[3]
        assert done_call[0][1]["type"] == "done"
        assert done_call[0][1]["conversationId"] == "user-1"

    @patch("shared.message_sender.send_to_connection")
    @patch("shared.ai_caller_agentcore.invoke_agentcore_streaming")
    @patch("shared.conversation_context.append_messages")
    @patch("shared.conversation_context.get_conversation_history")
    @patch("shared.connection_manager.get_connection_for_user")
    def test_saves_full_assembled_response(
        self,
        mock_get_conn,
        mock_get_history,
        mock_append,
        mock_stream,
        mock_send,
    ):
        """Verify full assembled response is saved to conversation history."""
        mock_get_conn.return_value = "conn-123"
        mock_get_history.return_value = []
        mock_stream.return_value = iter(["Hello", " world"])
        mock_send.return_value = True

        from orchestrator.handler import handler

        event = _make_sqs_event("user-1", "Hi")
        handler(event, MagicMock())

        # Verify append_messages was called with the full assembled response
        mock_append.assert_called_once_with(
            user_id="user-1",
            user_message="Hi",
            assistant_response="Hello world",
            correlation_id="test-msg-001",
        )

    @patch("shared.message_sender.send_to_connection")
    @patch("shared.ai_caller_agentcore.invoke_agentcore_streaming")
    @patch("shared.conversation_context.append_messages")
    @patch("shared.conversation_context.get_conversation_history")
    @patch("shared.connection_manager.get_connection_for_user")
    def test_client_disconnect_aborts_stream(
        self,
        mock_get_conn,
        mock_get_history,
        mock_append,
        mock_stream,
        mock_send,
    ):
        """Verify stream is aborted when client disconnects (send returns False)."""
        mock_get_conn.return_value = "conn-123"
        mock_get_history.return_value = []
        mock_stream.return_value = iter(["Hello", " world", " more"])
        # First send succeeds, second fails (client disconnected)
        mock_send.side_effect = [True, False]

        from orchestrator.handler import handler

        event = _make_sqs_event("user-1", "Hi")
        result = handler(event, MagicMock())

        # Should NOT save to conversation history (partial response discarded)
        mock_append.assert_not_called()
        # Should not fail the batch item (disconnect is handled gracefully)
        assert result["batchItemFailures"] == []

    @patch("shared.message_sender.send_to_connection")
    @patch("shared.ai_caller_agentcore.invoke_agentcore_streaming")
    @patch("shared.conversation_context.append_messages")
    @patch("shared.conversation_context.get_conversation_history")
    @patch("shared.connection_manager.get_connection_for_user")
    def test_error_mid_stream_sends_error_message(
        self,
        mock_get_conn,
        mock_get_history,
        mock_append,
        mock_stream,
        mock_send,
    ):
        """Verify error mid-stream sends error message and discards partial."""

        def _failing_generator():
            yield "Hello"
            raise RuntimeError("AI service error")

        mock_get_conn.return_value = "conn-123"
        mock_get_history.return_value = []
        mock_stream.return_value = _failing_generator()
        mock_send.return_value = True

        from orchestrator.handler import handler

        event = _make_sqs_event("user-1", "Hi")
        result = handler(event, MagicMock())

        # Should have sent chunk + error message
        # The error is caught and reported but causes batch failure
        assert len(result["batchItemFailures"]) == 1

        # Verify an error message was sent to client
        error_calls = [
            c for c in mock_send.call_args_list if c[0][1].get("type") == "error"
        ]
        assert len(error_calls) >= 1

        # Should NOT save to conversation history
        mock_append.assert_not_called()

    @patch("shared.message_sender.send_to_connection")
    @patch("shared.ai_caller_agentcore.invoke_agentcore_streaming")
    @patch("shared.conversation_context.append_messages")
    @patch("shared.conversation_context.get_conversation_history")
    @patch("shared.connection_manager.get_connection_for_user")
    def test_max_chunk_size_batching(
        self,
        mock_get_conn,
        mock_get_history,
        mock_append,
        mock_stream,
        mock_send,
        monkeypatch,
    ):
        """Verify tokens are batched according to max_chunk_size."""
        monkeypatch.setenv("MAX_CHUNK_SIZE", "3")

        # Need to reimport to pick up new env var
        import importlib

        import orchestrator.handler as orch_module

        importlib.reload(orch_module)

        mock_get_conn.return_value = "conn-123"
        mock_get_history.return_value = []
        mock_stream.return_value = iter(["a", "b", "c", "d", "e"])
        mock_send.return_value = True

        event = _make_sqs_event("user-1", "Hi")
        orch_module.handler(event, MagicMock())

        # With chunk_size=3 and 5 tokens: first batch of 3, then flush of 2
        chunk_calls = [
            c for c in mock_send.call_args_list if c[0][1].get("type") == "chunk"
        ]
        assert len(chunk_calls) == 2
        assert chunk_calls[0][0][1]["content"] == "abc"
        assert chunk_calls[1][0][1]["content"] == "de"

    @patch("shared.message_sender.send_to_connection")
    @patch("shared.ai_caller_agentcore.invoke_agentcore_streaming")
    @patch("shared.conversation_context.append_messages")
    @patch("shared.conversation_context.get_conversation_history")
    @patch("shared.connection_manager.get_connection_for_user")
    def test_no_connection_skips_processing(
        self,
        mock_get_conn,
        mock_get_history,
        mock_append,
        mock_stream,
        mock_send,
    ):
        """Verify message is skipped when no active connection exists."""
        mock_get_conn.return_value = None

        from orchestrator.handler import handler

        event = _make_sqs_event("user-1", "Hi")
        result = handler(event, MagicMock())

        assert result["batchItemFailures"] == []
        mock_stream.assert_not_called()
        mock_send.assert_not_called()
        mock_append.assert_not_called()
