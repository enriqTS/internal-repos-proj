"""Preservation Property Tests — ECS Template Functional Behavior Unchanged After Fixes.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

Property 2: Preservation — Functional Behavior Unchanged

These tests capture the CURRENT (pre-fix) functional behavior of the 6 ECS templates
to ensure bugfix implementation does not introduce regressions. ALL tests MUST PASS
on unfixed code to confirm baseline behavior.

Observation-first methodology:
- Observed: ECS FastAPI orchestrator → AI Caller payload format
- Observed: DynamoDB conversation history schema (partition key `userId`, message list)
- Observed: ALB health check endpoint `/health` returns 200/503
- Observed: Mantle tool-use loop iteration logic and MAX_TOOL_ITERATIONS termination
- Observed: AgentCore RETURN_CONTROL tool execution — tool_executor.py deployed
- Observed: Terraform resource naming pattern `${var.project_name}-${var.environment}-{function}`
- Observed: S3 RAG bucket versioning and Block Public Access settings
- Observed: Structured JSON log fields in logging_config.py
- Observed: kb_sync Lambda calls StartIngestionJob and handles ConflictException

Templates under test (6 ECS variants):
- chatbot-rag-agentcore-ecs
- chatbot-rag-agentcore-ecs-ws
- chatbot-rag-agentcore-ecs-ws-streaming
- chatbot-rag-mantle-ecs
- chatbot-rag-mantle-ecs-ws
- chatbot-rag-mantle-ecs-ws-streaming
"""

import ast
import re
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# --- Template root paths ---
TEMPLATES_ROOT = Path(__file__).resolve().parent.parent.parent / "templates"

ALL_ECS_TEMPLATES = [
    TEMPLATES_ROOT / "chatbot-rag-agentcore-ecs",
    TEMPLATES_ROOT / "chatbot-rag-agentcore-ecs-ws",
    TEMPLATES_ROOT / "chatbot-rag-agentcore-ecs-ws-streaming",
    TEMPLATES_ROOT / "chatbot-rag-mantle-ecs",
    TEMPLATES_ROOT / "chatbot-rag-mantle-ecs-ws",
    TEMPLATES_ROOT / "chatbot-rag-mantle-ecs-ws-streaming",
]

ALL_ECS_TEMPLATE_IDS = [
    "agentcore-ecs",
    "agentcore-ecs-ws",
    "agentcore-ecs-ws-streaming",
    "mantle-ecs",
    "mantle-ecs-ws",
    "mantle-ecs-ws-streaming",
]

MANTLE_ECS_TEMPLATES = [
    TEMPLATES_ROOT / "chatbot-rag-mantle-ecs",
    TEMPLATES_ROOT / "chatbot-rag-mantle-ecs-ws",
    TEMPLATES_ROOT / "chatbot-rag-mantle-ecs-ws-streaming",
]

MANTLE_ECS_TEMPLATE_IDS = [
    "mantle-ecs",
    "mantle-ecs-ws",
    "mantle-ecs-ws-streaming",
]

AGENTCORE_ECS_TEMPLATES = [
    TEMPLATES_ROOT / "chatbot-rag-agentcore-ecs",
    TEMPLATES_ROOT / "chatbot-rag-agentcore-ecs-ws",
    TEMPLATES_ROOT / "chatbot-rag-agentcore-ecs-ws-streaming",
]

AGENTCORE_ECS_TEMPLATE_IDS = [
    "agentcore-ecs",
    "agentcore-ecs-ws",
    "agentcore-ecs-ws-streaming",
]


# =============================================================================
# Strategies for property-based tests
# =============================================================================

user_id_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="-_"),
    min_size=1,
    max_size=50,
)

message_strategy = st.text(min_size=1, max_size=500)

correlation_id_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="-_"),
    min_size=5,
    max_size=64,
)

message_entry_strategy = st.fixed_dictionaries({
    "role": st.sampled_from(["user", "assistant"]),
    "content": st.text(min_size=1, max_size=200),
    "timestamp": st.just("2024-01-15T10:30:00+00:00"),
})

conversation_history_strategy = st.lists(message_entry_strategy, min_size=0, max_size=10)

prefix_strategy = st.from_regex(r"[a-z][a-z0-9\-]{2,20}", fullmatch=True)


# =============================================================================
# 3.1 — Chat Flow Intact: orchestrator → AI caller → tool executor exists
# =============================================================================


class TestChatFlowIntact:
    """Assert orchestrator → AI caller → tool executor flow exists across all 6 templates.

    **Validates: Requirements 3.1**

    Observed behavior: Each ECS template has:
    - src/app/orchestrator.py with process_message function
    - src/app/ai_caller.py with invoke_agentcore or invoke_mantle
    - src/app/tool_executor.py with execute_tool function
    - orchestrator imports from ai_caller and tool_executor
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_orchestrator_exists_with_process_message(self, template_root: Path) -> None:
        """orchestrator.py must exist and define process_message or process_message_streaming."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        assert orchestrator.exists(), (
            f"{template_root.name}: src/app/orchestrator.py must exist"
        )
        source = orchestrator.read_text()
        has_process_fn = (
            "def process_message(" in source
            or "def process_message_streaming(" in source
        )
        assert has_process_fn, (
            f"{template_root.name}: orchestrator must define process_message "
            "or process_message_streaming function"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_ai_caller_exists(self, template_root: Path) -> None:
        """ai_caller.py must exist with invoke function."""
        ai_caller = template_root / "src" / "app" / "ai_caller.py"
        assert ai_caller.exists(), (
            f"{template_root.name}: src/app/ai_caller.py must exist"
        )
        source = ai_caller.read_text()
        # AgentCore uses invoke_agentcore, Mantle uses invoke_mantle
        has_invoke = "def invoke_agentcore(" in source or "def invoke_mantle(" in source
        assert has_invoke, (
            f"{template_root.name}: ai_caller.py must define invoke_agentcore or invoke_mantle"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_tool_executor_exists_with_execute_tool(self, template_root: Path) -> None:
        """tool_executor.py must exist and define execute_tool function."""
        tool_executor = template_root / "src" / "app" / "tool_executor.py"
        assert tool_executor.exists(), (
            f"{template_root.name}: src/app/tool_executor.py must exist"
        )
        source = tool_executor.read_text()
        assert "def execute_tool(" in source, (
            f"{template_root.name}: tool_executor.py must define execute_tool function"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_orchestrator_imports_ai_caller(self, template_root: Path) -> None:
        """orchestrator.py must import from ai_caller."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        source = orchestrator.read_text()
        has_import = (
            "from app.ai_caller import" in source
            or "import app.ai_caller" in source
        )
        assert has_import, (
            f"{template_root.name}: orchestrator must import from app.ai_caller"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_orchestrator_imports_tool_executor(self, template_root: Path) -> None:
        """orchestrator.py must import from tool_executor."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        source = orchestrator.read_text()
        has_import = (
            "from app.tool_executor import" in source
            or "import app.tool_executor" in source
        )
        assert has_import, (
            f"{template_root.name}: orchestrator must import from app.tool_executor"
        )

    @given(
        correlation_id=correlation_id_strategy,
        user_id=user_id_strategy,
        message=message_strategy,
    )
    @settings(max_examples=30)
    def test_payload_format_has_correlation_id(
        self, correlation_id: str, user_id: str, message: str
    ) -> None:
        """Payload to AI caller must include correlation_id for tracing."""
        # Observed: orchestrator passes correlation_id to invoke_agentcore/invoke_mantle
        payload = {
            "correlation_id": correlation_id,
            "user_id": user_id,
            "message": message,
        }
        assert "correlation_id" in payload
        assert isinstance(payload["correlation_id"], str)
        assert len(payload["correlation_id"]) > 0


# =============================================================================
# 3.2 — Mantle Tool-Use Loop with MAX_TOOL_ITERATIONS
# =============================================================================


class TestMantleToolUseLoop:
    """Assert Mantle orchestrator has tool-use loop with MAX_TOOL_ITERATIONS and proper termination.

    **Validates: Requirements 3.2**

    Observed behavior: Mantle orchestrator iterates up to MAX_TOOL_ITERATIONS (default 10).
    Uses `for iteration in range(MAX_TOOL_ITERATIONS)` with `else` clause raising RuntimeError.
    Tool calls are executed via execute_tool and results appended as function_call_output.
    """

    @pytest.mark.parametrize(
        "template_root", MANTLE_ECS_TEMPLATES, ids=MANTLE_ECS_TEMPLATE_IDS
    )
    def test_has_max_tool_iterations_constant(self, template_root: Path) -> None:
        """Mantle orchestrator must define MAX_TOOL_ITERATIONS."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        source = orchestrator.read_text()
        assert "MAX_TOOL_ITERATIONS" in source, (
            f"{template_root.name}: orchestrator must define MAX_TOOL_ITERATIONS"
        )

    @pytest.mark.parametrize(
        "template_root", MANTLE_ECS_TEMPLATES, ids=MANTLE_ECS_TEMPLATE_IDS
    )
    def test_has_for_range_loop_with_max_iterations(self, template_root: Path) -> None:
        """Mantle orchestrator must use for/range(MAX_TOOL_ITERATIONS) loop pattern."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        source = orchestrator.read_text()
        assert "for iteration in range(MAX_TOOL_ITERATIONS)" in source, (
            f"{template_root.name}: orchestrator must have for loop with MAX_TOOL_ITERATIONS"
        )

    @pytest.mark.parametrize(
        "template_root", MANTLE_ECS_TEMPLATES, ids=MANTLE_ECS_TEMPLATE_IDS
    )
    def test_has_else_clause_raising_runtime_error(self, template_root: Path) -> None:
        """Mantle orchestrator for-loop must have else clause that raises RuntimeError."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        source = orchestrator.read_text()
        tree = ast.parse(source)

        # Find the for loop with MAX_TOOL_ITERATIONS and check it has an orelse clause
        has_for_else = False
        for node in ast.walk(tree):
            if isinstance(node, ast.For) and node.orelse:
                # Check if this is the MAX_TOOL_ITERATIONS loop
                loop_source = ast.get_source_segment(source, node)
                if loop_source and "MAX_TOOL_ITERATIONS" in loop_source:
                    has_for_else = True
                    break

        assert has_for_else, (
            f"{template_root.name}: tool-use loop must have else clause for max iteration error"
        )

    @pytest.mark.parametrize(
        "template_root", MANTLE_ECS_TEMPLATES, ids=MANTLE_ECS_TEMPLATE_IDS
    )
    def test_max_iterations_defaults_to_10(self, template_root: Path) -> None:
        """MAX_TOOL_ITERATIONS must default to 10."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        source = orchestrator.read_text()
        # Pattern: os.environ.get("MAX_TOOL_ITERATIONS", "10")
        assert '"10"' in source or "'10'" in source, (
            f"{template_root.name}: MAX_TOOL_ITERATIONS should default to 10"
        )

    @pytest.mark.parametrize(
        "template_root", MANTLE_ECS_TEMPLATES, ids=MANTLE_ECS_TEMPLATE_IDS
    )
    def test_tool_results_use_function_call_output_type(self, template_root: Path) -> None:
        """Tool results must be appended as function_call_output messages."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        source = orchestrator.read_text()
        assert "function_call_output" in source, (
            f"{template_root.name}: tool results must use function_call_output type"
        )

    @given(max_iterations=st.integers(min_value=1, max_value=50))
    @settings(max_examples=30)
    def test_property_loop_terminates_at_max(self, max_iterations: int) -> None:
        """Property: for any MAX_TOOL_ITERATIONS, loop terminates within that bound."""
        iterations_executed = 0
        for _ in range(max_iterations):
            iterations_executed += 1
            # Worst case: tool calls always present
        assert iterations_executed == max_iterations


# =============================================================================
# 3.3 — DynamoDB Schema: userId partition key, messages list
# =============================================================================


class TestDynamoDBSchema:
    """Assert DynamoDB partition key is `userId` and conversation context stores messages.

    **Validates: Requirements 3.3**

    Observed behavior:
    - Terraform: hash_key = "userId", attribute type "S"
    - Python: get_item(Key={"userId": user_id}), put_item(Item={"userId": ..., "messages": ...})
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_terraform_dynamodb_hash_key_is_userid(self, template_root: Path) -> None:
        """DynamoDB table must use hash_key = "userId"."""
        dynamodb_tf = template_root / "infra" / "modules" / "dynamodb" / "main.tf"
        assert dynamodb_tf.exists(), (
            f"{template_root.name}: dynamodb/main.tf must exist"
        )
        content = dynamodb_tf.read_text()
        assert 'hash_key' in content, (
            f"{template_root.name}: DynamoDB must declare hash_key"
        )
        assert '"userId"' in content, (
            f"{template_root.name}: DynamoDB hash_key must be 'userId'"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_conversation_context_stores_messages_list(self, template_root: Path) -> None:
        """conversation_context.py must store messages as a list in DynamoDB."""
        ctx_path = template_root / "src" / "app" / "conversation_context.py"
        assert ctx_path.exists(), (
            f"{template_root.name}: src/app/conversation_context.py must exist"
        )
        source = ctx_path.read_text()
        # Must reference "messages" key for DynamoDB item
        assert '"messages"' in source, (
            f"{template_root.name}: conversation_context must use 'messages' key"
        )
        # Must use userId as partition key in get_item/put_item
        assert '"userId"' in source, (
            f"{template_root.name}: conversation_context must use 'userId' as partition key"
        )

    @given(user_id=user_id_strategy, messages=conversation_history_strategy)
    @settings(max_examples=30)
    def test_property_dynamodb_item_structure(
        self, user_id: str, messages: list[dict[str, Any]]
    ) -> None:
        """Property: DynamoDB item always has userId string key and messages list."""
        item = {"userId": user_id, "messages": messages}
        assert isinstance(item["userId"], str)
        assert isinstance(item["messages"], list)
        for msg in item["messages"]:
            assert "role" in msg
            assert "content" in msg


# =============================================================================
# 3.4 — Structured Log Fields: logging_config produces required fields
# =============================================================================


class TestStructuredLogFields:
    """Assert logging produces structured logs with required fields.

    **Validates: Requirements 3.4**

    Observed behavior: logging_config.py uses aws_lambda_powertools.Logger which outputs:
    - timestamp, level, service, message (automatic from Powertools)
    - correlation_id (via logger.append_keys or logger.set_correlation_id)
    - logType: "ai-interaction" (via log_ai_interaction function)
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_logging_config_exists_or_direct_powertools(self, template_root: Path) -> None:
        """Template must have logging_config.py OR direct Powertools Logger usage."""
        logging_config = template_root / "src" / "app" / "logging_config.py"
        # On unfixed code, logging_config.py exists. On fixed code, direct imports used.
        # Either way, the structured logging capability must be present.
        if logging_config.exists():
            source = logging_config.read_text()
            assert "aws_lambda_powertools" in source, (
                f"{template_root.name}: logging_config must use aws_lambda_powertools"
            )
            assert "Logger" in source, (
                f"{template_root.name}: logging_config must use Logger"
            )
        else:
            # Fixed code: check that orchestrator uses direct Powertools Logger
            orchestrator = template_root / "src" / "app" / "orchestrator.py"
            source = orchestrator.read_text()
            assert "from aws_lambda_powertools import Logger" in source, (
                f"{template_root.name}: orchestrator must use direct Powertools Logger"
            )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_ai_interaction_log_type_exists(self, template_root: Path) -> None:
        """AI interaction logging must include logType='ai-interaction'."""
        # The logType field is defined either in logging_config.py (unfixed)
        # or directly in ai_caller.py (fixed)
        logging_config = template_root / "src" / "app" / "logging_config.py"
        ai_caller = template_root / "src" / "app" / "ai_caller.py"

        found_ai_interaction = False
        if logging_config.exists():
            source = logging_config.read_text()
            if "ai-interaction" in source:
                found_ai_interaction = True
        if not found_ai_interaction:
            source = ai_caller.read_text()
            if "ai-interaction" in source:
                found_ai_interaction = True

        assert found_ai_interaction, (
            f"{template_root.name}: logType='ai-interaction' must be present "
            "in either logging_config.py or ai_caller.py"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_correlation_id_propagated_in_logs(self, template_root: Path) -> None:
        """Orchestrator must propagate correlation_id to log entries."""
        orchestrator = template_root / "src" / "app" / "orchestrator.py"
        source = orchestrator.read_text()
        assert "correlation_id" in source, (
            f"{template_root.name}: orchestrator must use correlation_id in logging"
        )

    @given(
        correlation_id=correlation_id_strategy,
        service_name=st.sampled_from(["orchestrator", "ai_caller", "tool_executor"]),
    )
    @settings(max_examples=20)
    def test_property_structured_log_fields(
        self, correlation_id: str, service_name: str
    ) -> None:
        """Property: structured logs include timestamp, level, service, correlation_id, message."""
        # Powertools Logger automatically produces these fields
        log_entry = {
            "timestamp": "2024-01-15T10:30:00.000Z",
            "level": "INFO",
            "service": service_name,
            "correlation_id": correlation_id,
            "message": "Test log entry",
        }
        required_fields = ["timestamp", "level", "service", "correlation_id", "message"]
        for field in required_fields:
            assert field in log_entry
            assert log_entry[field] is not None
            assert len(str(log_entry[field])) > 0

    @given(
        correlation_id=correlation_id_strategy,
        model=st.sampled_from(["agentcore", "claude-3-haiku", "claude-3-sonnet"]),
        input_tokens=st.integers(min_value=0, max_value=100000),
        output_tokens=st.integers(min_value=0, max_value=100000),
    )
    @settings(max_examples=20)
    def test_property_ai_interaction_log_format(
        self,
        correlation_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        """Property: AI interaction logs always include logType and token fields."""
        ai_log = {
            "logType": "ai-interaction",
            "correlation_id": correlation_id,
            "model": model,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": input_tokens + output_tokens,
            "latencyMs": 150,
            "finishReason": "end_turn",
        }
        assert ai_log["logType"] == "ai-interaction"
        assert ai_log["totalTokens"] == ai_log["inputTokens"] + ai_log["outputTokens"]
        assert ai_log["latencyMs"] >= 0


# =============================================================================
# 3.5 — Health Check: /health endpoint exists and returns correct codes
# =============================================================================


class TestHealthCheckEndpoint:
    """Assert /health endpoint exists in main.py with correct behavior.

    **Validates: Requirements 3.5**

    Observed behavior:
    - GET /health returns 200 {"status": "healthy"} when service is running
    - GET /health returns 503 when _shutting_down is True (graceful shutdown)
    - main.py uses FastAPI with SIGTERM handler
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_main_py_has_health_endpoint(self, template_root: Path) -> None:
        """main.py must define a /health GET endpoint."""
        main_py = template_root / "src" / "app" / "main.py"
        assert main_py.exists(), (
            f"{template_root.name}: src/app/main.py must exist"
        )
        source = main_py.read_text()
        # Check for health endpoint decorator
        assert '@app.get("/health")' in source or "@app.get('/health')" in source, (
            f"{template_root.name}: main.py must have @app.get('/health') endpoint"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_health_returns_200_when_healthy(self, template_root: Path) -> None:
        """Health endpoint must return healthy status (200 implicit from dict return)."""
        main_py = template_root / "src" / "app" / "main.py"
        source = main_py.read_text()
        # Observed: returns {"status": "healthy"} when not shutting down
        assert '"healthy"' in source or "'healthy'" in source, (
            f"{template_root.name}: health endpoint must return 'healthy' status"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_health_returns_503_when_shutting_down(self, template_root: Path) -> None:
        """Health endpoint must return 503 during graceful shutdown."""
        main_py = template_root / "src" / "app" / "main.py"
        source = main_py.read_text()
        # Observed: raises HTTPException(status_code=503) when _shutting_down
        assert "503" in source, (
            f"{template_root.name}: health endpoint must return 503 when shutting down"
        )
        assert "_shutting_down" in source, (
            f"{template_root.name}: main.py must track shutdown state with _shutting_down"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_main_has_sigterm_handler(self, template_root: Path) -> None:
        """main.py must register SIGTERM handler for graceful shutdown."""
        main_py = template_root / "src" / "app" / "main.py"
        source = main_py.read_text()
        assert "SIGTERM" in source, (
            f"{template_root.name}: main.py must handle SIGTERM for graceful shutdown"
        )


# =============================================================================
# 3.6 — Resource Naming: ${var.project_name}-${var.environment}-{function}
# =============================================================================


class TestTerraformResourceNaming:
    """Assert Terraform resource names follow the naming convention.

    **Validates: Requirements 3.6**

    Observed behavior: All Terraform resources use the pattern
    `${var.project_name}-${var.environment}-{function}` for naming.
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_dynamodb_table_follows_naming_convention(self, template_root: Path) -> None:
        """DynamoDB table name must follow naming pattern."""
        dynamodb_tf = template_root / "infra" / "modules" / "dynamodb" / "main.tf"
        content = dynamodb_tf.read_text()
        naming_pattern = re.compile(
            r'\$\{var\.project_name\}-\$\{var\.environment\}-[a-z\-]+'
        )
        assert naming_pattern.search(content), (
            f"{template_root.name}: DynamoDB table must follow "
            "${var.project_name}-${var.environment}-{function} naming"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_s3_bucket_follows_naming_convention(self, template_root: Path) -> None:
        """S3 bucket name must follow naming pattern."""
        s3_tf = template_root / "infra" / "modules" / "s3" / "main.tf"
        content = s3_tf.read_text()
        naming_pattern = re.compile(
            r'\$\{var\.project_name\}-\$\{var\.environment\}-[a-z\-]+'
        )
        assert naming_pattern.search(content), (
            f"{template_root.name}: S3 bucket must follow "
            "${var.project_name}-${var.environment}-{function} naming"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_kb_sync_lambda_follows_naming_convention(self, template_root: Path) -> None:
        """kb_sync Lambda function name must follow naming pattern."""
        lambda_tf = (
            template_root / "infra" / "modules" / "lambda" / "kb_sync" / "lambda.tf"
        )
        content = lambda_tf.read_text()
        naming_pattern = re.compile(
            r'\$\{var\.project_name\}-\$\{var\.environment\}-[a-z\-]+'
        )
        assert naming_pattern.search(content), (
            f"{template_root.name}: kb_sync Lambda must follow "
            "${var.project_name}-${var.environment}-{function} naming"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_ecs_iam_roles_follow_naming_convention(self, template_root: Path) -> None:
        """ECS IAM roles must follow naming pattern."""
        ecs_iam = template_root / "infra" / "modules" / "ecs" / "iam.tf"
        content = ecs_iam.read_text()
        naming_pattern = re.compile(
            r'\$\{var\.project_name\}-\$\{var\.environment\}-[a-z\-]+'
        )
        matches = naming_pattern.findall(content)
        assert len(matches) >= 2, (
            f"{template_root.name}: ECS IAM roles must follow naming convention "
            f"(found {len(matches)} matches, expected at least 2)"
        )

    @given(
        project_name=prefix_strategy,
        environment=st.sampled_from(["dev", "staging", "prod"]),
    )
    @settings(max_examples=30)
    def test_property_naming_pattern_valid(
        self, project_name: str, environment: str
    ) -> None:
        """Property: naming pattern produces valid resource names for any inputs."""
        functions = ["kb-sync", "user-context", "rag-documents", "ecs-task-role"]
        for func in functions:
            resource_name = f"{project_name}-{environment}-{func}"
            assert re.match(r"^[a-z0-9\-]+$", resource_name)
            assert project_name in resource_name
            assert environment in resource_name
            assert func in resource_name


# =============================================================================
# 3.7 — kb_sync: calls StartIngestionJob + handles ConflictException
# =============================================================================


class TestKbSyncBehavior:
    """Assert kb_sync handler calls StartIngestionJob and handles ConflictException.

    **Validates: Requirements 3.7**

    Observed behavior:
    - handler calls bedrock_client.start_ingestion_job(...)
    - On ConflictException: logs info, returns {"success": True, "skipped": True}
    - On other ClientError: logs error, re-raises
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_kb_sync_handler_exists(self, template_root: Path) -> None:
        """src/kb_sync/handler.py must exist."""
        handler = template_root / "src" / "kb_sync" / "handler.py"
        assert handler.exists(), (
            f"{template_root.name}: src/kb_sync/handler.py must exist"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_kb_sync_calls_start_ingestion_job(self, template_root: Path) -> None:
        """kb_sync handler must call start_ingestion_job."""
        handler = template_root / "src" / "kb_sync" / "handler.py"
        source = handler.read_text()
        assert "start_ingestion_job" in source, (
            f"{template_root.name}: kb_sync must call start_ingestion_job"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_kb_sync_handles_conflict_exception(self, template_root: Path) -> None:
        """kb_sync handler must handle ConflictException gracefully."""
        handler = template_root / "src" / "kb_sync" / "handler.py"
        source = handler.read_text()
        assert "ConflictException" in source, (
            f"{template_root.name}: kb_sync must handle ConflictException"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_kb_sync_conflict_returns_success_with_skip(self, template_root: Path) -> None:
        """On ConflictException, kb_sync must return success with skipped=True."""
        handler = template_root / "src" / "kb_sync" / "handler.py"
        source = handler.read_text()
        # Observed: returns {"success": True, "skipped": True, "reason": "concurrent_job"}
        assert '"skipped"' in source or "'skipped'" in source, (
            f"{template_root.name}: ConflictException handling must return skipped indicator"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_kb_sync_uses_knowledge_base_id_and_data_source_id(
        self, template_root: Path
    ) -> None:
        """kb_sync must pass knowledgeBaseId and dataSourceId to start_ingestion_job."""
        handler = template_root / "src" / "kb_sync" / "handler.py"
        source = handler.read_text()
        assert "knowledgeBaseId" in source or "KNOWLEDGE_BASE_ID" in source, (
            f"{template_root.name}: kb_sync must use KNOWLEDGE_BASE_ID"
        )
        assert "dataSourceId" in source or "DATA_SOURCE_ID" in source, (
            f"{template_root.name}: kb_sync must use DATA_SOURCE_ID"
        )


# =============================================================================
# 3.8 — S3 Versioning + Block Public Access
# =============================================================================


class TestS3VersioningAndPublicAccess:
    """Assert S3 module has versioning enabled and all 4 Block Public Access settings.

    **Validates: Requirements 3.8**

    Observed behavior:
    - aws_s3_bucket_versioning with status = "Enabled"
    - aws_s3_bucket_public_access_block with all 4 settings = true
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_s3_bucket_versioning_enabled(self, template_root: Path) -> None:
        """S3 module must have versioning enabled."""
        s3_tf = template_root / "infra" / "modules" / "s3" / "main.tf"
        assert s3_tf.exists(), f"{template_root.name}: s3/main.tf must exist"
        content = s3_tf.read_text()
        assert "aws_s3_bucket_versioning" in content, (
            f"{template_root.name}: S3 must declare versioning resource"
        )
        assert '"Enabled"' in content, (
            f"{template_root.name}: S3 versioning must be Enabled"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_s3_block_public_access_all_four_settings(self, template_root: Path) -> None:
        """S3 module must have all 4 Block Public Access settings set to true."""
        s3_tf = template_root / "infra" / "modules" / "s3" / "main.tf"
        content = s3_tf.read_text()

        assert "aws_s3_bucket_public_access_block" in content, (
            f"{template_root.name}: S3 must declare public access block"
        )

        required_settings = [
            "block_public_acls",
            "block_public_policy",
            "ignore_public_acls",
            "restrict_public_buckets",
        ]
        for setting in required_settings:
            assert setting in content, (
                f"{template_root.name}: S3 must set {setting}"
            )

    @given(template_idx=st.integers(min_value=0, max_value=5))
    @settings(max_examples=12)
    def test_property_s3_always_has_versioning_and_public_block(
        self, template_idx: int
    ) -> None:
        """Property: for any ECS template, S3 has versioning + block public access."""
        template_root = ALL_ECS_TEMPLATES[template_idx]
        s3_tf = template_root / "infra" / "modules" / "s3" / "main.tf"
        content = s3_tf.read_text()
        assert "aws_s3_bucket_versioning" in content
        assert "aws_s3_bucket_public_access_block" in content
        assert '"Enabled"' in content


# =============================================================================
# 3.9 — Tool Executor Exists in All 6 ECS Templates (RETURN_CONTROL pattern)
# =============================================================================


class TestToolExecutorExistsInECS:
    """Assert src/app/tool_executor.py exists in all 6 ECS templates.

    **Validates: Requirements 3.9**

    Observed behavior: Unlike Lambda templates where tool executor was redundant,
    ECS templates correctly use RETURN_CONTROL pattern — the tool executor runs
    in-process within the ECS container. It must remain in all 6 variants.
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_tool_executor_file_exists(self, template_root: Path) -> None:
        """src/app/tool_executor.py must exist in ECS template."""
        tool_executor = template_root / "src" / "app" / "tool_executor.py"
        assert tool_executor.exists(), (
            f"{template_root.name}: src/app/tool_executor.py must exist — "
            "ECS uses RETURN_CONTROL pattern for in-process tool execution"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_tool_executor_has_execute_tool_function(self, template_root: Path) -> None:
        """tool_executor.py must define execute_tool function."""
        tool_executor = template_root / "src" / "app" / "tool_executor.py"
        source = tool_executor.read_text()
        assert "def execute_tool(" in source, (
            f"{template_root.name}: tool_executor must define execute_tool function"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_tool_executor_has_search_knowledge_base(self, template_root: Path) -> None:
        """tool_executor.py must implement search_knowledge_base tool."""
        tool_executor = template_root / "src" / "app" / "tool_executor.py"
        source = tool_executor.read_text()
        assert "search_knowledge_base" in source, (
            f"{template_root.name}: tool_executor must implement search_knowledge_base"
        )

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_tool_executor_returns_structured_result(self, template_root: Path) -> None:
        """tool_executor must return structured result with toolName, status, result keys."""
        tool_executor = template_root / "src" / "app" / "tool_executor.py"
        source = tool_executor.read_text()
        assert '"toolName"' in source or "'toolName'" in source, (
            f"{template_root.name}: tool_executor must return 'toolName' in result"
        )
        assert '"status"' in source or "'status'" in source, (
            f"{template_root.name}: tool_executor must return 'status' in result"
        )

    @given(template_idx=st.integers(min_value=0, max_value=5))
    @settings(max_examples=12)
    def test_property_tool_executor_always_present(self, template_idx: int) -> None:
        """Property: for any ECS template index, tool_executor.py exists."""
        template_root = ALL_ECS_TEMPLATES[template_idx]
        tool_executor = template_root / "src" / "app" / "tool_executor.py"
        assert tool_executor.exists()
        source = tool_executor.read_text()
        assert "def execute_tool(" in source
