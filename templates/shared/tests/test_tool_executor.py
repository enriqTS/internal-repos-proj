"""Unit tests for the shared tool executor module."""

from unittest.mock import MagicMock, patch

from shared.tool_executor import execute_tool, register_tool, search_knowledge_base


class TestExecuteTool:
    """Tests for execute_tool dispatch logic."""

    @patch("shared.tool_executor.search_knowledge_base")
    def test_dispatches_search_knowledge_base(self, mock_search: MagicMock) -> None:
        mock_search.return_value = {
            "query": "test",
            "documents": [{"key": "doc.txt", "content": "hello"}],
            "totalFound": 1,
        }
        result = execute_tool(
            "search_knowledge_base",
            {"query": "test"},
            correlation_id="req-001",
        )
        assert result["toolName"] == "search_knowledge_base"
        assert result["status"] == "success"
        assert result["result"]["totalFound"] == 1
        mock_search.assert_called_once_with(query="test", correlation_id="req-001")

    def test_unknown_tool_returns_error(self) -> None:
        result = execute_tool("nonexistent_tool", {}, correlation_id="req-002")
        assert result["toolName"] == "nonexistent_tool"
        assert result["status"] == "error"
        assert "Unknown tool" in result["error"]

    @patch("shared.tool_executor.search_knowledge_base")
    def test_exception_during_execution_returns_error(self, mock_search: MagicMock) -> None:
        mock_search.side_effect = RuntimeError("S3 is down")
        result = execute_tool(
            "search_knowledge_base",
            {"query": "fail"},
            correlation_id="req-003",
        )
        assert result["status"] == "error"
        assert "RuntimeError" in result["error"]

    def test_dispatches_registered_tool(self) -> None:
        def custom_tool(arguments: dict, *, correlation_id: str = "") -> dict:
            return {"echo": arguments.get("input")}

        register_tool("custom_echo", custom_tool)
        result = execute_tool("custom_echo", {"input": "hi"}, correlation_id="req-004")
        assert result["status"] == "success"
        assert result["result"]["echo"] == "hi"

    @patch("shared.tool_executor.search_knowledge_base")
    def test_missing_query_argument_passes_empty_string(self, mock_search: MagicMock) -> None:
        mock_search.return_value = {"query": "", "documents": [], "totalFound": 0}
        result = execute_tool("search_knowledge_base", {}, correlation_id="req-005")
        assert result["status"] == "success"
        mock_search.assert_called_once_with(query="", correlation_id="req-005")


class TestSearchKnowledgeBase:
    """Tests for search_knowledge_base S3 logic."""

    @patch("shared.tool_executor.RAG_BUCKET_NAME", "")
    def test_empty_bucket_name_returns_no_documents(self) -> None:
        result = search_knowledge_base("query", correlation_id="req-010")
        assert result["documents"] == []
        assert result["totalFound"] == 0

    @patch("shared.tool_executor.RAG_BUCKET_NAME", "my-rag-bucket")
    def test_empty_query_returns_no_documents(self) -> None:
        result = search_knowledge_base("", correlation_id="req-011")
        assert result["documents"] == []
        assert result["totalFound"] == 0

    @patch("shared.tool_executor.RAG_BUCKET_NAME", "my-rag-bucket")
    @patch("shared.tool_executor._get_s3_client")
    def test_successful_search_returns_documents(self, mock_get_client: MagicMock) -> None:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_objects_v2.return_value = {
            "Contents": [{"Key": "docs/intro.txt"}],
        }
        mock_body = MagicMock()
        mock_body.read.return_value = b"Introduction content"
        mock_s3.get_object.return_value = {"Body": mock_body}

        result = search_knowledge_base("docs/", correlation_id="req-012")

        assert result["query"] == "docs/"
        assert result["totalFound"] == 1
        assert result["documents"][0]["key"] == "docs/intro.txt"
        assert result["documents"][0]["content"] == "Introduction content"
        mock_s3.list_objects_v2.assert_called_once_with(
            Bucket="my-rag-bucket", Prefix="docs/", MaxKeys=10
        )

    @patch("shared.tool_executor.RAG_BUCKET_NAME", "my-rag-bucket")
    @patch("shared.tool_executor._get_s3_client")
    def test_list_returns_no_contents(self, mock_get_client: MagicMock) -> None:
        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_objects_v2.return_value = {}
        result = search_knowledge_base("empty/", correlation_id="req-013")
        assert result["documents"] == []
        assert result["totalFound"] == 0

    @patch("shared.tool_executor.RAG_BUCKET_NAME", "my-rag-bucket")
    @patch("shared.tool_executor._get_s3_client")
    def test_get_object_failure_skips_document(self, mock_get_client: MagicMock) -> None:
        from botocore.exceptions import ClientError

        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        mock_s3.list_objects_v2.return_value = {
            "Contents": [{"Key": "docs/secret.txt"}, {"Key": "docs/ok.txt"}],
        }

        error_response = {"Error": {"Code": "AccessDenied", "Message": "Forbidden"}}
        mock_body = MagicMock()
        mock_body.read.return_value = b"OK content"

        mock_s3.get_object.side_effect = [
            ClientError(error_response, "GetObject"),
            {"Body": mock_body},
        ]

        result = search_knowledge_base("docs/", correlation_id="req-014")
        assert result["totalFound"] == 1
        assert result["documents"][0]["key"] == "docs/ok.txt"

    @patch("shared.tool_executor.RAG_BUCKET_NAME", "my-rag-bucket")
    @patch("shared.tool_executor._get_s3_client")
    def test_list_operation_failure_raises_runtime_error(self, mock_get_client: MagicMock) -> None:
        from botocore.exceptions import ClientError

        import pytest

        mock_s3 = MagicMock()
        mock_get_client.return_value = mock_s3
        error_response = {"Error": {"Code": "NoSuchBucket", "Message": "Bucket not found"}}
        mock_s3.list_objects_v2.side_effect = ClientError(error_response, "ListObjectsV2")

        with pytest.raises(RuntimeError, match="Knowledge base search failed"):
            search_knowledge_base("prefix/", correlation_id="req-015")
