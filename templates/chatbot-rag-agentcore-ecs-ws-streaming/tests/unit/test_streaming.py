"""Unit tests for streaming orchestration in the ECS WebSocket streaming variant.

Tests verify:
- Chunks are forwarded progressively via message_sender
- Client disconnect mid-stream aborts the stream
- Full response is assembled and saved after stream completes
- Error during streaming sends error message and discards partial response
"""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture()
def mock_ai_caller():
    """Mock AgentCore streaming to yield predictable chunks."""
    with patch("app.orchestrator.invoke_agentcore_streaming") as mock:
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
        ctx.get_conversation_history.return_value = []
        ctx.append_messages.return_value = []
        mock.return_value = ctx
        yield ctx


class TestStreamingOrchestrator:
    """Tests for process_message_streaming."""

    def test_chunks_forwarded_progressively(
        self, mock_ai_caller, mock_send, mock_context
    ):
        """Each chunk from AI caller is sent to client as {"type": "chunk"}."""
        mock_ai_caller.return_value = iter(["Hello", " world", "!"])

        from app.orchestrator import process_message_streaming

        result = process_message_streaming(
            user_id="user-1",
            message_text="hi",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        # Verify chunk messages sent
        chunk_calls = [
            call
            for call in mock_send.call_args_list
            if call[0][1].get("type") == "chunk"
        ]
        assert len(chunk_calls) == 3
        assert chunk_calls[0][0][1]["content"] == "Hello"
        assert chunk_calls[1][0][1]["content"] == " world"
        assert chunk_calls[2][0][1]["content"] == "!"

        # Verify done message sent
        done_calls = [
            call
            for call in mock_send.call_args_list
            if call[0][1].get("type") == "done"
        ]
        assert len(done_calls) == 1
        assert done_calls[0][0][1]["conversationId"] == "user-1"

        # Verify full response assembled
        assert result["response"] == "Hello world!"
        assert result["streamed"] is True

    def test_client_disconnect_aborts_stream(
        self, mock_ai_caller, mock_send, mock_context
    ):
        """If send_to_connection returns False, stream is aborted."""
        mock_ai_caller.return_value = iter(["chunk1", "chunk2", "chunk3"])
        # Simulate disconnect on second chunk
        mock_send.side_effect = [True, False]

        from app.orchestrator import process_message_streaming

        result = process_message_streaming(
            user_id="user-1",
            message_text="hi",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        assert result["streamed"] is False
        assert result.get("disconnected") is True
        # Should NOT save to conversation history
        mock_context.append_messages.assert_not_called()

    def test_ai_error_sends_error_message(
        self, mock_ai_caller, mock_send, mock_context
    ):
        """If AI caller raises, error message is sent to client."""

        def gen_with_error():
            yield "partial"
            raise RuntimeError("Model error")

        mock_ai_caller.return_value = gen_with_error()

        from app.orchestrator import process_message_streaming

        result = process_message_streaming(
            user_id="user-1",
            message_text="hi",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        assert result["streamed"] is False
        assert "error" in result

        # Verify error message sent to client
        error_calls = [
            call
            for call in mock_send.call_args_list
            if call[0][1].get("type") == "error"
        ]
        assert len(error_calls) == 1
        assert "streaming failed" in error_calls[0][0][1]["message"].lower()

        # Should NOT save to conversation history
        mock_context.append_messages.assert_not_called()

    def test_assembled_response_saved_to_history(
        self, mock_ai_caller, mock_send, mock_context
    ):
        """After stream completes, full assembled response is saved."""
        mock_ai_caller.return_value = iter(["A", "B", "C"])

        from app.orchestrator import process_message_streaming

        process_message_streaming(
            user_id="user-1",
            message_text="hello",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        mock_context.append_messages.assert_called_once_with(
            user_id="user-1",
            user_message="hello",
            assistant_response="ABC",
            correlation_id="corr-1",
        )

    def test_empty_stream_saves_empty_response(
        self, mock_ai_caller, mock_send, mock_context
    ):
        """An empty stream still sends done and saves empty response."""
        mock_ai_caller.return_value = iter([])

        from app.orchestrator import process_message_streaming

        result = process_message_streaming(
            user_id="user-1",
            message_text="hi",
            connection_id="conn-123",
            correlation_id="corr-1",
        )

        assert result["response"] == ""
        assert result["streamed"] is True
        # Done message still sent
        done_calls = [
            call
            for call in mock_send.call_args_list
            if call[0][1].get("type") == "done"
        ]
        assert len(done_calls) == 1
