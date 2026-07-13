# Implementation Plan

## Overview

This plan fixes 9 convention violations in the `chatbot-rag-agentcore` and `chatbot-rag-mantle` templates, bringing them into compliance with upd8 steering conventions (API key auth, least-privilege IAM, explicit encryption, direct Powertools usage, module-level SDK clients, explicit Lambda memory sizing, and removal of the redundant Tool Executor in AgentCore). The workflow follows the bug condition methodology: explore the bug first, preserve existing behavior, then implement and validate.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Convention Violations in Chatbot RAG Templates
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the violations exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected conventions - it will validate the fixes when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate each of the 9 convention violations
  - **Scoped PBT Approach**: For each violation, write a targeted assertion that checks the convention:
    1. Parse `api-spec.json` in both templates, assert `security` scheme exists on `POST /chat` endpoint
    2. Assert `src/tool_executor/` directory does NOT exist in AgentCore template
    3. Parse handler files in both templates, assert no import from `shared.logging_config` — only direct `aws_lambda_powertools` imports
    4. Parse `src/ai_caller/handler.py` (Mantle), assert `OpenAI(` instantiation is NOT inside the handler function body
    5. Parse `infra/modules/lambda/variables.tf`, assert `memory_size` variable is declared
    6. Parse `infra/modules/s3/main.tf`, `infra/modules/dynamodb/main.tf`, `infra/modules/sqs/main.tf`, assert explicit encryption configuration present
    7. Parse `infra/modules/bedrock_kb/` IAM policy, assert no `Resource = ["*"]` on s3vectors statements
    8. Parse Lambda execution role IAM, assert `xray:PutTraceSegments` and `xray:PutTelemetryData` permissions exist
    9. Assert `tests/test_tool_executor.py` does NOT exist in AgentCore template
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves all 9 violations exist)
  - Document counterexamples found to understand each violation's current state
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Functional Behavior Unchanged After Fixes
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy artifacts (functional behavior):
    - Observe: Orchestrator → AI Caller payload format (correlation_id, conversation_history, system_prompt, tool_definitions)
    - Observe: DynamoDB conversation history schema (partition key `userId`, message list structure)
    - Observe: API Gateway response body structure for successful chat requests
    - Observe: Mantle tool-use loop iteration logic and max-iteration termination
    - Observe: Terraform resource naming pattern `{prefix}-{function}`
    - Observe: Mantle Tool Executor Lambda exists and is configured
    - Observe: S3 RAG bucket versioning and Block Public Access settings
    - Observe: Structured JSON log fields (`timestamp`, `level`, `service`, `correlation_id`, `message`, `logType: "ai-interaction"`)
  - Write property-based tests capturing observed behavior:
    1. For all orchestrator invocations, payload MUST contain correlation_id, conversation_history, system_prompt, tool_definitions in expected format
    2. For all DynamoDB writes, partition key is `userId` and message list structure is preserved
    3. For all API responses, body structure matches observed format
    4. For all Mantle tool-use iterations, loop terminates correctly at max iterations
    5. For all Terraform resources, names follow `{prefix}-{function}` pattern
    6. Mantle template still deploys Tool Executor Lambda
    7. S3 RAG bucket retains versioning and Block Public Access
    8. Log output retains required structured fields
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3. Fix 1: API Key Enforcement (both templates)

  - [x] 3.1 Add API key authentication to OpenAPI specs and Terraform
    - In `api-spec.json` (both templates): add `x-amazon-apigateway-api-key-source: HEADER` at top level
    - Add `securityDefinitions` / `components.securitySchemes` entry for `api_key` (type `apiKey`, in `header`, name `x-api-key`)
    - Add `security: [{ api_key: [] }]` to the `POST /chat` operation
    - In Terraform: provision `aws_api_gateway_api_key`, `aws_api_gateway_usage_plan`, and `aws_api_gateway_usage_plan_key` resources associated with the API stage
    - _Bug_Condition: artifact.openapi_endpoint_lacks_api_key_auth_
    - _Expected_Behavior: API key required on /chat, Terraform provisions key + usage plan_
    - _Preservation: API Gateway request validation (userId, message) continues to work (3.4)_
    - _Requirements: 2.1, 3.4_

- [x] 4. Fix 2: Tool Executor Removal + Native KB (AgentCore only)

  - [x] 4.1 Remove Tool Executor Lambda from AgentCore template
    - Remove Tool Executor Lambda module invocation from Terraform (`infra/modules/lambda/` for tool_executor)
    - Remove associated IAM role, policy, and CloudWatch log group for tool_executor
    - Remove `src/tool_executor/` directory from AgentCore template
    - Update any orchestrator references that invoke tool_executor (if direct invocation exists)
    - _Bug_Condition: artifact.agentcore_deploys_tool_executor_lambda_
    - _Expected_Behavior: No Tool Executor Lambda deployed in AgentCore_
    - _Preservation: Mantle Tool Executor continues to exist and function (3.1)_
    - _Requirements: 2.2, 3.1_

  - [x] 4.2 Configure Bedrock KB as native action group in AgentCore
    - In AgentCore module, configure `aws_bedrockagent_agent_action_group` with `action_group_executor` set to Knowledge Base
    - Verify KB retrieval works without Lambda hop
    - _Bug_Condition: artifact.agentcore_deploys_tool_executor_lambda_
    - _Expected_Behavior: AgentCore uses native KB retrieval as action group_
    - _Requirements: 2.2_

- [x] 5. Fix 3: Logging Unification (both templates)

  - [x] 5.1 Replace shared logging wrapper with direct Powertools imports
    - In all handlers (`src/orchestrator/`, `src/ai_caller/`, `src/responses_reader/`, `src/kb_sync/`, `src/tool_executor/` Mantle only):
      - Replace `from shared.logging_config import setup_logging` with:
        ```python
        from aws_lambda_powertools import Logger, Tracer
        logger = Logger()
        tracer = Tracer()
        ```
      - Apply `@logger.inject_lambda_context` and `@tracer.capture_lambda_handler` decorators to handlers
    - Remove `logging_config.py` from shared layer (keep shared layer only if other utilities exist)
    - Ensure structured log fields (`timestamp`, `level`, `service`, `correlation_id`, `message`) are preserved via Powertools config
    - _Bug_Condition: artifact.handler_uses_shared_logging_wrapper_
    - _Expected_Behavior: Direct Powertools Logger/Tracer at module level, no intermediate wrapper_
    - _Preservation: Structured JSON log fields and logType: "ai-interaction" remain present (3.9)_
    - _Requirements: 2.3, 3.9_

- [x] 6. Fix 4: Module-Level OpenAI Client (Mantle AI Caller)

  - [x] 6.1 Move OpenAI client instantiation to module level
    - In `src/ai_caller/handler.py` (Mantle template):
      - Move `OpenAI(base_url=..., api_key=...)` to module level (outside handler function)
      - Read env vars (`BEDROCK_MANTLE_ENDPOINT`, API key from Secrets Manager) at module level
      - Handler function references module-level `client` variable
    - _Bug_Condition: artifact.mantle_ai_caller_creates_client_in_handler_
    - _Expected_Behavior: Client created at module level, reused across warm starts_
    - _Preservation: POST /responses call with stream=False and response structure unchanged (3.5)_
    - _Requirements: 2.4, 3.5_

- [x] 7. Fix 5: Explicit memory_size Variable (both templates)

  - [x] 7.1 Add memory_size variable to Lambda Terraform module
    - In `infra/modules/lambda/variables.tf`: add `variable "memory_size"` with type `number`, description, and default `256`
    - In `infra/modules/lambda/main.tf`: reference `var.memory_size` in `aws_lambda_function.memory_size`
    - In module invocations: pass `memory_size = 512` for orchestrator and ai_caller, `memory_size = 256` for utility Lambdas (kb_sync, responses_reader, tool_executor in Mantle)
    - _Bug_Condition: artifact.lambda_module_lacks_explicit_memory_size_
    - _Expected_Behavior: Explicit memory_size declared, 512 for AI Lambdas, 256 for utilities_
    - _Preservation: Resource naming pattern {prefix}-{function} unchanged (3.7)_
    - _Requirements: 2.5, 3.7_

- [x] 8. Fix 6: Explicit Encryption (both templates)

  - [x] 8.1 Add explicit encryption configuration to storage resources
    - **S3** (`infra/modules/s3/main.tf`): Add `aws_s3_bucket_server_side_encryption_configuration` resource with `sse_algorithm = "aws:kms"` or `"AES256"`
    - **DynamoDB** (`infra/modules/dynamodb/main.tf`): Add `server_side_encryption { enabled = true }` block to table resource
    - **SQS** (`infra/modules/sqs/main.tf`): Add `sqs_managed_sse_enabled = true` to queue resource
    - _Bug_Condition: artifact.storage_resource_lacks_explicit_encryption_
    - _Expected_Behavior: All storage resources have explicit encryption-at-rest config_
    - _Preservation: S3 RAG bucket versioning and Block Public Access remain enabled (3.8)_
    - _Requirements: 2.6, 3.8_

- [x] 9. Fix 7: IAM Scoping for s3vectors (AgentCore template)

  - [x] 9.1 Scope s3vectors IAM policy to specific bucket ARN
    - In `infra/modules/bedrock_kb/iam.tf` (or equivalent policy document):
      - Replace `Resource = ["*"]` with `Resource = ["arn:aws:s3:::${var.project_prefix}-*-vectors", "arn:aws:s3:::${var.project_prefix}-*-vectors/*"]`
      - Ensure `project_prefix` variable is available in the module scope
    - _Bug_Condition: artifact.iam_policy_uses_wildcard_for_s3vectors_
    - _Expected_Behavior: Resource scoped to specific vector store bucket ARN pattern_
    - _Preservation: Bedrock KB still functions with scoped permissions_
    - _Requirements: 2.7_

- [x] 10. Fix 8: Explicit X-Ray IAM Permissions (both templates)

  - [x] 10.1 Add X-Ray permissions to Lambda execution roles
    - In `infra/modules/lambda/iam.tf` (or Lambda execution role definition):
      - Add IAM policy statement with `Effect = "Allow"`, `actions = ["xray:PutTraceSegments", "xray:PutTelemetryData"]`, `resources = ["*"]`
      - Attach to Lambda execution role (Resource `["*"]` is required by X-Ray service design)
    - _Bug_Condition: artifact.lambda_role_lacks_xray_permissions_
    - _Expected_Behavior: Lambda roles include explicit X-Ray IAM permissions_
    - _Preservation: Existing tracing mode settings unchanged_
    - _Requirements: 2.8_

- [x] 11. Fix 9: Test Cleanup (AgentCore template)
  - **NOTE**: This task depends on Fix 2 (task 4) — Tool Executor removal must be done first

  - [x] 11.1 Remove stale test files referencing Tool Executor
    - Delete `tests/test_tool_executor.py` from AgentCore template
    - Remove tool_executor references from integration/conftest if present
    - Verify remaining test suite passes with `uv run pytest`
    - _Bug_Condition: artifact.tests_reference_removed_tool_executor_
    - _Expected_Behavior: No stale test references, full test suite passes_
    - _Preservation: All other tests remain and pass_
    - _Requirements: 2.9_

- [x] 12. Verify fixes and run full validation

  - [x] 12.1 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - All Convention Violations Resolved
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected conventions
    - When this test passes, it confirms all 9 violations are resolved
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms all bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 12.2 Verify preservation tests still pass
    - **Property 2: Preservation** - Functional Behavior Still Intact
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all functional behaviors preserved after all 9 fixes
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 12.3 Run full test suite on both templates
    - Run `uv run pytest` in AgentCore template — all tests must pass
    - Run `uv run pytest` in Mantle template — all tests must pass
    - Run `terraform validate` on both templates' infra
    - Run `ruff check .` on both templates' Python code

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Task 11 (Test Cleanup) depends on Task 4 (Tool Executor Removal) — the Tool Executor must be removed before cleaning up its tests.
- Exploration test (task 1) and preservation tests (task 2) MUST be written and run BEFORE any fix implementation begins.
- The Mantle template's Tool Executor Lambda is NOT removed — only AgentCore's is affected by Fix 2.
- All Terraform changes must pass `terraform fmt` and `terraform validate` before being considered complete.
- Python changes must pass `ruff check .` and `ruff format --check .`.
- Property-based tests use observation-first methodology: observe behavior on unfixed code, then encode as properties.
