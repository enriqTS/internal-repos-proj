"""Tests for the Responses Reader Lambda handler."""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure the responses_reader module is importable as a distinct module
_RESPONSES_READER_SRC = str(Path(__file__).resolve().parent.parent / "src" / "responses_reader")


@pytest.fixture(autouse=True)
def _isolate_responses_reader_import() -> None:
    """Ensure we import responses_reader's handler by path priority."""
    sys.path.insert(0, _RESPONSES_READER_SRC)
    sys.modules.pop("handler", None)
    yield
    sys.path.remove(_RESPONSES_READER_SRC)
    sys.modules.pop("handler", None)


@pytest.fixture
def mock_lambda_context() -> MagicMock:
    """Minimal mock Lambda context."""
    ctx = MagicMock()
    ctx.function_name = "test-responses-reader"
    ctx.memory_limit_in_mb = 128
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test-responses-reader"
    ctx.aws_request_id = "test-request-id"
    return ctx


@pytest.fixture
def sample_event() -> dict:
    """Sample API Gateway proxy event with pathParameters.messageId."""
    return {
        "httpMethod": "GET",
        "pathParameters": {"messageId": "msg-abc-123"},
        "headers": {},
        "body": None,
    }


@patch("handler.table")
def test_handler_returns_200_with_response_data(
    mock_table: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
) -> None:
    """Handler returns 200 with stored response data when item exists."""
    # Arrange: mock DynamoDB get_item returning an item
    stored_item = {
        "messageId": "msg-abc-123",
        "content": "Here is the answer to your question.",
        "role": "assistant",
        "expiresAt": 1700000000,
    }
    mock_table.get_item.return_value = {"Item": stored_item}

    # Act
    import handler

    result = handler.handler(sample_event, mock_lambda_context)

    # Assert
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["messageId"] == "msg-abc-123"
    assert body["content"] == "Here is the answer to your question."
    assert body["role"] == "assistant"
    assert body["expiresAt"] == 1700000000

    # Verify DynamoDB was called with correct key
    mock_table.get_item.assert_called_once_with(Key={"messageId": "msg-abc-123"})


@patch("handler.table")
def test_handler_returns_404_when_item_not_found(
    mock_table: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
) -> None:
    """Handler returns 404 when no item exists for the given messageId."""
    # Arrange: mock DynamoDB get_item returning no Item key
    mock_table.get_item.return_value = {}

    # Act
    import handler

    result = handler.handler(sample_event, mock_lambda_context)

    # Assert
    assert result["statusCode"] == 404
    body = json.loads(result["body"])
    assert body["error"] == "not_found"
    assert "msg-abc-123" in body["message"]
