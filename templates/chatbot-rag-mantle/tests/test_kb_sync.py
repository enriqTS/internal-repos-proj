"""Tests for the KB Sync Lambda handler."""

import sys
from collections.abc import Generator
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

# Ensure the kb_sync module is importable
_KB_SYNC_SRC = str(Path(__file__).resolve().parent.parent / "src" / "kb_sync")


@pytest.fixture(autouse=True)
def _isolate_kb_sync_import() -> Generator[None, None, None]:
    """Ensure we import kb_sync's handler cleanly on each test."""
    sys.path.insert(0, _KB_SYNC_SRC)
    sys.modules.pop("handler", None)
    yield
    sys.path.remove(_KB_SYNC_SRC)
    sys.modules.pop("handler", None)


@pytest.fixture
def sample_s3_event() -> dict:
    """Sample S3 event notification payload."""
    return {
        "Records": [
            {
                "eventVersion": "2.1",
                "eventSource": "aws:s3",
                "eventName": "ObjectCreated:Put",
                "s3": {
                    "bucket": {"name": "test-rag-bucket"},
                    "object": {"key": "documents/report.pdf", "size": 1024},
                },
            },
        ],
    }


@pytest.fixture
def mock_lambda_context() -> MagicMock:
    """Minimal mock Lambda context."""
    ctx = MagicMock()
    ctx.function_name = "test-kb-sync"
    ctx.memory_limit_in_mb = 128
    ctx.invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test-kb-sync"
    ctx.aws_request_id = "test-request-id"
    return ctx


@patch("handler.bedrock_client")
def test_handler_starts_ingestion_job_successfully(
    mock_bedrock: MagicMock,
    sample_s3_event: dict,
    mock_lambda_context: MagicMock,
) -> None:
    """Handler should call start_ingestion_job and return success with ingestionJobId."""
    # Arrange
    mock_bedrock.start_ingestion_job.return_value = {
        "ingestionJob": {
            "ingestionJobId": "job-abc-123",
            "knowledgeBaseId": "test-kb-id",
            "dataSourceId": "test-ds-id",
            "status": "STARTING",
        },
    }

    # Act
    import handler

    result = handler.handler(sample_s3_event, mock_lambda_context)

    # Assert: start_ingestion_job called with env var values
    mock_bedrock.start_ingestion_job.assert_called_once_with(
        knowledgeBaseId="test-kb-id",
        dataSourceId="test-ds-id",
    )

    # Assert: response structure
    assert result["success"] is True
    assert result["ingestionJobId"] == "job-abc-123"


@patch("handler.bedrock_client")
def test_handler_returns_skipped_on_conflict_exception(
    mock_bedrock: MagicMock,
    sample_s3_event: dict,
    mock_lambda_context: MagicMock,
) -> None:
    """Handler should return success with skipped=True when an ingestion job is already running."""
    # Arrange: simulate ConflictException
    error_response = {
        "Error": {
            "Code": "ConflictException",
            "Message": "An ingestion job is already in progress.",
        },
    }
    mock_bedrock.start_ingestion_job.side_effect = ClientError(
        error_response,
        operation_name="StartIngestionJob",
    )

    # Act
    import handler

    result = handler.handler(sample_s3_event, mock_lambda_context)

    # Assert: graceful handling — no exception raised
    assert result["success"] is True
    assert result["skipped"] is True
    assert result["reason"] == "concurrent_job"
