"""Tests for the Orchestrator Lambda handler (REST variant — SQS-triggered).

Validates:
- SQS Records event format is parsed correctly
- NO call to get_conversation_history() before AI invocation (Req 1.1, 1.2)
- AI Caller invoked with simplified payload: {message, sessionId, correlationId} (Req 7.1)
- append_messages() called after successful response (Req 2.1)
- DynamoDB write failure does not block response delivery (Req 2.4)

Requirements: 1.1, 1.2, 2.1, 2.4, 3.4
"""

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


@patch("handler.append_messages")
@patch("handler.invoke_ai_caller")
@patch("handler.responses_table")
@patch("handler.lambda_client")
def test_no_conversation_history_retrieval_before_ai_invocation(
    mock_lambda_client: MagicMock,
    mock_responses_table: MagicMock,
    mock_invoke_ai: MagicMock,
    mock_append_messages: MagicMock,
    sqs_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """Orchestrator does NOT call get_conversation_history() before invoking AI.

    AgentCore Runtime manages session context via sessionId — no DynamoDB
    read is needed to load conversation history before AI invocation.
    (Requirements 1.1, 1.2)
    """
    mock_invoke_ai.return_value = {
        "response": "Response text",
        "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15},
        "finishReason": "end_turn",
        "sessionId": "user-001",
    }
    mock_append_messages.return_value = []

    # Verify the handler code never directly imports or calls get_conversation_history.
    # The handler module should not have any reference to get_conversation_history.
    import handler as handler_module
    from handler import handler

    assert not hasattr(handler_module, "get_conversation_history"), (
        "Handler should not import get_conversation_history — "
        "AgentCore manages session context via sessionId"
    )

    # Also confirm AI was invoked without needing prior history retrieval
    handler(sqs_event, lambda_context)
    mock_invoke_ai.assert_called_once()


@patch("handler.append_messages")
@patch("handler.invoke_ai_caller")
@patch("handler.responses_table")
@patch("handler.lambda_client")
def test_ai_caller_receives_simplified_payload(
    mock_lambda_client: MagicMock,
    mock_responses_table: MagicMock,
    mock_invoke_ai: MagicMock,
    mock_append_messages: MagicMock,
    sqs_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """AI Caller is invoked with {message, sessionId, correlationId} — no messages array.

    (Requirements 1.2, 7.1)
    """
    mock_invoke_ai.return_value = {
        "response": "OK",
        "usage": {"inputTokens": 5, "outputTokens": 2, "totalTokens": 7},
        "finishReason": "end_turn",
        "sessionId": "user-001",
    }
    mock_append_messages.return_value = []

    from handler import handler

    handler(sqs_event, lambda_context)

    # Verify the exact keyword arguments — no "messages" or "tools"
    mock_invoke_ai.assert_called_once_with(
        message="Hello, how can you help me?",
        session_id="user-001",
        correlation_id="corr-xyz-789",
    )


@patch("handler.append_messages")
@patch("handler.invoke_ai_caller")
@patch("handler.responses_table")
@patch("handler.lambda_client")
def test_append_messages_called_after_successful_response(
    mock_lambda_client: MagicMock,
    mock_responses_table: MagicMock,
    mock_invoke_ai: MagicMock,
    mock_append_messages: MagicMock,
    sqs_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """append_messages() is called with user + assistant messages after AI success.

    (Requirements 2.1, 2.3)
    """
    mock_invoke_ai.return_value = {
        "response": "The answer is 42.",
        "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15},
        "finishReason": "end_turn",
        "sessionId": "user-001",
    }
    mock_append_messages.return_value = [
        {"role": "user", "content": "Hello, how can you help me?", "timestamp": "2024-01-15T10:30:00Z"},
        {"role": "assistant", "content": "The answer is 42.", "timestamp": "2024-01-15T10:30:01Z"},
    ]

    from handler import handler

    handler(sqs_event, lambda_context)

    mock_append_messages.assert_called_once_with(
        "user-001",
        "Hello, how can you help me?",
        "The answer is 42.",
        correlation_id="corr-xyz-789",
    )


@patch("handler.append_messages")
@patch("handler.invoke_ai_caller")
@patch("handler.responses_table")
@patch("handler.lambda_client")
def test_dynamodb_write_failure_does_not_block_response(
    mock_lambda_client: MagicMock,
    mock_responses_table: MagicMock,
    mock_invoke_ai: MagicMock,
    mock_append_messages: MagicMock,
    sqs_event: dict[str, Any],
    lambda_context: MagicMock,
) -> None:
    """DynamoDB write failure for conversation history does not block response delivery.

    The handler should still return 200 and write the completed response
    to the Responses Table even if append_messages raises an exception.
    (Requirement 2.4)
    """
    mock_invoke_ai.return_value = {
        "response": "I can help you!",
        "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15},
        "finishReason": "end_turn",
        "sessionId": "user-001",
    }

    # Simulate DynamoDB write failure in append_messages
    mock_append_messages.side_effect = Exception("DynamoDB ConditionalCheckFailedException")

    from handler import handler

    result = handler(sqs_event, lambda_context)

    # Handler still returns 200 — SQS message should be deleted
    assert result == {"statusCode": 200}

    # Response was still written to the responses table despite append_messages failure
    put_calls = mock_responses_table.put_item.call_args_list
    # Should have "pending" + "completed" writes
    assert len(put_calls) >= 2
    last_put = put_calls[-1][1]["Item"]
    assert last_put["status"] == "completed"
    assert last_put["response"] == "I can help you!"
