"""Tests for the AI Caller Lambda handler (AgentCore — Bedrock Agent Runtime)."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

# Ensure the ai_caller module is importable as a distinct module
_AI_CALLER_SRC = str(Path(__file__).resolve().parent.parent / "src" / "ai_caller")


@pytest.fixture(autouse=True)
def _isolate_ai_caller_import():
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
        "userId": "user-123",
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
def mock_agent_response() -> dict:
    """Mock Bedrock Agent Runtime invoke_agent response with streaming completion."""
    # Simulate the streaming response object from invoke_agent
    chunk_bytes = "I can help you with searching our knowledge base!".encode("utf-8")

    chunk_event = {
        "chunk": {"bytes": chunk_bytes},
    }

    trace_event = {
        "trace": {
            "trace": {
                "orchestrationTrace": {
                    "modelInvocationOutput": {
                        "metadata": {
                            "usage": {
                                "inputTokens": 42,
                                "outputTokens": 15,
                            }
                        }
                    },
                    "observation": {
                        "finalResponse": {"text": "I can help you with searching our knowledge base!"},
                    },
                }
            }
        }
    }

    return {
        "completion": [chunk_event, trace_event],
        "contentType": "application/json",
        "sessionId": "user-123",
    }


@patch("handler.bedrock_agent_runtime")
def test_handler_returns_response_and_usage(
    mock_bedrock_client: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
    mock_agent_response: dict,
) -> None:
    """Handler should invoke Bedrock AgentCore Runtime and return response with usage data."""
    # Arrange: wire the mock client
    mock_bedrock_client.invoke_agent.return_value = mock_agent_response

    # Act
    import handler

    result = handler.handler(sample_event, mock_lambda_context)

    # Assert: invoke_agent was called with correct parameters
    mock_bedrock_client.invoke_agent.assert_called_once()
    call_kwargs = mock_bedrock_client.invoke_agent.call_args.kwargs
    assert call_kwargs["agentId"] == "test-agent-id"
    assert call_kwargs["agentAliasId"] == "TSTALIASID"
    assert call_kwargs["sessionId"] == "user-123"
    assert call_kwargs["inputText"] == "Hello, what can you help me with?"

    # Assert: response structure
    assert "response" in result
    assert result["response"] == "I can help you with searching our knowledge base!"

    # Assert: usage data
    assert result["usage"]["inputTokens"] == 42
    assert result["usage"]["outputTokens"] == 15
    assert result["usage"]["totalTokens"] == 57

    # Assert: finish reason
    assert result["finishReason"] == "end_turn"

    # Assert: session ID preserved
    assert result["sessionId"] == "user-123"


@patch("handler.bedrock_agent_runtime")
def test_handler_raises_on_client_error(
    mock_bedrock_client: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
) -> None:
    """Handler should raise RuntimeError when Bedrock Agent Runtime returns a ClientError."""
    # Arrange: make the client raise a ClientError
    error_response = {
        "Error": {
            "Code": "ThrottlingException",
            "Message": "Rate exceeded",
        },
    }
    mock_bedrock_client.invoke_agent.side_effect = ClientError(
        error_response,
        operation_name="InvokeAgent",
    )

    # Act & Assert
    import handler

    with pytest.raises(RuntimeError, match="AgentCore Runtime error"):
        handler.handler(sample_event, mock_lambda_context)
