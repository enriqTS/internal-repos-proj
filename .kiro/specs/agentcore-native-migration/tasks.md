# Implementation Plan: AgentCore Native Session Migration

## Overview

This plan migrates all 6 AgentCore chatbot-RAG template variants to leverage native AgentCore Runtime session management. Work is organized shared-first (modules used by multiple variants), then per-variant changes, then infrastructure, monitoring, tests, and documentation. Python is the implementation language throughout.

## Tasks

- [x] 1. Update shared layer modules (Lambda variants)
  - [x] 1.1 Simplify `ai_caller_agentcore.py` interface in `chatbot-rag-agentcore-ws`
    - Open `templates/chatbot-rag-agentcore-ws/src/layers/shared/python/shared/ai_caller_agentcore.py`
    - Change `invoke_agentcore()` signature: replace `messages: list[dict]` param with `message: str`
    - Remove `tools` parameter from the function signature
    - Remove `_extract_latest_user_message()` helper function
    - Pass `message` directly as `inputText` in `invoke_agent()` call (no message array construction)
    - Keep: `sessionId`, `agentId`, `agentAliasId`, `sessionState` params in `invoke_agent()` call
    - Keep: token usage extraction, finish reason extraction, structured logging, streaming support
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 1.2 Simplify `ai_caller_agentcore.py` interface in `chatbot-rag-agentcore-ws-streaming`
    - Apply identical changes as 1.1 to `templates/chatbot-rag-agentcore-ws-streaming/src/layers/shared/python/shared/ai_caller_agentcore.py`
    - Ensure streaming generator function (`invoke_agentcore_streaming` or equivalent) also uses `message: str` instead of `messages: list`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 1.3 Simplify `ai_caller_agentcore.py` interface in `chatbot-rag-agentcore` (REST variant)
    - Apply identical changes as 1.1 to `templates/chatbot-rag-agentcore/src/layers/shared/python/shared/ai_caller_agentcore.py`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 1.4 Update `conversation_context.py` in all 3 Lambda variants
    - Files: `templates/chatbot-rag-agentcore{,-ws,-ws-streaming}/src/layers/shared/python/shared/conversation_context.py`
    - Remove `get_conversation_history()` from public exports (or mark as internal `_get_conversation_history`)
    - Keep `append_messages()` and `save_conversation_history()` and `trim_history()` for compliance writes
    - Ensure `append_messages()` can still work internally (it may read-append-write)
    - _Requirements: 1.1, 1.4, 2.1, 2.3_

- [x] 2. Update ECS app modules (3 ECS variants)
  - [x] 2.1 Simplify `ai_caller.py` in `chatbot-rag-agentcore-ecs`
    - Open `templates/chatbot-rag-agentcore-ecs/src/app/ai_caller.py`
    - Change `invoke_agentcore()` signature: replace `messages: list[dict]` with `message: str`
    - Remove `tools` parameter
    - Remove `_extract_latest_user_message()` helper
    - Pass `message` directly as `inputText` in `invoke_agent()` call
    - Keep: session management, token extraction, logging, error handling
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 2.2 Simplify `ai_caller.py` in `chatbot-rag-agentcore-ecs-ws`
    - Apply identical changes as 2.1 to `templates/chatbot-rag-agentcore-ecs-ws/src/app/ai_caller.py`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 2.3 Simplify `ai_caller.py` in `chatbot-rag-agentcore-ecs-ws-streaming`
    - Apply identical changes as 2.1 to `templates/chatbot-rag-agentcore-ecs-ws-streaming/src/app/ai_caller.py`
    - Ensure streaming function also uses `message: str`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 2.4 Update `conversation_context.py` in all 3 ECS variants
    - Files: `templates/chatbot-rag-agentcore-ecs{,-ws,-ws-streaming}/src/app/conversation_context.py`
    - Remove `get_conversation_history()` from public interface (keep internal if needed by `append_messages`)
    - Keep `append_messages()`, `save_conversation_history()`, `trim_history()`
    - _Requirements: 1.1, 1.4, 2.1_

  - [x] 2.5 Update `orchestrator.py` in `chatbot-rag-agentcore-ecs`
    - Open `templates/chatbot-rag-agentcore-ecs/src/app/orchestrator.py`
    - Remove call to `get_conversation_history()` / `retrieve_conversation_history()`
    - Remove construction of `messages` array from history + new message
    - Invoke AI Caller with `message=message_text` (string) instead of `messages=[...]`
    - Keep: saving conversation exchange after successful response (`append_messages`)
    - Keep: error handling, correlation ID propagation
    - _Requirements: 1.1, 1.2, 2.1, 2.4_

  - [x] 2.6 Update `orchestrator.py` in `chatbot-rag-agentcore-ecs-ws`
    - Apply identical orchestrator changes as 2.5 to `templates/chatbot-rag-agentcore-ecs-ws/src/app/orchestrator.py`
    - Keep: WebSocket response delivery logic
    - _Requirements: 1.1, 1.2, 2.1, 2.4, 6.2_

  - [x] 2.7 Update `orchestrator.py` in `chatbot-rag-agentcore-ecs-ws-streaming`
    - Apply identical orchestrator changes as 2.5 to `templates/chatbot-rag-agentcore-ecs-ws-streaming/src/app/orchestrator.py`
    - Keep: streaming chunk delivery, abort-on-disconnect logic
    - _Requirements: 1.1, 1.2, 2.1, 2.4, 6.3, 6.5_

- [x] 3. Checkpoint — Verify ECS and shared layer changes
  - Ensure all tests pass, ask the user if questions arise.
  - Run `uv run pytest` in each ECS variant to confirm no import errors or broken tests.

- [x] 4. Update Lambda AI Caller handlers (3 Lambda variants)
  - [x] 4.1 Refactor AI Caller handler in `chatbot-rag-agentcore-ws`
    - Open `templates/chatbot-rag-agentcore-ws/src/ai_caller/handler.py`
    - Change event parsing: `event["message"]` (string) + `event["sessionId"]` + `event["correlationId"]`
    - Remove: parsing of `event["messages"]` (list) and `event["tools"]`
    - Remove: `@metrics.log_metrics` decorator and `Metrics` import/instantiation
    - Remove: `metrics.add_metric(name="AIModelLatency", ...)` emission
    - Call `invoke_agentcore(session_id=session_id, message=message, ...)`
    - Keep: `@logger.inject_lambda_context`, structured logging, error handling
    - _Requirements: 7.1, 7.2, 7.3, 4.3_

  - [x] 4.2 Refactor AI Caller handler in `chatbot-rag-agentcore-ws-streaming`
    - Apply identical handler changes as 4.1 to `templates/chatbot-rag-agentcore-ws-streaming/src/ai_caller/handler.py`
    - Ensure streaming response handling is preserved
    - _Requirements: 7.1, 7.2, 7.3, 4.3_

  - [x] 4.3 Refactor AI Caller handler in `chatbot-rag-agentcore` (REST variant)
    - Apply identical handler changes as 4.1 to `templates/chatbot-rag-agentcore/src/ai_caller/handler.py`
    - _Requirements: 7.1, 7.2, 7.3, 4.3_

- [x] 5. Update Lambda Orchestrator handlers
  - [x] 5.1 Refactor Orchestrator handler in `chatbot-rag-agentcore` (REST — keeps SQS trigger)
    - Open `templates/chatbot-rag-agentcore/src/orchestrator/handler.py`
    - Remove: `retrieve_conversation_history()` / `get_conversation_history()` call
    - Remove: building `messages` array from history
    - Invoke AI Caller Lambda with simplified payload: `{"message": msg, "sessionId": user_id, "correlationId": corr_id}`
    - Keep: SQS `event["Records"]` parsing (REST variant stays SQS-triggered)
    - Keep: writing response to Responses Table for client polling
    - Keep: `append_messages()` call to save exchange for compliance
    - Keep: `MessageProcessingLatency` and `ConversationLength` metric emissions
    - _Requirements: 1.1, 1.2, 2.1, 2.4, 3.5, 6.1_

  - [x] 5.2 Refactor Orchestrator handler in `chatbot-rag-agentcore-ws` (direct WS integration — no SQS)
    - Open `templates/chatbot-rag-agentcore-ws/src/orchestrator/handler.py`
    - Change event parsing from SQS Records format to WebSocket API Gateway event format:
      - `body = json.loads(event.get("body", "{}"))`
      - `connection_id = event["requestContext"]["connectionId"]`
      - `user_id = body["userId"]`
      - `message = body["message"]`
      - `correlation_id = event["requestContext"].get("requestId", str(uuid.uuid4()))`
    - Remove: `retrieve_conversation_history()` / `get_conversation_history()` call
    - Remove: building `messages` array from history
    - Invoke AI Caller Lambda with simplified payload: `{"message": msg, "sessionId": user_id, "correlationId": corr_id}`
    - Keep: sending response back via WebSocket connection (single message frame)
    - Keep: `append_messages()` call for compliance
    - Return `{"statusCode": 200}` for API GW integration response
    - _Requirements: 1.1, 1.2, 2.1, 2.4, 3.1, 3.4, 6.2_

  - [x] 5.3 Refactor Orchestrator handler in `chatbot-rag-agentcore-ws-streaming` (direct WS integration — no SQS)
    - Apply same WebSocket event format changes as 5.2 to `templates/chatbot-rag-agentcore-ws-streaming/src/orchestrator/handler.py`
    - Remove: SQS Records parsing, history retrieval, messages array building
    - Invoke AI Caller with simplified payload
    - Keep: streaming chunk delivery via WebSocket (`chunk` frames + `done` frame)
    - Keep: abort-on-disconnect logic (discard partial, don't persist)
    - Keep: `append_messages()` for compliance (only on full completion)
    - _Requirements: 1.1, 1.2, 2.1, 2.4, 3.1, 3.4, 6.3, 6.5_

- [x] 6. Remove SQS infrastructure from Lambda WS variants
  - [x] 6.1 Remove SQS module from `chatbot-rag-agentcore-ws` infra
    - Delete `templates/chatbot-rag-agentcore-ws/infra/modules/sqs/` directory (main.tf, outputs.tf, variables.tf)
    - Update `templates/chatbot-rag-agentcore-ws/infra/main.tf`: remove `module "sqs"` block and any SQS-related variable references
    - Update Lambda module: remove SQS event source mapping for orchestrator in `infra/modules/lambda/orchestrator/`
    - Remove IAM permissions: `sqs:SendMessage`, `sqs:ReceiveMessage`, `sqs:DeleteMessage` from Orchestrator role
    - _Requirements: 3.2, 3.3_

  - [x] 6.2 Update WebSocket API route integration in `chatbot-rag-agentcore-ws`
    - Open `templates/chatbot-rag-agentcore-ws/infra/modules/websocket_api/main.tf`
    - Change `sendMessage` route `integration_uri` from SQS-enqueue Lambda ARN to Orchestrator Lambda ARN (direct invocation)
    - Ensure API GW has `lambda:InvokeFunction` permission on Orchestrator Lambda
    - _Requirements: 3.1, 3.4_

  - [x] 6.3 Remove SQS module from `chatbot-rag-agentcore-ws-streaming` infra
    - Delete `templates/chatbot-rag-agentcore-ws-streaming/infra/modules/sqs/` directory
    - Apply identical infra/main.tf and Lambda module changes as 6.1 for this variant
    - _Requirements: 3.2, 3.3_

  - [x] 6.4 Update WebSocket API route integration in `chatbot-rag-agentcore-ws-streaming`
    - Apply identical websocket_api changes as 6.2 for this variant
    - _Requirements: 3.1, 3.4_

- [x] 7. Simplify monitoring module
  - [x] 7.1 Update monitoring Terraform module in `chatbot-rag-agentcore` (REST variant)
    - Open `templates/chatbot-rag-agentcore/infra/modules/monitoring/main.tf`
    - Remove `AIModelLatency` dashboard widget
    - Remove `ToolExecutionLatency` dashboard widget
    - Keep: `MessageProcessingLatency`, `ConversationLength`, Lambda Errors widgets
    - Keep: DLQ depth alarm (REST variant still uses SQS)
    - Keep: `p99-latency` alarm, `lambda-error-rate` alarm
    - Keep: X-Ray tracing configuration
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 7.2 Update monitoring configuration in Lambda WS variants
    - If monitoring is configured in `chatbot-rag-agentcore-ws` and `chatbot-rag-agentcore-ws-streaming` (check infra/main.tf or infra/modules for dashboard/alarm resources):
      - Remove `AIModelLatency` and `ToolExecutionLatency` widgets
      - Remove DLQ-related dashboard widgets and alarms (SQS no longer exists)
      - Keep: `MessageProcessingLatency`, `ConversationLength`, Lambda Errors, X-Ray
    - _Requirements: 4.3, 4.4, 4.7_

  - [x] 7.3 Update monitoring configuration in ECS variants
    - If any monitoring/dashboard resources exist in ECS variant infra (`chatbot-rag-agentcore-ecs`, `chatbot-rag-agentcore-ecs-ws`, `chatbot-rag-agentcore-ecs-ws-streaming`):
      - Remove `AIModelLatency` and `ToolExecutionLatency` widgets
      - Keep: business metrics, X-Ray tracing
    - _Requirements: 4.3, 4.4, 4.6_

  - [x] 7.4 Remove custom metric emission from AI Caller code (all variants)
    - In Lambda variants: remove `metrics.add_metric(name="AIModelLatency", ...)` and related Metrics import from AI Caller handlers (if not already done in tasks 4.1-4.3)
    - In ECS variants: remove any custom metric emission for `AIModelLatency` or `ToolExecutionLatency` from `ai_caller.py`
    - _Requirements: 4.3, 4.4_

- [x] 8. Checkpoint — Verify infrastructure and monitoring changes
  - Ensure all tests pass, ask the user if questions arise.
  - Run `terraform validate` in each variant's `infra/` directory to confirm no broken references.
  - Confirm no orphaned SQS references remain in WS variant codebases.

- [x] 9. Update tests across all variants
  - [x] 9.1 Update unit tests for shared layer AI Caller in Lambda variants
    - Update or create tests that verify `invoke_agentcore()` accepts `message: str` (not `messages: list`)
    - Remove tests that pass `messages` array or `tools` parameter
    - Verify tests confirm `inputText` is passed directly to `invoke_agent()`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 9.2 Update unit tests for Orchestrator in Lambda variants
    - Update tests to verify NO call to `get_conversation_history()` occurs before AI invocation
    - Add test: Orchestrator invokes AI Caller with `{"message": ..., "sessionId": ..., "correlationId": ...}` payload
    - For WS variants: update test event fixtures from SQS Records format to WebSocket API GW format
    - For REST variant: keep SQS Records event format in test fixtures
    - Verify `append_messages()` is still called after successful response
    - Add test: DynamoDB write failure does not block response delivery (log ERROR + continue)
    - _Requirements: 1.1, 1.2, 2.1, 2.4, 3.4_

  - [x] 9.3 Update unit tests for ECS app modules
    - Update tests for `ai_caller.py`: verify accepts `message: str`, rejects `messages: list`
    - Update tests for `orchestrator.py`: verify no history retrieval before AI call
    - Verify `append_messages()` is called with user + assistant messages post-invocation
    - Verify DynamoDB write failure is non-blocking (logged, response still returned)
    - _Requirements: 1.1, 2.1, 2.4, 7.1_

  - [ ]* 9.4 Write property test: Conversation exchange persistence (Property 1)
    - **Property 1: Conversation exchange persistence after successful AI response**
    - *For any* successful AI invocation, the Orchestrator saves both user message and assistant response with timestamp and role fields
    - Test across randomized user messages, session IDs, and response contents
    - **Validates: Requirements 2.1, 2.3**

  - [ ]* 9.5 Write property test: AI Caller receives only current message (Property 2)
    - **Property 2: AI Caller receives only current message**
    - *For any* invocation payload, it contains exactly one message string (not an array), a sessionId, and a correlationId
    - Generate random message strings, sessionIds, and verify payload structure
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ]* 9.6 Write property test: No DynamoDB read before AI invocation (Property 3)
    - **Property 3: No DynamoDB read before AI invocation**
    - *For any* message processing flow, mock DynamoDB and verify no `get_item` read occurs before AI Caller invocation
    - **Validates: Requirements 1.1, 1.2, 1.4**

  - [ ]* 9.7 Write property test: DynamoDB write failure is non-blocking (Property 7)
    - **Property 7: DynamoDB write failure is non-blocking**
    - *For any* DynamoDB write failure during conversation persistence, the response is still delivered to the client
    - Generate random failure scenarios and verify graceful degradation
    - **Validates: Requirements 2.4**

- [x] 10. Update README documentation for all variants
  - [x] 10.1 Update README for `chatbot-rag-agentcore` (REST)
    - Document that AgentCore Runtime manages conversation context via `sessionId`
    - Note that conversation history is still persisted to DynamoDB for compliance
    - Update architecture diagram if present (remove history retrieval step)
    - Note monitoring relies on AgentCore vended logs for model/tool latency
    - _Requirements: 5.1_

  - [x] 10.2 Update README for `chatbot-rag-agentcore-ws`
    - Document removal of SQS queue (direct WebSocket → Orchestrator Lambda invocation)
    - Document simplified AI Caller interface
    - Update architecture section to reflect direct integration
    - _Requirements: 3.1, 5.1_

  - [x] 10.3 Update README for `chatbot-rag-agentcore-ws-streaming`
    - Apply same documentation updates as 10.2 for the streaming variant
    - _Requirements: 3.1, 5.1_

  - [x] 10.4 Update README for `chatbot-rag-agentcore-ecs`
    - Document simplified AI Caller interface (single message, not history array)
    - Document AgentCore session management via `sessionId`
    - _Requirements: 5.1_

  - [x] 10.5 Update README for `chatbot-rag-agentcore-ecs-ws`
    - Apply same documentation updates as 10.4 for the ECS WebSocket variant
    - _Requirements: 5.1_

  - [x] 10.6 Update README for `chatbot-rag-agentcore-ecs-ws-streaming`
    - Apply same documentation updates as 10.4 for the ECS streaming variant
    - _Requirements: 5.1_

- [x] 11. Final checkpoint — Full validation
  - Ensure all tests pass across all 6 variants (`uv run pytest`).
  - Run `terraform validate` in each variant's `infra/` directory.
  - Verify no Mantle variants were modified (`chatbot-rag-mantle-*` unchanged).
  - Verify Tool Executor, KB Sync, and Bedrock KB modules are untouched.
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests and can be skipped for faster delivery.
- Shared layer changes (task 1) MUST be completed before Lambda handler changes (tasks 4-5) since handlers import from the shared layer.
- ECS app modules (task 2) are self-contained and can be done in parallel with Lambda shared layer work.
- Infrastructure changes (task 6) should be done AFTER handler refactoring (task 5) to avoid broken deployments.
- The REST variant (`chatbot-rag-agentcore`) retains SQS + Responses Table — do NOT remove those.
- Property tests reference design document properties 1, 2, 3, and 7 (infrastructure properties 4-6, 8-9 are best validated via integration/deployment tests).
