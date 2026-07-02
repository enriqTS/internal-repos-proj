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


@patch("handler.append_messages")
@patch("handler.invoke_ai_caller")
@patch("handler.responses_table")
@patch("handler.lambda_client")
def test_handler_returns_200_and_stores_response(
    mock_lambda_client: MagicMock,
    mock_responses_table: MagicMock,
    mock_invoke_ai: MagicMock,
    mock_append_messages: MagicMock,
    sqs_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """Handler returns 200 and writes completed response when AI returns text-only reply."""
    # Arrange: invoke_ai_caller returns a text-only response (no tool calls)
    mock_invoke_ai.return_value = {
        "response": "I can help you with many things!",
        "usage": {"inputTokens": 50, "outputTokens": 20, "totalTokens": 70},
        "finishReason": "end_turn",
        "sessionId": "user-001",
    }

    # Arrange: append_messages returns updated history
    mock_append_messages.return_value = [
        {"role": "user", "content": "Hello, how can you help me?", "timestamp": "2024-01-15T10:30:00Z"},
        {"role": "assistant", "content": "I can help you with many things!", "timestamp": "2024-01-15T10:30:01Z"},
    ]

    # Act
    from handler import handler

    result = handler(sqs_event, lambda_context)

    # Assert: handler always returns 200 so SQS deletes the message
    assert result == {"statusCode": 200}

    # Assert: AI Caller was invoked with simplified payload (message string, not array)
    mock_invoke_ai.assert_called_once_with(
        message="Hello, how can you help me?",
        session_id="user-001",
        correlation_id="corr-xyz-789",
    )

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

    # Assert: conversation exchange was saved via append_messages
    mock_append_messages.assert_called_once_with(
        "user-001",
        "Hello, how can you help me?",
        "I can help you with many things!",
        correlation_id="corr-xyz-789",
    )
