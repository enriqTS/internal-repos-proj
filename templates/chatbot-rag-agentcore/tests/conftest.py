"""Shared test fixtures for all Lambda function tests."""

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
    monkeypatch.setenv("RESPONSES_TABLE_NAME", "test-responses-table")
    monkeypatch.setenv("AI_CALLER_FUNCTION_NAME", "test-ai-caller")
    monkeypatch.setenv("RAG_BUCKET_NAME", "test-rag-bucket")
    monkeypatch.setenv("MAX_CONVERSATION_HISTORY", "50")
    monkeypatch.setenv("MAX_RETRY_ATTEMPTS", "3")
    monkeypatch.setenv("MAX_TOOL_ITERATIONS", "10")
    monkeypatch.setenv("KNOWLEDGE_BASE_ID", "test-kb-id")
    monkeypatch.setenv("DATA_SOURCE_ID", "test-ds-id")
    monkeypatch.setenv("MODEL_ID", "test-model-id")
    monkeypatch.setenv("AGENT_RUNTIME_ARN", "arn:aws:bedrock:us-east-1:123456789012:agent-runtime/test-runtime")
    monkeypatch.setenv("AGENT_ALIAS_ID", "TSTALIASID")
    monkeypatch.setenv("AGENT_ID", "test-agent-id")
