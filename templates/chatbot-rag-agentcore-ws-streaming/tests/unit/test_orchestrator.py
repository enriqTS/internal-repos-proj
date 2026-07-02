"""Tests for the Orchestrator Lambda handler (WebSocket streaming variant — direct API GW integration).

Validates:
- WebSocket API Gateway event format is parsed correctly (not SQS Records)
- NO call to get_conversation_history() before AI invocation (Req 1.1, 1.2)
- AI Caller invoked with simplified payload: {message, sessionId, correlationId} (Req 7.1)
- append_messages() called after successful response (Req 2.1)
- DynamoDB write failure does not block response delivery (Req 2.4)
- Streaming chunks sent via WebSocket connection (Req 6.3)

Requirements: 1.1, 1.2, 2.1, 2.4, 3.4
"""

import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Ensure the orchestrator module is importable
_ORCHESTRATOR_SRC = str(
    Path(__file__).resolve().parent.parent.parent / "src" / "orchestrator"
)


@pytest.fixture(autouse=True)
def _isolate_orchestrator_import() -> None:
    """Ensure we import orchestrator handler by path priority."""
    sys.path.insert(0, _ORCHESTRATOR_SRC)
    sys.modules.pop("handler", None)
    yield
    sys.path.remove(_ORCHESTRATOR_SRC)
    sys.modules.pop("handler", None)


# --- Fixtures ---


@pytest.fixture
def lambda_context() -> MagicMock:
    """Mock AWS Lambda context object."""
    ctx = MagicMock()
    ctx.function_name = "test-orchestrator-ws-streaming"
    ctx.memory_limit_in_mb = 256
    ctx.invoked_function_arn = (
        "arn:aws:lambda:us-east-1:123456789012:function:test-orchestrator-ws-streaming"
    )
    ctx.aws_request_id = "test-request-id-stream"
    return ctx


@pytest.fixture
def ws_event() -> dict[str, Any]:
    """Sample WebSocket API Gateway event — sendMessage route."""
    return {
        "requestContext": {
            "connectionId": "abc123",
            "routeKey": "sendMessage",
            "requestId": "req-id-001",
        },
        "body": json.dumps({"userId": "user-001", "message": "Hello"}),
    }


# --- Tests ---


@patch("handler.send_to_connection")
@patch("handler.append_messages")
@patch("handler.invoke_agentcore_streaming")
def test_handler_parses_websocket_event_and_returns_200(
    mock_invoke_streaming: MagicMock,
    mock_append_messages: MagicMock,
    mock_send: MagicMock,
    ws_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """Handler correctly parses WebSocket API GW event and returns statusCode 200."""
    mock_invoke_streaming.return_value = iter(["Hi", " there", "!"])
    mock_append_messages.return_value = []
    mock_send.return_value = True

    import handler

    result = handler.handler(ws_event, lambda_context)

    assert result == {"statusCode": 200}


@patch("handler.send_to_connection")
@patch("handler.append_messages")
@patch("handler.invoke_agentcore_streaming")
def test_ai_caller_receives_simplified_payload(
    mock_invoke_streaming: MagicMock,
    mock_append_messages: MagicMock,
    mock_send: MagicMock,
    ws_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """AI Caller streaming invoked with message (str), session_id, correlation_id.

    (Requirements 1.2, 7.1)
    """
    mock_invoke_streaming.return_value = iter(["OK"])
    mock_append_messages.return_value = []
    mock_send.return_value = True

    import handler

    handler.handler(ws_event, lambda_context)

    mock_invoke_streaming.assert_called_once_with(
        session_id="user-001",
        message="Hello",
        correlation_id="req-id-001",
    )


@patch("handler.send_to_connection")
@patch("handler.append_messages")
@patch("handler.invoke_agentcore_streaming")
def test_no_conversation_history_retrieval_before_ai_invocation(
    mock_invoke_streaming: MagicMock,
    mock_append_messages: MagicMock,
    mock_send: MagicMock,
    ws_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """Orchestrator does NOT call get_conversation_history() before AI invocation.

    AgentCore Runtime manages session context natively via sessionId.
    (Requirements 1.1, 1.2)
    """
    mock_invoke_streaming.return_value = iter(["Answer"])
    mock_append_messages.return_value = []
    mock_send.return_value = True

    import handler

    with patch(
        "shared.conversation_context.get_conversation_history",
    ) as mock_get_history:
        handler.handler(ws_event, lambda_context)
        mock_get_history.assert_not_called()


@patch("handler.send_to_connection")
@patch("handler.append_messages")
@patch("handler.invoke_agentcore_streaming")
def test_append_messages_called_after_successful_stream(
    mock_invoke_streaming: MagicMock,
    mock_append_messages: MagicMock,
    mock_send: MagicMock,
    ws_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """append_messages() is called with user + assembled response after streaming completes.

    (Requirements 2.1, 2.3)
    """
    mock_invoke_streaming.return_value = iter(["The answer", " is 42."])
    mock_append_messages.return_value = []
    mock_send.return_value = True

    import handler

    handler.handler(ws_event, lambda_context)

    mock_append_messages.assert_called_once_with(
        user_id="user-001",
        user_message="Hello",
        assistant_response="The answer is 42.",
        correlation_id="req-id-001",
    )


@patch("handler.send_to_connection")
@patch("handler.append_messages")
@patch("handler.invoke_agentcore_streaming")
def test_streaming_chunks_sent_via_websocket(
    mock_invoke_streaming: MagicMock,
    mock_append_messages: MagicMock,
    mock_send: MagicMock,
    ws_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """Streaming chunks are sent to the client via WebSocket as 'chunk' messages.

    (Requirement 6.3)
    """
    mock_invoke_streaming.return_value = iter(["Hello", " world"])
    mock_append_messages.return_value = []
    mock_send.return_value = True

    import handler

    handler.handler(ws_event, lambda_context)

    # At least chunk messages and a done message should be sent
    send_calls = mock_send.call_args_list
    assert len(send_calls) >= 2  # at least chunks + done

    # Verify chunks were sent to correct connection
    for call in send_calls:
        assert call[0][0] == "abc123"  # connection_id

    # Verify done message is sent last
    last_message = send_calls[-1][0][1]
    assert last_message["type"] == "done"


@patch("handler.send_to_connection")
@patch("handler.append_messages")
@patch("handler.invoke_agentcore_streaming")
def test_dynamodb_write_failure_does_not_block_response(
    mock_invoke_streaming: MagicMock,
    mock_append_messages: MagicMock,
    mock_send: MagicMock,
    ws_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """DynamoDB write failure for conversation history does not block response delivery.

    The handler should still return 200 and deliver streaming chunks
    even when append_messages raises an exception.
    (Requirement 2.4)
    """
    mock_invoke_streaming.return_value = iter(["I can help!"])
    mock_send.return_value = True

    # Simulate DynamoDB write failure
    mock_append_messages.side_effect = Exception(
        "DynamoDB ConditionalCheckFailedException"
    )

    import handler

    result = handler.handler(ws_event, lambda_context)

    # Handler still returns 200
    assert result == {"statusCode": 200}

    # Chunks and done message were still sent to the client
    send_calls = mock_send.call_args_list
    assert len(send_calls) >= 1
    # Verify done message was sent (streaming completed successfully)
    done_calls = [c for c in send_calls if c[0][1].get("type") == "done"]
    assert len(done_calls) == 1


@patch("handler.send_to_connection")
@patch("handler.append_messages")
@patch("handler.invoke_agentcore_streaming")
def test_handler_sends_error_on_missing_user_id(
    mock_invoke_streaming: MagicMock,
    mock_append_messages: MagicMock,
    mock_send: MagicMock,
    lambda_context: MagicMock,
) -> None:
    """Handler sends error message when userId is missing from body."""
    event = {
        "requestContext": {
            "connectionId": "conn-invalid",
            "routeKey": "sendMessage",
            "requestId": "req-err",
        },
        "body": json.dumps({"message": "Hello"}),
    }
    mock_send.return_value = True

    import handler

    result = handler.handler(event, lambda_context)

    assert result == {"statusCode": 200}
    mock_invoke_streaming.assert_not_called()
    # An error message should be sent to the connection
    mock_send.assert_called_once()
    sent_message = mock_send.call_args[0][1]
    assert sent_message["type"] == "error"
