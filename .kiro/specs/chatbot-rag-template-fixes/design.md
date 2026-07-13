# Chatbot RAG Template Fixes - Bugfix Design

## Overview

Architecture review of the `chatbot-rag-agentcore` and `chatbot-rag-mantle` templates identified 9 violations of upd8 steering conventions (serverless, Python, Terraform). This design formalizes the bug condition — templates that deviate from established standards — and defines a minimal, targeted fix plan that brings both templates into compliance without altering their functional behavior (chat flow, AI invocation, tool-use loop, conversation storage).

## Glossary

- **Bug_Condition (C)**: Any template configuration or code that violates upd8 steering conventions (missing API key auth, redundant Lambda, indirect Powertools usage, handler-scoped SDK client, implicit memory/encryption, overly-broad IAM, missing X-Ray permissions, stale tests)
- **Property (P)**: The corrected state where each template artifact complies with the relevant upd8 convention
- **Preservation**: Existing functional behavior (chat flow, AI invocation, tool-use loop, conversation storage, response format, resource naming) that must remain unchanged after the fix
- **OpenAPI spec**: The `api-spec.json` file defining API Gateway REST API contract for each template
- **Tool Executor Lambda**: A Lambda function in the AgentCore template that invokes tools on behalf of the agent — redundant because Bedrock KB integrates natively with AgentCore action groups
- **Powertools**: `aws-lambda-powertools` Python library providing Logger, Tracer, Metrics for Lambda observability
- **bedrock-mantle**: AWS endpoint compatible with OpenAI SDK, used in the Mantle variant's AI Caller

## Bug Details

### Bug Condition

The bug manifests when template artifacts are provisioned or executed while containing convention violations. Each violation represents a distinct sub-condition; the overall bug condition is the disjunction of all nine.

**Formal Specification:**
```
FUNCTION isBugCondition(artifact)
  INPUT: artifact of type TemplateArtifact (OpenAPI spec, Terraform module, Python handler, test file)
  OUTPUT: boolean
  
  RETURN artifact.openapi_endpoint_lacks_api_key_auth
         OR artifact.agentcore_deploys_tool_executor_lambda
         OR artifact.handler_uses_shared_logging_wrapper
         OR artifact.mantle_ai_caller_creates_client_in_handler
         OR artifact.lambda_module_lacks_explicit_memory_size
         OR artifact.storage_resource_lacks_explicit_encryption
         OR artifact.iam_policy_uses_wildcard_for_s3vectors
         OR artifact.lambda_role_lacks_xray_permissions
         OR artifact.tests_reference_removed_tool_executor
END FUNCTION
```

### Examples

- **API key (1.1)**: `api-spec.json` defines `POST /chat` without `security` scheme → endpoint is publicly accessible without authorization
- **Tool Executor (1.2)**: AgentCore template's `infra/` provisions `modules/lambda/` for `tool_executor` → unnecessary Lambda hop when Bedrock KB can be associated natively
- **Logging wrapper (1.3)**: Handler does `from shared.logging_config import setup_logging` instead of `from aws_lambda_powertools import Logger`
- **Client in handler (1.4)**: `ai_caller/handler.py` calls `client = OpenAI(...)` inside `def handler(event, context)` → new TCP connection per invocation
- **Memory size (1.5)**: Lambda module Terraform has no `memory_size` variable → defaults to 128 MB, insufficient for AI workloads
- **Encryption (1.6)**: S3 module has no `aws_s3_bucket_server_side_encryption_configuration` resource → relies on implicit AWS default
- **IAM wildcard (1.7)**: `Resource = ["*"]` on s3vectors policy → violates least-privilege
- **X-Ray (1.8)**: Lambda role enables tracing mode but has no `xray:PutTraceSegments`/`xray:PutTelemetryData` statement
- **Stale tests (1.9)**: `tests/test_tool_executor.py` exists in AgentCore template after the Lambda is removed → test failures

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Mantle template's Tool Executor Lambda continues to exist and function (fix 2.2 applies only to AgentCore)
- Orchestrator → AI Caller invocation payload format (correlation_id, conversation_history, system_prompt, tool_definitions) remains the same
- DynamoDB conversation history schema (partition key `userId`, message list structure) remains unchanged
- API Gateway request validation (requiring `userId` and `message` fields) continues to work
- Mantle AI Caller's `POST /responses` call with `stream=False` and response structure remains the same
- Mantle orchestrator tool-use loop iteration logic and max-iteration termination remain unchanged
- Terraform resource naming pattern `{prefix}-{function}` continues to be used
- S3 RAG bucket versioning and Block Public Access settings remain enabled
- Structured JSON log fields (`timestamp`, `level`, `service`, `correlation_id`, `message`) and `logType: "ai-interaction"` remain present

**Scope:**
All functional behavior — request processing, AI model invocation, tool execution (Mantle), conversation storage, response delivery — is unaffected. Changes are limited to security posture, infrastructure configuration, SDK lifecycle, observability setup, and test hygiene.

## Hypothesized Root Cause

Based on the architecture review, the violations stem from:

1. **Initial template scaffolding without steering review**: Templates were created before upd8 steering conventions were fully codified, or conventions were not applied during initial development.

2. **AgentCore design predates native KB integration**: The Tool Executor was added when AgentCore required a Lambda to call Knowledge Base; Bedrock has since added native KB association as an action group, making the Lambda redundant.

3. **Shared layer pattern from older projects**: The `logging_config.py` wrapper was carried over from projects that predated Powertools adoption; the convention now requires direct Powertools usage.

4. **Python SDK anti-pattern**: Creating the OpenAI client inside the handler is a common mistake for developers unfamiliar with Lambda warm-start optimization.

5. **Terraform defaults relied upon implicitly**: AWS provides sensible defaults (128 MB memory, default encryption), but upd8 conventions require explicit declaration for auditability and environment-specific tuning.

6. **IAM policies copied from examples**: AWS documentation examples often use `Resource = ["*"]` for simplicity; these were not scoped during template creation.

7. **Missing X-Ray IAM**: Tracing was enabled on the Lambda resource but the corresponding IAM permissions were forgotten — a common oversight since X-Ray often works temporarily via broader permissions.

## Correctness Properties

Property 1: Bug Condition - Convention Compliance

_For any_ template artifact where the bug condition holds (isBugCondition returns true), the fixed template SHALL produce an artifact that satisfies the relevant upd8 convention: API key enforced, no redundant Lambda (AgentCore), direct Powertools imports, module-level SDK client, explicit memory_size, explicit encryption, scoped IAM, X-Ray permissions present, and no stale test references.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**

Property 2: Preservation - Functional Behavior Unchanged

_For any_ template artifact where the bug condition does NOT hold (functional behavior artifacts: request flow, AI invocation, tool-use loop, conversation storage, response format, resource naming), the fixed template SHALL produce identical runtime behavior, preserving all existing chat functionality, data schemas, payload formats, and naming conventions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

## Fix Implementation

### Changes Required

#### Fix 1: API Key Enforcement (both templates)

**Files**: `api-spec.json` (both templates), `infra/environment/*/main.tf` or `infra/api.tf`

**Specific Changes**:
1. Add `x-amazon-apigateway-api-key-source: HEADER` at the top level of the OpenAPI spec
2. Add a `securityDefinitions` / `components.securitySchemes` entry for `api_key` of type `apiKey`, `in: header`, `name: x-api-key`
3. Add `security: [{ api_key: [] }]` to the `POST /chat` operation
4. In Terraform, provision `aws_api_gateway_api_key`, `aws_api_gateway_usage_plan`, and `aws_api_gateway_usage_plan_key` resources associated with the API stage

#### Fix 2: Tool Executor Removal + Native KB (AgentCore only)

**Files**: AgentCore `infra/modules/lambda/` (remove tool_executor instance), `infra/modules/agentcore/`, `src/tool_executor/` (remove directory)

**Specific Changes**:
1. Remove the Tool Executor Lambda module invocation from Terraform
2. Remove associated IAM role, policy, and CloudWatch log group for tool_executor
3. In the AgentCore module, configure Bedrock Knowledge Base as a native action group via `aws_bedrockagent_agent_action_group` with `action_group_executor` set to the KB
4. Remove `src/tool_executor/` directory from the AgentCore template
5. Update any orchestrator references that invoke tool_executor (if any direct invocation exists)

#### Fix 3: Logging Unification (both templates)

**Files**: All handlers in `src/orchestrator/`, `src/ai_caller/`, `src/responses_reader/`, `src/kb_sync/`, `src/tool_executor/` (Mantle only)

**Specific Changes**:
1. Replace `from shared.logging_config import setup_logging` (or equivalent) with direct imports:
   ```python
   from aws_lambda_powertools import Logger, Tracer
   logger = Logger()
   tracer = Tracer()
   ```
2. Remove `logging_config.py` from the shared layer (or keep only if other non-logging utilities exist in shared)
3. Ensure `@logger.inject_lambda_context` and `@tracer.capture_lambda_handler` decorators are applied to handlers

#### Fix 4: Module-Level OpenAI Client (Mantle AI Caller)

**File**: `src/ai_caller/handler.py` (Mantle template)

**Specific Changes**:
1. Move `OpenAI(base_url=..., api_key=...)` instantiation to module level (outside handler function)
2. Read environment variables (`BEDROCK_MANTLE_ENDPOINT`, API key from Secrets Manager) at module level
3. Handler function references the module-level `client` variable

#### Fix 5: Explicit memory_size Variable (both templates)

**File**: `infra/modules/lambda/variables.tf`, `infra/modules/lambda/main.tf`

**Specific Changes**:
1. Add `variable "memory_size"` with type `number`, description, and default `256`
2. Reference `var.memory_size` in `aws_lambda_function.memory_size`
3. In module invocations, pass `memory_size = 512` for orchestrator and ai_caller, `memory_size = 256` for utility Lambdas (kb_sync, responses_reader, tool_executor in Mantle)

#### Fix 6: Explicit Encryption (both templates)

**Files**: `infra/modules/s3/main.tf`, `infra/modules/dynamodb/main.tf`, `infra/modules/sqs/main.tf`

**Specific Changes**:
1. **S3**: Add `aws_s3_bucket_server_side_encryption_configuration` resource with `sse_algorithm = "aws:kms"` or `"AES256"`
2. **DynamoDB**: Add `server_side_encryption { enabled = true }` block to table resource
3. **SQS**: Add `sqs_managed_sse_enabled = true` (or `kms_master_key_id` if KMS is preferred) to queue resource

#### Fix 7: IAM Scoping for s3vectors (AgentCore template)

**File**: `infra/modules/bedrock_kb/iam.tf` (or equivalent policy document)

**Specific Changes**:
1. Replace `Resource = ["*"]` with `Resource = ["arn:aws:s3:::${var.project_prefix}-*-vectors", "arn:aws:s3:::${var.project_prefix}-*-vectors/*"]`
2. Ensure the variable `project_prefix` is available in the module scope

#### Fix 8: Explicit X-Ray IAM Permissions (both templates)

**File**: `infra/modules/lambda/iam.tf` (or Lambda execution role definition)

**Specific Changes**:
1. Add an IAM policy statement:
   ```hcl
   statement {
     effect    = "Allow"
     actions   = ["xray:PutTraceSegments", "xray:PutTelemetryData"]
     resources = ["*"]
   }
   ```
2. Attach to the Lambda execution role (resource `["*"]` is required by X-Ray service design)

#### Fix 9: Test Cleanup (AgentCore template)

**Files**: `tests/test_tool_executor.py` (remove), any test importing or mocking tool_executor

**Specific Changes**:
1. Delete `tests/test_tool_executor.py` from AgentCore template
2. Remove tool_executor references from integration/conftest if present
3. Verify remaining test suite passes with `uv run pytest`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the violations on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the violations BEFORE implementing the fixes. Confirm that each violation exists in the current code.

**Test Plan**: Inspect template artifacts programmatically and assert that conventions are met. Run on UNFIXED code to observe failures.

**Test Cases**:
1. **API Key Test**: Parse `api-spec.json`, assert `security` scheme exists on `/chat` (will fail on unfixed code)
2. **Tool Executor Existence Test**: Assert `src/tool_executor/` directory does NOT exist in AgentCore template (will fail on unfixed code)
3. **Logging Import Test**: Parse handler files, assert no import from `shared.logging_config` (will fail on unfixed code)
4. **Client Scope Test**: Parse `ai_caller/handler.py`, assert `OpenAI(` is not inside handler function body (will fail on unfixed code)
5. **Memory Size Test**: Parse Lambda module Terraform, assert `memory_size` variable exists (will fail on unfixed code)
6. **Encryption Test**: Parse S3/DynamoDB/SQS modules, assert encryption configuration present (will fail on unfixed code)
7. **IAM Scope Test**: Parse s3vectors IAM policy, assert no `Resource = ["*"]` (will fail on unfixed code)
8. **X-Ray IAM Test**: Parse Lambda role, assert `xray:PutTraceSegments` permission exists (will fail on unfixed code)
9. **Stale Test Files**: Assert `tests/test_tool_executor.py` does NOT exist in AgentCore (will fail on unfixed code)

**Expected Counterexamples**:
- Each test above will fail, confirming the violation exists in the current template
- Possible additional findings: other undocumented convention violations

### Fix Checking

**Goal**: Verify that for all artifacts where the bug condition holds, the fixed template satisfies the relevant convention.

**Pseudocode:**
```
FOR ALL artifact WHERE isBugCondition(artifact) DO
  result := applyFix(artifact)
  ASSERT meetsConvention(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all artifacts where the bug condition does NOT hold, the fixed template produces the same behavior as the original.

**Pseudocode:**
```
FOR ALL artifact WHERE NOT isBugCondition(artifact) DO
  ASSERT originalBehavior(artifact) = fixedBehavior(artifact)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many input combinations (different user messages, conversation histories, tool invocations) automatically
- It catches edge cases in payload format preservation that manual tests might miss
- It provides strong guarantees that the chat flow is unchanged

**Test Plan**: Observe behavior on UNFIXED code first for chat requests, tool invocations (Mantle), and conversation storage, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Payload Format Preservation**: Verify orchestrator → AI Caller payload format remains identical after logging/client changes
2. **DynamoDB Schema Preservation**: Verify conversation storage schema unchanged after all fixes
3. **Response Format Preservation**: Verify API Gateway response body structure unchanged after API key addition
4. **Mantle Tool Loop Preservation**: Verify Mantle tool-use loop behavior identical after logging changes
5. **Resource Naming Preservation**: Verify Terraform resource names follow `{prefix}-{function}` pattern after all infra changes

### Unit Tests

- Test OpenAPI spec parsing validates API key scheme presence
- Test Terraform plan output includes explicit memory_size for all Lambdas
- Test Terraform plan output includes encryption configuration for S3, DynamoDB, SQS
- Test IAM policy documents contain scoped resources (not wildcards) for s3vectors
- Test IAM policy documents contain X-Ray permissions
- Test handler imports use `aws_lambda_powertools` directly
- Test module-level client instantiation in Mantle AI Caller

### Property-Based Tests

- Generate random chat payloads and verify orchestrator handles them identically before/after logging unification
- Generate random conversation histories and verify DynamoDB write format is unchanged
- Generate random tool call sequences (Mantle) and verify tool-use loop termination behavior unchanged
- Generate random resource name prefixes and verify Terraform naming pattern compliance

### Integration Tests

- Deploy fixed AgentCore template to dev environment and run full chat flow end-to-end
- Deploy fixed Mantle template to dev environment and run tool-use flow end-to-end
- Verify API key is required (request without key returns 403)
- Verify AgentCore KB retrieval works via native action group (no Lambda hop)
- Verify CloudWatch logs use Powertools structured format
- Verify X-Ray traces appear in the AWS console
- Run `terraform plan` on fixed templates and verify no unexpected resource changes beyond the 9 fixes
