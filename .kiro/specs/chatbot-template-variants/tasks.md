# Implementation Plan: Chatbot Template Variants

## Overview

This plan implements ten new chatbot RAG template variants organized in five phases: shared modules first, then Lambda WebSocket variants (non-streaming → streaming), ECS variants (REST → WebSocket → WebSocket streaming), architecture diagrams via Draw.io MCP, and finally documentation/metadata. Each task builds incrementally on prior work, with shared core logic written once and reused across all variants.

Python 3.12, uv, ruff, pytest, Hypothesis for application code. Terraform with S3 remote backend and DynamoDB lock for infrastructure. aws-lambda-powertools for structured logging across all variants.

## Tasks

- [x] 1. Shared modules and core logic
  - [x] 1.1 Create shared message protocol module (`shared/message_protocol.py`)
    - Implement `build_chunk_message`, `build_done_message`, `build_message_response`, `build_status_message`, `build_error_message`, `validate_client_message`
    - Follow the exact interfaces defined in the design document
    - This module is reused identically across all WebSocket variants (Lambda and ECS)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 1.2 Create shared logging configuration module (`shared/logging_config.py`)
    - Configure aws-lambda-powertools Logger with `POWERTOOLS_SERVICE_NAME` and `POWERTOOLS_LOG_LEVEL` env vars
    - Structured JSON format: `timestamp`, `level`, `service`, `correlation_id`, `message`, plus optional `logType`, `model`, `tokens`, `latencyMs`
    - AI interaction log helper (`log_ai_interaction`) with fields: `correlation_id`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `latencyMs`, `finishReason`
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 1.3 Create shared data models module (`shared/models.py`)
    - Define Pydantic models for `ChatRequest`, `ChatResponse`, `ErrorResponse`
    - Validation: `userId` (1–256 chars), `message` (1–4096 chars)
    - Reusable across Lambda and ECS variants
    - _Requirements: 7.1, 12.3, 12.4_

  - [x] 1.4 Create shared connection manager module (`shared/connection_manager.py`)
    - Implement `store_connection`, `remove_connection`, `get_connection_for_user`
    - TTL calculation: `connectedAt + 86400` seconds (24h)
    - boto3 DynamoDB resource client created at module level (reuse)
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 1.5 Create shared message sender module (`shared/message_sender.py`)
    - Implement `send_to_connection` with retry logic (3 retries, exponential backoff)
    - Handle 410 GoneException: remove connection, return False
    - Handle expired connections (`expiresAt < now`): skip delivery, delete entry
    - _Requirements: 2.6, 2.7, 2.8, 9.8_

  - [x] 1.6 Create shared AI caller core logic — AgentCore variant (`shared/ai_caller_agentcore.py`)
    - Prompt construction, model invocation (non-streaming and streaming modes), response parsing, token usage extraction
    - `SYSTEM_PROMPT` constant with PLACEHOLDER comment at module level
    - AI interaction logging via shared logging helper
    - Streaming mode: yield chunks from AgentCore Runtime completion stream
    - _Requirements: 5.1, 5.6, 11.1, 11.2, 15.2_

  - [x] 1.7 Create shared AI caller core logic — Mantle variant (`shared/ai_caller_mantle.py`)
    - OpenAI SDK with bedrock-mantle base URL, prompt construction, model invocation
    - `SYSTEM_PROMPT` constant with PLACEHOLDER comment at module level
    - Non-streaming: full response parse. Streaming: yield chunks from response iterator
    - AI interaction logging after stream completion (single log entry)
    - _Requirements: 5.1, 5.6, 10.1, 15.2, 15.3_

  - [x] 1.8 Create shared tool executor module (`shared/tool_executor.py`)
    - Tool dispatch, RAG bucket search (S3 GetObject), result formatting
    - Identical logic across all variants
    - _Requirements: 5.2_

  - [x] 1.9 Create shared conversation context module (`shared/conversation_context.py`)
    - DynamoDB read/write for user conversation history
    - History trimming to `MAX_CONVERSATION_HISTORY` messages
    - Message appending with timestamp
    - Graceful degradation: proceed with empty history on read failure, log ERROR
    - _Requirements: 5.3, 5.5_

  - [ ]* 1.10 Write property tests for message protocol validation
    - **Property 3: WebSocket client message validation**
    - **Property 4: WebSocket message protocol format consistency**
    - Use Hypothesis with `@settings(max_examples=100)`
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

  - [ ]* 1.11 Write property tests for connection management and message sender
    - **Property 5: Connection store/remove round-trip**
    - **Property 10: Message sender retry behavior**
    - **Property 11: Stale connection detection and cleanup**
    - Mock boto3 DynamoDB and apigatewaymanagementapi
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 2.7, 2.8, 9.8**

  - [ ]* 1.12 Write property tests for template naming and metadata validation
    - **Property 1: Template naming convention validation**
    - **Property 2: Metadata JSON schema validation**
    - Generate arbitrary combinations of (ai_service, compute, transport, streaming)
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

- [x] 2. Checkpoint — Ensure all shared module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Lambda WebSocket non-streaming variants (AgentCore + Mantle)
  - [x] 3.1 Scaffold `chatbot-rag-agentcore-ws` template directory structure
    - Create full directory tree: `src/`, `infra/`, `tests/`, `docs/`, `build/`
    - Create `pyproject.toml` (uv, dev deps: pytest, ruff, hypothesis), `Makefile`, `.gitignore`
    - Copy shared modules into `src/layers/shared/python/shared/`
    - Create `src/connection_manager/handler.py` — Lambda handler for $connect/$disconnect
    - Create `src/orchestrator/handler.py` — SQS-triggered, calls AI caller, sends response via message_sender
    - Create `src/ai_caller/handler.py` — wraps shared AgentCore AI caller with Lambda handler
    - Create `src/tool_executor/handler.py` — wraps shared tool executor with Lambda handler
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.1, 5.5, 5.6, 6.1_

  - [x] 3.2 Create Terraform modules for `chatbot-rag-agentcore-ws`
    - `infra/modules/websocket_api/` — API Gateway v2 WebSocket with $connect, $disconnect, sendMessage routes
    - `infra/modules/sqs/` — SQS FIFO queue for sendMessage integration
    - `infra/modules/lambda/` — connection_manager, orchestrator, ai_caller, tool_executor, shared_layer
    - `infra/modules/dynamodb/` — User_Context_DB + Connection_Table with TTL on expiresAt
    - `infra/modules/s3/` — RAG bucket
    - `infra/modules/agentcore/` — AgentCore runtime configuration
    - `infra/environment/dev/` — main.tf, variables.tf, outputs.tf, backend.tf, terraform.tfvars.example
    - S3 remote backend with unique state key `chatbot-rag-agentcore-ws/dev/terraform.tfstate`
    - IAM: execute-api:ManageConnections for orchestrator, least privilege for all roles
    - Use Terraform MCP for provider resource lookups
    - _Requirements: 2.1, 2.5, 2.9, 2.10, 6.3, 6.4, 6.5, 9.5, 13.1, 13.2, 13.4, 13.5, 13.6_

  - [x] 3.3 Scaffold `chatbot-rag-mantle-ws` template from AgentCore variant
    - Copy `chatbot-rag-agentcore-ws` structure
    - Replace AI caller with Mantle variant (OpenAI SDK, tool-use loop logic)
    - Update orchestrator to handle Mantle tool-use loop (non-streaming: iterate until no function_call)
    - Remove `infra/modules/agentcore/`, adjust IAM for Bedrock Mantle endpoint
    - Update metadata, README references
    - _Requirements: 1.1, 1.2, 5.1, 5.5, 6.1_

  - [ ]* 3.4 Write unit tests for Lambda WebSocket non-streaming variants
    - Test connection_manager handler ($connect with/without userId, $disconnect)
    - Test orchestrator handler (message processing, response delivery via @connections)
    - Test AI caller Lambda handlers (both AgentCore and Mantle)
    - Mock boto3 (DynamoDB, SQS, apigatewaymanagementapi, Bedrock)
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.9, 3.5_

- [x] 4. Lambda WebSocket streaming variants (AgentCore + Mantle)
  - [x] 4.1 Create `chatbot-rag-agentcore-ws-streaming` template
    - Copy `chatbot-rag-agentcore-ws` structure
    - Modify AI caller to use streaming mode (event-by-event consumption from AgentCore Runtime)
    - Modify orchestrator to forward chunks progressively via message_sender
    - Send `{"type": "chunk"}` per token, `{"type": "done"}` at end
    - Save assembled full response to conversation history after stream completes
    - Handle client disconnect mid-stream: abort stream within 5s
    - Add `max_chunk_size` Terraform variable (default 1, max 50)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 4.2 Create `chatbot-rag-mantle-ws-streaming` template
    - Copy `chatbot-rag-mantle-ws` structure
    - Modify AI caller to use streaming mode (`stream=True` in OpenAI SDK)
    - Implement streaming tool-use loop: function_call items → invoke tool → follow-up streaming request
    - Send `{"type": "status", "message": "Processing..."}` per tool-use iteration
    - Only stream tokens from final iteration (no function_call items)
    - Handle MAX_TOOL_ITERATIONS exceeded: send error message, stop processing
    - Save complete assembled response + intermediate tool results after success
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 4.3 Write property tests for streaming variants
    - **Property 6: Streaming response assembly preserves content**
    - **Property 7: Tool-use loop with streaming terminates correctly**
    - **Property 9: AI interaction log completeness (streaming and non-streaming)**
    - Mock AI service streaming responses with arbitrary token sequences
    - **Validates: Requirements 3.4, 10.1, 10.2, 10.3, 10.4, 10.5, 11.4, 15.2, 15.3**

  - [ ]* 4.4 Write unit tests for streaming Lambda variants
    - Test streaming chunk delivery order
    - Test stream abort on client disconnect
    - Test tool-use loop iteration with streaming (Mantle)
    - Test MAX_TOOL_ITERATIONS error path
    - Test AI interaction log emitted once after stream completion
    - _Requirements: 3.1, 3.4, 3.6, 3.8, 10.4, 11.5_

- [x] 5. Checkpoint — Ensure all Lambda variant tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. ECS REST non-streaming variants (AgentCore + Mantle)
  - [x] 6.1 Scaffold `chatbot-rag-agentcore-ecs` template directory structure
    - Create ECS directory tree: `src/app/`, `infra/`, `tests/`, `docs/`, `build/`
    - Create `pyproject.toml` (fastapi, uvicorn, boto3, app deps), `Makefile`, `.gitignore`, `Dockerfile`
    - Create `src/app/main.py` — FastAPI entry point with `/health` and `/chat` endpoints, lifespan for graceful shutdown
    - Create `src/app/orchestrator.py` — reuses shared conversation context, calls ai_caller/tool_executor via direct imports
    - Create `src/app/ai_caller.py` — wraps shared AgentCore AI caller for in-process use
    - Create `src/app/tool_executor.py` — wraps shared tool executor for in-process use
    - Create `src/app/logging_config.py` — reuses shared logging config pattern
    - Create `src/app/models.py` — reuses shared models
    - Create `src/app/config.py` — environment variable loading with defaults
    - Dockerfile: multi-stage Python 3.12-slim, uv for dependency export
    - _Requirements: 4.1, 4.2, 4.5, 8.1, 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8, 12.9_

  - [x] 6.2 Create Terraform modules for `chatbot-rag-agentcore-ecs`
    - `infra/modules/vpc/` — VPC, 2 AZ subnets (public + private), NAT GW, IGW, route tables
    - `infra/modules/ecs/` — cluster, service, task definition (CPU 512, memory 1024, port 8080)
    - `infra/modules/ecr/` — ECR repository
    - `infra/modules/alb/` — ALB with health check (interval 30s, timeout 5s, healthy 2, unhealthy 3)
    - `infra/modules/dynamodb/` — User_Context_DB
    - `infra/modules/s3/` — RAG bucket
    - `infra/modules/agentcore/` — AgentCore runtime
    - ECS task execution role (ECR pull, CloudWatch write) + task role (Bedrock, DynamoDB, S3 — least privilege)
    - Security groups: inbound ALB→ECS on container port, outbound ECS→AWS on 443
    - CloudWatch log group with 30-day retention
    - Deployment circuit breaker with rollback, min healthy 100%, max 200%
    - Use Terraform MCP for ECS/VPC/ALB resource lookups
    - _Requirements: 4.1, 4.3, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 6.2, 6.3, 6.4, 8.5, 8.6, 13.1, 13.2, 13.3, 13.5, 13.6_

  - [x] 6.3 Create `chatbot-rag-mantle-ecs` template from AgentCore ECS variant
    - Copy `chatbot-rag-agentcore-ecs` structure
    - Replace AI caller with Mantle variant (OpenAI SDK, tool-use loop)
    - Update orchestrator for Mantle tool-use loop (non-streaming)
    - Remove `infra/modules/agentcore/`, adjust IAM for Bedrock Mantle
    - _Requirements: 1.1, 1.2, 5.1, 5.5_

  - [ ]* 6.4 Write unit tests for ECS REST variants
    - Test `/health` endpoint (200 healthy, 503 shutting down)
    - Test `/chat` endpoint (valid request, missing fields → 400, server error → 500)
    - Test orchestrator module (conversation flow, AI call, tool execution)
    - _Requirements: 8.1, 12.3, 12.4, 12.5, 12.7_

  - [ ]* 6.5 Write property test for ECS graceful shutdown
    - **Property 12: ECS graceful shutdown preserves in-flight requests**
    - Simulate SIGTERM with concurrent requests, verify all complete
    - **Validates: Requirements 8.4**

- [x] 7. ECS WebSocket non-streaming variants (AgentCore + Mantle)
  - [x] 7.1 Create `chatbot-rag-agentcore-ecs-ws` template
    - Copy `chatbot-rag-agentcore-ecs` structure
    - Add `src/app/connection_manager.py` — reuses shared connection manager logic
    - Add `src/app/message_sender.py` — reuses shared message sender logic
    - Modify `src/app/main.py` — add WebSocket route handlers ($connect, $disconnect, sendMessage)
    - Replace ALB with NLB + API Gateway WebSocket + VPC Link in Terraform
    - Add `infra/modules/nlb/` and `infra/modules/websocket_api/`
    - Add Connection_Table to `infra/modules/dynamodb/` with TTL
    - Add execute-api:ManageConnections to ECS task role
    - _Requirements: 4.4, 4.5, 12.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.1, 9.5_

  - [x] 7.2 Create `chatbot-rag-mantle-ecs-ws` template
    - Copy `chatbot-rag-agentcore-ecs-ws` structure
    - Replace AI caller with Mantle variant, update orchestrator for tool-use loop
    - Remove agentcore module, adjust IAM
    - _Requirements: 1.1, 1.2, 5.1, 5.5_

  - [ ]* 7.3 Write unit tests for ECS WebSocket non-streaming variants
    - Test WebSocket connection lifecycle (connect → message → response → disconnect)
    - Test connection manager (store, remove, get)
    - Test message sender (success, 410 Gone, retry exhaustion)
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.7, 2.8_

- [x] 8. ECS WebSocket streaming variants (AgentCore + Mantle)
  - [x] 8.1 Create `chatbot-rag-agentcore-ecs-ws-streaming` template
    - Copy `chatbot-rag-agentcore-ecs-ws` structure
    - Modify AI caller for streaming mode (AgentCore Runtime event streaming)
    - Modify orchestrator to forward chunks progressively via message sender
    - Handle client disconnect mid-stream: abort within 5s
    - Add `max_chunk_size` Terraform variable
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 3.8, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 8.2 Create `chatbot-rag-mantle-ecs-ws-streaming` template
    - Copy `chatbot-rag-mantle-ecs-ws` structure
    - Modify AI caller for streaming mode (OpenAI SDK stream=True)
    - Implement streaming tool-use loop (same logic as Lambda Mantle streaming)
    - Send status messages per tool-use iteration, stream only final response
    - Handle MAX_TOOL_ITERATIONS exceeded
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 8.3 Write unit tests for ECS WebSocket streaming variants
    - Test streaming chunk delivery and assembly
    - Test tool-use loop with streaming (Mantle ECS)
    - Test client disconnect during stream
    - _Requirements: 3.1, 3.4, 3.8, 10.1, 10.4_

- [x] 9. Checkpoint — Ensure all variant tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Correlation ID and observability verification
  - [x] 10.1 Implement and verify correlation ID propagation across all variants
    - Ensure correlation_id flows from entry point through orchestrator, ai_caller, tool_executor, connection_manager, message_sender
    - Generate UUID v4 if not available in incoming context
    - Verify every log entry within a request includes the same correlation_id
    - _Requirements: 15.5, 15.6_

  - [ ]* 10.2 Write property test for correlation ID propagation
    - **Property 8: Correlation ID propagation across all variants**
    - **Validates: Requirements 15.5, 15.6**

- [x] 11. Architecture diagrams via Draw.io MCP
  - [x] 11.1 Generate architecture diagrams for Lambda WebSocket variants (4 diagrams)
    - Use Draw.io MCP with AWS4 shape library
    - `chatbot-rag-agentcore-ws`: Client → API GW WebSocket → Connection Manager Lambda + SQS → Orchestrator → AI Caller → AgentCore → Tool Executor → S3/DynamoDB
    - `chatbot-rag-mantle-ws`: Same layout with Mantle AI service
    - `chatbot-rag-agentcore-ws-streaming`: Same as above with dashed edges for streaming path
    - `chatbot-rag-mantle-ws-streaming`: Same as above with dashed edges + status messages shown
    - Use `awsCloud` group, labeled directional edges, left-to-right flow
    - Title label identifying variant name and characteristics
    - Save to `templates/{name}/docs/architecture.drawio`
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.6, 16.8, 16.9, 16.10_

  - [x] 11.2 Generate architecture diagrams for ECS REST variants (2 diagrams)
    - `chatbot-rag-agentcore-ecs`: Client → ALB → ECS (VPC/private subnet) → modules → DynamoDB/S3/Bedrock
    - `chatbot-rag-mantle-ecs`: Same layout with Mantle
    - Include VPC group, public/private subnet groups, NAT GW, ECR
    - _Requirements: 16.1, 16.2, 16.3, 16.5, 16.6, 16.9, 16.10_

  - [x] 11.3 Generate architecture diagrams for ECS WebSocket variants (4 diagrams)
    - `chatbot-rag-agentcore-ecs-ws`: Client → API GW WebSocket → VPC Link → NLB → ECS (private subnet) → modules → DynamoDB (connections + context)/S3/Bedrock
    - `chatbot-rag-mantle-ecs-ws`: Same with Mantle
    - `chatbot-rag-agentcore-ecs-ws-streaming`: Same with dashed streaming edges
    - `chatbot-rag-mantle-ecs-ws-streaming`: Same with dashed streaming edges + status flow
    - Include VPC, subnets, NLB, Connection_Table, @connections path back to API GW
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10_

- [x] 12. Documentation and metadata
  - [x] 12.1 Create metadata.json for all 10 template variants
    - Follow naming pattern: `chatbot-rag-{ai_service}[-ecs][-ws][-streaming]`
    - Tags: `chatbot`, `rag`, `python`, `terraform`, AI service tag, plus `websocket`/`streaming`/`ecs` as applicable
    - Description ≤ 200 chars mentioning AI service, transport, streaming mode, compute layer
    - Date in ISO 8601 YYYY-MM-DD format
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 12.2 Create README.md for Lambda WebSocket non-streaming variants
    - Sections: Overview, Architecture, Prerequisites, Project Structure, Configuration, Deployment, RAG Knowledge Base, Logging & Observability, Customization, WebSocket Protocol
    - WebSocket Protocol: client-to-server fields table, server-to-client types table, JS/TS code example
    - Title format: "Chatbot RAG Template — {AI Service} (WebSocket)"
    - _Requirements: 14.1, 14.2, 14.5, 7.7_

  - [x] 12.3 Create README.md for Lambda WebSocket streaming variants
    - All sections from 12.2 plus "Streaming Behavior" section
    - Streaming Behavior: token delivery explanation, chunk/done/error handling, tool-use interaction (Mantle), client assembly code example
    - Title format: "Chatbot RAG Template — {AI Service} (WebSocket, Streaming)"
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 7.7_

  - [x] 12.4 Create README.md for ECS REST variants
    - Sections: Overview, Architecture, Prerequisites, Project Structure, Configuration, Deployment, RAG Knowledge Base, Logging & Observability, Customization, Container Operations
    - Container Operations: docker build/push, ECR auth, scaling, health check, SIGTERM, Makefile targets
    - Title format: "Chatbot RAG Template — {AI Service} (ECS)"
    - _Requirements: 14.1, 14.4, 14.5_

  - [x] 12.5 Create README.md for ECS WebSocket variants (non-streaming and streaming)
    - Non-streaming: all ECS sections + WebSocket Protocol
    - Streaming: all ECS sections + WebSocket Protocol + Streaming Behavior
    - Title format includes all non-default dimensions
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 13. Shared logic verification and final validation
  - [x] 13.1 Verify shared core logic identity across all 10 variants
    - Extract function bodies from ai_caller, tool_executor, conversation_context across same-service variants
    - Confirm zero diff after normalizing import paths and removing Lambda handler boilerplate
    - Verify SYSTEM_PROMPT constant exists at module level in all AI caller files
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7_

  - [x] 13.2 Validate template artifact structure completeness
    - Lambda variants: verify all required dirs/files per Req 6.1
    - ECS variants: verify all required dirs/files per Req 6.2
    - Verify .gitignore excludes all specified patterns
    - Verify Makefile targets (build, deploy, test, lint, format + docker targets for ECS)
    - _Requirements: 6.1, 6.2, 6.5, 6.6, 6.7_

  - [x] 13.3 Validate Terraform configurations across all variants
    - Run `terraform validate` on each variant's dev environment
    - Verify S3 remote backend with unique state keys
    - Verify resource naming follows `{project_name}-{environment}-{function}` pattern
    - Verify no cross-stack references or hardcoded ARNs
    - Verify tags: Project, Environment, ManagedBy = "terraform"
    - _Requirements: 6.3, 6.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Shared modules (task group 1) are written once and copied/imported into each variant — changes propagate by re-copying
- Architecture diagrams are generated using the Draw.io MCP server with AWS4 shape library icons
- Terraform MCP should be used for provider resource/attribute lookups when writing infra modules
- All commits should follow the auto-commit convention: one commit per logical unit of work
- Fish shell: use `bash -c "..."` for complex terminal commands

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.6", "1.7", "1.8", "1.9"] },
    { "id": 1, "tasks": ["1.4", "1.5"] },
    { "id": 2, "tasks": ["1.10", "1.11", "1.12"] },
    { "id": 3, "tasks": ["3.1", "3.2"] },
    { "id": 4, "tasks": ["3.3", "3.4"] },
    { "id": 5, "tasks": ["4.1", "4.2"] },
    { "id": 6, "tasks": ["4.3", "4.4"] },
    { "id": 7, "tasks": ["6.1", "6.2"] },
    { "id": 8, "tasks": ["6.3", "6.4", "6.5"] },
    { "id": 9, "tasks": ["7.1"] },
    { "id": 10, "tasks": ["7.2", "7.3"] },
    { "id": 11, "tasks": ["8.1"] },
    { "id": 12, "tasks": ["8.2", "8.3"] },
    { "id": 13, "tasks": ["10.1"] },
    { "id": 14, "tasks": ["10.2"] },
    { "id": 15, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 16, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 17, "tasks": ["13.1", "13.2", "13.3"] }
  ]
}
```
