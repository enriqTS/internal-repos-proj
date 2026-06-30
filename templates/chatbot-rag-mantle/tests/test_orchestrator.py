"""Tests for the Orchestrator Lambda handler."""

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


# --- Fixtures ---


@pytest.fixture
def lambda_context() -> MagicMock:
    """Mock AWS Lambda context object."""
    ctx = MagicMock()
    ctx.function_name = "test-orchestrator"
    ctx.memory_limit_in_mb = 256
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test-orchestrator"
    ctx.aws_request_id = "test-request-id-1234"
    return ctx


@pytest.fixture
def sqs_event() -> dict[str, Any]:
    """Sample SQS event payload with a single message."""
    body = {
        "userId": "user-001",
        "message": "Hello, how can you help me?",
        "messageId": "msg-abc-123",
        "correlationId": "corr-xyz-789",
        "timestamp": "2024-01-15T10:30:00Z",
    }
    return {
        "Records": [
            {
                "messageId": "sqs-msg-id",
                "receiptHandle": "handle",
                "body": json.dumps(body),
                "attributes": {},
                "messageAttributes": {},
                "md5OfBody": "",
                "eventSource": "aws:sqs",
                "eventSourceARN": "arn:aws:sqs:us-east-1:123456789012:test-queue",
                "awsRegion": "us-east-1",
            }
        ]
    }


# --- Tests ---


@patch("handler.save_conversation_history")
@patch("handler.invoke_ai_caller")
@patch("handler.table")
@patch("handler.responses_table")
@patch("handler.lambda_client")
def test_handler_returns_200_and_stores_response(
    mock_lambda_client: MagicMock,
    mock_responses_table: MagicMock,
    mock_table: MagicMock,
    mock_invoke_ai: MagicMock,
    mock_save_history: MagicMock,
    sqs_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """Handler returns 200 and writes completed response when AI returns text-only reply."""
    # Arrange: DynamoDB get_item returns empty history
    mock_table.get_item.return_value = {"Item": {}}

    # Arrange: invoke_ai_caller returns a text-only response (no tool calls)
    mock_invoke_ai.return_value = {
        "content": "I can help you with many things!",
        "function_calls": [],
        "timestamp": "2024-01-15T10:30:01Z",
    }

    # Act
    from handler import handler

    result = handler(sqs_event, lambda_context)

    # Assert: handler always returns 200 so SQS deletes the message
    assert result == {"statusCode": 200}

    # Assert: DynamoDB was queried for conversation history
    mock_table.get_item.assert_called_once_with(Key={"userId": "user-001"})

    # Assert: AI Caller was invoked with messages containing the user message
    mock_invoke_ai.assert_called_once()
    call_kwargs = mock_invoke_ai.call_args[1]
    messages_sent = call_kwargs["messages"]
    assert any(m["role"] == "user" and "Hello" in m["content"] for m in messages_sent)

    # Assert: completed response was written to responses table
    put_calls = mock_responses_table.put_item.call_args_list
    # Should have at least 2 calls: "pending" + "completed"
    assert len(put_calls) >= 2

    # Check the final put_item was for "completed" status
    last_put = put_calls[-1][1]["Item"]
    assert last_put["messageId"] == "msg-abc-123"
    assert last_put["status"] == "completed"
    assert last_put["response"] == "I can help you with many things!"
    assert last_put["userId"] == "user-001"

    # Assert: conversation history was saved with user + assistant messages
    mock_save_history.assert_called_once()
    saved_messages = mock_save_history.call_args[0][1]
    assert len(saved_messages) == 2  # user message + assistant response
    assert saved_messages[0]["role"] == "user"
    assert saved_messages[1]["role"] == "assistant"
