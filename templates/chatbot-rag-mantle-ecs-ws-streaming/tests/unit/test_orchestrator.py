"""Unit tests for orchestrator module — Streaming WebSocket Mantle variant."""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set required environment variables for all tests."""
    monkeypatch.setenv("DYNAMODB_TABLE_NAME", "test-table")
    monkeypatch.setenv("CONNECTION_TABLE_NAME", "test-connections")
    monkeypatch.setenv("WEBSOCKET_API_ENDPOINT", "https://test.execute-api.us-east-1.amazonaws.com")
    monkeypatch.setenv("RAG_BUCKET_NAME", "test-bucket")
    monkeypatch.setenv("MANTLE_BASE_URL", "https://test-mantle.api.aws/v1")
    monkeypatch.setenv("MODEL_ID", "test-model")
    monkeypatch.setenv("MAX_TOOL_ITERATIONS", "3")
    monkeypatch.setenv("MAX_CHUNK_SIZE", "1")


def _make_streaming_events(text_chunks: list[str], function_calls: list[dict] | None = None):
    """Generate streaming events for invoke_mantle_streaming mock."""
    events = []
    if function_calls:
        for fc in function_calls:
            events.append({
                "type": "function_call",
                "name": fc["name"],
                "arguments": fc["arguments"],
                "call_id": fc["call_id"],
            })
    else:
        for chunk in text_chunks:
            events.append({"type": "text_delta", "content": chunk})

    events.append({
        "type": "done",
        "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15},
        "finish_reason": "stop",
    })
    return events


class TestStreamingOrchestrator:
    """Tests for the streaming tool-use loop orchestrator."""

    @patch("app.orchestrator.send_to_connection")
    @patch("app.orchestrator.invoke_mantle_streaming")
    def test_streams_text_only_response_to_client(
        self, mock_streaming, mock_send, monkeypatch,
    ) -> None:
        """When AI returns text without function_calls, stream chunks to client."""
        monkeypatch.setenv("MAX_CHUNK_SIZE", "1")

        # Reset module-level globals that cache conversation_context
        import app.orchestrator as orch_module
        orch_module._conversation_context = None

        mock_streaming.return_value = iter(_make_streaming_events(["Hello", " world"]))
        mock_send.return_value = True

        mock_ctx = MagicMock()
        mock_ctx.get_conversation_history.return_value = []
        mock_ctx.append_messages.return_value = []

        with patch("app.orchestrator._get_conversation_context", return_value=mock_ctx):
            from app.orchestrator import process_message
            result = process_message(
                user_id="user-1",
                message_text="Hi",
                connection_id="conn-123",
                correlation_id="req-abc",
            )

        assert result["response"] == "Hello world"
        assert result["delivered"] is True
        assert result["conversationId"] == "user-1"

        # Should have sent chunk messages + done message
        calls = mock_send.call_args_list
        # 2 text chunks + 1 done = 3 send calls
        assert len(calls) == 3
        assert calls[0][0][1]["type"] == "chunk"
        assert calls[0][0][1]["content"] == "Hello"
        assert calls[1][0][1]["type"] == "chunk"
        assert calls[1][0][1]["content"] == " world"
        assert calls[2][0][1]["type"] == "done"

    @patch("app.orchestrator.send_to_connection")
    @patch("app.orchestrator.invoke_mantle_streaming")
    @patch("app.orchestrator.execute_tool")
    def test_tool_use_loop_sends_status_then_streams_final(
        self, mock_tool, mock_streaming, mock_send, monkeypatch
    ) -> None:
        """Tool-use loop: send status on tool-use iteration, stream final response."""
        monkeypatch.setenv("MAX_CHUNK_SIZE", "1")

        import app.orchestrator as orch_module
        orch_module._conversation_context = None

        # First call returns function_call, second returns text
        tool_events = _make_streaming_events(
            [],
            function_calls=[{
                "name": "search_knowledge_base",
                "arguments": '{"query": "docs"}',
                "call_id": "call-1",
            }],
        )
        text_events = _make_streaming_events(["Based on", " documents"])

        mock_streaming.side_effect = [iter(tool_events), iter(text_events)]
        mock_tool.return_value = {
            "toolName": "search_knowledge_base",
            "status": "success",
            "result": {"documents": []},
        }
        mock_send.return_value = True

        mock_ctx = MagicMock()
        mock_ctx.get_conversation_history.return_value = []
        mock_ctx.append_messages.return_value = []

        with patch("app.orchestrator._get_conversation_context", return_value=mock_ctx):
            from app.orchestrator import process_message
            result = process_message(
                user_id="user-2",
                message_text="Search docs",
                connection_id="conn-456",
                correlation_id="req-def",
            )

        assert result["response"] == "Based on documents"
        assert result["delivered"] is True

        # First send: status message
        first_send = mock_send.call_args_list[0][0][1]
        assert first_send["type"] == "status"
        assert first_send["message"] == "Processing..."

        # Subsequent sends: chunk, chunk, done
        assert mock_send.call_args_list[1][0][1]["type"] == "chunk"
        assert mock_send.call_args_list[2][0][1]["type"] == "chunk"
        assert mock_send.call_args_list[3][0][1]["type"] == "done"

    @patch("app.orchestrator.send_to_connection")
    @patch("app.orchestrator.invoke_mantle_streaming")
    def test_max_iterations_exceeded_sends_error(
        self, mock_streaming, mock_send, monkeypatch
    ) -> None:
        """When MAX_TOOL_ITERATIONS exceeded, send error and don't save."""
        monkeypatch.setenv("MAX_TOOL_ITERATIONS", "2")

        import app.orchestrator as orch_module
        orch_module._conversation_context = None
        # Force re-read of MAX_TOOL_ITERATIONS
        orch_module.MAX_TOOL_ITERATIONS = 2

        # Every iteration returns tool calls
        tool_events = _make_streaming_events(
            [],
            function_calls=[{
                "name": "search_knowledge_base",
                "arguments": '{"query": "test"}',
                "call_id": "call-x",
            }],
        )
        mock_streaming.side_effect = [iter(list(tool_events)), iter(list(tool_events))]
        mock_send.return_value = True

        mock_ctx = MagicMock()
        mock_ctx.get_conversation_history.return_value = []

        with (
            patch("app.orchestrator._get_conversation_context", return_value=mock_ctx),
            patch(
                "app.orchestrator.execute_tool",
                return_value={"status": "success", "result": {}},
            ),
        ):
            from app.orchestrator import process_message
            result = process_message(
                user_id="user-3",
                message_text="loop forever",
                connection_id="conn-789",
                correlation_id="req-ghi",
            )

        assert result["response"] == ""
        assert result["delivered"] is False

        # Last send should be the error message
        last_send = mock_send.call_args_list[-1][0][1]
        assert last_send["type"] == "error"
        assert "Maximum tool iterations exceeded" in last_send["message"]
        assert last_send["correlationId"] == "req-ghi"

        # Should NOT have saved conversation
        mock_ctx.append_messages.assert_not_called()

    @patch("app.orchestrator.send_to_connection")
    @patch("app.orchestrator.invoke_mantle_streaming")
    def test_client_disconnect_aborts_streaming(
        self, mock_streaming, mock_send, monkeypatch
    ) -> None:
        """When client disconnects during streaming, abort and don't save."""
        monkeypatch.setenv("MAX_CHUNK_SIZE", "1")

        import app.orchestrator as orch_module
        orch_module._conversation_context = None

        text_events = _make_streaming_events(["Hello", " world", " more"])
        mock_streaming.return_value = iter(text_events)

        # First chunk delivery fails (client disconnected)
        mock_send.return_value = False

        mock_ctx = MagicMock()
        mock_ctx.get_conversation_history.return_value = []

        with patch("app.orchestrator._get_conversation_context", return_value=mock_ctx):
            from app.orchestrator import process_message
            result = process_message(
                user_id="user-4",
                message_text="Hi",
                connection_id="conn-gone",
                correlation_id="req-jkl",
            )

        assert result["delivered"] is False

        # Should NOT have saved conversation (partial response discarded)
        mock_ctx.append_messages.assert_not_called()

    @patch("app.orchestrator.send_to_connection")
    @patch("app.orchestrator.invoke_mantle_streaming")
    def test_streaming_error_sends_error_to_client(
        self, mock_streaming, mock_send, monkeypatch
    ) -> None:
        """When AI streaming error mid-stream, send error and don't save."""
        import app.orchestrator as orch_module
        orch_module._conversation_context = None

        mock_streaming.side_effect = RuntimeError("Connection reset")
        mock_send.return_value = True

        mock_ctx = MagicMock()
        mock_ctx.get_conversation_history.return_value = []

        with patch("app.orchestrator._get_conversation_context", return_value=mock_ctx):
            from app.orchestrator import process_message
            result = process_message(
                user_id="user-5",
                message_text="Hi",
                connection_id="conn-err",
                correlation_id="req-mno",
            )

        assert result["response"] == ""
        assert result["delivered"] is False

        # Error message sent to client
        error_send = mock_send.call_args_list[0][0][1]
        assert error_send["type"] == "error"

        # Should NOT have saved conversation
        mock_ctx.append_messages.assert_not_called()
