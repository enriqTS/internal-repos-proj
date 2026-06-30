"""Tests for the AI Caller Lambda handler."""

import sys
from collections.abc import Generator
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure the ai_caller module is importable as a distinct module
_AI_CALLER_SRC = str(Path(__file__).resolve().parent.parent / "src" / "ai_caller")


@pytest.fixture(autouse=True)
def _isolate_ai_caller_import() -> Generator[None, None, None]:
    """Ensure we import ai_caller's handler (not orchestrator's) by path priority."""
    sys.path.insert(0, _AI_CALLER_SRC)
    # Remove cached handler module so we reimport from ai_caller path
    sys.modules.pop("handler", None)
    yield
    sys.path.remove(_AI_CALLER_SRC)
    sys.modules.pop("handler", None)


@pytest.fixture
def sample_event() -> dict:
    """Sample AI Caller event with correlationId, messages, and tools."""
    return {
        "correlationId": "msg-test-001",
        "messages": [
            {"role": "user", "content": "Hello, what can you help me with?"},
        ],
        "tools": [
            {
                "type": "function",
                "name": "search_knowledge_base",
                "description": "Search the knowledge base for relevant information.",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            },
        ],
    }


@pytest.fixture
def mock_lambda_context() -> MagicMock:
    """Minimal mock Lambda context."""
    ctx = MagicMock()
    ctx.function_name = "test-ai-caller"
    ctx.memory_limit_in_mb = 256
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test-ai-caller"
    ctx.aws_request_id = "test-request-id"
    return ctx


@pytest.fixture
def mock_openai_response() -> MagicMock:
    """Mock OpenAI responses.create return value with text-only output."""
    response = MagicMock()

    # Usage stats
    response.usage.input_tokens = 42
    response.usage.output_tokens = 15
    response.usage.total_tokens = 57

    # Status
    response.status = "completed"

    # Output: single text message
    message_item = MagicMock()
    message_item.type = "message"

    content_block = MagicMock()
    content_block.type = "text"
    content_block.text = "I can help you with searching our knowledge base!"

    message_item.content = [content_block]
    response.output = [message_item]

    return response


@patch("handler.OpenAI")
def test_handler_returns_output_and_usage(
    mock_openai_cls: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
    mock_openai_response: MagicMock,
) -> None:
    """Handler should call Mantle via OpenAI SDK and return output items with usage data."""
    # Arrange: wire the mock client
    mock_client = MagicMock()
    mock_client.responses.create.return_value = mock_openai_response
    mock_openai_cls.return_value = mock_client

    # Act
    import handler

    result = handler.handler(sample_event, mock_lambda_context)

    # Assert: OpenAI client created with correct base_url
    mock_openai_cls.assert_called_once_with(
        base_url="https://bedrock-mantle.us-east-1.api.aws/v1",
        api_key="bedrock",
    )

    # Assert: responses.create called with event data
    mock_client.responses.create.assert_called_once()
    call_kwargs = mock_client.responses.create.call_args.kwargs
    assert call_kwargs["model"] == "test-model-id"
    assert call_kwargs["input"] == sample_event["messages"]
    assert call_kwargs["tools"] == sample_event["tools"]
    assert call_kwargs["stream"] is False

    # Assert: response structure
    assert "output" in result
    assert "usage" in result
    assert len(result["output"]) == 1
    assert result["output"][0]["type"] == "message"
    assert result["output"][0]["content"][0]["text"] == "I can help you with searching our knowledge base!"

    # Assert: usage data
    assert result["usage"]["inputTokens"] == 42
    assert result["usage"]["outputTokens"] == 15
    assert result["usage"]["totalTokens"] == 57
    assert result["status"] == "completed"


@patch("handler.OpenAI")
def test_handler_raises_on_api_error(
    mock_openai_cls: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
) -> None:
    """Handler should raise RuntimeError when the Mantle API returns an error."""
    from openai import OpenAIError

    # Arrange: make the client raise an OpenAIError
    mock_client = MagicMock()
    mock_client.responses.create.side_effect = OpenAIError("Service unavailable")
    mock_openai_cls.return_value = mock_client

    # Act & Assert
    import handler

    with pytest.raises(RuntimeError, match="Mantle API error"):
        handler.handler(sample_event, mock_lambda_context)
