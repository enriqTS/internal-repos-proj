# Implementation Plan: Chatbot RAG Scalability Improvements

## Overview

This plan implements production-readiness improvements for both chatbot-rag templates (mantle and agentcore). All changes are first implemented in `chatbot-rag-mantle`, then copied to `chatbot-rag-agentcore`. The order follows the dependency chain: timeout configuration → responses table → orchestrator refactor → KB sync → API gateway → monitoring → copy to agentcore.

**Language**: Python 3.12 (Lambda code), HCL (Terraform)
**Template path**: `templates/chatbot-rag-mantle/`

## Tasks

- [x] 1. Update timeout and SQS visibility configuration
  - [x] 1.1 Update Orchestrator Lambda timeout to 150s and add X-Ray tracing
    - Modify `infra/modules/lambda/orchestrator/lambda.tf`: change `timeout = 30` to `timeout = 150`, add `tracing_config { mode = "Active" }`
    - _Requirements: 1.1, 6.1_
  - [x] 1.2 Update AI Caller Lambda timeout to 90s and add X-Ray tracing
    - Modify `infra/modules/lambda/ai_caller/lambda.tf`: change timeout to 90, add `tracing_config { mode = "Active" }`
    - _Requirements: 1.2, 6.1_
  - [x] 1.3 Update Tool Executor Lambda to add X-Ray tracing
    - Modify `infra/modules/lambda/tool_executor/lambda.tf`: add `tracing_config { mode = "Active" }`
    - _Requirements: 6.1_
  - [x] 1.4 Update SQS visibility timeout to 900s
    - Modify `infra/modules/sqs/main.tf`: change `visibility_timeout_seconds = 60` to `visibility_timeout_seconds = 900`
    - _Requirements: 1.3, 1.4_

- [x] 2. Create Responses Table DynamoDB module
  - [x] 2.1 Create `infra/modules/dynamodb_responses/` module
    - Create `main.tf` with `aws_dynamodb_table.responses` (PAY_PER_REQUEST, hash_key=messageId, TTL on expiresAt)
    - Create `variables.tf` with `project_prefix` variable
    - Create `outputs.tf` exposing `table_name` and `table_arn`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 2.2 Wire the dynamodb_responses module in `infra/environment/dev/main.tf`
    - Add `module "dynamodb_responses"` block referencing the new module
    - _Requirements: 2.1_

- [x] 3. Refactor Orchestrator with retry logic and response writes
  - [x] 3.1 Add retry helper and response write utilities to Orchestrator
    - Modify `src/orchestrator/handler.py`: add `_retry_with_backoff()` function with exponential backoff, add `_write_response()` function to write to Responses Table, add `RESPONSES_TABLE_NAME` env var, add Powertools `Metrics` import and initialization
    - _Requirements: 3.1, 3.2, 3.6_
  - [x] 3.2 Refactor Orchestrator handler to use retry logic and always write responses
    - Modify `src/orchestrator/handler.py`: wrap `invoke_ai_caller` and `invoke_tool_executor` calls with `_retry_with_backoff()`, write `pending` status at start, write `completed` on success, write `failed` on exhausted retries, never re-raise exceptions (return 200 always)
    - _Requirements: 2.5, 2.6, 3.3, 3.4_
  - [x] 3.3 Add Powertools Metrics emission to Orchestrator
    - Emit `MessageProcessingLatency` and `ConversationLength` custom CloudWatch metrics via `@metrics.log_metrics` decorator
    - _Requirements: 6.3_
  - [x] 3.4 Update Orchestrator Terraform to pass Responses Table config
    - Modify `infra/modules/lambda/orchestrator/variables.tf`: add `responses_table_arn` and `responses_table_name` variables
    - Modify `infra/modules/lambda/orchestrator/lambda.tf`: add `RESPONSES_TABLE_NAME` env var
    - Modify `infra/modules/lambda/orchestrator/iam.tf`: add `dynamodb:PutItem` permission on responses table ARN
    - Update `infra/environment/dev/main.tf` orchestrator module call to pass the new variables
    - _Requirements: 2.5, 2.6, 3.3_
  - [ ]* 3.5 Write property tests for Orchestrator retry and response logic
    - **Property 1: TTL computation correctness** — verify expiresAt = timestamp + 604800
    - **Property 2: Successful processing writes completed response** — mock AI caller success, verify completed record
    - **Property 3: Exhausted retries write failed response** — mock persistent failures, verify failed record
    - **Property 5: Retry count bounded by configuration** — mock failures, verify exact N attempts
    - **Property 6: No re-raise after retry exhaustion** — verify handler returns without raising
    - **Property 8: Custom metrics emission** — verify both metrics emitted on success
    - **Validates: Requirements 2.3, 2.5, 2.6, 3.2, 3.3, 3.4, 6.3**

- [x] 4. Checkpoint — Verify orchestrator changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create Responses Reader Lambda
  - [x] 5.1 Create `src/responses_reader/handler.py`
    - Implement GET /responses/{messageId} handler: read from Responses Table by messageId, return 404 if not found, return 200 with record if found
    - _Requirements: 2.8, 2.9, 2.10_
  - [x] 5.2 Create `infra/modules/lambda/responses_reader/` Terraform module
    - Create `lambda.tf` (Python 3.12, timeout=10s, shared layer, env var RESPONSES_TABLE_NAME, tracing_config Active)
    - Create `iam.tf` (dynamodb:GetItem on responses table, basic execution role)
    - Create `variables.tf` (project_prefix, shared_layer_arn, responses_table_arn, responses_table_name, log_level)
    - Create `outputs.tf` (function_arn, function_name, invoke_arn)
    - _Requirements: 2.8, 6.1_
  - [x] 5.3 Wire the responses_reader module in `infra/environment/dev/main.tf`
    - Add `module "responses_reader"` block passing required variables
    - _Requirements: 2.8_
  - [ ]* 5.4 Write property test for Responses Reader round-trip
    - **Property 4: Response reader round-trip** — store random records, call handler, verify returned data matches
    - **Validates: Requirements 2.8**

- [x] 6. Create KB Sync Lambda and Bedrock Knowledge Base module
  - [x] 6.1 Create `infra/modules/bedrock_kb/` Terraform module
    - Create `main.tf` with `aws_bedrockagent_knowledge_base` (Titan Embed v2, OpenSearch Serverless) and `aws_bedrockagent_data_source` (S3), plus IAM role for Bedrock KB S3 access
    - Create `variables.tf` (project_prefix, aws_region, rag_bucket_arn, opensearch_collection_arn)
    - Create `outputs.tf` (knowledge_base_id, data_source_id)
    - _Requirements: 4.8_
  - [x] 6.2 Create `src/kb_sync/handler.py`
    - Implement S3 event trigger handler: call `bedrock:StartIngestionJob`, log ingestion job ID on success, handle ConflictException gracefully (log INFO, return success)
    - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - [x] 6.3 Create `infra/modules/lambda/kb_sync/` Terraform module
    - Create `lambda.tf` (Python 3.12, timeout=30s, shared layer, env vars KNOWLEDGE_BASE_ID + DATA_SOURCE_ID, tracing_config Active)
    - Create `iam.tf` (bedrock:StartIngestionJob permission, basic execution role)
    - Create `variables.tf` (project_prefix, shared_layer_arn, knowledge_base_id, data_source_id, s3_bucket_arn, log_level)
    - Create `outputs.tf` (function_arn, function_name)
    - _Requirements: 4.5, 4.6, 4.7, 6.1_
  - [x] 6.4 Modify S3 module to add event notifications for KB Sync
    - Modify `infra/modules/s3/main.tf`: add `aws_s3_bucket_notification` (ObjectCreated + ObjectRemoved → KB_Sync_Lambda) and `aws_lambda_permission` for S3 invoke
    - Modify `infra/modules/s3/variables.tf`: add `kb_sync_lambda_arn` and `kb_sync_lambda_function_name` variables
    - _Requirements: 4.1_
  - [x] 6.5 Wire bedrock_kb and kb_sync modules in `infra/environment/dev/main.tf`
    - Add `module "bedrock_kb"` and `module "kb_sync"` blocks, pass outputs between them
    - Update `module "s3"` call to pass kb_sync lambda ARN/name
    - _Requirements: 4.1, 4.8_
  - [ ]* 6.6 Write property test for KB Sync Lambda
    - **Property 7: KB Sync calls StartIngestionJob for any S3 event** — generate random S3 event payloads, mock bedrock client, verify exactly one StartIngestionJob call
    - **Validates: Requirements 4.2**

- [x] 7. Checkpoint — Verify KB sync and responses reader
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update API Gateway for throttling, caching, and new endpoint
  - [x] 8.1 Add GET /responses/{messageId} endpoint to OpenAPI spec
    - Modify `infra/openapi/api-spec.json`: add `/responses/{messageId}` path with GET method, Lambda proxy integration to responses_reader
    - _Requirements: 2.8, 2.9, 2.10_
  - [x] 8.2 Update POST /chat response to return messageId
    - Modify `infra/openapi/api-spec.json`: update POST /chat response mapping to include `messageId` from `$context.requestId`
    - _Requirements: 2.7_
  - [x] 8.3 Add throttling, usage plan, and caching to API Gateway Terraform module
    - Modify `infra/modules/api_gateway/main.tf`: add `aws_api_gateway_method_settings` (rate/burst limits), `aws_api_gateway_usage_plan`, `aws_api_gateway_api_key`, `aws_api_gateway_usage_plan_key`, cache settings on GET /responses, enable `xray_tracing_enabled` and `cache_cluster_enabled` on stage
    - Modify `infra/modules/api_gateway/variables.tf`: add throttle_rate_limit, throttle_burst_limit, quota_limit, cache_enabled, cache_size, cache_ttl, responses_reader_invoke_arn variables
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.2_
  - [x] 8.4 Update `infra/environment/dev/main.tf` and `variables.tf` with new API Gateway variables
    - Pass responses_reader invoke ARN and new throttling/cache variables to the api_gateway module
    - Add throttle/cache variable declarations to `infra/environment/dev/variables.tf` with defaults
    - _Requirements: 5.1, 5.2_

- [x] 9. Add Powertools Metrics to AI Caller and Tool Executor
  - [x] 9.1 Add AIModelLatency metric to AI Caller Lambda
    - Modify `src/ai_caller/handler.py`: add Powertools Metrics initialization, emit `AIModelLatency` metric on each invocation
    - _Requirements: 6.4_
  - [x] 9.2 Add ToolExecutionLatency metric to Tool Executor Lambda
    - Modify `src/tool_executor/handler.py`: add Powertools Metrics initialization, emit `ToolExecutionLatency` metric on each invocation
    - _Requirements: 6.5_

- [x] 10. Create Monitoring Terraform module
  - [x] 10.1 Create `infra/modules/monitoring/` module
    - Create `main.tf` with CloudWatch Dashboard (MessageProcessingLatency, AIModelLatency, ToolExecutionLatency, ConversationLength, DLQ depth, Lambda errors/duration widgets) and 3 CloudWatch Alarms (error rate > 5%, p99 latency > SLA threshold, DLQ depth > threshold)
    - Create `variables.tf` (project_prefix, orchestrator_function_name, ai_caller_function_name, tool_executor_function_name, kb_sync_function_name, dlq_name, sla_latency_threshold_ms, dlq_depth_threshold, sns_alarm_topic_arn)
    - Create `outputs.tf` (dashboard_arn, alarm_arns)
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 6.10_
  - [x] 10.2 Wire monitoring module in `infra/environment/dev/main.tf`
    - Add `module "monitoring"` block passing all Lambda function names and DLQ name
    - Add monitoring-related variables (thresholds) to `infra/environment/dev/variables.tf`
    - _Requirements: 6.6_

- [x] 11. Checkpoint — Verify complete chatbot-rag-mantle template
  - Run `terraform validate` on `infra/environment/dev/`
  - Ensure all property tests and unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Copy all changes to chatbot-rag-agentcore template
  - [x] 12.1 Copy new infra modules to chatbot-rag-agentcore
    - Copy `infra/modules/dynamodb_responses/` directory
    - Copy `infra/modules/lambda/responses_reader/` directory
    - Copy `infra/modules/lambda/kb_sync/` directory
    - Copy `infra/modules/bedrock_kb/` directory
    - Copy `infra/modules/monitoring/` directory
    - _Requirements: 7.1, 7.2_
  - [x] 12.2 Copy new Lambda source code to chatbot-rag-agentcore
    - Copy `src/responses_reader/` directory
    - Copy `src/kb_sync/` directory
    - _Requirements: 7.1, 7.2_
  - [x] 12.3 Apply modifications to existing chatbot-rag-agentcore files
    - Apply same timeout/X-Ray changes to `infra/modules/lambda/orchestrator/lambda.tf`, `ai_caller/lambda.tf`, `tool_executor/lambda.tf`
    - Apply same SQS visibility change to `infra/modules/sqs/main.tf`
    - Apply same S3 notification changes to `infra/modules/s3/main.tf` and `variables.tf`
    - Apply same API Gateway changes to `infra/modules/api_gateway/main.tf` and `variables.tf`
    - Apply same OpenAPI spec changes to `infra/openapi/api-spec.json`
    - Update `infra/environment/dev/main.tf` and `variables.tf` with all new module calls and variables
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 12.4 Apply Orchestrator handler changes to chatbot-rag-agentcore
    - Copy retry logic, response writes, and metrics to `src/orchestrator/handler.py` (adapt to agentcore-specific handler if it differs)
    - Apply AI Caller and Tool Executor metrics changes
    - _Requirements: 7.1, 7.2_
  - [x] 12.5 Update Orchestrator IAM and variables for chatbot-rag-agentcore
    - Apply same `iam.tf` and `variables.tf` changes to the agentcore orchestrator module
    - _Requirements: 7.1, 7.2_

- [x] 13. Final checkpoint — Verify both templates
  - Run `terraform validate` on chatbot-rag-agentcore `infra/environment/dev/`
  - Confirm both templates have identical infrastructure improvements
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All changes are implemented first in `chatbot-rag-mantle`, then mirrored to `chatbot-rag-agentcore` in task 12
- Property tests use `hypothesis` library for Python
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical milestones
- The Bedrock KB module assumes an OpenSearch Serverless collection exists (or will be provisioned separately)
