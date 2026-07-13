# Chatbot RAG ECS Template Fixes - Bugfix Design

## Overview

Architecture review of the 6 chatbot-rag ECS template variants (3 AgentCore + 3 Mantle, across REST/WS/WS-streaming) identified 9 violations of upd8 steering conventions (serverless, Python, Terraform). This design formalizes the bug condition — ECS templates that deviate from established standards — and defines a minimal, targeted fix plan that brings all 6 templates into compliance without altering their functional behavior (chat flow, AI invocation, tool-use loop via RETURN_CONTROL, conversation storage, ALB health checks).

Key architectural context distinguishing ECS from Lambda templates:
- ECS uses **FastAPI on Fargate**, exposed via **ALB** (not API Gateway)
- Authentication must be enforced at **ALB level** (WAF, Cognito, or OIDC) — not API Gateway API keys
- Each template has a **kb_sync Lambda** for S3-triggered KB ingestion (same fix pattern as Lambda templates)
- **Tool Executor is CORRECT** in ECS (RETURN_CONTROL pattern for in-process execution) — NOT a violation
- OpenAI client fix applies to **long-lived ECS processes** (not Lambda cold-start), but same principle: module-level instantiation avoids per-request HTTP client overhead

## Glossary

- **Bug_Condition (C)**: Any ECS template configuration or code that violates upd8 steering conventions (missing ALB auth, intermediate logging wrapper, handler-scoped SDK client, implicit Lambda memory, implicit DynamoDB encryption, overly-broad IAM, missing X-Ray permissions)
- **Property (P)**: The corrected state where each template artifact complies with the relevant upd8 convention
- **Preservation**: Existing functional behavior (chat flow, AI invocation, RETURN_CONTROL tool execution, conversation storage, health checks, resource naming) that must remain unchanged after the fix
- **ALB**: Application Load Balancer — the entry point for all ECS templates (replaces API Gateway from Lambda variants)
- **RETURN_CONTROL**: AgentCore action group pattern where the agent returns tool call requests to the ECS app for in-process execution, rather than invoking a separate Lambda
- **logging_config.py**: The intermediate `app.logging_config` wrapper module that provides `get_logger()` and `log_ai_interaction()` — wraps Powertools Logger but violates direct-import convention
- **kb_sync Lambda**: The only Lambda function in each ECS template, triggered by S3 events to start Bedrock KB ingestion jobs
- **bedrock-mantle**: AWS endpoint compatible with OpenAI SDK, used in the Mantle variant's AI Caller via `OpenAI(base_url=...)`

## Bug Details

### Bug Condition

The bug manifests when ECS template artifacts are provisioned or executed while containing convention violations. Each violation represents a distinct sub-condition; the overall bug condition is the disjunction of all nine.

**Formal Specification:**
```
FUNCTION isBugCondition(artifact)
  INPUT: artifact of type ECSTemplateArtifact (ALB module, ECS IAM, Lambda module, Python module, Terraform resource)
  OUTPUT: boolean
  
  RETURN artifact.alb_listener_forwards_without_auth
         OR artifact.ecs_app_uses_logging_config_wrapper
         OR artifact.kb_sync_lambda_uses_shared_logging_wrapper
         OR artifact.mantle_ai_caller_creates_client_per_request
         OR artifact.kb_sync_lambda_lacks_explicit_memory_size
         OR artifact.dynamodb_table_lacks_explicit_encryption
         OR artifact.ecs_task_role_uses_wildcard_for_bedrock
         OR artifact.kb_sync_iam_uses_wildcard_for_bedrock
         OR artifact.kb_sync_lambda_role_lacks_xray_permissions
END FUNCTION
```

### Examples

- **ALB Auth (1.1)**: ALB listener `default_action` is `forward` to target group without any `authenticate-oidc`, `authenticate-cognito` action or WAF WebACL association → all requests reach ECS without authorization
- **ECS Logging wrapper (1.2)**: `main.py` does `from app.logging_config import get_logger` instead of `from aws_lambda_powertools import Logger; logger = Logger(service="main")` directly
- **kb_sync Logging wrapper (1.3)**: `handler.py` does `from shared.logging_config import get_logger` instead of direct `from aws_lambda_powertools import Logger`
- **Client per request (1.4)**: `ai_caller.py` calls `client = OpenAI(base_url=..., api_key="bedrock")` inside `invoke_mantle()` function → new HTTP client and connection pool per request on a long-lived ECS container
- **Memory size (1.5)**: `aws_lambda_function.kb_sync` has no `memory_size` attribute → defaults to 128 MB
- **DynamoDB encryption (1.6)**: `aws_dynamodb_table.user_context` has no `server_side_encryption` block → relies on implicit AWS default encryption
- **ECS Bedrock IAM (1.7)**: `task_bedrock` policy uses `Resource = "*"` for `bedrock:InvokeAgent`/`bedrock:InvokeModel`/`bedrock:InvokeModelWithResponseStream` → violates least-privilege
- **kb_sync Bedrock IAM (1.8)**: `kb_sync_permissions` policy uses `resources = ["*"]` for `bedrock:StartIngestionJob` → should scope to specific KB ARN
- **X-Ray IAM (1.9)**: `tracing_config { mode = "Active" }` enabled on kb_sync Lambda but role lacks `xray:PutTraceSegments` and `xray:PutTelemetryData` permissions

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- ECS FastAPI app processes chat requests (REST) or WebSocket messages (WS variants) through orchestrator → AI caller → tool executor flow with the same payload format and response structure
- Mantle orchestrator tool-use loop iterates until no function_call items remain or MAX_TOOL_ITERATIONS is reached, with the same termination behavior
- AgentCore RETURN_CONTROL tool execution pattern continues to work — tool_executor.py remains deployed and called in-process by all 6 ECS variants
- DynamoDB stores conversation history using the same partition key schema (`userId`) and message list structure
- Structured JSON logs continue to include `timestamp`, `level`, `service`, `correlation_id`, `message` fields, and AI interaction logs include `logType: "ai-interaction"` with the same extra fields
- ALB health check hits `/health` endpoint and continues returning HTTP 200 (healthy) or HTTP 503 (shutting down)
- Terraform resource naming continues to use `${var.project_name}-${var.environment}-{function}` pattern
- kb_sync Lambda continues to call `bedrock:StartIngestionJob` with the same parameters and handle `ConflictException` gracefully
- S3 RAG bucket continues to have versioning and Block Public Access enabled on all four settings

**Scope:**
All functional behavior — request processing, AI model invocation, in-process tool execution (RETURN_CONTROL), conversation storage, response delivery, graceful shutdown — is unaffected. Changes are limited to security posture (ALB auth), infrastructure configuration (memory, encryption, IAM), SDK lifecycle (client instantiation), and observability setup (direct Powertools imports).

## Hypothesized Root Cause

Based on the architecture review, the violations stem from:

1. **ALB provisioned without auth layer**: Templates focused on "get it working" with direct forwarding; ALB authentication rules (OIDC/Cognito) or WAF association were deferred and never added. Unlike API Gateway which has built-in API key support, ALB auth requires explicit configuration of an additional action or WAF WebACL.

2. **Shared logging wrapper from pre-convention era**: The `logging_config.py` module was created as a convenience layer wrapping Powertools Logger. Convention now requires each module to import Powertools directly — the wrapper adds indirection without value.

3. **Lambda kb_sync handler copied from serverless templates**: The `shared.logging_config` import in kb_sync Lambda was carried over from the Lambda-only templates without updating to direct Powertools usage.

4. **Per-request client instantiation in long-lived process**: In Lambda, creating a client per invocation is a known anti-pattern (cold-start penalty). In ECS, the same pattern wastes resources by creating a new HTTP connection pool on every request instead of reusing the module-level client across the container's lifetime.

5. **Terraform defaults relied upon implicitly**: `memory_size` defaults to 128 MB if omitted; `server_side_encryption` on DynamoDB defaults to AWS-owned key. upd8 conventions require explicit declaration for auditability and environment-specific tuning.

6. **IAM policies copied from examples**: AWS documentation examples use `Resource = "*"` for simplicity. The ECS task role and kb_sync Lambda role both use wildcards instead of scoping to specific agent/model/KB ARNs.

7. **Missing X-Ray IAM oversight**: Tracing was enabled on the kb_sync Lambda resource but the corresponding IAM permissions were not added — a common oversight since X-Ray may work temporarily via broader permissions or fail silently.

## Correctness Properties

Property 1: Bug Condition - Convention Compliance

_For any_ ECS template artifact where the bug condition holds (isBugCondition returns true), the fixed template SHALL produce an artifact that satisfies the relevant upd8 convention: ALB auth enforced (WAF or OIDC/Cognito), direct Powertools imports without wrappers, module-level SDK client, explicit memory_size, explicit DynamoDB encryption, scoped IAM for Bedrock, and X-Ray permissions present.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**

Property 2: Preservation - Functional Behavior Unchanged

_For any_ ECS template artifact where the bug condition does NOT hold (functional behavior artifacts: chat flow, AI invocation, RETURN_CONTROL tool execution, conversation storage, health checks, response format, resource naming), the fixed template SHALL produce identical runtime behavior, preserving all existing functionality, data schemas, payload formats, and naming conventions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

## Fix Implementation

### Changes Required

#### Fix 1: ALB Authentication Enforcement (all 6 templates)

**Files**: `infra/modules/alb/main.tf`, `infra/modules/alb/variables.tf`, new `infra/modules/waf/` module (optional)

**Specific Changes**:
1. Add an `aws_wafv2_web_acl` resource with a rule matching a custom API key header (`x-api-key`) against a stored secret, OR add an `authenticate-oidc` / `authenticate-cognito` action on the ALB listener rule before the `forward` action
2. Recommended approach: **AWS WAF WebACL** associated with the ALB, with a custom rule that checks for a valid `x-api-key` header value — this is the simplest path that mirrors the API Gateway API key pattern from Lambda templates
3. Add `aws_wafv2_web_acl_association` resource linking the WebACL to the ALB
4. Add variables for `waf_enabled` (bool, default true) and `api_key_value` (SSM parameter reference)
5. The `/health` endpoint should be excluded from auth (ALB health checks don't pass custom headers) — use a WAF rule with a URI path exclusion for `/health`

#### Fix 2: ECS App Logging — Remove Wrapper (all 6 templates)

**Files**: `src/app/main.py`, `src/app/orchestrator.py`, `src/app/ai_caller.py`, `src/app/tool_executor.py`, `src/app/conversation_context.py`, `src/app/logging_config.py` (remove)

**Specific Changes**:
1. In each module, replace `from app.logging_config import get_logger` with direct Powertools import:
   ```python
   from aws_lambda_powertools import Logger
   logger = Logger(service="module_name")
   ```
2. Replace `from app.logging_config import get_logger, log_ai_interaction` with direct Logger usage and inline `log_ai_interaction` logic (or move `log_ai_interaction` to a small utility without wrapping Logger instantiation)
3. Remove `src/app/logging_config.py` from all 6 ECS templates
4. Ensure structured log fields (`logType: "ai-interaction"`, token counts, latency) remain identical in output

#### Fix 3: kb_sync Lambda Logging — Remove Shared Wrapper (all 6 templates)

**Files**: `src/kb_sync/handler.py`

**Specific Changes**:
1. Replace `from shared.logging_config import get_logger` with:
   ```python
   from aws_lambda_powertools import Logger
   logger = Logger()
   ```
2. Add `@logger.inject_lambda_context` decorator to the handler function
3. The shared layer can remain for other utilities but the logging import must be direct

#### Fix 4: Module-Level OpenAI Client (3 Mantle ECS variants)

**File**: `src/app/ai_caller.py` (Mantle templates)

**Specific Changes**:
1. Move `client = OpenAI(base_url=MANTLE_BASE_URL, api_key="bedrock")` to module level (outside `invoke_mantle()` function):
   ```python
   # Module-level client — reused across all requests in the ECS container
   _client = OpenAI(
       base_url=MANTLE_BASE_URL,
       api_key="bedrock",  # AWS auth handled by SDK credentials
   )
   ```
2. Inside `invoke_mantle()`, reference `_client` instead of creating a new instance
3. This is especially impactful for ECS since containers are long-lived — the same client/connection pool serves thousands of requests

#### Fix 5: Explicit memory_size for kb_sync Lambda (all 6 templates)

**Files**: `infra/modules/lambda/kb_sync/lambda.tf`, `infra/modules/lambda/kb_sync/variables.tf`

**Specific Changes**:
1. Add `variable "memory_size"` in `variables.tf` with type `number`, description, and default `256`
2. Add `memory_size = var.memory_size` to the `aws_lambda_function.kb_sync` resource
3. In the module invocation (parent), pass `memory_size = 256` explicitly

#### Fix 6: Explicit DynamoDB Encryption (all 6 templates)

**File**: `infra/modules/dynamodb/main.tf`

**Specific Changes**:
1. Add `server_side_encryption` block to `aws_dynamodb_table.user_context`:
   ```hcl
   server_side_encryption {
     enabled = true
   }
   ```
2. This declares encryption explicitly for auditability — AWS already encrypts by default with AWS-owned key, but explicit declaration satisfies convention

#### Fix 7: Scoped ECS Task Role Bedrock IAM (all 6 templates)

**Files**: `infra/modules/ecs/iam.tf`, `infra/modules/ecs/variables.tf`

**Specific Changes**:
1. **AgentCore variants**: Replace `Resource = "*"` with scoped agent ARN:
   ```hcl
   Resource = [
     "arn:aws:bedrock:${var.aws_region}:${var.account_id}:agent/${var.agent_id}",
     "arn:aws:bedrock:${var.aws_region}:${var.account_id}:agent-alias/${var.agent_id}/${var.agent_alias_id}",
     "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.model_id}",
   ]
   ```
2. **Mantle variants**: Replace `Resource = "*"` with scoped model ARN:
   ```hcl
   Resource = [
     "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.model_id}",
   ]
   ```
3. Add corresponding variables (`agent_id`, `agent_alias_id`, `model_id`, `aws_region`, `account_id`) to `variables.tf`

#### Fix 8: Scoped kb_sync Lambda Bedrock IAM (all 6 templates)

**File**: `infra/modules/lambda/kb_sync/iam.tf`

**Specific Changes**:
1. Replace `resources = ["*"]` with:
   ```hcl
   resources = [
     "arn:aws:bedrock:${var.aws_region}:${var.account_id}:knowledge-base/${var.knowledge_base_id}"
   ]
   ```
2. Add variables `aws_region`, `account_id` to the kb_sync module (or use data sources `aws_region` and `aws_caller_identity`)

#### Fix 9: X-Ray IAM Permissions for kb_sync Lambda (all 6 templates)

**File**: `infra/modules/lambda/kb_sync/iam.tf`

**Specific Changes**:
1. Add an IAM policy statement to the kb_sync role:
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
2. `Resource = ["*"]` is required by X-Ray service design (traces are not scoped to specific ARNs)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the violations on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the violations BEFORE implementing the fixes. Confirm that each violation exists in the current ECS templates.

**Test Plan**: Inspect template artifacts programmatically and assert that conventions are met. Run on UNFIXED code to observe failures.

**Test Cases**:
1. **ALB Auth Test**: Parse `infra/modules/alb/main.tf`, assert an `authenticate-*` action or WAF association exists on the listener (will fail on unfixed code)
2. **ECS Logging Import Test**: Parse `src/app/*.py` files, assert no `from app.logging_config import` statements exist (will fail on unfixed code)
3. **kb_sync Logging Import Test**: Parse `src/kb_sync/handler.py`, assert no `from shared.logging_config import` (will fail on unfixed code)
4. **Client Scope Test**: Parse `src/app/ai_caller.py` (Mantle), assert `OpenAI(` is not inside any function body (will fail on unfixed code)
5. **Memory Size Test**: Parse `infra/modules/lambda/kb_sync/lambda.tf`, assert `memory_size` attribute exists (will fail on unfixed code)
6. **DynamoDB Encryption Test**: Parse `infra/modules/dynamodb/main.tf`, assert `server_side_encryption` block present (will fail on unfixed code)
7. **ECS Bedrock IAM Test**: Parse `infra/modules/ecs/iam.tf`, assert `task_bedrock` policy does not use `Resource = "*"` (will fail on unfixed code)
8. **kb_sync IAM Test**: Parse `infra/modules/lambda/kb_sync/iam.tf`, assert `bedrock:StartIngestionJob` is not scoped to `["*"]` (will fail on unfixed code)
9. **X-Ray IAM Test**: Parse `infra/modules/lambda/kb_sync/iam.tf`, assert `xray:PutTraceSegments` permission exists (will fail on unfixed code)

**Expected Counterexamples**:
- Each test above will fail, confirming the violation exists in all 6 ECS templates
- ALB modules forward traffic without any auth mechanism
- All ECS app modules import through `app.logging_config` wrapper
- Mantle `ai_caller.py` creates `OpenAI` client inside `invoke_mantle()` function body

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
- It provides strong guarantees that the chat flow is unchanged for non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for chat requests, RETURN_CONTROL tool invocations, and conversation storage, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Payload Format Preservation**: Verify orchestrator → AI Caller invocation payload format remains identical after logging/client changes
2. **DynamoDB Schema Preservation**: Verify conversation storage schema unchanged after all fixes
3. **Health Check Preservation**: Verify `/health` endpoint returns HTTP 200 (healthy) and HTTP 503 (shutting down) identically after ALB auth addition
4. **Mantle Tool Loop Preservation**: Verify Mantle tool-use loop behavior identical after logging and client changes
5. **RETURN_CONTROL Preservation**: Verify AgentCore RETURN_CONTROL tool execution continues working identically — tool_executor.py remains deployed and functional
6. **Resource Naming Preservation**: Verify Terraform resource names follow `${var.project_name}-${var.environment}-{function}` pattern after all infra changes

### Unit Tests

- Test WAF WebACL rule correctly blocks requests without valid `x-api-key` header
- Test WAF rule excludes `/health` endpoint from auth requirements
- Test Terraform plan output includes explicit `memory_size = 256` for kb_sync Lambda
- Test Terraform plan output includes `server_side_encryption` block for DynamoDB tables
- Test IAM policy documents contain scoped Bedrock resources (not wildcards) for ECS task role
- Test IAM policy documents contain scoped KB ARN for kb_sync Lambda
- Test IAM policy documents contain X-Ray permissions for kb_sync Lambda role
- Test handler imports use `aws_lambda_powertools` directly (no intermediate wrapper)
- Test module-level client instantiation in Mantle AI Caller (client created outside function)

### Property-Based Tests

- Generate random chat payloads and verify orchestrator handles them identically before/after logging unification
- Generate random conversation histories and verify DynamoDB write format is unchanged
- Generate random tool call sequences (Mantle) and verify tool-use loop termination behavior unchanged
- Generate random RETURN_CONTROL responses (AgentCore) and verify tool_executor handles them identically
- Generate random resource name prefixes and verify Terraform naming pattern compliance

### Integration Tests

- Deploy fixed AgentCore ECS template to dev environment and run full chat flow end-to-end
- Deploy fixed Mantle ECS template to dev environment and run tool-use flow end-to-end
- Verify ALB rejects requests without valid API key (WAF blocks with 403)
- Verify `/health` endpoint remains accessible without API key (health check exclusion)
- Verify AgentCore RETURN_CONTROL tool execution works correctly in-process
- Verify CloudWatch logs from ECS containers use Powertools structured format directly
- Verify X-Ray traces appear for kb_sync Lambda invocations
- Run `terraform plan` on fixed templates and verify no unexpected resource changes beyond the 9 fixes
