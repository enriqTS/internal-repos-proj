"""Shared test fixtures for chatbot-rag-agentcore-ws-streaming tests."""

import pytest


@pytest.fixture(autouse=True)
def _aws_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set required AWS-related environment variables for all tests."""
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("POWERTOOLS_SERVICE_NAME", "test")
    monkeypatch.setenv("POWERTOOLS_LOG_LEVEL", "DEBUG")


@pytest.fixture(autouse=True)
def _lambda_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set Lambda-specific environment variables for all tests."""
    monkeypatch.setenv("DYNAMODB_TABLE_NAME", "test-context-table")
    monkeypatch.setenv("CONNECTION_TABLE_NAME", "test-connections")
    monkeypatch.setenv("WEBSOCKET_API_ENDPOINT", "https://test.execute-api.us-east-1.amazonaws.com/dev")
    monkeypatch.setenv("AGENT_RUNTIME_ARN", "arn:aws:bedrock:us-east-1:123456789012:agent-runtime/test")
    monkeypatch.setenv("AGENT_ALIAS_ID", "TSTALIASID")
    monkeypatch.setenv("AGENT_ID", "test-agent-id")
    monkeypatch.setenv("MAX_CHUNK_SIZE", "1")
