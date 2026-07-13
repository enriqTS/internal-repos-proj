# Bugfix Requirements Document

## Introduction

Architecture review of the 6 chatbot-rag ECS template variants (AgentCore and Mantle, across REST, WebSocket, and WebSocket-streaming) revealed multiple violations of upd8 steering conventions (serverless, Python, Terraform). These are not new features but corrections to bring existing ECS template code into compliance with established standards: ALB authentication enforcement, direct Powertools usage without intermediate wrappers, proper SDK client lifecycle, explicit Lambda memory sizing, explicit DynamoDB encryption, least-privilege IAM, and X-Ray IAM permissions.

**Affected templates (6):**
1. `chatbot-rag-agentcore-ecs` — AgentCore, REST, non-streaming
2. `chatbot-rag-agentcore-ecs-ws` — AgentCore, WebSocket, non-streaming
3. `chatbot-rag-agentcore-ecs-ws-streaming` — AgentCore, WebSocket, streaming
4. `chatbot-rag-mantle-ecs` — Mantle, REST, non-streaming
5. `chatbot-rag-mantle-ecs-ws` — Mantle, WebSocket, non-streaming
6. `chatbot-rag-mantle-ecs-ws-streaming` — Mantle, WebSocket, streaming

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the ALB listener receives traffic on the `/chat` endpoint (REST variants) or WebSocket upgrade path (WS variants) THEN the system forwards all requests directly to ECS without any authentication mechanism — no API key, no WAF, no Cognito, no ALB OIDC rule — leaving the endpoints publicly accessible without authorization

1.2 WHEN ECS app modules initialize logging THEN the system uses an intermediate `app.logging_config` wrapper (`from app.logging_config import get_logger`) instead of importing and using `aws_lambda_powertools.Logger` directly in each module, violating the convention of direct Powertools usage

1.3 WHEN the kb_sync Lambda initializes logging THEN the system uses a shared Lambda Layer wrapper (`from shared.logging_config import get_logger`) instead of importing `aws_lambda_powertools.Logger` directly in the handler, violating the same convention

1.4 WHEN the Mantle AI Caller module invokes the Bedrock Mantle API (all 3 Mantle ECS variants) THEN the system creates a new `OpenAI` client instance inside the `invoke_mantle()` function on every call, wasting resources by establishing a new HTTP client and connection pool per request instead of reusing one at module level

1.5 WHEN the kb_sync Lambda function is provisioned via Terraform THEN the system does not specify an explicit `memory_size` attribute, defaulting to 128 MB which may be insufficient for Bedrock `StartIngestionJob` API calls

1.6 WHEN DynamoDB tables are provisioned via the `infra/modules/dynamodb/main.tf` module THEN the system does not declare explicit `server_side_encryption { enabled = true }`, relying on implicit AWS defaults rather than explicit declarations required by convention

1.7 WHEN the ECS task role IAM policy grants Bedrock permissions THEN the system uses `Resource = "*"` for `bedrock:InvokeAgent`, `bedrock:InvokeModel`, and `bedrock:InvokeModelWithResponseStream` actions instead of scoping to specific model/agent ARNs, violating least-privilege

1.8 WHEN the kb_sync Lambda IAM policy grants Bedrock permissions THEN the system uses `Resource = "*"` for `bedrock:StartIngestionJob` instead of scoping to the specific Knowledge Base ARN, violating least-privilege

1.9 WHEN X-Ray tracing is enabled on the kb_sync Lambda via `tracing_config { mode = "Active" }` THEN the system does not grant explicit `xray:PutTraceSegments` and `xray:PutTelemetryData` IAM permissions in the Lambda execution role

### Expected Behavior (Correct)

2.1 WHEN the ALB receives traffic on chat/WebSocket endpoints THEN the system SHALL enforce authentication via an ALB authentication rule (OIDC or Cognito action) or an associated AWS WAF WebACL with an API key header match rule, blocking unauthenticated requests before they reach ECS

2.2 WHEN ECS app modules initialize logging THEN each module SHALL import and instantiate `aws_lambda_powertools.Logger` directly at module level (e.g., `from aws_lambda_powertools import Logger; logger = Logger(service="module_name")`), without any intermediate shared wrapper module

2.3 WHEN the kb_sync Lambda handler initializes logging THEN it SHALL import `aws_lambda_powertools.Logger` directly (e.g., `from aws_lambda_powertools import Logger; logger = Logger()`) without the shared Lambda Layer `logging_config.py` wrapper

2.4 WHEN the Mantle AI Caller module is loaded THEN the system SHALL create the `OpenAI` client instance at module level (outside any function) so that the HTTP client and connection pool are reused across requests within the same ECS container

2.5 WHEN the kb_sync Lambda function is provisioned via Terraform THEN the system SHALL declare an explicit `memory_size` attribute defaulting to 256 MB, configurable via variable

2.6 WHEN DynamoDB tables are provisioned THEN the system SHALL declare explicit `server_side_encryption { enabled = true }` in the table resource for auditability and compliance

2.7 WHEN the ECS task role IAM policy grants Bedrock permissions THEN the system SHALL scope the `Resource` to the specific agent ARN (AgentCore variants: `arn:aws:bedrock:*:*:agent/${var.agent_id}`) or model ARN (Mantle variants: `arn:aws:bedrock:*::foundation-model/${var.model_id}`) following least-privilege

2.8 WHEN the kb_sync Lambda IAM policy grants Bedrock permissions THEN the system SHALL scope the `Resource` to `arn:aws:bedrock:*:*:knowledge-base/${var.knowledge_base_id}` following least-privilege

2.9 WHEN X-Ray tracing is enabled on the kb_sync Lambda THEN the Lambda execution role SHALL include an explicit IAM policy statement granting `xray:PutTraceSegments` and `xray:PutTelemetryData` on `Resource = ["*"]` (as required by X-Ray service)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the ECS FastAPI app processes chat requests (REST variants) or WebSocket messages (WS variants) THEN the system SHALL CONTINUE TO route through the orchestrator → AI caller → tool executor flow with the same payload format and response structure

3.2 WHEN the Mantle orchestrator manages the tool-use loop THEN the system SHALL CONTINUE TO iterate until no function_call items remain or MAX_TOOL_ITERATIONS is reached, with the same termination behavior

3.3 WHEN DynamoDB stores conversation history THEN the system SHALL CONTINUE TO use the same partition key schema (`userId`) and message list structure

3.4 WHEN structured JSON logs are emitted THEN the system SHALL CONTINUE TO include `timestamp`, `level`, `service`, `correlation_id`, and `message` fields, and AI interaction logs SHALL CONTINUE TO include `logType: "ai-interaction"` with the same extra fields

3.5 WHEN the ALB health check hits the `/health` endpoint THEN the system SHALL CONTINUE TO return HTTP 200 when healthy and HTTP 503 during graceful shutdown

3.6 WHEN Terraform constructs resource names THEN the system SHALL CONTINUE TO use the `${var.project_name}-${var.environment}-{function}` naming pattern for all resources

3.7 WHEN the kb_sync Lambda receives an S3 event THEN the system SHALL CONTINUE TO call `bedrock:StartIngestionJob` with the same parameters and handle `ConflictException` gracefully (skip if job already running)

3.8 WHEN the S3 RAG bucket is provisioned THEN the system SHALL CONTINUE TO have versioning and Block Public Access enabled on all four settings

3.9 WHEN ECS containers use the `tool_executor.py` module for in-process tool execution via RETURN_CONTROL THEN the system SHALL CONTINUE TO deploy and use tool_executor.py in all 6 ECS variants (this is the correct pattern for ECS — unlike Lambda where it was redundant)
