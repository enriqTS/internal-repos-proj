"""Unit tests for ai_caller.py in the ECS WebSocket variant.

Tests verify:
- invoke_agentcore() accepts `message: str` (not a list)
- invoke_agentcore() passes message directly as inputText to invoke_agent()
- No messages array or tools parameter in the interface
"""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch):
    """Set required environment variables for ai_caller module."""
    monkeypatch.setenv("AGENT_ID", "test-agent-id")
    monkeypatch.setenv("AGENT_ALIAS_ID", "TSTALIASID")
    monkeypatch.setenv("AGENT_RUNTIME_ARN", "arn:aws:bedrock:us-east-1:123456789012:agent/test")


@pytest.fixture()
def mock_boto3_client():
    """Mock the bedrock-agent-runtime client."""
    with patch("app.ai_caller.bedrock_agent_runtime") as mock_client:
        # Simulate a successful invoke_agent response with a completion stream
        mock_client.invoke_agent.return_value = {
            "completion": [
                {
                    "chunk": {"bytes": b"Hello there!"},
                },
            ],
        }
        yield mock_client


class TestInvokeAgentcoreInterface:
    """Tests for invoke_agentcore function interface."""

    def test_accepts_message_as_string(self, mock_boto3_client):
        """invoke_agentcore accepts message as a plain string parameter."""
        from app.ai_caller import invoke_agentcore

        result = invoke_agentcore(
            session_id="user-1",
            message="Hello",
            correlation_id="corr-1",
        )

        assert result["response"] == "Hello there!"
        assert result["sessionId"] == "user-1"

    def test_passes_message_as_input_text(self, mock_boto3_client):
        """The message string is passed directly as inputText to invoke_agent."""
        from app.ai_caller import invoke_agentcore

        invoke_agentcore(
            session_id="user-1",
            message="What is the weather?",
            correlation_id="corr-1",
        )

        call_kwargs = mock_boto3_client.invoke_agent.call_args[1]
        assert call_kwargs["inputText"] == "What is the weather?"
        assert call_kwargs["sessionId"] == "user-1"
        # No messages array in the call
        assert "messages" not in call_kwargs

    def test_does_not_accept_messages_list(self, mock_boto3_client):
        """invoke_agentcore raises TypeError if called with messages=list."""
        from app.ai_caller import invoke_agentcore

        with pytest.raises(TypeError):
            invoke_agentcore(
                session_id="user-1",
                messages=[{"role": "user", "content": "Hello"}],  # type: ignore[call-arg]
                correlation_id="corr-1",
            )

    def test_does_not_accept_tools_parameter(self, mock_boto3_client):
        """invoke_agentcore raises TypeError if called with tools parameter."""
        from app.ai_caller import invoke_agentcore

        with pytest.raises(TypeError):
            invoke_agentcore(
                session_id="user-1",
                message="Hello",
                tools=[{"name": "search"}],  # type: ignore[call-arg]
                correlation_id="corr-1",
            )

    def test_session_id_passed_to_invoke_agent(self, mock_boto3_client):
        """sessionId is forwarded correctly to the boto3 invoke_agent call."""
        from app.ai_caller import invoke_agentcore

        invoke_agentcore(
            session_id="session-xyz-123",
            message="Hi",
            correlation_id="corr-1",
        )

        call_kwargs = mock_boto3_client.invoke_agent.call_args[1]
        assert call_kwargs["sessionId"] == "session-xyz-123"
