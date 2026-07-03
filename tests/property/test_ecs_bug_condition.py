"""Bug Condition Exploration Tests — Convention Violations in Chatbot RAG ECS Templates.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9**

Property 1: Bug Condition — Convention Violations in Chatbot RAG ECS Templates

These tests are EXPECTED TO FAIL on unfixed code. Failure confirms the violations exist.
Each test encodes the expected convention — when all bugs are fixed, all tests pass.

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

import pytest

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


# =============================================================================
# Violation 1 — ALB Listener Forwards Without Auth (No WAF or authenticate-* action)
# =============================================================================


class TestAlbAuthEnforcement:
    """Assert that ALB/NLB listener has authentication mechanism (WAF or authenticate-* action).

    **Validates: Requirements 1.1**

    REST ECS variants use ALB — check for WAF WebACL or authenticate-* action.
    WS ECS variants use NLB + API Gateway — check for WAF WebACL association
    on either the NLB infra or the root infra (waf module).
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_load_balancer_has_auth_mechanism(self, template_root: Path) -> None:
        """Load balancer MUST have authenticate-* action or associated WAF WebACL."""
        # Determine if this is an ALB or NLB-based template
        alb_dir = template_root / "infra" / "modules" / "alb"
        nlb_dir = template_root / "infra" / "modules" / "nlb"

        has_authenticate_action = False
        has_waf_association = False

        if alb_dir.exists():
            # REST variant: check ALB module for auth
            for tf_file in alb_dir.glob("*.tf"):
                tf_content = tf_file.read_text()
                if re.search(r'type\s*=\s*"authenticate-(oidc|cognito)"', tf_content):
                    has_authenticate_action = True
                if "aws_wafv2_web_acl_association" in tf_content:
                    has_waf_association = True
        elif nlb_dir.exists():
            # WS variant: NLB itself doesn't support WAF — check for WAF module
            # WAF in WS variants would be on API Gateway or as a separate module
            pass

        # Check for WAF module at infra/modules/waf/ level
        waf_dir = template_root / "infra" / "modules" / "waf"
        if waf_dir.exists():
            for tf_file in waf_dir.glob("*.tf"):
                tf_content = tf_file.read_text()
                if "aws_wafv2_web_acl" in tf_content:
                    has_waf_association = True
                    break

        # Check root-level infra .tf files for WAF references
        infra_dir = template_root / "infra"
        for tf_file in infra_dir.glob("*.tf"):
            tf_content = tf_file.read_text()
            if "aws_wafv2_web_acl_association" in tf_content:
                has_waf_association = True
                break

        # Check environment-level infra if it exists
        env_dir = template_root / "infra" / "environment"
        if env_dir.exists():
            for tf_file in env_dir.rglob("*.tf"):
                tf_content = tf_file.read_text()
                if "aws_wafv2_web_acl_association" in tf_content:
                    has_waf_association = True
                    break

        assert has_authenticate_action or has_waf_association, (
            f"{template_root.name}: Load balancer forwards traffic without any "
            "authentication mechanism. Expected authenticate-oidc/cognito action "
            "or WAF WebACL association."
        )


# =============================================================================
# Violation 2 — ECS App Modules Use logging_config Wrapper
# =============================================================================


class TestEcsAppDirectPowertoolsImport:
    """Assert ECS app modules use direct Powertools Logger, not app.logging_config wrapper.

    **Validates: Requirements 1.2**
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_no_app_logging_config_import(self, template_root: Path) -> None:
        """No src/app/*.py file should import from app.logging_config."""
        app_dir = template_root / "src" / "app"
        assert app_dir.exists(), f"src/app/ not found in {template_root.name}"

        violations: list[str] = []
        for py_file in app_dir.glob("*.py"):
            content = py_file.read_text()
            if "from app.logging_config import" in content:
                violations.append(py_file.name)

        assert len(violations) == 0, (
            f"{template_root.name}: The following src/app/ modules still import "
            f"from app.logging_config: {violations}. "
            "Convention requires direct `from aws_lambda_powertools import Logger`."
        )


# =============================================================================
# Violation 3 — kb_sync Lambda Uses shared.logging_config Wrapper
# =============================================================================


class TestKbSyncDirectPowertoolsImport:
    """Assert kb_sync handler uses direct Powertools import, not shared.logging_config.

    **Validates: Requirements 1.3**
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_no_shared_logging_config_import(self, template_root: Path) -> None:
        """src/kb_sync/handler.py must NOT import from shared.logging_config."""
        handler_path = template_root / "src" / "kb_sync" / "handler.py"
        assert handler_path.exists(), (
            f"kb_sync handler not found at {handler_path}"
        )

        content = handler_path.read_text()

        has_shared_wrapper = (
            "from shared.logging_config import" in content
            or "import shared.logging_config" in content
        )

        assert not has_shared_wrapper, (
            f"{template_root.name}: src/kb_sync/handler.py imports from "
            "shared.logging_config wrapper. Convention requires direct "
            "`from aws_lambda_powertools import Logger`."
        )


# =============================================================================
# Violation 4 — Mantle OpenAI Client Created Inside Function Body
# =============================================================================


class TestMantleModuleLevelOpenAIClient:
    """Assert OpenAI client is instantiated at module level, not inside function.

    **Validates: Requirements 1.4**
    """

    @pytest.mark.parametrize(
        "template_root", MANTLE_ECS_TEMPLATES, ids=MANTLE_ECS_TEMPLATE_IDS
    )
    def test_openai_client_not_inside_function(self, template_root: Path) -> None:
        """OpenAI() instantiation must NOT be inside any function body in ai_caller.py."""
        ai_caller_path = template_root / "src" / "app" / "ai_caller.py"
        assert ai_caller_path.exists(), (
            f"ai_caller.py not found at {ai_caller_path}"
        )

        source = ai_caller_path.read_text()
        tree = ast.parse(source)

        # Find all function definitions and check if OpenAI( is called inside any of them
        openai_in_function = False
        function_name = ""

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for child in ast.walk(node):
                    if isinstance(child, ast.Call):
                        func = child.func
                        if isinstance(func, ast.Name) and func.id == "OpenAI":
                            openai_in_function = True
                            function_name = node.name
                            break
                        if isinstance(func, ast.Attribute) and func.attr == "OpenAI":
                            openai_in_function = True
                            function_name = node.name
                            break
                if openai_in_function:
                    break

        assert not openai_in_function, (
            f"{template_root.name}: OpenAI() client is instantiated inside "
            f"function '{function_name}' in src/app/ai_caller.py. "
            "Convention requires module-level instantiation for connection reuse "
            "across requests in long-lived ECS containers."
        )


# =============================================================================
# Violation 5 — kb_sync Lambda Lacks Explicit memory_size
# =============================================================================


class TestKbSyncExplicitMemorySize:
    """Assert kb_sync Lambda has explicit memory_size attribute in Terraform.

    **Validates: Requirements 1.5**
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_lambda_resource_has_memory_size(self, template_root: Path) -> None:
        """aws_lambda_function.kb_sync MUST declare memory_size attribute."""
        lambda_tf = (
            template_root / "infra" / "modules" / "lambda" / "kb_sync" / "lambda.tf"
        )
        assert lambda_tf.exists(), f"kb_sync lambda.tf not found at {lambda_tf}"

        content = lambda_tf.read_text()

        # Check for memory_size attribute in the Lambda resource
        has_memory_size = bool(re.search(r"\bmemory_size\b", content))

        assert has_memory_size, (
            f"{template_root.name}: infra/modules/lambda/kb_sync/lambda.tf does not "
            "declare memory_size attribute. Convention requires explicit memory_size "
            "(default 256 MB) for auditability and environment-specific tuning."
        )


# =============================================================================
# Violation 6 — DynamoDB Table Lacks Explicit server_side_encryption
# =============================================================================


class TestDynamoDBExplicitEncryption:
    """Assert DynamoDB table has explicit server_side_encryption block.

    **Validates: Requirements 1.6**
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_dynamodb_has_server_side_encryption(self, template_root: Path) -> None:
        """aws_dynamodb_table MUST have server_side_encryption block."""
        dynamodb_main = (
            template_root / "infra" / "modules" / "dynamodb" / "main.tf"
        )
        assert dynamodb_main.exists(), (
            f"DynamoDB main.tf not found at {dynamodb_main}"
        )

        content = dynamodb_main.read_text()

        has_encryption = "server_side_encryption" in content

        assert has_encryption, (
            f"{template_root.name}: infra/modules/dynamodb/main.tf does not declare "
            "server_side_encryption block. Convention requires explicit "
            "`server_side_encryption { enabled = true }` for auditability."
        )


# =============================================================================
# Violation 7 — ECS Task Role Uses Resource = "*" for Bedrock
# =============================================================================


class TestEcsBedrockIamScoped:
    """Assert ECS task role Bedrock policy does NOT use Resource = "*".

    **Validates: Requirements 1.7**
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_ecs_bedrock_policy_not_wildcard(self, template_root: Path) -> None:
        """task_bedrock policy must NOT use Resource = "*" (wildcard)."""
        ecs_iam = template_root / "infra" / "modules" / "ecs" / "iam.tf"
        assert ecs_iam.exists(), f"ECS iam.tf not found at {ecs_iam}"

        content = ecs_iam.read_text()

        # Find the task_bedrock policy block and check for wildcard resource
        # The policy uses jsonencode format: Resource = "*"
        # We need to detect wildcard in the Bedrock policy specifically

        # Strategy: look for patterns that indicate wildcard resource on Bedrock actions
        # Pattern 1: HCL style Resource = "*"
        # Pattern 2: jsonencode style "Resource": "*" or Resource = "*"
        has_wildcard_bedrock = False

        # Check for task_bedrock policy block with Resource = "*"
        if "task_bedrock" in content:
            # Extract the task_bedrock block content
            # Look for Resource = "*" pattern (HCL jsonencode style)
            bedrock_section_match = re.search(
                r'resource\s+"aws_iam_role_policy"\s+"task_bedrock"\s*\{(.*?)^\}',
                content,
                re.DOTALL | re.MULTILINE,
            )
            if bedrock_section_match:
                bedrock_section = bedrock_section_match.group(1)
                # Check for Resource = "*" (jsonencode literal)
                if re.search(r'Resource\s*=\s*"\*"', bedrock_section):
                    has_wildcard_bedrock = True
                # Check for "Resource": "*" (JSON string in jsonencode)
                if re.search(r'"Resource"\s*:\s*"\*"', bedrock_section):
                    has_wildcard_bedrock = True
                # Check for resources = ["*"] (aws_iam_policy_document style)
                if re.search(r'resources\s*=\s*\[\s*"\*"\s*\]', bedrock_section):
                    has_wildcard_bedrock = True

        assert not has_wildcard_bedrock, (
            f"{template_root.name}: infra/modules/ecs/iam.tf task_bedrock policy "
            'uses Resource = "*" (wildcard). Convention requires scoping to '
            "specific agent/model ARNs following least-privilege."
        )


# =============================================================================
# Violation 8 — kb_sync Lambda IAM Uses Wildcard for bedrock:StartIngestionJob
# =============================================================================


class TestKbSyncBedrockIamScoped:
    """Assert kb_sync Lambda IAM does NOT use wildcard for bedrock:StartIngestionJob.

    **Validates: Requirements 1.8**
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_kb_sync_bedrock_policy_not_wildcard(self, template_root: Path) -> None:
        """bedrock:StartIngestionJob must NOT be scoped to resources = ["*"]."""
        kb_sync_iam = (
            template_root / "infra" / "modules" / "lambda" / "kb_sync" / "iam.tf"
        )
        assert kb_sync_iam.exists(), f"kb_sync iam.tf not found at {kb_sync_iam}"

        content = kb_sync_iam.read_text()

        # The file uses aws_iam_policy_document with resources = ["*"]
        # Check if bedrock:StartIngestionJob action is scoped to wildcard
        has_wildcard_bedrock = False

        # Look for a statement block that contains StartIngestionJob and resources = ["*"]
        # Parse loosely: find bedrock:StartIngestionJob and check if nearby resources is ["*"]
        if "StartIngestionJob" in content:
            # Find the policy document block
            doc_match = re.search(
                r'data\s+"aws_iam_policy_document"\s+"kb_sync_permissions"\s*\{(.*?)^\}',
                content,
                re.DOTALL | re.MULTILINE,
            )
            if doc_match:
                doc_content = doc_match.group(1)
                # Check for resources = ["*"]
                if re.search(r'resources\s*=\s*\[\s*"\*"\s*\]', doc_content):
                    has_wildcard_bedrock = True

        assert not has_wildcard_bedrock, (
            f"{template_root.name}: infra/modules/lambda/kb_sync/iam.tf "
            'bedrock:StartIngestionJob is scoped to resources = ["*"]. '
            "Convention requires scoping to specific Knowledge Base ARN "
            "following least-privilege."
        )


# =============================================================================
# Violation 9 — kb_sync Lambda Role Lacks X-Ray IAM Permissions
# =============================================================================


class TestKbSyncXrayIamPermissions:
    """Assert kb_sync Lambda role includes X-Ray tracing IAM permissions.

    **Validates: Requirements 1.9**
    """

    @pytest.mark.parametrize(
        "template_root", ALL_ECS_TEMPLATES, ids=ALL_ECS_TEMPLATE_IDS
    )
    def test_kb_sync_has_xray_put_trace_segments(self, template_root: Path) -> None:
        """kb_sync IAM must include xray:PutTraceSegments permission."""
        kb_sync_iam = (
            template_root / "infra" / "modules" / "lambda" / "kb_sync" / "iam.tf"
        )
        assert kb_sync_iam.exists(), f"kb_sync iam.tf not found at {kb_sync_iam}"

        content = kb_sync_iam.read_text()

        has_xray_permission = "xray:PutTraceSegments" in content

        assert has_xray_permission, (
            f"{template_root.name}: infra/modules/lambda/kb_sync/iam.tf lacks "
            "xray:PutTraceSegments permission. Convention requires explicit X-Ray "
            "IAM permissions when tracing_config mode = Active."
        )
