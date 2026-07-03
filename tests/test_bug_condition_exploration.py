"""Bug Condition Exploration Tests — Convention Violations in Chatbot RAG Templates.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9**

Property 1: Bug Condition — Convention Violations in Chatbot RAG Templates

These tests are EXPECTED TO FAIL on unfixed code. Failure confirms the violations exist.
Each test encodes the expected convention — when all bugs are fixed, all tests pass.
"""

import ast
import json
import os
import re
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# --- Template root paths ---
TEMPLATES_ROOT = Path(__file__).resolve().parent.parent / "templates"
AGENTCORE_ROOT = TEMPLATES_ROOT / "chatbot-rag-agentcore"
MANTLE_ROOT = TEMPLATES_ROOT / "chatbot-rag-mantle"

TEMPLATE_ROOTS = [AGENTCORE_ROOT, MANTLE_ROOT]
TEMPLATE_IDS = ["agentcore", "mantle"]


# =============================================================================
# Violation 1.1 — API Key Auth Missing on POST /chat
# =============================================================================


@pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
class TestApiKeyAuthEnforcement:
    """Assert that the OpenAPI spec enforces API key authentication on POST /chat.

    **Validates: Requirements 1.1**
    """

    def test_post_chat_has_security_scheme(self, template_root: Path) -> None:
        """POST /chat operation MUST have a security scheme defined."""
        spec_path = template_root / "infra" / "openapi" / "api-spec.json"
        assert spec_path.exists(), f"api-spec.json not found at {spec_path}"

        spec = json.loads(spec_path.read_text())
        post_chat = spec.get("paths", {}).get("/chat", {}).get("post", {})

        # The operation must declare a security requirement
        security = post_chat.get("security", [])
        assert len(security) > 0, (
            f"POST /chat in {template_root.name} has no 'security' scheme — "
            "endpoint is publicly accessible without authorization"
        )

    def test_security_schemes_defined(self, template_root: Path) -> None:
        """OpenAPI spec MUST define securitySchemes (apiKey type)."""
        spec_path = template_root / "infra" / "openapi" / "api-spec.json"
        spec = json.loads(spec_path.read_text())

        # Check both OpenAPI 3.x (components.securitySchemes) and Swagger 2.0 (securityDefinitions)
        security_schemes = spec.get("components", {}).get("securitySchemes", {})
        security_definitions = spec.get("securityDefinitions", {})

        has_api_key_scheme = False
        for _name, scheme in {**security_schemes, **security_definitions}.items():
            if scheme.get("type") == "apiKey":
                has_api_key_scheme = True
                break

        assert has_api_key_scheme, (
            f"{template_root.name}/api-spec.json has no apiKey security scheme defined"
        )


# =============================================================================
# Violation 1.2 — Tool Executor Exists in AgentCore Template
# =============================================================================


class TestToolExecutorAbsenceAgentcore:
    """Assert that AgentCore template does NOT deploy a Tool Executor Lambda.

    **Validates: Requirements 1.2**
    """

    def test_tool_executor_directory_does_not_exist(self) -> None:
        """src/tool_executor/ directory must NOT exist in AgentCore template."""
        tool_executor_dir = AGENTCORE_ROOT / "src" / "tool_executor"
        assert not tool_executor_dir.exists(), (
            f"AgentCore template still has {tool_executor_dir} — "
            "Tool Executor is redundant because Bedrock KB integrates natively with AgentCore"
        )


# =============================================================================
# Violation 1.3 — Shared Logging Wrapper Used Instead of Direct Powertools
# =============================================================================


class TestDirectPowertoolsUsage:
    """Assert handlers use direct aws_lambda_powertools imports, not shared.logging_config.

    **Validates: Requirements 1.3**
    """

    @staticmethod
    def _find_handler_files(template_root: Path) -> list[Path]:
        """Find all handler.py files in src/ directories."""
        handlers = []
        src_dir = template_root / "src"
        if src_dir.exists():
            for handler_path in src_dir.rglob("handler.py"):
                handlers.append(handler_path)
        return handlers

    @pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
    def test_no_shared_logging_config_import(self, template_root: Path) -> None:
        """No handler should import from shared.logging_config."""
        handlers = self._find_handler_files(template_root)
        assert len(handlers) > 0, f"No handler files found in {template_root.name}"

        violations = []
        for handler_path in handlers:
            content = handler_path.read_text()
            if "from shared.logging_config" in content or "import shared.logging_config" in content:
                rel_path = handler_path.relative_to(template_root)
                violations.append(str(rel_path))

        assert len(violations) == 0, (
            f"{template_root.name} handlers still use shared.logging_config wrapper: "
            f"{violations}. Convention requires direct aws_lambda_powertools imports."
        )


# =============================================================================
# Violation 1.4 — OpenAI Client Created Inside Handler (Mantle AI Caller)
# =============================================================================


class TestModuleLevelOpenAIClient:
    """Assert that OpenAI client is instantiated at module level, not inside handler.

    **Validates: Requirements 1.4**
    """

    def test_openai_client_not_inside_handler_function(self) -> None:
        """OpenAI() instantiation must NOT be inside a function body in Mantle ai_caller."""
        handler_path = MANTLE_ROOT / "src" / "ai_caller" / "handler.py"
        assert handler_path.exists(), f"Mantle AI Caller handler not found at {handler_path}"

        source = handler_path.read_text()
        tree = ast.parse(source)

        # Find all function definitions and check if OpenAI( is instantiated inside any of them
        openai_in_function = False
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # Walk the function body for OpenAI( calls
                for child in ast.walk(node):
                    if isinstance(child, ast.Call):
                        func = child.func
                        # Check for OpenAI(...) call
                        if isinstance(func, ast.Name) and func.id == "OpenAI":
                            openai_in_function = True
                            break
                        if isinstance(func, ast.Attribute) and func.attr == "OpenAI":
                            openai_in_function = True
                            break
                if openai_in_function:
                    break

        assert not openai_in_function, (
            "Mantle ai_caller/handler.py creates OpenAI client inside a function body. "
            "Convention requires module-level instantiation for TCP connection reuse across warm starts."
        )


# =============================================================================
# Violation 1.5 — Lambda Module Lacks Explicit memory_size Variable
# =============================================================================


@pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
class TestExplicitMemorySize:
    """Assert that Lambda Terraform modules declare an explicit memory_size variable.

    **Validates: Requirements 1.5**
    """

    def test_lambda_variables_declares_memory_size(self, template_root: Path) -> None:
        """At least one Lambda module variables.tf must declare a memory_size variable."""
        lambda_modules_dir = template_root / "infra" / "modules" / "lambda"
        assert lambda_modules_dir.exists(), f"Lambda modules dir not found: {lambda_modules_dir}"

        # Check all variables.tf files inside lambda module subdirectories
        found_memory_size = False
        for variables_tf in lambda_modules_dir.rglob("variables.tf"):
            content = variables_tf.read_text()
            # Look for variable "memory_size" declaration
            if re.search(r'variable\s+"memory_size"', content):
                found_memory_size = True
                break

        assert found_memory_size, (
            f"{template_root.name} Lambda modules do not declare a 'memory_size' variable. "
            "Convention requires explicit memory_size (512 for AI Lambdas, 256 for utilities)."
        )


# =============================================================================
# Violation 1.6 — Storage Resources Lack Explicit Encryption
# =============================================================================


@pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
class TestExplicitEncryption:
    """Assert that S3, DynamoDB, and SQS modules have explicit encryption configuration.

    **Validates: Requirements 1.6**
    """

    def test_s3_has_encryption_configuration(self, template_root: Path) -> None:
        """S3 module must have aws_s3_bucket_server_side_encryption_configuration."""
        s3_main = template_root / "infra" / "modules" / "s3" / "main.tf"
        assert s3_main.exists(), f"S3 module main.tf not found: {s3_main}"

        content = s3_main.read_text()
        assert "aws_s3_bucket_server_side_encryption_configuration" in content, (
            f"{template_root.name} S3 module lacks explicit encryption configuration. "
            "Convention requires aws_s3_bucket_server_side_encryption_configuration resource."
        )

    def test_dynamodb_has_encryption_configuration(self, template_root: Path) -> None:
        """DynamoDB module must have server_side_encryption block."""
        dynamodb_main = template_root / "infra" / "modules" / "dynamodb" / "main.tf"
        assert dynamodb_main.exists(), f"DynamoDB module main.tf not found: {dynamodb_main}"

        content = dynamodb_main.read_text()
        assert "server_side_encryption" in content, (
            f"{template_root.name} DynamoDB module lacks explicit encryption configuration. "
            "Convention requires server_side_encryption {{ enabled = true }} block."
        )

    def test_sqs_has_encryption_configuration(self, template_root: Path) -> None:
        """SQS module must have sqs_managed_sse_enabled or kms_master_key_id."""
        sqs_main = template_root / "infra" / "modules" / "sqs" / "main.tf"
        assert sqs_main.exists(), f"SQS module main.tf not found: {sqs_main}"

        content = sqs_main.read_text()
        has_sse = "sqs_managed_sse_enabled" in content or "kms_master_key_id" in content
        assert has_sse, (
            f"{template_root.name} SQS module lacks explicit encryption configuration. "
            "Convention requires sqs_managed_sse_enabled = true or kms_master_key_id."
        )


# =============================================================================
# Violation 1.7 — IAM Policy Uses Wildcard Resource for s3vectors
# =============================================================================


class TestIAMScopingS3Vectors:
    """Assert that s3vectors IAM policy does not use Resource = ["*"].

    **Validates: Requirements 1.7**
    """

    def test_bedrock_kb_s3vectors_policy_scoped(self) -> None:
        """Bedrock KB s3vectors IAM policy must NOT use Resource = ["*"]."""
        # Check all .tf files in bedrock_kb module for wildcard resource on s3vectors
        bedrock_kb_dir = AGENTCORE_ROOT / "infra" / "modules" / "bedrock_kb"
        assert bedrock_kb_dir.exists(), f"bedrock_kb module not found: {bedrock_kb_dir}"

        has_wildcard_on_s3vectors = False
        for tf_file in bedrock_kb_dir.glob("*.tf"):
            content = tf_file.read_text()
            # Look for s3vectors actions followed by Resource = ["*"]
            if "s3vectors" in content.lower():
                # Find blocks containing s3vectors actions and check their Resource
                # Simple heuristic: if we see s3vectors AND Resource = ["*"] in the same policy
                lines = content.split("\n")
                in_s3vectors_block = False
                brace_depth = 0
                for line in lines:
                    if "s3vectors" in line.lower():
                        in_s3vectors_block = True
                    if in_s3vectors_block:
                        brace_depth += line.count("{") + line.count("[")
                        brace_depth -= line.count("}") + line.count("]")
                        # Check for Resource = ["*"]
                        if re.search(r'Resource\s*=\s*\[\s*"\*"\s*\]', line, re.IGNORECASE):
                            has_wildcard_on_s3vectors = True
                            break
                        if re.search(r'"Resource"\s*:\s*\[\s*"\*"\s*\]', line):
                            has_wildcard_on_s3vectors = True
                            break

        assert not has_wildcard_on_s3vectors, (
            "AgentCore bedrock_kb module uses Resource = [\"*\"] on s3vectors statements. "
            "Convention requires scoping to specific vector store bucket ARN for least-privilege."
        )


# =============================================================================
# Violation 1.8 — Lambda Role Lacks Explicit X-Ray Permissions
# =============================================================================


@pytest.mark.parametrize("template_root", TEMPLATE_ROOTS, ids=TEMPLATE_IDS)
class TestXRayIAMPermissions:
    """Assert that Lambda execution roles include X-Ray tracing IAM permissions.

    **Validates: Requirements 1.8**
    """

    def test_lambda_role_has_xray_permissions(self, template_root: Path) -> None:
        """Lambda IAM policies must include xray:PutTraceSegments and xray:PutTelemetryData."""
        lambda_modules_dir = template_root / "infra" / "modules" / "lambda"
        assert lambda_modules_dir.exists(), f"Lambda modules dir not found: {lambda_modules_dir}"

        # Search all .tf files in lambda modules for xray permissions
        has_put_trace_segments = False
        has_put_telemetry_data = False

        for tf_file in lambda_modules_dir.rglob("*.tf"):
            content = tf_file.read_text()
            if "xray:PutTraceSegments" in content:
                has_put_trace_segments = True
            if "xray:PutTelemetryData" in content:
                has_put_telemetry_data = True

        assert has_put_trace_segments and has_put_telemetry_data, (
            f"{template_root.name} Lambda execution roles lack explicit X-Ray permissions. "
            f"Found xray:PutTraceSegments={has_put_trace_segments}, "
            f"xray:PutTelemetryData={has_put_telemetry_data}. "
            "Convention requires both permissions for X-Ray tracing."
        )


# =============================================================================
# Violation 1.9 — Stale test_tool_executor.py in AgentCore Template
# =============================================================================


class TestStaleToolExecutorTests:
    """Assert that test_tool_executor.py does NOT exist in AgentCore template.

    **Validates: Requirements 1.9**
    """

    def test_tool_executor_test_file_does_not_exist(self) -> None:
        """tests/test_tool_executor.py must NOT exist in AgentCore template."""
        test_file = AGENTCORE_ROOT / "tests" / "test_tool_executor.py"
        assert not test_file.exists(), (
            f"AgentCore template still has {test_file}. "
            "This test file references a component (Tool Executor) that should be removed."
        )


# =============================================================================
# Property-based test: Parametric checking across all templates
# =============================================================================


@given(template_idx=st.sampled_from([0, 1]))
@settings(max_examples=10)
def test_property_all_templates_should_enforce_api_key(template_idx: int) -> None:
    """Property: For any template in the set, POST /chat must enforce API key auth.

    **Validates: Requirements 1.1**
    """
    template_root = TEMPLATE_ROOTS[template_idx]
    spec_path = template_root / "infra" / "openapi" / "api-spec.json"
    spec = json.loads(spec_path.read_text())
    post_chat = spec.get("paths", {}).get("/chat", {}).get("post", {})
    security = post_chat.get("security", [])
    assert len(security) > 0, f"{template_root.name}: POST /chat has no security scheme"


@given(template_idx=st.sampled_from([0, 1]))
@settings(max_examples=10)
def test_property_no_shared_logging_wrapper(template_idx: int) -> None:
    """Property: For any template, handlers must NOT import shared.logging_config.

    **Validates: Requirements 1.3**
    """
    template_root = TEMPLATE_ROOTS[template_idx]
    src_dir = template_root / "src"
    violations = []
    for handler_path in src_dir.rglob("handler.py"):
        content = handler_path.read_text()
        if "from shared.logging_config" in content:
            violations.append(str(handler_path.relative_to(template_root)))
    assert len(violations) == 0, (
        f"{template_root.name}: handlers use shared.logging_config: {violations}"
    )
