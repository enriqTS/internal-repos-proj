"""Tests for the tool_executor Lambda handler (AgentCore action group format)."""

import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

# Ensure the tool_executor module is importable by its specific path,
# since multiple Lambdas share the generic "handler" module name.
_TOOL_EXECUTOR_DIR = str(Path(__file__).resolve().parent.parent / "src" / "tool_executor")


@pytest.fixture
def lambda_context() -> MagicMock:
    """Create a minimal mock Lambda context."""
    ctx = MagicMock()
    ctx.function_name = "test-tool-executor"
    ctx.memory_limit_in_mb = 128
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test-tool-executor"
    ctx.aws_request_id = "test-request-id"
    return ctx


@pytest.fixture
def tool_executor_handler() -> ModuleType:  # type: ignore[misc]
    """Import the tool_executor handler module explicitly to avoid name collisions."""
    # Temporarily prioritize tool_executor on sys.path so `import handler` resolves correctly.
    sys.path.insert(0, _TOOL_EXECUTOR_DIR)
    try:
        # Remove cached handler module if loaded from another Lambda directory.
        sys.modules.pop("handler", None)
        import handler as tool_executor_module

        yield tool_executor_module
    finally:
        sys.path.remove(_TOOL_EXECUTOR_DIR)
        sys.modules.pop("handler", None)


@pytest.fixture
def sample_event() -> dict:
    """Sample Bedrock Agent action group event for search_knowledge_base."""
    return {
        "actionGroup": "KnowledgeBaseGroup",
        "function": "search_knowledge_base",
        "parameters": [{"name": "query", "value": "test"}],
        "sessionId": "session-123",
        "messageVersion": "1.0",
    }


def test_search_knowledge_base_returns_document_content(
    tool_executor_handler: ModuleType,
    sample_event: dict,
    lambda_context: MagicMock,
) -> None:
    """Handler returns action group response with document content from S3."""
    mock_s3 = MagicMock()
    mock_s3.list_objects_v2.return_value = {
        "Contents": [{"Key": "test/doc1.txt"}],
    }

    body_stream = MagicMock()
    body_stream.read.return_value = b"This is the document content for testing."
    mock_s3.get_object.return_value = {"Body": body_stream}

    with patch.object(tool_executor_handler, "s3_client", mock_s3):
        response = tool_executor_handler.handler(sample_event, lambda_context)

    # Assert: response is in Bedrock Agent action group format
    assert response["messageVersion"] == "1.0"
    assert response["response"]["actionGroup"] == "KnowledgeBaseGroup"
    assert response["response"]["function"] == "search_knowledge_base"
    body = response["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
    assert "This is the document content for testing." in body

    # Verify S3 interactions
    mock_s3.list_objects_v2.assert_called_once_with(
        Bucket="test-rag-bucket",
        Prefix="test",
        MaxKeys=5,
    )
    mock_s3.get_object.assert_called_once_with(
        Bucket="test-rag-bucket",
        Key="test/doc1.txt",
    )


def test_search_knowledge_base_no_results(
    tool_executor_handler: ModuleType,
    lambda_context: MagicMock,
) -> None:
    """Handler returns action group response with 'no documents found' message."""
    mock_s3 = MagicMock()
    mock_s3.list_objects_v2.return_value = {}

    event = {
        "actionGroup": "KnowledgeBaseGroup",
        "function": "search_knowledge_base",
        "parameters": [{"name": "query", "value": "nonexistent"}],
        "sessionId": "session-456",
        "messageVersion": "1.0",
    }

    with patch.object(tool_executor_handler, "s3_client", mock_s3):
        response = tool_executor_handler.handler(event, lambda_context)

    body = response["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
    assert "No documents found" in body


def test_unknown_function_returns_error(
    tool_executor_handler: ModuleType,
    lambda_context: MagicMock,
) -> None:
    """Handler returns action group error response for an unknown function name."""
    event = {
        "actionGroup": "UnknownGroup",
        "function": "nonexistent_tool",
        "parameters": [],
        "sessionId": "session-789",
        "messageVersion": "1.0",
    }

    response = tool_executor_handler.handler(event, lambda_context)

    # Should still return a valid action group response (error is in the body)
    assert response["messageVersion"] == "1.0"
    body = response["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
    assert "Error executing" in body or "Unknown function" in body
