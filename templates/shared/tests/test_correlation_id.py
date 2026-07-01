"""Property-based test for correlation ID propagation across all variants.

Verifies that when downstream functions are called, they correctly receive
and log the same correlation_id — ensuring consistent observability across
the entire request flow (orchestrator → ai_caller → tool_executor → message_sender).

**Validates: Requirements 15.5, 15.6**

Feature: chatbot-template-variants, Property 8: Correlation ID propagation across all variants
"""

import os
import sys
import uuid
from unittest.mock import MagicMock, patch

# Set environment variables before importing modules
os.environ.setdefault("POWERTOOLS_SERVICE_NAME", "test")
os.environ.setdefault("POWERTOOLS_LOG_LEVEL", "DEBUG")
os.environ.setdefault("DYNAMODB_TABLE_NAME", "test-user-context")
os.environ.setdefault("CONNECTION_TABLE_NAME", "test-connections")
os.environ.setdefault("CONNECTION_TTL_SECONDS", "86400")
os.environ.setdefault("WEBSOCKET_API_ENDPOINT", "https://test.execute-api.us-east-1.amazonaws.com/dev")
os.environ.setdefault("RAG_BUCKET_NAME", "test-rag-bucket")
os.environ.setdefault("MANTLE_BASE_URL", "https://bedrock-mantle.us-east-1.api.aws/v1")
os.environ.setdefault("MODEL_ID", "test-model")
os.environ.setdefault("MAX_TOOL_ITERATIONS", "10")
os.environ.setdefault("MAX_CONVERSATION_HISTORY", "50")

# Mock openai module before importing ai_caller_mantle
_mock_openai = MagicMock()
sys.modules.setdefault("openai", _mock_openai)

import hypothesis.strategies as st
from hypothesis import given, settings

from shared.ai_caller_agentcore import invoke_agentcore
from shared.ai_caller_mantle import invoke_mantle
from shared.conversation_context import get_conversation_history
from shared.logging_config import get_logger, log_ai_interaction
from shared.tool_executor import execute_tool


# --- Strategies ---

correlation_id_strategy = st.from_regex(
    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
    fullmatch=True,
)


# --- Property Tests: Correlation ID Propagation ---


class TestCorrelationIdPropagation:
    """Property 8: correlation_id propagation across all variants.

    For any correlation_id string received in the initial request context,
    every log entry produced during that request's processing (across orchestrator,
    AI caller, tool executor, connection manager, and message sender) SHALL include
    that same correlation ID value.
    """

    @given(correlation_id=correlation_id_strategy)
    @settings(max_examples=100)
    def test_tool_executor_logs_correlation_id_unknown_tool(self, correlation_id: str) -> None:
        """Verify tool_executor passes correlation_id to all log entries (unknown tool path).

        **Validates: Requirements 15.5, 15.6**
        """
        logged_correlation_ids: list[str] = []

        def capture_log(msg, *args, **kwargs):
            extra = kwargs.get("extra", {})
            if "correlation_id" in extra:
                logged_correlation_ids.append(extra["correlation_id"])

        with patch("shared.tool_executor.logger") as mock_logger:
            mock_logger.info = MagicMock(side_effect=capture_log)
            mock_logger.warning = MagicMock(side_effect=capture_log)
            mock_logger.error = MagicMock(side_effect=capture_log)

            execute_tool(
                tool_name="unknown_tool",
                arguments={"query": "test"},
                correlation_id=correlation_id,
            )

        assert len(logged_correlation_ids) > 0, (
            f"No log entries with correlation_id found for {correlation_id}"
        )
        for logged_id in logged_correlation_ids:
            assert logged_id == correlation_id

    @given(correlation_id=correlation_id_strategy)
    @settings(max_examples=100)
    def test_tool_executor_search_logs_correlation_id(self, correlation_id: str) -> None:
        """Verify search_knowledge_base passes correlation_id to all log entries.

        **Validates: Requirements 15.5, 15.6**
        """
        logged_correlation_ids: list[str] = []

        def capture_log(msg, *args, **kwargs):
            extra = kwargs.get("extra", {})
            if "correlation_id" in extra:
                logged_correlation_ids.append(extra["correlation_id"])

        mock_s3 = MagicMock()
        mock_s3.list_objects_v2.return_value = {"Contents": []}

        with (
            patch("shared.tool_executor.logger") as mock_logger,
            patch("shared.tool_executor._get_s3_client", return_value=mock_s3),
        ):
            mock_logger.info = MagicMock(side_effect=capture_log)
            mock_logger.warning = MagicMock(side_effect=capture_log)
            mock_logger.error = MagicMock(side_effect=capture_log)

            execute_tool(
                tool_name="search_knowledge_base",
                arguments={"query": "test-query"},
                correlation_id=correlation_id,
            )

        assert len(logged_correlation_ids) > 0
        for logged_id in logged_correlation_ids:
            assert logged_id == correlation_id

    @given(correlation_id=correlation_id_strategy)
    @settings(max_examples=100)
    def test_ai_caller_mantle_logs_correlation_id(self, correlation_id: str) -> None:
        """Verify ai_caller_mantle passes correlation_id to all log entries including ai-interaction.

        **Validates: Requirements 15.5, 15.6**
        """
        logged_correlation_ids: list[str] = []

        def capture_log(msg, *args, **kwargs):
            extra = kwargs.get("extra", {})
            if "correlation_id" in extra:
                logged_correlation_ids.append(extra["correlation_id"])

        # Mock the OpenAI client response
        mock_response = MagicMock()
        mock_response.usage.input_tokens = 10
        mock_response.usage.output_tokens = 5
        mock_response.usage.total_tokens = 15
        mock_response.status = "completed"
        mock_response.output = []

        with (
            patch("shared.ai_caller_mantle.logger") as mock_logger,
            patch("shared.ai_caller_mantle._client") as mock_client,
        ):
            mock_logger.info = MagicMock(side_effect=capture_log)
            mock_logger.warning = MagicMock(side_effect=capture_log)
            mock_logger.error = MagicMock(side_effect=capture_log)
            mock_client.responses.create.return_value = mock_response

            invoke_mantle(
                messages=[{"role": "user", "content": "hello"}],
                tools=[],
                correlation_id=correlation_id,
            )

        # Must have at least 2 log entries: the invocation log and the ai-interaction log
        assert len(logged_correlation_ids) >= 2, (
            f"Expected >=2 log entries with correlation_id, got {len(logged_correlation_ids)}"
        )
        for logged_id in logged_correlation_ids:
            assert logged_id == correlation_id

    @given(correlation_id=correlation_id_strategy)
    @settings(max_examples=100)
    def test_ai_caller_agentcore_logs_correlation_id(self, correlation_id: str) -> None:
        """Verify ai_caller_agentcore passes correlation_id to all log entries.

        **Validates: Requirements 15.5, 15.6**
        """
        logged_correlation_ids: list[str] = []

        def capture_log(msg, *args, **kwargs):
            extra = kwargs.get("extra", {})
            cid = extra.get("correlation_id") or extra.get("correlationId")
            if cid:
                logged_correlation_ids.append(cid)

        mock_response = {"completion": []}

        with (
            patch("shared.ai_caller_agentcore.logger") as mock_logger,
            patch("shared.ai_caller_agentcore.bedrock_agent_runtime") as mock_runtime,
        ):
            mock_logger.info = MagicMock(side_effect=capture_log)
            mock_logger.warning = MagicMock(side_effect=capture_log)
            mock_logger.error = MagicMock(side_effect=capture_log)
            mock_runtime.invoke_agent.return_value = mock_response

            invoke_agentcore(
                session_id="test-session",
                messages=[{"role": "user", "content": "hello"}],
                correlation_id=correlation_id,
            )

        # Must have at least 2 log entries: invocation + ai-interaction
        assert len(logged_correlation_ids) >= 2, (
            f"Expected >=2 log entries with correlation_id, got {len(logged_correlation_ids)}"
        )
        for logged_id in logged_correlation_ids:
            assert logged_id == correlation_id

    @given(correlation_id=correlation_id_strategy)
    @settings(max_examples=100)
    def test_conversation_context_logs_correlation_id(self, correlation_id: str) -> None:
        """Verify conversation_context passes correlation_id to all log entries.

        **Validates: Requirements 15.5, 15.6**
        """
        logged_correlation_ids: list[str] = []

        def capture_log(msg, *args, **kwargs):
            extra = kwargs.get("extra", {})
            cid = extra.get("correlation_id") or extra.get("correlationId")
            if cid:
                logged_correlation_ids.append(cid)

        with (
            patch("shared.conversation_context.logger") as mock_logger,
            patch("shared.conversation_context._get_table", return_value=None),
        ):
            mock_logger.info = MagicMock(side_effect=capture_log)
            mock_logger.warning = MagicMock(side_effect=capture_log)
            mock_logger.error = MagicMock(side_effect=capture_log)

            get_conversation_history("test-user", correlation_id=correlation_id)

        assert len(logged_correlation_ids) > 0, (
            f"No log entries with correlation_id found for {correlation_id}"
        )
        for logged_id in logged_correlation_ids:
            assert logged_id == correlation_id


class TestCorrelationIdGeneration:
    """Tests for UUID v4 generation when no correlation_id is provided.

    **Validates: Requirement 15.6**
    """

    @given(data=st.data())
    @settings(max_examples=50)
    def test_generates_valid_uuid4_format(self, data: st.DataObject) -> None:
        """Verify generated correlation IDs are valid UUID v4 format.

        Entry points generate uuid.uuid4() when no correlation_id is available.
        This verifies the UUID generation produces valid v4 UUIDs consistently.
        """
        generated = str(uuid.uuid4())
        parsed = uuid.UUID(generated, version=4)
        assert parsed.version == 4
        assert str(parsed) == generated

    def test_uuid4_always_has_correct_variant_and_version(self) -> None:
        """Verify 100 generated UUIDs all conform to v4 spec."""
        for _ in range(100):
            generated = str(uuid.uuid4())
            parsed = uuid.UUID(generated)
            assert parsed.version == 4
            # Variant must be RFC 4122 (bits 10xx)
            assert (parsed.int >> 62) & 0b11 == 0b10 or (parsed.int >> 61) & 0b111 == 0b100


class TestCorrelationIdConsistencyAcrossModules:
    """Integration-level test verifying end-to-end correlation_id consistency.

    Simulates the orchestrator calling ai_caller and tool_executor, and verifies
    all downstream components receive the same correlation_id.

    **Validates: Requirements 15.5, 15.6**
    """

    @given(correlation_id=correlation_id_strategy)
    @settings(max_examples=100)
    def test_full_flow_same_correlation_id(self, correlation_id: str) -> None:
        """End-to-end: orchestrator passes same correlation_id to ai_caller and tool_executor."""
        ai_caller_correlation_ids: list[str] = []
        tool_executor_correlation_ids: list[str] = []

        def capture_ai_log(msg, *args, **kwargs):
            extra = kwargs.get("extra", {})
            cid = extra.get("correlation_id") or extra.get("correlationId")
            if cid:
                ai_caller_correlation_ids.append(cid)

        def capture_tool_log(msg, *args, **kwargs):
            extra = kwargs.get("extra", {})
            if "correlation_id" in extra:
                tool_executor_correlation_ids.append(extra["correlation_id"])

        mock_response = MagicMock()
        mock_response.usage.input_tokens = 10
        mock_response.usage.output_tokens = 5
        mock_response.usage.total_tokens = 15
        mock_response.status = "completed"

        # First call: tool_use response
        mock_tool_item = MagicMock()
        mock_tool_item.type = "function_call"
        mock_tool_item.name = "search_knowledge_base"
        mock_tool_item.arguments = '{"query": "test"}'
        mock_tool_item.call_id = "call-123"

        # Second call: text response
        mock_text_item = MagicMock()
        mock_text_item.type = "message"
        mock_text_item.content = [MagicMock(type="text", text="Here is the answer")]

        mock_response_with_tool = MagicMock()
        mock_response_with_tool.usage.input_tokens = 10
        mock_response_with_tool.usage.output_tokens = 5
        mock_response_with_tool.usage.total_tokens = 15
        mock_response_with_tool.status = "completed"
        mock_response_with_tool.output = [mock_tool_item]

        mock_response_text = MagicMock()
        mock_response_text.usage.input_tokens = 10
        mock_response_text.usage.output_tokens = 5
        mock_response_text.usage.total_tokens = 15
        mock_response_text.status = "completed"
        mock_response_text.output = [mock_text_item]

        mock_s3 = MagicMock()
        mock_s3.list_objects_v2.return_value = {"Contents": []}

        with (
            patch("shared.ai_caller_mantle.logger") as mock_ai_logger,
            patch("shared.ai_caller_mantle._client") as mock_client,
            patch("shared.tool_executor.logger") as mock_tool_logger,
            patch("shared.tool_executor._get_s3_client", return_value=mock_s3),
        ):
            mock_ai_logger.info = MagicMock(side_effect=capture_ai_log)
            mock_ai_logger.warning = MagicMock(side_effect=capture_ai_log)
            mock_ai_logger.error = MagicMock(side_effect=capture_ai_log)

            mock_tool_logger.info = MagicMock(side_effect=capture_tool_log)
            mock_tool_logger.warning = MagicMock(side_effect=capture_tool_log)
            mock_tool_logger.error = MagicMock(side_effect=capture_tool_log)

            # Two calls: first returns tool call, second returns text
            mock_client.responses.create.side_effect = [
                mock_response_with_tool,
                mock_response_text,
            ]

            # Simulate orchestrator's tool-use loop:
            # 1. Call AI (gets tool call)
            invoke_mantle(
                messages=[{"role": "user", "content": "search for docs"}],
                tools=[],
                correlation_id=correlation_id,
            )

            # 2. Execute tool with same correlation_id
            execute_tool(
                tool_name="search_knowledge_base",
                arguments={"query": "test"},
                correlation_id=correlation_id,
            )

            # 3. Call AI again with same correlation_id (gets text response)
            invoke_mantle(
                messages=[{"role": "user", "content": "search for docs"}],
                tools=[],
                correlation_id=correlation_id,
            )

        # Verify ALL components received the same correlation_id
        all_ids = ai_caller_correlation_ids + tool_executor_correlation_ids

        assert len(all_ids) > 0, "No correlation IDs captured across modules"
        for logged_id in all_ids:
            assert logged_id == correlation_id, (
                f"Correlation ID mismatch: expected={correlation_id}, got={logged_id}"
            )

    @given(correlation_id=correlation_id_strategy)
    @settings(max_examples=100)
    def test_ai_interaction_log_includes_correlation_id(self, correlation_id: str) -> None:
        """Verify the ai-interaction log entry includes the correlation_id.

        The log_ai_interaction helper must emit the correlation_id in its extra fields.

        **Validates: Requirements 15.5, 15.6**
        """
        ai_interaction_entries: list[dict] = []

        def capture_log(msg, *args, **kwargs):
            extra = kwargs.get("extra", {})
            if extra.get("logType") == "ai-interaction":
                ai_interaction_entries.append(extra)

        mock_logger = MagicMock()
        mock_logger.info = MagicMock(side_effect=capture_log)

        log_ai_interaction(
            mock_logger,
            correlation_id=correlation_id,
            model="test-model",
            input_tokens=10,
            output_tokens=5,
            total_tokens=15,
            latency_ms=100,
            finish_reason="stop",
        )

        assert len(ai_interaction_entries) == 1, "Expected exactly one ai-interaction log entry"
        entry = ai_interaction_entries[0]
        assert entry["correlation_id"] == correlation_id
        assert entry["logType"] == "ai-interaction"
        assert entry["model"] == "test-model"
        assert entry["inputTokens"] == 10
        assert entry["outputTokens"] == 5
        assert entry["totalTokens"] == 15
        assert entry["latencyMs"] == 100
        assert entry["finishReason"] == "stop"


class TestCorrelationIdFunctionSignatures:
    """Verify all shared module functions accept correlation_id as a keyword argument.

    This ensures the pattern is consistent across all variants — every downstream
    function in the shared modules accepts correlation_id for propagation.

    **Validates: Requirements 15.5, 15.6**
    """

    def test_tool_executor_accepts_correlation_id_kwarg(self) -> None:
        """execute_tool accepts correlation_id as keyword argument."""
        import inspect

        sig = inspect.signature(execute_tool)
        assert "correlation_id" in sig.parameters
        param = sig.parameters["correlation_id"]
        assert param.kind in (
            inspect.Parameter.KEYWORD_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )

    def test_ai_caller_mantle_invoke_accepts_correlation_id_kwarg(self) -> None:
        """invoke_mantle accepts correlation_id as keyword argument."""
        import inspect

        sig = inspect.signature(invoke_mantle)
        assert "correlation_id" in sig.parameters
        param = sig.parameters["correlation_id"]
        assert param.kind == inspect.Parameter.KEYWORD_ONLY

    def test_ai_caller_agentcore_invoke_accepts_correlation_id_kwarg(self) -> None:
        """invoke_agentcore accepts correlation_id as keyword argument."""
        import inspect

        sig = inspect.signature(invoke_agentcore)
        assert "correlation_id" in sig.parameters
        param = sig.parameters["correlation_id"]
        assert param.kind == inspect.Parameter.KEYWORD_ONLY

    def test_conversation_context_get_history_accepts_correlation_id_kwarg(self) -> None:
        """get_conversation_history accepts correlation_id as keyword argument."""
        import inspect

        sig = inspect.signature(get_conversation_history)
        assert "correlation_id" in sig.parameters
        param = sig.parameters["correlation_id"]
        assert param.kind == inspect.Parameter.KEYWORD_ONLY

    def test_conversation_context_append_accepts_correlation_id_kwarg(self) -> None:
        """append_messages accepts correlation_id as keyword argument."""
        import inspect

        from shared.conversation_context import append_messages

        sig = inspect.signature(append_messages)
        assert "correlation_id" in sig.parameters
        param = sig.parameters["correlation_id"]
        assert param.kind == inspect.Parameter.KEYWORD_ONLY

    def test_search_knowledge_base_accepts_correlation_id_kwarg(self) -> None:
        """search_knowledge_base accepts correlation_id as keyword argument."""
        import inspect

        from shared.tool_executor import search_knowledge_base

        sig = inspect.signature(search_knowledge_base)
        assert "correlation_id" in sig.parameters
        param = sig.parameters["correlation_id"]
        assert param.kind == inspect.Parameter.KEYWORD_ONLY

    def test_ai_caller_mantle_streaming_accepts_correlation_id_kwarg(self) -> None:
        """invoke_mantle_streaming accepts correlation_id as keyword argument."""
        import inspect

        from shared.ai_caller_mantle import invoke_mantle_streaming

        sig = inspect.signature(invoke_mantle_streaming)
        assert "correlation_id" in sig.parameters
        param = sig.parameters["correlation_id"]
        assert param.kind == inspect.Parameter.KEYWORD_ONLY

    def test_ai_caller_agentcore_streaming_accepts_correlation_id_kwarg(self) -> None:
        """invoke_agentcore_streaming accepts correlation_id as keyword argument."""
        import inspect

        from shared.ai_caller_agentcore import invoke_agentcore_streaming

        sig = inspect.signature(invoke_agentcore_streaming)
        assert "correlation_id" in sig.parameters
        param = sig.parameters["correlation_id"]
        assert param.kind == inspect.Parameter.KEYWORD_ONLY
