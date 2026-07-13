# Implementation Plan

## Overview

This plan fixes 9 convention violations across the 6 chatbot-rag ECS template variants (3 AgentCore + 3 Mantle, across REST/WS/WS-streaming), bringing them into compliance with upd8 steering conventions (ALB authentication via WAF, direct Powertools usage without intermediate wrappers, module-level SDK clients, explicit Lambda memory sizing, explicit DynamoDB encryption, least-privilege IAM, and X-Ray IAM permissions). The workflow follows the bug condition methodology: explore the bug first, preserve existing behavior, then implement and validate.

**Key ECS-specific context:**
- ECS uses FastAPI on Fargate exposed via ALB (not API Gateway)
- Authentication enforced at ALB level via WAF WebACL (not API Gateway API keys)
- Tool Executor is CORRECT in ECS (RETURN_CONTROL pattern) — no removal task needed
- OpenAI client fix applies to long-lived ECS processes (module-level instantiation avoids per-request overhead)
- Each template has a kb_sync Lambda for S3-triggered KB ingestion (same fix pattern as Lambda templates)

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Convention Violations in Chatbot RAG ECS Templates
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the violations exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected conventions - it will validate the fixes when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate each of the 9 convention violations across all 6 ECS templates
  - **Scoped PBT Approach**: For each violation, write a targeted assertion that checks the convention across all 6 templates:
    1. Parse `infra/modules/alb/main.tf` in all 6 templates, assert an `authenticate-*` action or WAF WebACL association exists on the ALB listener (will fail — no auth exists)
    2. Parse `src/app/*.py` files in all 6 templates, assert no `from app.logging_config import` statements exist — only direct `from aws_lambda_powertools import Logger` (will fail — all use wrapper)
    3. Parse `src/kb_sync/handler.py` in all 6 templates, assert no `from shared.logging_config import` — only direct Powertools import (will fail — all use shared wrapper)
    4. Parse `src/app/ai_caller.py` in 3 Mantle templates, assert `OpenAI(` instantiation is NOT inside any function body (will fail — client created per request)
    5. Parse `infra/modules/lambda/kb_sync/lambda.tf` in all 6 templates, assert `memory_size` attribute exists on the Lambda resource (will fail — no memory_size declared)
    6. Parse `infra/modules/dynamodb/main.tf` in all 6 templates, assert `server_side_encryption` block is present (will fail — no explicit encryption)
    7. Parse `infra/modules/ecs/iam.tf` in all 6 templates, assert `task_bedrock` policy does NOT use `Resource = "*"` (will fail — all use wildcard)
    8. Parse `infra/modules/lambda/kb_sync/iam.tf` in all 6 templates, assert `bedrock:StartIngestionJob` is NOT scoped to `["*"]` (will fail — all use wildcard)
    9. Parse `infra/modules/lambda/kb_sync/iam.tf` in all 6 templates, assert `xray:PutTraceSegments` and `xray:PutTelemetryData` permissions exist (will fail — no X-Ray permissions)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves all 9 violations exist in all 6 ECS templates)
  - Document counterexamples found to understand each violation's current state
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Functional Behavior Unchanged After ECS Fixes
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy artifacts (functional behavior):
    - Observe: ECS FastAPI orchestrator → AI Caller payload format (correlation_id, conversation_history, system_prompt, tool_definitions)
    - Observe: DynamoDB conversation history schema (partition key `userId`, message list structure)
    - Observe: ALB health check endpoint `/health` returns HTTP 200 (healthy) and HTTP 503 (shutting down)
    - Observe: Mantle tool-use loop iteration logic and MAX_TOOL_ITERATIONS termination
    - Observe: AgentCore RETURN_CONTROL tool execution — tool_executor.py deployed and called in-process
    - Observe: Terraform resource naming pattern `${var.project_name}-${var.environment}-{function}`
    - Observe: S3 RAG bucket versioning and Block Public Access settings
    - Observe: Structured JSON log fields (`timestamp`, `level`, `service`, `correlation_id`, `message`, `logType: "ai-interaction"`)
    - Observe: kb_sync Lambda calls `bedrock:StartIngestionJob` and handles `ConflictException` gracefully
  - Write property-based tests capturing observed behavior:
    1. For all orchestrator invocations, payload MUST contain correlation_id, conversation_history, system_prompt, tool_definitions in expected format
    2. For all DynamoDB writes, partition key is `userId` and message list structure is preserved
    3. For all ALB health check requests, `/health` returns correct status codes
    4. For all Mantle tool-use iterations, loop terminates correctly at MAX_TOOL_ITERATIONS
    5. For all AgentCore RETURN_CONTROL flows, tool_executor.py is present and functional in all 6 templates
    6. For all Terraform resources, names follow `${var.project_name}-${var.environment}-{function}` pattern
    7. S3 RAG bucket retains versioning and Block Public Access in all 6 templates
    8. Log output retains required structured fields after logging changes
    9. kb_sync Lambda handler continues to handle S3 events with ConflictException grace
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3. Fix 1: ALB Authentication Enforcement via WAF WebACL (all 6 templates)

  - [x] 3.1 Create WAF WebACL module with API key header rule
    - Create `infra/modules/waf/main.tf` with `aws_wafv2_web_acl` resource
    - Add rule matching `x-api-key` header against a stored secret value (SSM parameter reference)
    - Add URI path exclusion for `/health` endpoint (ALB health checks don't pass custom headers)
    - Default action: Block (requests without valid API key are rejected with 403)
    - Add `aws_wafv2_web_acl_association` resource linking the WebACL to the ALB ARN
    - Create `infra/modules/waf/variables.tf` with `waf_enabled` (bool, default true), `api_key_value` (SSM reference), `alb_arn`
    - Create `infra/modules/waf/outputs.tf` with WebACL ARN output
    - _Bug_Condition: artifact.alb_listener_forwards_without_auth_
    - _Expected_Behavior: WAF WebACL blocks requests without valid x-api-key header, excludes /health_
    - _Preservation: /health endpoint remains accessible without auth for ALB health checks (3.5)_
    - _Requirements: 2.1, 3.5_

  - [x] 3.2 Wire WAF module into all 6 ECS template root Terraform
    - In each template's root `main.tf`, add module invocation for WAF passing ALB ARN
    - Ensure WAF module depends on ALB module (ALB must exist before association)
    - Apply consistently across all 6 templates (agentcore-ecs, agentcore-ecs-ws, agentcore-ecs-ws-streaming, mantle-ecs, mantle-ecs-ws, mantle-ecs-ws-streaming)
    - _Requirements: 2.1_

- [x] 4. Fix 2: ECS App Logging — Remove Wrapper (all 6 templates)

  - [x] 4.1 Replace logging wrapper imports with direct Powertools Logger in all ECS app modules
    - In each module (`src/app/main.py`, `src/app/orchestrator.py`, `src/app/ai_caller.py`, `src/app/tool_executor.py`, `src/app/conversation_context.py`):
      - Replace `from app.logging_config import get_logger` with:
        ```python
        from aws_lambda_powertools import Logger
        logger = Logger(service="module_name")
        ```
      - Replace `from app.logging_config import get_logger, log_ai_interaction` with direct Logger usage
      - Inline `log_ai_interaction` logic (structured log with `logType: "ai-interaction"` and token fields) directly in the AI caller module
    - Ensure structured log fields (`logType: "ai-interaction"`, token counts, latency) remain identical in output
    - Apply across all 6 ECS templates
    - _Bug_Condition: artifact.ecs_app_uses_logging_config_wrapper_
    - _Expected_Behavior: Direct Powertools Logger at module level, no intermediate wrapper_
    - _Preservation: Structured JSON log fields and logType: "ai-interaction" remain present (3.4)_
    - _Requirements: 2.2, 3.4_

  - [x] 4.2 Remove `src/app/logging_config.py` from all 6 ECS templates
    - Delete the wrapper file from all 6 templates
    - Verify no remaining imports reference `app.logging_config`
    - _Requirements: 2.2_

- [x] 5. Fix 3: kb_sync Lambda Logging — Remove Shared Wrapper (all 6 templates)

  - [x] 5.1 Replace shared logging wrapper with direct Powertools import in kb_sync handler
    - In `src/kb_sync/handler.py` (all 6 templates):
      - Replace `from shared.logging_config import get_logger` with:
        ```python
        from aws_lambda_powertools import Logger
        logger = Logger()
        ```
      - Retain `@logger.inject_lambda_context` decorator on handler function
    - The shared layer can remain for other utilities but the logging import must be direct
    - Apply consistently across all 6 templates
    - _Bug_Condition: artifact.kb_sync_lambda_uses_shared_logging_wrapper_
    - _Expected_Behavior: Direct Powertools Logger import, no intermediate wrapper_
    - _Preservation: kb_sync handler continues to call StartIngestionJob and handle ConflictException (3.7)_
    - _Requirements: 2.3, 3.7_

- [x] 6. Fix 4: Module-Level OpenAI Client (3 Mantle ECS variants)

  - [x] 6.1 Move OpenAI client instantiation to module level in Mantle AI Caller
    - In `src/app/ai_caller.py` (mantle-ecs, mantle-ecs-ws, mantle-ecs-ws-streaming):
      - Move `client = OpenAI(base_url=MANTLE_BASE_URL, api_key="bedrock")` to module level:
        ```python
        # Module-level client — reused across all requests in the ECS container
        _client = OpenAI(
            base_url=MANTLE_BASE_URL,
            api_key="bedrock",  # AWS auth handled by SDK credentials
        )
        ```
      - Inside `invoke_mantle()`, reference `_client` instead of creating a new instance
    - This is especially impactful for ECS since containers are long-lived — the same client/connection pool serves thousands of requests
    - Apply across all 3 Mantle ECS variants
    - _Bug_Condition: artifact.mantle_ai_caller_creates_client_per_request_
    - _Expected_Behavior: Client created at module level, reused across requests within ECS container_
    - _Preservation: POST /responses call with stream=False and response structure unchanged (3.1, 3.2)_
    - _Requirements: 2.4, 3.1, 3.2_

- [x] 7. Fix 5: Explicit memory_size for kb_sync Lambda (all 6 templates)

  - [x] 7.1 Add memory_size variable and attribute to kb_sync Lambda module
    - In `infra/modules/lambda/kb_sync/variables.tf`: add `variable "memory_size"` with type `number`, description, and default `256`
    - In `infra/modules/lambda/kb_sync/lambda.tf`: add `memory_size = var.memory_size` to the `aws_lambda_function.kb_sync` resource
    - In parent module invocation: pass `memory_size = 256` explicitly
    - Apply consistently across all 6 templates
    - _Bug_Condition: artifact.kb_sync_lambda_lacks_explicit_memory_size_
    - _Expected_Behavior: Explicit memory_size = 256 declared, configurable via variable_
    - _Preservation: Resource naming pattern ${var.project_name}-${var.environment}-{function} unchanged (3.6)_
    - _Requirements: 2.5, 3.6_

- [x] 8. Fix 6: Explicit DynamoDB Encryption (all 6 templates)

  - [x] 8.1 Add server_side_encryption block to DynamoDB table resource
    - In `infra/modules/dynamodb/main.tf` (all 6 templates):
      - Add `server_side_encryption { enabled = true }` block to `aws_dynamodb_table.user_context`
    - This declares encryption explicitly for auditability — AWS already encrypts by default with AWS-owned key, but explicit declaration satisfies convention
    - Apply consistently across all 6 templates
    - _Bug_Condition: artifact.dynamodb_table_lacks_explicit_encryption_
    - _Expected_Behavior: Explicit server_side_encryption block present for auditability_
    - _Preservation: DynamoDB table schema (partition key userId, message list structure) unchanged (3.3)_
    - _Requirements: 2.6, 3.3_

- [x] 9. Fix 7: Scoped ECS Task Role Bedrock IAM (all 6 templates)

  - [x] 9.1 Scope Bedrock IAM policy in ECS task role to specific resource ARNs
    - In `infra/modules/ecs/iam.tf` (all 6 templates):
      - **AgentCore variants** (3 templates): Replace `Resource = "*"` with scoped agent ARN:
        ```hcl
        Resource = [
          "arn:aws:bedrock:${var.aws_region}:${var.account_id}:agent/${var.agent_id}",
          "arn:aws:bedrock:${var.aws_region}:${var.account_id}:agent-alias/${var.agent_id}/${var.agent_alias_id}",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.model_id}",
        ]
        ```
      - **Mantle variants** (3 templates): Replace `Resource = "*"` with scoped model ARN:
        ```hcl
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.model_id}",
        ]
        ```
    - Add corresponding variables (`agent_id`, `agent_alias_id`, `model_id`, `aws_region`, `account_id`) to `infra/modules/ecs/variables.tf`
    - _Bug_Condition: artifact.ecs_task_role_uses_wildcard_for_bedrock_
    - _Expected_Behavior: Resource scoped to specific agent/model ARNs following least-privilege_
    - _Preservation: ECS task continues to invoke Bedrock successfully with scoped permissions (3.1, 3.2)_
    - _Requirements: 2.7, 3.1, 3.2_

- [x] 10. Fix 8: Scoped kb_sync Lambda Bedrock IAM (all 6 templates)

  - [x] 10.1 Scope kb_sync Lambda IAM to specific Knowledge Base ARN
    - In `infra/modules/lambda/kb_sync/iam.tf` (all 6 templates):
      - Replace `resources = ["*"]` with:
        ```hcl
        resources = [
          "arn:aws:bedrock:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:knowledge-base/${var.knowledge_base_id}"
        ]
        ```
      - Add `data "aws_region" "current" {}` and `data "aws_caller_identity" "current" {}` data sources (or use existing variables)
    - Apply consistently across all 6 templates
    - _Bug_Condition: artifact.kb_sync_iam_uses_wildcard_for_bedrock_
    - _Expected_Behavior: Resource scoped to specific Knowledge Base ARN following least-privilege_
    - _Preservation: kb_sync Lambda continues to call StartIngestionJob successfully (3.7)_
    - _Requirements: 2.8, 3.7_

- [x] 11. Fix 9: X-Ray IAM Permissions for kb_sync Lambda (all 6 templates)

  - [x] 11.1 Add X-Ray permissions to kb_sync Lambda execution role
    - In `infra/modules/lambda/kb_sync/iam.tf` (all 6 templates):
      - Add IAM policy statement:
        ```hcl
        data "aws_iam_policy_document" "kb_sync_xray" {
          statement {
            effect    = "Allow"
            actions   = ["xray:PutTraceSegments", "xray:PutTelemetryData"]
            resources = ["*"]
          }
        }

        resource "aws_iam_role_policy" "kb_sync_xray" {
          name   = "${var.project_name}-${var.environment}-kb-sync-xray"
          role   = aws_iam_role.kb_sync.id
          policy = data.aws_iam_policy_document.kb_sync_xray.json
        }
        ```
      - `Resource = ["*"]` is required by X-Ray service design (traces are not scoped to specific ARNs)
    - Apply consistently across all 6 templates
    - _Bug_Condition: artifact.kb_sync_lambda_role_lacks_xray_permissions_
    - _Expected_Behavior: Lambda role includes explicit X-Ray IAM permissions_
    - _Preservation: Existing tracing mode settings unchanged_
    - _Requirements: 2.9_

- [x] 12. Verify fixes and run full validation

  - [x] 12.1 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - All Convention Violations Resolved in ECS Templates
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected conventions
    - When this test passes, it confirms all 9 violations are resolved across all 6 ECS templates
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms all bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 12.2 Verify preservation tests still pass
    - **Property 2: Preservation** - Functional Behavior Still Intact Across All 6 Templates
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all functional behaviors preserved after all 9 fixes across all 6 ECS templates
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 12.3 Run full test suite on all 6 ECS templates
    - Run `uv run pytest` in each template — all tests must pass
    - Run `terraform validate` on each template's `infra/` directory
    - Run `ruff check .` on each template's Python code
    - Verify consistency: same fix patterns applied identically across all 6 templates

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All 9 fixes must be applied consistently across all 6 ECS templates (chatbot-rag-agentcore-ecs, chatbot-rag-agentcore-ecs-ws, chatbot-rag-agentcore-ecs-ws-streaming, chatbot-rag-mantle-ecs, chatbot-rag-mantle-ecs-ws, chatbot-rag-mantle-ecs-ws-streaming).
- Tool Executor is NOT a violation in ECS — it remains deployed and used via RETURN_CONTROL in all 6 templates. No removal task exists here (unlike the Lambda template fixes).
- ALB auth uses WAF WebACL (replaces the API Gateway API key approach from Lambda templates).
- OpenAI client fix (Fix 4) applies only to the 3 Mantle variants.
- Scoped ECS Bedrock IAM (Fix 7) differs between AgentCore (agent ARN) and Mantle (model ARN) variants.
- Exploration test (task 1) and preservation tests (task 2) MUST be written and run BEFORE any fix implementation begins.
- All Terraform changes must pass `terraform fmt` and `terraform validate` before being considered complete.
- Python changes must pass `ruff check .` and `ruff format --check .`.
- Property-based tests use observation-first methodology: observe behavior on unfixed code, then encode as properties.
