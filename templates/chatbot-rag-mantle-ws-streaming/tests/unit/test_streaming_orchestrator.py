"""Unit tests for the streaming orchestrator handler.

Tests the streaming tool-use loop behavior including:
- Streaming tokens to client from final iteration only
- Status messages sent per tool-use iteration
- MAX_TOOL_ITERATIONS exceeded handling
- Client disconnect mid-stream handling
- Conversation history saving after success
"""

import json
import sys
from unittest.mock import MagicMock, patch

import pytest

# Patch target module path — the orchestrator handler imports from these
_ORCH = "orchestrator.handler"


@pytest.fixture(autouse=True)
def _env_vars(monkeypatch):
    """Set required environment variables for all tests."""
    monkeypatch.setenv("DYNAMODB_TABLE_NAME", "test-user-context")
    monkeypatch.setenv("CONNECTION_TABLE_NAME", "test-connections")
    monkeypatch.setenv("WEBSOCKET_API_ENDPOINT", "https://test.execute-api.us-east-1.amazonaws.com/dev")
    monkeypatch.setenv("MAX_TOOL_ITERATIONS", "3")
    monkeypatch.setenv("MAX_CHUNK_SIZE", "5")
    monkeypatch.setenv("MAX_CONVERSATION_HISTORY", "50")
    monkeypatch.setenv("POWERTOOLS_SERVICE_NAME", "test-orchestrator")
    monkeypatch.setenv("POWERTOOLS_LOG_LEVEL", "DEBUG")


@pytest.fixture(autouse=True)
def _clear_module_cache():
    """Remove orchestrator.handler from module cache to pick up fresh env vars."""
    yield
    for key in list(sys.modules.keys()):
        if key.startswith("orchestrator"):
            del sys.modules[key]


@pytest.fixture
def sqs_event():
    """Build a minimal SQS event with a single record."""
    def _build(user_id: str = "user-123", message: str = "Hello"):
        return {
            "Records": [
                {
                    "messageId": "msg-001",
                    "body": json.dumps({"userId": user_id, "message": message}),
                }
            ]
        }
    return _build


class TestStreamingFinalIteration:
    """Test that tokens are only streamed from the final iteration (no function_calls)."""

    @patch(f"{_ORCH}.send_to_connection", return_value=True)
    @patch(f"{_ORCH}.get_connection_for_user", return_value="conn-abc")
    @patch(f"{_ORCH}.get_conversation_history", return_value=[])
    @patch(f"{_ORCH}.save_conversation_history")
    @patch(f"{_ORCH}.invoke_mantle_streaming")
    def test_streams_text_from_final_iteration(
        self,
        mock_stream,
        mock_save,
        mock_history,
        mock_conn,
        mock_send,
        sqs_event,
    ):
        """When AI returns text without function_calls, stream chunks to client."""
        # Simulate streaming response: text only (final iteration)
        mock_stream.return_value = iter([
            {"type": "text_delta", "content": "Hello"},
            {"type": "text_delta", "content": " world"},
            {"type": "done", "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15}, "status": "completed"},
        ])

        from orchestrator.handler import handler

        result = handler(sqs_event(), MagicMock())

        assert result["batchItemFailures"] == []

        # Verify chunks were sent (MAX_CHUNK_SIZE=5, "Hello world" = 11 chars → 3 chunks)
        send_calls = mock_send.call_args_list
        chunk_calls = [c for c in send_calls if c[0][1].get("type") == "chunk"]
        done_calls = [c for c in send_calls if c[0][1].get("type") == "done"]

        assert len(chunk_calls) == 3  # "Hello", " worl", "d"
        assert chunk_calls[0][0][1] == {"type": "chunk", "content": "Hello"}
        assert chunk_calls[1][0][1] == {"type": "chunk", "content": " worl"}
        assert chunk_calls[2][0][1] == {"type": "chunk", "content": "d"}
        assert len(done_calls) == 1


class TestStreamingToolUseLoop:
    """Test tool-use loop: function_calls → execute tool → follow-up → final stream."""

    @patch(f"{_ORCH}.send_to_connection", return_value=True)
    @patch(f"{_ORCH}.get_connection_for_user", return_value="conn-abc")
    @patch(f"{_ORCH}.get_conversation_history", return_value=[])
    @patch(f"{_ORCH}.save_conversation_history")
    @patch(f"{_ORCH}.execute_tool")
    @patch(f"{_ORCH}.invoke_mantle_streaming")
    def test_tool_use_then_stream_final(
        self,
        mock_stream,
        mock_tool,
        mock_save,
        mock_history,
        mock_conn,
        mock_send,
        sqs_event,
    ):
        """First iteration has function_call (not streamed), second has text (streamed)."""
        # First call: function_call items
        first_stream = iter([
            {"type": "function_call", "name": "search_knowledge_base", "arguments": '{"query": "test"}', "call_id": "call-1"},
            {"type": "done", "usage": {"inputTokens": 5, "outputTokens": 2, "totalTokens": 7}, "status": "completed"},
        ])
        # Second call: text response (final)
        second_stream = iter([
            {"type": "text_delta", "content": "Found"},
            {"type": "text_delta", "content": " it!"},
            {"type": "done", "usage": {"inputTokens": 15, "outputTokens": 4, "totalTokens": 19}, "status": "completed"},
        ])
        mock_stream.side_effect = [first_stream, second_stream]
        mock_tool.return_value = {"toolName": "search_knowledge_base", "status": "success", "result": "doc content"}

        from orchestrator.handler import handler

        result = handler(sqs_event(), MagicMock())

        assert result["batchItemFailures"] == []

        # Verify status message sent for tool-use iteration
        send_calls = mock_send.call_args_list
        status_calls = [c for c in send_calls if c[0][1].get("type") == "status"]
        assert len(status_calls) == 1
        assert status_calls[0][0][1] == {"type": "status", "message": "Processing..."}

        # Verify chunks were sent from final iteration only
        chunk_calls = [c for c in send_calls if c[0][1].get("type") == "chunk"]
        assert len(chunk_calls) >= 1
        # Reconstruct streamed text
        streamed_text = "".join(c[0][1]["content"] for c in chunk_calls)
        assert streamed_text == "Found it!"

        # Verify tool was executed
        mock_tool.assert_called_once()

    @patch(f"{_ORCH}.send_to_connection", return_value=True)
    @patch(f"{_ORCH}.get_connection_for_user", return_value="conn-abc")
    @patch(f"{_ORCH}.get_conversation_history", return_value=[])
    @patch(f"{_ORCH}.save_conversation_history")
    @patch(f"{_ORCH}.execute_tool")
    @patch(f"{_ORCH}.invoke_mantle_streaming")
    def test_sends_one_status_per_iteration(
        self,
        mock_stream,
        mock_tool,
        mock_save,
        mock_history,
        mock_conn,
        mock_send,
        sqs_event,
    ):
        """Each tool-use iteration sends exactly one status message."""
        # Two tool-use iterations, then final text
        mock_stream.side_effect = [
            iter([
                {"type": "function_call", "name": "search_knowledge_base", "arguments": '{"query": "a"}', "call_id": "c1"},
                {"type": "done", "usage": {}, "status": "completed"},
            ]),
            iter([
                {"type": "function_call", "name": "search_knowledge_base", "arguments": '{"query": "b"}', "call_id": "c2"},
                {"type": "done", "usage": {}, "status": "completed"},
            ]),
            iter([
                {"type": "text_delta", "content": "Done"},
                {"type": "done", "usage": {}, "status": "completed"},
            ]),
        ]
        mock_tool.return_value = {"toolName": "search_knowledge_base", "status": "success", "result": "x"}

        from orchestrator.handler import handler

        handler(sqs_event(), MagicMock())

        send_calls = mock_send.call_args_list
        status_calls = [c for c in send_calls if c[0][1].get("type") == "status"]
        assert len(status_calls) == 2


class TestMaxToolIterationsExceeded:
    """Test MAX_TOOL_ITERATIONS exceeded sends error and stops processing."""

    @patch(f"{_ORCH}.send_to_connection", return_value=True)
    @patch(f"{_ORCH}.get_connection_for_user", return_value="conn-abc")
    @patch(f"{_ORCH}.get_conversation_history", return_value=[])
    @patch(f"{_ORCH}.save_conversation_history")
    @patch(f"{_ORCH}.execute_tool")
    @patch(f"{_ORCH}.invoke_mantle_streaming")
    def test_max_iterations_sends_error(
        self,
        mock_stream,
        mock_tool,
        mock_save,
        mock_history,
        mock_conn,
        mock_send,
        sqs_event,
    ):
        """When all iterations have function_calls, send error and don't save."""
        # All 3 iterations return function_calls (MAX_TOOL_ITERATIONS=3)
        mock_stream.side_effect = [
            iter([
                {"type": "function_call", "name": "search_knowledge_base", "arguments": '{"query": "x"}', "call_id": f"c{i}"},
                {"type": "done", "usage": {}, "status": "completed"},
            ])
            for i in range(3)
        ]
        mock_tool.return_value = {"toolName": "search_knowledge_base", "status": "success", "result": "x"}

        from orchestrator.handler import handler

        result = handler(sqs_event(), MagicMock())

        # Should NOT fail the SQS batch (error handled gracefully)
        assert result["batchItemFailures"] == []

        # Verify error message was sent to client
        send_calls = mock_send.call_args_list
        error_calls = [c for c in send_calls if c[0][1].get("type") == "error"]
        assert len(error_calls) == 1
        assert "Maximum tool iterations exceeded" in error_calls[0][0][1]["message"]
        assert error_calls[0][0][1].get("correlationId") == "msg-001"

        # Verify conversation was NOT saved
        mock_save.assert_not_called()


class TestClientDisconnect:
    """Test handling when client disconnects mid-stream."""

    @patch(f"{_ORCH}.send_to_connection")
    @patch(f"{_ORCH}.get_connection_for_user", return_value="conn-abc")
    @patch(f"{_ORCH}.get_conversation_history", return_value=[])
    @patch(f"{_ORCH}.save_conversation_history")
    @patch(f"{_ORCH}.invoke_mantle_streaming")
    def test_disconnect_during_chunk_delivery(
        self,
        mock_stream,
        mock_save,
        mock_history,
        mock_conn,
        mock_send,
        sqs_event,
    ):
        """If send_to_connection returns False during streaming, abort and don't save."""
        mock_stream.return_value = iter([
            {"type": "text_delta", "content": "Hello world"},
            {"type": "done", "usage": {}, "status": "completed"},
        ])
        # First chunk delivery fails (client disconnected)
        mock_send.return_value = False

        from orchestrator.handler import handler

        result = handler(sqs_event(), MagicMock())

        # Should NOT fail the SQS batch
        assert result["batchItemFailures"] == []
        # Conversation should NOT be saved
        mock_save.assert_not_called()


class TestConversationSaving:
    """Test that complete response + tool results are saved after success."""

    @patch(f"{_ORCH}.send_to_connection", return_value=True)
    @patch(f"{_ORCH}.get_connection_for_user", return_value="conn-abc")
    @patch(f"{_ORCH}.get_conversation_history", return_value=[])
    @patch(f"{_ORCH}.save_conversation_history")
    @patch(f"{_ORCH}.execute_tool")
    @patch(f"{_ORCH}.invoke_mantle_streaming")
    def test_saves_response_and_tool_results(
        self,
        mock_stream,
        mock_tool,
        mock_save,
        mock_history,
        mock_conn,
        mock_send,
        sqs_event,
    ):
        """After successful streaming with tools, save full response and tool results."""
        mock_stream.side_effect = [
            iter([
                {"type": "function_call", "name": "search_knowledge_base", "arguments": '{"query": "q"}', "call_id": "c1"},
                {"type": "done", "usage": {}, "status": "completed"},
            ]),
            iter([
                {"type": "text_delta", "content": "Answer"},
                {"type": "done", "usage": {}, "status": "completed"},
            ]),
        ]
        mock_tool.return_value = {"toolName": "search_knowledge_base", "status": "success", "result": "found"}

        from orchestrator.handler import handler

        handler(sqs_event(message="What?"), MagicMock())

        # Verify save was called
        mock_save.assert_called_once()
        saved_messages = mock_save.call_args[0][1]

        # Should contain: user message, tool interaction, assistant response
        assert len(saved_messages) == 3
        assert saved_messages[0]["role"] == "user"
        assert saved_messages[0]["content"] == "What?"
        assert saved_messages[1]["role"] == "assistant"
        assert saved_messages[1].get("tool_calls") is not None
        assert saved_messages[2]["role"] == "assistant"
        assert saved_messages[2]["content"] == "Answer"
