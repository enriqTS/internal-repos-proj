"""Unit tests for streaming-specific behavior — Mantle ECS WebSocket streaming variant."""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set required environment variables for all tests."""
    monkeypatch.setenv("MANTLE_BASE_URL", "https://test-mantle.api.aws/v1")
    monkeypatch.setenv("MODEL_ID", "test-model")
    monkeypatch.setenv("DYNAMODB_TABLE_NAME", "test-table")
    monkeypatch.setenv("CONNECTION_TABLE_NAME", "test-connections")
    monkeypatch.setenv("WEBSOCKET_API_ENDPOINT", "https://test.execute-api.us-east-1.amazonaws.com")
    monkeypatch.setenv("RAG_BUCKET_NAME", "test-bucket")
    monkeypatch.setenv("MAX_CHUNK_SIZE", "1")


class TestStreamingAICaller:
    """Tests for the streaming invoke function of AI caller."""

    @patch("app.ai_caller.OpenAI")
    def test_invoke_mantle_streaming_yields_text_deltas(self, mock_openai_cls) -> None:
        """invoke_mantle_streaming yields text_delta events from the stream."""
        from app.ai_caller import invoke_mantle_streaming

        # Mock the streaming response
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client

        # Create mock stream events
        mock_event_text1 = MagicMock()
        mock_event_text1.type = "response.output_text.delta"
        mock_event_text1.delta = "Hello"

        mock_event_text2 = MagicMock()
        mock_event_text2.type = "response.output_text.delta"
        mock_event_text2.delta = " world"

        mock_event_done = MagicMock()
        mock_event_done.type = "response.completed"
        mock_event_done.response = MagicMock()
        mock_event_done.response.usage = MagicMock()
        mock_event_done.response.usage.input_tokens = 10
        mock_event_done.response.usage.output_tokens = 5
        mock_event_done.response.status = "completed"

        mock_client.responses.create.return_value = iter([
            mock_event_text1, mock_event_text2, mock_event_done
        ])

        events = list(invoke_mantle_streaming(
            messages=[{"role": "user", "content": "Hi"}],
            correlation_id="test-123",
        ))

        # Should have text_delta events + done event
        text_events = [e for e in events if e["type"] == "text_delta"]
        done_events = [e for e in events if e["type"] == "done"]

        assert len(text_events) == 2
        assert text_events[0]["content"] == "Hello"
        assert text_events[1]["content"] == " world"
        assert len(done_events) == 1
        assert done_events[0]["usage"]["inputTokens"] == 10
        assert done_events[0]["usage"]["outputTokens"] == 5

    @patch("app.ai_caller.OpenAI")
    def test_invoke_mantle_streaming_yields_function_calls(self, mock_openai_cls) -> None:
        """invoke_mantle_streaming yields function_call events."""
        from app.ai_caller import invoke_mantle_streaming

        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client

        # Simulate function call events
        mock_item_added = MagicMock()
        mock_item_added.type = "response.output_item.added"
        mock_item_added.item = MagicMock()
        mock_item_added.item.type = "function_call"
        mock_item_added.item.call_id = "call-1"
        mock_item_added.item.name = "search_knowledge_base"

        mock_args_delta = MagicMock()
        mock_args_delta.type = "response.function_call_arguments.delta"
        mock_args_delta.item_id = "call-1"
        mock_args_delta.delta = '{"query": "test"}'

        mock_args_done = MagicMock()
        mock_args_done.type = "response.function_call_arguments.done"
        mock_args_done.item_id = "call-1"

        mock_completed = MagicMock()
        mock_completed.type = "response.completed"
        mock_completed.response = MagicMock()
        mock_completed.response.usage = MagicMock()
        mock_completed.response.usage.input_tokens = 8
        mock_completed.response.usage.output_tokens = 3
        mock_completed.response.status = "completed"

        mock_client.responses.create.return_value = iter([
            mock_item_added, mock_args_delta, mock_args_done, mock_completed
        ])

        events = list(invoke_mantle_streaming(
            messages=[{"role": "user", "content": "Search"}],
            correlation_id="test-456",
        ))

        fc_events = [e for e in events if e["type"] == "function_call"]
        assert len(fc_events) == 1
        assert fc_events[0]["name"] == "search_knowledge_base"
        assert fc_events[0]["arguments"] == '{"query": "test"}'
        assert fc_events[0]["call_id"] == "call-1"


class TestMaxChunkSize:
    """Tests for MAX_CHUNK_SIZE batching behavior."""

    @patch("app.orchestrator.send_to_connection")
    @patch("app.orchestrator.invoke_mantle_streaming")
    def test_chunks_batched_by_max_chunk_size(
        self, mock_streaming, mock_send, monkeypatch
    ) -> None:
        """Tokens are batched per MAX_CHUNK_SIZE before sending."""
        monkeypatch.setenv("MAX_CHUNK_SIZE", "3")

        import app.orchestrator as orch_module
        orch_module._conversation_context = None
        orch_module.MAX_CHUNK_SIZE = 3

        # 5 text chunks should result in 2 send calls (3+2)
        events = []
        for t in ["A", "B", "C", "D", "E"]:
            events.append({"type": "text_delta", "content": t})
        events.append({
            "type": "done",
            "usage": {"inputTokens": 5, "outputTokens": 5, "totalTokens": 10},
            "finish_reason": "stop",
        })

        mock_streaming.return_value = iter(events)
        mock_send.return_value = True

        mock_ctx = MagicMock()
        mock_ctx.get_conversation_history.return_value = []
        mock_ctx.append_messages.return_value = []

        with patch("app.orchestrator._get_conversation_context", return_value=mock_ctx):
            from app.orchestrator import process_message
            result = process_message(
                user_id="user-batch",
                message_text="Hi",
                connection_id="conn-batch",
                correlation_id="req-batch",
            )

        assert result["response"] == "ABCDE"

        # Extract chunk sends (exclude done message)
        chunk_sends = [
            c[0][1] for c in mock_send.call_args_list
            if c[0][1].get("type") == "chunk"
        ]
        # 3 tokens batched, then 2 remaining
        assert len(chunk_sends) == 2
        assert chunk_sends[0]["content"] == "ABC"
        assert chunk_sends[1]["content"] == "DE"
