"""Tests for the AI Caller Lambda handler (AgentCore WS Streaming variant).

Validates the simplified interface where invoke_agentcore() accepts
a message string (not a messages list) and passes inputText directly
to invoke_agent(). No tools parameter is accepted. This variant uses
stream=True for progressive streaming support.

Requirements: 7.1, 7.2, 7.3
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

# Ensure the ai_caller module is importable
_AI_CALLER_SRC = str(Path(__file__).resolve().parent.parent.parent / "src" / "ai_caller")


@pytest.fixture(autouse=True)
def _isolate_ai_caller_import() -> None:
    """Ensure we import ai_caller's handler by path priority."""
    sys.path.insert(0, _AI_CALLER_SRC)
    sys.modules.pop("handler", None)
    yield
    sys.path.remove(_AI_CALLER_SRC)
    sys.modules.pop("handler", None)


@pytest.fixture
def sample_event() -> dict:
    """Sample AI Caller event with simplified interface: message (str), sessionId, correlationId."""
    return {
        "message": "Explain the streaming architecture",
        "sessionId": "user-stream-001",
        "correlationId": "corr-stream-001",
    }


@pytest.fixture
def mock_lambda_context() -> MagicMock:
    """Minimal mock Lambda context."""
    ctx = MagicMock()
    ctx.function_name = "test-ai-caller-ws-streaming"
    ctx.memory_limit_in_mb = 256
    ctx.invoked_function_arn = (
        "arn:aws:lambda:us-east-1:123456789012:function:test-ai-caller-ws-streaming"
    )
    ctx.aws_request_id = "test-request-id"
    return ctx


@pytest.fixture
def mock_agent_response() -> dict:
    """Mock Bedrock Agent Runtime invoke_agent response with multiple chunks."""
    chunk_event_1 = {"chunk": {"bytes": b"The streaming "}}
    chunk_event_2 = {"chunk": {"bytes": b"architecture works "}}
    chunk_event_3 = {"chunk": {"bytes": b"like this."}}
    trace_event = {
        "trace": {
            "trace": {
                "orchestrationTrace": {
                    "modelInvocationOutput": {
                        "metadata": {
                            "usage": {
                                "inputTokens": 25,
                                "outputTokens": 12,
                            }
                        }
                    },
                    "observation": {
                        "finalResponse": {"text": "The streaming architecture works like this."},
                    },
                }
            }
        }
    }
    return {
        "completion": [chunk_event_1, chunk_event_2, chunk_event_3, trace_event],
        "contentType": "application/json",
        "sessionId": "user-stream-001",
    }


@patch("shared.ai_caller_agentcore.bedrock_agent_runtime")
def test_handler_passes_message_as_input_text(
    mock_bedrock_client: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
    mock_agent_response: dict,
) -> None:
    """Handler should pass message string directly as inputText to invoke_agent()."""
    mock_bedrock_client.invoke_agent.return_value = mock_agent_response

    import handler

    handler.handler(sample_event, mock_lambda_context)

    mock_bedrock_client.invoke_agent.assert_called_once()
    call_kwargs = mock_bedrock_client.invoke_agent.call_args.kwargs
    assert call_kwargs["inputText"] == "Explain the streaming architecture"
    assert call_kwargs["sessionId"] == "user-stream-001"
    assert call_kwargs["agentId"] == "test-agent-id"
    assert call_kwargs["agentAliasId"] == "TSTALIASID"


@patch("shared.ai_caller_agentcore.bedrock_agent_runtime")
def test_handler_returns_assembled_streaming_response(
    mock_bedrock_client: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
    mock_agent_response: dict,
) -> None:
    """Handler should assemble streaming chunks into a complete response."""
    mock_bedrock_client.invoke_agent.return_value = mock_agent_response

    import handler

    result = handler.handler(sample_event, mock_lambda_context)

    # Streaming handler assembles all chunks into one response
    assert result["response"] == "The streaming architecture works like this."
    assert result["usage"]["inputTokens"] == 25
    assert result["usage"]["outputTokens"] == 12
    assert result["usage"]["totalTokens"] == 37
    assert result["finishReason"] == "end_turn"
    assert result["sessionId"] == "user-stream-001"


@patch("shared.ai_caller_agentcore.bedrock_agent_runtime")
def test_handler_raises_on_client_error(
    mock_bedrock_client: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
) -> None:
    """Handler should raise RuntimeError on ClientError from AgentCore Runtime."""
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

    import handler

    with pytest.raises(RuntimeError, match="AgentCore Runtime error"):
        handler.handler(sample_event, mock_lambda_context)


@patch("shared.ai_caller_agentcore.bedrock_agent_runtime")
def test_handler_does_not_construct_messages_array(
    mock_bedrock_client: MagicMock,
    sample_event: dict,
    mock_lambda_context: MagicMock,
    mock_agent_response: dict,
) -> None:
    """Handler should not construct a messages array — inputText is the raw message string."""
    mock_bedrock_client.invoke_agent.return_value = mock_agent_response

    import handler

    handler.handler(sample_event, mock_lambda_context)

    call_kwargs = mock_bedrock_client.invoke_agent.call_args.kwargs
    assert isinstance(call_kwargs["inputText"], str)
    assert call_kwargs["inputText"] == sample_event["message"]
    assert "messages" not in call_kwargs


@patch("shared.ai_caller_agentcore.bedrock_agent_runtime")
def test_handler_extracts_token_usage_from_trace(
    mock_bedrock_client: MagicMock,
    mock_lambda_context: MagicMock,
) -> None:
    """Handler should extract token usage from trace events correctly."""
    event = {
        "message": "Test streaming",
        "sessionId": "user-789",
        "correlationId": "corr-789",
    }
    trace_event = {
        "trace": {
            "trace": {
                "orchestrationTrace": {
                    "modelInvocationOutput": {
                        "metadata": {
                            "usage": {
                                "inputTokens": 80,
                                "outputTokens": 40,
                            }
                        }
                    },
                    "observation": {
                        "finalResponse": {"text": "Result"},
                    },
                }
            }
        }
    }
    mock_bedrock_client.invoke_agent.return_value = {
        "completion": [
            {"chunk": {"bytes": b"Result"}},
            trace_event,
        ],
        "sessionId": "user-789",
    }

    import handler

    result = handler.handler(event, mock_lambda_context)

    assert result["usage"]["inputTokens"] == 80
    assert result["usage"]["outputTokens"] == 40
    assert result["usage"]["totalTokens"] == 120
