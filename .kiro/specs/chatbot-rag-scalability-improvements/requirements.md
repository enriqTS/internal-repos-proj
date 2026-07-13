# Requirements Document

## Introduction

This document specifies the scalability and reliability improvements for the two chatbot-rag templates (`chatbot-rag-mantle` and `chatbot-rag-agentcore`). Both templates share the same serverless architecture pattern (API Gateway → SQS FIFO → Orchestrator Lambda → AI Caller → DynamoDB/S3) and require identical infrastructure enhancements for production readiness. The improvements address timeout correctness, response delivery, immediate retry with failure feedback, automated RAG synchronization via Bedrock Knowledge Base ingestion, API throttling, and observability.

## Glossary

- **Orchestrator_Lambda**: The Lambda function that manages conversation flow, coordinates AI calls, and handles the tool-use loop (mantle) or delegates to AgentCore (agentcore).
- **AI_Caller_Lambda**: The Lambda function that invokes the AI model (Bedrock Mantle API or AgentCore Runtime).
- **Tool_Executor_Lambda**: The Lambda function that executes tool calls such as RAG document retrieval from the knowledge base.
- **SQS_Main_Queue**: The FIFO SQS queue that receives chat messages from API Gateway and triggers the Orchestrator_Lambda.
- **SQS_DLQ**: The dead-letter queue (FIFO) that receives messages that exceed the maximum receive count on the SQS_Main_Queue. Retained as a safety net for catastrophic failures (Lambda crash/timeout).
- **Responses_Table**: A DynamoDB table that stores asynchronous processing results keyed by `messageId` for client polling.
- **RAG_Bucket**: The S3 bucket storing knowledge base documents that serves as a data source for the Bedrock Knowledge Base.
- **KB_Sync_Lambda**: A Lambda function triggered by S3 events on the RAG_Bucket that calls `StartIngestionJob` on the Bedrock Knowledge Base to re-index updated documents.
- **Bedrock_Knowledge_Base**: An AWS Bedrock managed Knowledge Base that handles document chunking, embedding (via Amazon Titan Embed), and vector storage internally.
- **API_Gateway**: The REST API Gateway serving as the entry point for client requests.
- **Monitoring_Module**: A Terraform module (`infra/modules/monitoring/`) that provisions X-Ray tracing, CloudWatch dashboards, custom metrics, and alarms.
- **project_prefix**: A Terraform variable used as a naming prefix for all provisioned AWS resources.
- **messageId**: A unique identifier generated per chat request, used for end-to-end tracing and response polling by clients.
- **visibility_timeout_seconds**: The SQS setting that controls how long a message remains invisible after being received by a consumer.
- **TTL**: Time-to-live attribute on DynamoDB items that enables automatic expiration and deletion.

## Requirements

### Requirement 1: Lambda and SQS Timeout Alignment

**User Story:** As a platform engineer, I want Lambda timeouts and SQS visibility timeout to be correctly aligned, so that messages are not reprocessed while still being actively handled.

#### Acceptance Criteria

1. THE Orchestrator_Lambda SHALL have a timeout of 150 seconds.
2. THE AI_Caller_Lambda SHALL have a timeout of 90 seconds.
3. THE SQS_Main_Queue SHALL have a visibility_timeout_seconds of 900 seconds.
4. THE SQS_Main_Queue visibility_timeout_seconds SHALL be at least 6 times the Orchestrator_Lambda timeout.

### Requirement 2: Response Storage and Polling Endpoint

**User Story:** As a client developer, I want to poll for chatbot responses via a dedicated endpoint, so that I can retrieve AI-generated answers in this non-streaming architecture.

#### Acceptance Criteria

1. THE Responses_Table SHALL use `messageId` (String) as the partition key.
2. THE Responses_Table SHALL store attributes: `response`, `status`, `timestamp`, and `userId`.
3. THE Responses_Table SHALL use a TTL attribute named `expiresAt` set to 7 days from item creation.
4. THE Responses_Table SHALL use PAY_PER_REQUEST billing mode.
5. WHEN the Orchestrator_Lambda completes processing successfully, THE Orchestrator_Lambda SHALL write a record to the Responses_Table with status `completed` and the AI-generated response.
6. WHEN the Orchestrator_Lambda exhausts all retry attempts, THE Orchestrator_Lambda SHALL write a record to the Responses_Table with status `failed` and an error description.
7. WHEN a POST /chat request is accepted, THE API_Gateway SHALL return the `messageId` in the response body for client polling.
8. WHEN a client sends GET /responses/{messageId}, THE API_Gateway SHALL return the corresponding record from the Responses_Table.
9. IF no record exists for the provided messageId, THEN THE API_Gateway SHALL return HTTP 404 with a descriptive error message.
10. WHEN a record exists with status `pending`, THE API_Gateway SHALL return HTTP 200 with status `pending` to indicate processing is in progress.

### Requirement 3: Immediate Retry with Failure Feedback

**User Story:** As a user of the chatbot, I want my messages to be retried immediately on transient failures and to receive a failure notification promptly, so that I don't wait indefinitely for a response.

#### Acceptance Criteria

1. WHEN the Orchestrator_Lambda encounters a transient failure (AI Caller timeout, throttling, or tool execution error), THE Orchestrator_Lambda SHALL retry the failed operation immediately within the same execution.
2. THE Orchestrator_Lambda SHALL retry failed operations up to a configurable maximum number of attempts (default 3) with exponential backoff.
3. WHEN all retry attempts are exhausted, THE Orchestrator_Lambda SHALL write a record to the Responses_Table with status `failed` and a descriptive error message.
4. WHEN all retry attempts are exhausted, THE Orchestrator_Lambda SHALL delete the message from the SQS_Main_Queue (successful processing) to prevent SQS-level redelivery.
5. THE SQS_DLQ SHALL be retained as a safety net for catastrophic failures only (Lambda crash, timeout, out-of-memory) where the Orchestrator_Lambda cannot execute its error handling logic.
6. WHEN a retry attempt occurs, THE Orchestrator_Lambda SHALL log the attempt number, error type, and backoff duration for observability.

### Requirement 4: RAG Knowledge Base Auto-Sync via S3 Events

**User Story:** As a knowledge base manager, I want documents uploaded to the RAG bucket to automatically trigger a Bedrock Knowledge Base ingestion job, so that the chatbot can retrieve the latest information without manual re-indexing.

#### Acceptance Criteria

1. THE RAG_Bucket SHALL emit S3 event notifications for `s3:ObjectCreated:*` and `s3:ObjectRemoved:*` events.
2. WHEN an S3 event is received, THE KB_Sync_Lambda SHALL call `bedrock:StartIngestionJob` on the configured Bedrock_Knowledge_Base to re-index the data source.
3. WHEN a `StartIngestionJob` call succeeds, THE KB_Sync_Lambda SHALL log the ingestion job ID for audit purposes.
4. IF a `ConflictException` is returned (ingestion job already running), THE KB_Sync_Lambda SHALL log the conflict at INFO level and return success without error.
5. THE KB_Sync_Lambda SHALL receive the Knowledge Base ID and Data Source ID as environment variables.
6. THE KB_Sync_Lambda SHALL have IAM permissions for `bedrock:StartIngestionJob` on the Bedrock_Knowledge_Base.
7. THE KB_Sync_Lambda SHALL use the shared Lambda layer for logging utilities (aws-lambda-powertools).
8. THE Bedrock_Knowledge_Base SHALL be configured with the RAG_Bucket as its S3 data source and Amazon Titan Embed as the embedding model.

### Requirement 5: API Gateway Throttling and Caching

**User Story:** As a platform engineer, I want API Gateway to enforce rate limits and cache read responses, so that the system is protected from traffic spikes and redundant backend calls.

#### Acceptance Criteria

1. THE API_Gateway stage SHALL have an explicit throttling_rate_limit configured.
2. THE API_Gateway stage SHALL have an explicit throttling_burst_limit configured.
3. THE API_Gateway SHALL have a usage plan with per-API-key quotas.
4. THE API_Gateway SHALL enable response caching on the GET /responses/{messageId} endpoint.
5. WHEN a cached response exists for a GET /responses/{messageId} request, THE API_Gateway SHALL return the cached response without invoking the backend integration.

### Requirement 6: Observability at Scale

**User Story:** As a platform engineer, I want comprehensive tracing, metrics, dashboards, and alarms, so that I can monitor system health and troubleshoot issues in production.

#### Acceptance Criteria

1. THE Orchestrator_Lambda, AI_Caller_Lambda, Tool_Executor_Lambda, and KB_Sync_Lambda SHALL have X-Ray tracing enabled with mode set to `Active`.
2. THE API_Gateway stage SHALL have X-Ray tracing enabled.
3. THE Orchestrator_Lambda SHALL emit custom CloudWatch metrics: MessageProcessingLatency (milliseconds) and ConversationLength (message count).
4. THE AI_Caller_Lambda SHALL emit a custom CloudWatch metric: AIModelLatency (milliseconds).
5. THE Tool_Executor_Lambda SHALL emit a custom CloudWatch metric: ToolExecutionLatency (milliseconds).
6. THE Monitoring_Module SHALL provision a CloudWatch Dashboard with widgets for all custom metrics and DLQDepth.
7. THE Monitoring_Module SHALL provision a CloudWatch Alarm that triggers when any Lambda error rate exceeds 5% over a 5-minute period.
8. THE Monitoring_Module SHALL provision a CloudWatch Alarm that triggers when p99 latency exceeds the defined SLA threshold.
9. THE Monitoring_Module SHALL provision a CloudWatch Alarm that triggers when DLQ depth exceeds a configurable threshold.
10. THE Monitoring_Module SHALL be provisioned as a reusable Terraform module at `infra/modules/monitoring/`.

### Requirement 7: Cross-Template Consistency

**User Story:** As a template maintainer, I want both chatbot-rag-mantle and chatbot-rag-agentcore templates to receive identical infrastructure improvements, so that users of either template get the same production-readiness guarantees.

#### Acceptance Criteria

1. THE chatbot-rag-mantle template SHALL include all infrastructure changes specified in Requirements 1 through 6.
2. THE chatbot-rag-agentcore template SHALL include all infrastructure changes specified in Requirements 1 through 6.
3. WHEN a new Terraform module is created, THE module SHALL follow the existing modular structure under `infra/modules/`.
4. WHEN new Lambda functions are created, THE Lambda functions SHALL use Python 3.12 runtime. THE shared Lambda layer for aws-lambda-powertools utilities SHOULD be included but is not required if the function operates correctly without it.
5. WHEN new DynamoDB tables are created, THE tables SHALL use PAY_PER_REQUEST billing mode consistent with the existing user-context table.
6. THE KB_Sync_Lambda implementation SHALL follow the pattern established in #[[file:~/upd8/Secretaria-Eva-IA/src/lambda/kb_sync/lambda_function.py]] and #[[file:~/upd8/Secretaria-Eva-IA/terraform/modules/compute/lambda/kb-sync/lambda.tf]].
