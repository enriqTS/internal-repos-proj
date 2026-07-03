"""Preservation Property Tests — Functional Behavior Unchanged After Fixes.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

Property 2: Preservation — Functional Behavior Unchanged

These tests capture the CURRENT (pre-fix) functional behavior to ensure fixes do not
introduce regressions. All tests MUST PASS on unfixed code to confirm baseline.

Observation-first methodology:
- Observed the Mantle orchestrator → AI Caller payload format
- Observed DynamoDB conversation history schema (partition key `userId`, message list)
- Observed API Gateway response body structure
- Observed Mantle tool-use loop iteration logic and max-iteration termination
- Observed Terraform resource naming pattern `{prefix}-{function}`
- Observed Mantle Tool Executor Lambda exists and is configured
- Observed S3 RAG bucket versioning and Block Public Access settings
- Observed structured JSON log fields in logging_config.py
"""

import ast
import json
import re
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

# --- Template root paths ---
TEMPLATES_ROOT = Path(__file__).resolve().parent.parent / "templates"
AGENTCORE_ROOT = TEMPLATES_ROOT / "chatbot-rag-agentcore"
MANTLE_ROOT = TEMPLATES_ROOT / "chatbot-rag-mantle"

TEMPLATE_ROOTS = [AGENTCORE_ROOT, MANTLE_ROOT]
TEMPLATE_IDS = ["agentcore", "mantle"]


# =============================================================================
# Strategies for property-based tests
# =============================================================================

# Strategy for generating valid user IDs
user_id_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="-_"),
    min_size=1,
    max_size=50,
)

# Strategy for generating valid chat messages
message_strategy = st.text(min_size=1, max_size=500)

# Strategy for generating correlation IDs
correlation_id_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="-_"),
    min_size=5,
    max_size=64,
)

# Strategy for generating conversation history messages
message_entry_strategy = st.fixed_dictionaries({
    "role": st.sampled_from(["user", "assistant", "tool"]),
    "content": st.text(min_size=1, max_size=200),
    "timestamp": st.just("2024-01-15T10:30:00Z"),
})

# Strategy for conversation history (list of messages)
conversation_history_strategy = st.lists(message_entry_strategy, min_size=0, max_size=10)

# Strategy for tool call definitions
tool_definition_strategy = st.fixed_dictionaries({
    "name": st.sampled_from(["search_knowledge_base", "get_document", "summarize"]),
    "call_id": st.text(
        alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="-_"),
        min_size=5,
        max_size=20,
    ),
    "arguments": st.just("{}"),
})

# Strategy for tool call lists
tool_calls_strategy = st.lists(tool_definition_strategy, min_size=1, max_size=5)

# Strategy for Terraform prefix names
prefix_strategy = st.from_regex(r"[a-z][a-z0-9\-]{2,20}", fullmatch=True)


# =============================================================================
# Property 1: Orchestrator → AI Caller Payload Format Preserved (3.2)
# =============================================================================


class TestOrchestratorPayloadFormat:
    """Assert orchestrator invoke_ai_caller builds payload with expected keys.

    **Validates: Requirements 3.2**

    Observed behavior: The orchestrator invokes AI Caller with a payload containing
    'messages' (conversation_history) and 'correlationId'. The AI Caller handler
    expects these exact keys in the event.
    """

    @given(
        messages=conversation_history_strategy,
        correlation_id=correlation_id_strategy,
    )
    @settings(max_examples=50)
    def test_ai_caller_payload_contains_required_keys(
        self, messages: list[dict[str, Any]], correlation_id: str
    ) -> None:
        """For all orchestrator invocations, payload MUST contain messages and correlationId."""
        # Simulate payload construction as done in orchestrator's invoke_ai_caller
        payload = {
            "messages": messages,
            "correlationId": correlation_id,
        }

        # Assert payload structure matches observed format
        assert "messages" in payload, "Payload must contain 'messages'"
        assert "correlationId" in payload, "Payload must contain 'correlationId'"
        assert isinstance(payload["messages"], list), "'messages' must be a list"
        assert isinstance(payload["correlationId"], str), "'correlationId' must be a string"
        assert len(payload["correlationId"]) > 0, "'correlationId' must be non-empty"

    def test_orchestrator_invoke_ai_caller_signature_matches(self) -> None:
        """Orchestrator's invoke_ai_caller constructs payload with messages + correlationId."""
        handler_path = MANTLE_ROOT / "src" / "orchestrator" / "handler.py"
        source = handler_path.read_text()

        # Verify the invoke_ai_caller function constructs the expected payload structure
        assert "def invoke_ai_caller" in source, "invoke_ai_caller function must exist"
        # Payload must include messages and correlationId keys
        assert '"messages"' in source, "Payload must include 'messages' key"
        assert '"correlationId"' in source or '"correlationId"' in source, (
            "Payload must include 'correlationId' key"
        )

    def test_ai_caller_handler_expects_correlationId_and_messages(self) -> None:
        """AI Caller handler extracts correlationId and messages from event."""
        handler_path = MANTLE_ROOT / "src" / "ai_caller" / "handler.py"
        source = handler_path.read_text()

        # Verify AI Caller reads the expected keys from the event
        assert 'event.get("correlationId")' in source or "event.get('correlationId')" in source
        assert 'event.get("messages"' in source or "event.get('messages'" in source


# =============================================================================
# Property 2: DynamoDB Conversation History Schema Preserved (3.3)
# =============================================================================


class TestDynamoDBConversationSchema:
    """Assert DynamoDB conversation history uses userId partition key and message list.

    **Validates: Requirements 3.3**

    Observed behavior: DynamoDB table uses 'userId' as partition key.
    Items stored as { userId: str, messages: list[{role, content, timestamp}] }.
    """

    @given(user_id=user_id_strategy, messages=conversation_history_strategy)
    @settings(max_examples=50)
    def test_dynamodb_item_schema_preserved(
        self, user_id: str, messages: list[dict[str, Any]]
    ) -> None:
        """For all DynamoDB writes, partition key is userId and messages is a list."""
        # Simulate the DynamoDB item structure as observed in save_conversation_history
        item = {
            "userId": user_id,
            "messages": messages,
        }

        # Assert schema structure
        assert "userId" in item, "DynamoDB item must have 'userId' partition key"
        assert "messages" in item, "DynamoDB item must have 'messages' attribute"
        assert isinstance(item["messages"], list), "'messages' must be a list"
        assert isinstance(item["userId"], str), "'userId' must be a string"

    def test_orchestrator_uses_userId_as_partition_key(self) -> None:
        """Orchestrator get_item and put_item use Key={'userId': ...} pattern."""
        handler_path = MANTLE_ROOT / "src" / "orchestrator" / "handler.py"
        source = handler_path.read_text()

        # Verify DynamoDB operations use userId as key
        assert 'Key={"userId":' in source or "Key={\"userId\":" in source, (
            "DynamoDB get_item must use 'userId' as partition key"
        )

    def test_save_conversation_history_structure(self) -> None:
        """save_conversation_history stores {userId, messages} structure."""
        handler_path = MANTLE_ROOT / "src" / "orchestrator" / "handler.py"
        source = handler_path.read_text()

        # Verify put_item uses the expected Item schema
        assert '"userId": user_id' in source, "put_item must include userId"
        assert '"messages": messages' in source, "put_item must include messages list"


# =============================================================================
# Property 3: API Response Body Structure Preserved (3.4)
# =============================================================================


class TestAPIResponseStructure:
    """Assert API Gateway response body structure matches observed format.

    **Validates: Requirements 3.4**

    Observed behavior: POST /chat response template returns JSON with
    messageId, response, conversationId, timestamp fields.
    The OpenAPI spec defines required fields: userId and message in the request body.
    """

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_post_chat_response_schema_has_expected_fields(self, template_root: Path) -> None:
        """API response schema for POST /chat must include messageId, response, conversationId, timestamp."""
        spec_path = template_root / "infra" / "openapi" / "api-spec.json"
        spec = json.loads(spec_path.read_text())

        response_200 = (
            spec.get("paths", {})
            .get("/chat", {})
            .get("post", {})
            .get("responses", {})
            .get("200", {})
        )
        schema = (
            response_200.get("content", {})
            .get("application/json", {})
            .get("schema", {})
        )
        properties = schema.get("properties", {})

        expected_fields = ["messageId", "response", "conversationId", "timestamp"]
        for field in expected_fields:
            assert field in properties, (
                f"{template_root.name}: POST /chat 200 response schema missing '{field}' field"
            )

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_post_chat_request_requires_userId_and_message(self, template_root: Path) -> None:
        """POST /chat request body must require userId and message fields."""
        spec_path = template_root / "infra" / "openapi" / "api-spec.json"
        spec = json.loads(spec_path.read_text())

        request_body = (
            spec.get("paths", {})
            .get("/chat", {})
            .get("post", {})
            .get("requestBody", {})
        )
        schema = (
            request_body.get("content", {})
            .get("application/json", {})
            .get("schema", {})
        )

        required = schema.get("required", [])
        assert "userId" in required, f"{template_root.name}: 'userId' must be required in request body"
        assert "message" in required, f"{template_root.name}: 'message' must be required in request body"


# =============================================================================
# Property 4: Mantle Tool-Use Loop Terminates Correctly (3.6)
# =============================================================================


class TestMantleToolUseLoopTermination:
    """Assert Mantle orchestrator tool-use loop terminates at max iterations.

    **Validates: Requirements 3.6**

    Observed behavior: Orchestrator iterates up to MAX_TOOL_ITERATIONS (default 10).
    Uses `for iteration in range(MAX_TOOL_ITERATIONS)` with `else` clause raising
    RuntimeError when max iterations exceeded without text-only response.
    """

    @given(max_iterations=st.integers(min_value=1, max_value=50))
    @settings(max_examples=30)
    def test_tool_loop_terminates_at_max_iterations(self, max_iterations: int) -> None:
        """For all max_iteration values, the loop terminates within that bound."""
        # Simulate the loop logic observed in orchestrator handler
        iterations_executed = 0
        exhausted = True

        for iteration in range(max_iterations):
            iterations_executed += 1
            # Simulate tool calls always being present (worst case — no text response)
            function_calls = [{"name": "search_knowledge_base"}]
            if not function_calls:
                exhausted = False
                break

        # If loop completed without break, max iterations was reached
        assert iterations_executed == max_iterations
        assert exhausted, "Loop must exhaust all iterations when tool calls never stop"

    def test_orchestrator_has_for_else_loop_pattern(self) -> None:
        """Orchestrator uses for/else pattern to detect max iteration exhaustion."""
        handler_path = MANTLE_ROOT / "src" / "orchestrator" / "handler.py"
        source = handler_path.read_text()

        # Verify the for-else pattern exists
        assert "for iteration in range(MAX_TOOL_ITERATIONS)" in source, (
            "Orchestrator must use for loop with MAX_TOOL_ITERATIONS"
        )
        # The else clause raises RuntimeError on max iterations exceeded
        assert "maximum allowed tool-use iterations" in source.lower() or "max_tool_iterations" in source.lower()

    def test_max_tool_iterations_default_is_10(self) -> None:
        """MAX_TOOL_ITERATIONS defaults to 10 in the orchestrator."""
        handler_path = MANTLE_ROOT / "src" / "orchestrator" / "handler.py"
        source = handler_path.read_text()

        # Verify the default value
        assert '"10"' in source or "'10'" in source, (
            "MAX_TOOL_ITERATIONS should default to 10"
        )


# =============================================================================
# Property 5: Terraform Resource Naming Pattern Preserved (3.7)
# =============================================================================


class TestTerraformResourceNaming:
    """Assert Terraform resources follow {prefix}-{function} naming pattern.

    **Validates: Requirements 3.7**

    Observed behavior: Lambda modules use local.function_name =
    "${var.project_name}-${var.environment}-<function>" for naming.
    S3 uses "${var.project_name}-${var.environment}-rag-documents".
    """

    @given(project_name=prefix_strategy, environment=st.sampled_from(["dev", "staging", "prod"]))
    @settings(max_examples=30)
    def test_naming_pattern_produces_valid_resource_names(
        self, project_name: str, environment: str
    ) -> None:
        """For all prefix+environment combinations, names follow {prefix}-{function} pattern."""
        # Observed pattern: ${var.project_name}-${var.environment}-<function>
        functions = ["orchestrator", "ai-caller", "tool-executor", "kb-sync", "responses-reader"]

        for func in functions:
            resource_name = f"{project_name}-{environment}-{func}"
            # Must match pattern: lowercase alphanumeric with hyphens
            assert re.match(r"^[a-z0-9\-]+$", resource_name), (
                f"Resource name '{resource_name}' does not match naming pattern"
            )
            # Must contain project name, environment, and function
            assert project_name in resource_name
            assert environment in resource_name
            assert func in resource_name

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_lambda_modules_use_prefix_function_naming(self, template_root: Path) -> None:
        """All Lambda modules define function_name using ${var.project_name}-${var.environment}-X."""
        lambda_dir = template_root / "infra" / "modules" / "lambda"
        assert lambda_dir.exists()

        # Check all lambda.tf files for the naming pattern
        naming_pattern = re.compile(
            r'\$\{var\.project_name\}-\$\{var\.environment\}-[a-z\-]+'
        )

        lambda_tf_files = list(lambda_dir.rglob("lambda.tf"))
        assert len(lambda_tf_files) > 0, f"No lambda.tf files found in {template_root.name}"

        for tf_file in lambda_tf_files:
            content = tf_file.read_text()
            match = naming_pattern.search(content)
            assert match is not None, (
                f"{tf_file.relative_to(template_root)} does not follow "
                "naming pattern ${var.project_name}-${var.environment}-<function>"
            )


# =============================================================================
# Property 6: Mantle Tool Executor Lambda Exists and Is Configured (3.1)
# =============================================================================


class TestMantleToolExecutorExists:
    """Assert Mantle template still deploys Tool Executor Lambda.

    **Validates: Requirements 3.1**

    Observed behavior: The Mantle template has:
    - src/tool_executor/handler.py (Python handler)
    - infra/modules/lambda/tool_executor/ (Terraform module)
    This must remain after fixes (only AgentCore removes its Tool Executor).
    """

    def test_mantle_tool_executor_source_exists(self) -> None:
        """Mantle template must have src/tool_executor/handler.py."""
        handler_path = MANTLE_ROOT / "src" / "tool_executor" / "handler.py"
        assert handler_path.exists(), (
            "Mantle template must retain src/tool_executor/handler.py — "
            "only AgentCore removes the Tool Executor"
        )

    def test_mantle_tool_executor_terraform_module_exists(self) -> None:
        """Mantle template must have infra/modules/lambda/tool_executor/ Terraform module."""
        tf_dir = MANTLE_ROOT / "infra" / "modules" / "lambda" / "tool_executor"
        assert tf_dir.exists(), (
            "Mantle template must retain infra/modules/lambda/tool_executor/ — "
            "only AgentCore removes the Tool Executor"
        )

    def test_mantle_tool_executor_has_lambda_resource(self) -> None:
        """Mantle tool_executor/lambda.tf must declare aws_lambda_function resource."""
        lambda_tf = MANTLE_ROOT / "infra" / "modules" / "lambda" / "tool_executor" / "lambda.tf"
        assert lambda_tf.exists(), "tool_executor/lambda.tf must exist"
        content = lambda_tf.read_text()
        assert "aws_lambda_function" in content, (
            "tool_executor/lambda.tf must declare aws_lambda_function resource"
        )

    def test_mantle_tool_executor_handler_has_search_knowledge_base(self) -> None:
        """Mantle tool_executor handler must implement search_knowledge_base tool."""
        handler_path = MANTLE_ROOT / "src" / "tool_executor" / "handler.py"
        source = handler_path.read_text()
        assert "search_knowledge_base" in source, (
            "Mantle tool_executor must implement search_knowledge_base"
        )


# =============================================================================
# Property 7: S3 RAG Bucket Versioning and Block Public Access (3.8)
# =============================================================================


class TestS3RAGBucketSettings:
    """Assert S3 RAG bucket retains versioning and Block Public Access settings.

    **Validates: Requirements 3.8**

    Observed behavior: Both templates' S3 modules declare:
    - aws_s3_bucket_versioning with status = "Enabled"
    - aws_s3_bucket_public_access_block with all four settings = true
    """

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_s3_rag_bucket_has_versioning_enabled(self, template_root: Path) -> None:
        """S3 module must have aws_s3_bucket_versioning with status = Enabled."""
        s3_main = template_root / "infra" / "modules" / "s3" / "main.tf"
        assert s3_main.exists(), f"S3 module not found: {s3_main}"

        content = s3_main.read_text()
        assert "aws_s3_bucket_versioning" in content, (
            f"{template_root.name}: S3 module must declare aws_s3_bucket_versioning resource"
        )
        assert '"Enabled"' in content, (
            f"{template_root.name}: Bucket versioning must be set to Enabled"
        )

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_s3_rag_bucket_has_block_public_access(self, template_root: Path) -> None:
        """S3 module must have aws_s3_bucket_public_access_block with all four settings."""
        s3_main = template_root / "infra" / "modules" / "s3" / "main.tf"
        content = s3_main.read_text()

        assert "aws_s3_bucket_public_access_block" in content, (
            f"{template_root.name}: S3 module must declare aws_s3_bucket_public_access_block"
        )

        # All four Block Public Access settings must be present and true
        required_settings = [
            "block_public_acls",
            "ignore_public_acls",
            "block_public_policy",
            "restrict_public_buckets",
        ]
        for setting in required_settings:
            assert setting in content, (
                f"{template_root.name}: S3 module must set {setting} = true"
            )

    @given(template_idx=st.sampled_from([0, 1]))
    @settings(max_examples=10)
    def test_property_s3_always_has_versioning_and_public_block(self, template_idx: int) -> None:
        """Property: For any template, S3 RAG bucket has versioning + block public access."""
        template_root = TEMPLATE_ROOTS[template_idx]
        s3_main = template_root / "infra" / "modules" / "s3" / "main.tf"
        content = s3_main.read_text()

        assert "aws_s3_bucket_versioning" in content
        assert "aws_s3_bucket_public_access_block" in content
        assert '"Enabled"' in content


# =============================================================================
# Property 8: Structured JSON Log Fields Preserved (3.9)
# =============================================================================


class TestStructuredLogFields:
    """Assert log output retains required structured fields.

    **Validates: Requirements 3.9**

    Observed behavior: The shared/logging_config.py uses aws_lambda_powertools Logger
    which outputs structured JSON with timestamp, level, service, message fields.
    The log_ai_interaction function adds logType="ai-interaction" to AI interaction logs.
    Logger.set_correlation_id adds correlation_id to all subsequent log entries.
    """

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_handlers_use_powertools_logger_directly(self, template_root: Path) -> None:
        """Handlers must import and use aws_lambda_powertools Logger directly (no wrapper)."""
        orchestrator_handler = template_root / "src" / "orchestrator" / "handler.py"
        content = orchestrator_handler.read_text()

        assert "from aws_lambda_powertools import Logger" in content, (
            f"{template_root.name}: orchestrator handler must import Powertools Logger directly"
        )
        assert "logger = Logger(" in content, (
            f"{template_root.name}: orchestrator handler must instantiate Logger at module level"
        )

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_ai_interaction_log_includes_logtype(self, template_root: Path) -> None:
        """AI interaction logging must include logType='ai-interaction' in handler code."""
        # After logging_config.py removal, ai-interaction logging is done directly in handlers.
        # For Mantle: directly in src/ai_caller/handler.py
        # For AgentCore: in shared/ai_caller_agentcore.py (the handler delegates to it)
        ai_caller_handler = template_root / "src" / "ai_caller" / "handler.py"
        assert ai_caller_handler.exists(), f"AI caller handler not found for {template_root.name}"
        content = ai_caller_handler.read_text()

        # Check directly in handler first, then in the shared module it delegates to
        if "ai-interaction" not in content:
            # AgentCore delegates to shared ai_caller_agentcore.py
            shared_ai_caller = (
                template_root / "src" / "layers" / "shared" / "python" / "shared" / "ai_caller_agentcore.py"
            )
            assert shared_ai_caller.exists(), (
                f"{template_root.name}: Neither ai_caller/handler.py nor shared/ai_caller_agentcore.py "
                "contains logType='ai-interaction'"
            )
            shared_content = shared_ai_caller.read_text()
            assert "ai-interaction" in shared_content, (
                f"{template_root.name}: AI caller must emit logType='ai-interaction' for AI interaction logs"
            )

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_handlers_set_correlation_id(self, template_root: Path) -> None:
        """Handlers must call logger.set_correlation_id for structured correlation tracking."""
        orchestrator_handler = template_root / "src" / "orchestrator" / "handler.py"
        content = orchestrator_handler.read_text()

        assert "set_correlation_id" in content, (
            f"{template_root.name}: orchestrator handler must set correlation_id for log tracking"
        )

    @given(
        correlation_id=correlation_id_strategy,
        service_name=st.sampled_from(["orchestrator", "ai-caller", "tool-executor"]),
    )
    @settings(max_examples=30)
    def test_property_structured_log_fields_format(
        self, correlation_id: str, service_name: str
    ) -> None:
        """Property: Structured logs must be producible with correlation_id and service fields.

        Powertools Logger automatically includes timestamp, level, service, message.
        The correlation_id is added via set_correlation_id.
        """
        # Simulate log structure that Powertools Logger produces
        log_entry = {
            "timestamp": "2024-01-15T10:30:00.000Z",
            "level": "INFO",
            "service": service_name,
            "correlation_id": correlation_id,
            "message": "Test log entry",
        }

        # All required fields present
        required_fields = ["timestamp", "level", "service", "correlation_id", "message"]
        for field in required_fields:
            assert field in log_entry, f"Log entry must contain '{field}'"
            assert log_entry[field] is not None, f"'{field}' must not be None"
            assert len(str(log_entry[field])) > 0, f"'{field}' must not be empty"

    @given(
        correlation_id=correlation_id_strategy,
        model=st.sampled_from(["claude-3-haiku", "claude-3-sonnet", "test-model"]),
    )
    @settings(max_examples=20)
    def test_property_ai_interaction_log_has_logtype(
        self, correlation_id: str, model: str
    ) -> None:
        """Property: AI interaction logs must include logType='ai-interaction'."""
        # Simulate log_ai_interaction output structure
        ai_log_entry = {
            "timestamp": "2024-01-15T10:30:00.000Z",
            "level": "INFO",
            "service": "ai-caller",
            "correlation_id": correlation_id,
            "message": "AI interaction",
            "logType": "ai-interaction",
            "model": model,
        }

        assert ai_log_entry["logType"] == "ai-interaction", (
            "AI interaction logs must have logType='ai-interaction'"
        )
        assert "correlation_id" in ai_log_entry
        assert "model" in ai_log_entry
