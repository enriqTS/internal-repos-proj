# Design Document: Chatbot RAG Scalability Improvements

## Overview

This design covers production-readiness improvements for both chatbot-rag templates (`chatbot-rag-mantle` and `chatbot-rag-agentcore`). The changes introduce timeout alignment, asynchronous response polling, internal retry with failure feedback, automated RAG Knowledge Base sync, API throttling/caching, and observability infrastructure.

All changes follow the existing modular Terraform pattern (`infra/modules/{module_name}/`) and use Python 3.12 with `aws-lambda-powertools` for Lambda code.

---

## Architecture Additions

> **Purpose**: Reference list for updating the draw.io architecture diagram.

### New AWS Resources

| # | Resource Type | Name/ID Pattern | Module Location | Notes |
|---|---------------|-----------------|-----------------|-------|
| 1 | DynamoDB Table | `{project_prefix}-responses` | `infra/modules/dynamodb_responses/` | PAY_PER_REQUEST, TTL enabled, partition key: `messageId` |
| 2 | Lambda Function | `{project_prefix}-responses-reader` | `infra/modules/lambda/responses_reader/` | GET /responses/{messageId} backend |
| 3 | Lambda Function | `{project_prefix}-kb-sync` | `infra/modules/lambda/kb_sync/` | Triggered by S3 events, calls StartIngestionJob |
| 4 | Bedrock Knowledge Base | `{project_prefix}-knowledge-base` | `infra/modules/bedrock_kb/` | S3 data source + Amazon Titan Embed v2 |
| 5 | Bedrock Data Source | (managed by bedrock_kb module) | `infra/modules/bedrock_kb/` | Points to RAG_Bucket |
| 6 | S3 Bucket Notification | (on existing RAG_Bucket) | `infra/modules/s3/` (modified) | ObjectCreated + ObjectRemoved → KB_Sync_Lambda |
| 7 | API Gateway Resource | `/responses/{messageId}` (GET) | `infra/modules/api_gateway/` (modified) | Lambda proxy integration to responses_reader |
| 8 | API Gateway Usage Plan | `{project_prefix}-usage-plan` | `infra/modules/api_gateway/` (modified) | Rate/burst/quota limits |
| 9 | API Gateway API Key | `{project_prefix}-default-key` | `infra/modules/api_gateway/` (modified) | Associated with usage plan |
| 10 | API Gateway Cache | Stage-level cache cluster | `infra/modules/api_gateway/` (modified) | 0.5 GB, TTL on GET /responses |
| 11 | CloudWatch Dashboard | `{project_prefix}-dashboard` | `infra/modules/monitoring/` | All custom metrics + DLQ depth |
| 12 | CloudWatch Alarms (3) | `{project_prefix}-*-alarm` | `infra/modules/monitoring/` | Error rate, p99 latency, DLQ depth |
| 13 | IAM Role | `{project_prefix}-kb-sync-role` | `infra/modules/lambda/kb_sync/` | bedrock:StartIngestionJob permission |
| 14 | IAM Role | `{project_prefix}-responses-reader-role` | `infra/modules/lambda/responses_reader/` | DynamoDB GetItem on responses table |

### New Connections & Data Flows

| # | Source | Target | Trigger/Mechanism | Description |
|---|--------|--------|-------------------|-------------|
| A | S3 RAG_Bucket | KB_Sync_Lambda | S3 Event Notification (ObjectCreated/ObjectRemoved) | Document upload/delete triggers KB sync |
| B | KB_Sync_Lambda | Bedrock Knowledge Base | `bedrock:StartIngestionJob` API call | Re-indexes the S3 data source |
| C | API Gateway (GET /responses/{messageId}) | Responses_Reader_Lambda | Lambda Proxy Integration | Client polls for response |
| D | Responses_Reader_Lambda | Responses_Table (DynamoDB) | `dynamodb:GetItem` | Reads response by messageId |
| E | Orchestrator_Lambda | Responses_Table (DynamoDB) | `dynamodb:PutItem` | Writes completed/failed response |
| F | API Gateway Stage | CloudWatch (X-Ray) | X-Ray Tracing | Request tracing |
| G | All Lambdas | CloudWatch (X-Ray) | X-Ray Active Tracing | Distributed tracing |
| H | All Lambdas | CloudWatch Metrics | Powertools Metrics (EMF) | Custom business metrics |

### Modified Existing Resources

| Resource | Change |
|----------|--------|
| Orchestrator Lambda | timeout: 30s → 150s, new env vars (RESPONSES_TABLE_NAME), new IAM (PutItem on responses table), X-Ray Active |
| AI Caller Lambda | timeout: 30s → 90s, X-Ray Active, Powertools Metrics |
| Tool Executor Lambda | X-Ray Active, Powertools Metrics |
| SQS Main Queue | visibility_timeout_seconds: 60s → 900s |
| API Gateway Stage | xray_tracing_enabled, method_settings (throttle + cache), cache_cluster_enabled |
| POST /chat response template | Now returns `messageId` (mapped from SQS MessageId or $context.requestId) |

---

## Component Design

### 1. Timeout Alignment (Requirement 1)

**Changes are configuration-only in Terraform:**

- `infra/modules/lambda/orchestrator/lambda.tf`: `timeout = 150`
- `infra/modules/lambda/ai_caller/lambda.tf`: `timeout = 90`
- `infra/modules/sqs/main.tf`: `visibility_timeout_seconds = 900`

**Rationale**: The visibility timeout (900s) is 6x the orchestrator timeout (150s) to prevent message redelivery during retries and tool-use loops. The AI Caller timeout (90s) allows headroom for model inference on large contexts.

---

### 2. Responses Table Module (`infra/modules/dynamodb_responses/`)

**Resources:**

```hcl
resource "aws_dynamodb_table" "responses" {
  name         = "${var.project_prefix}-responses"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "messageId"

  attribute {
    name = "messageId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = {
    Name    = "${var.project_prefix}-responses"
    Project = var.project_prefix
  }
}
```

**Item Schema (application-level):**

```json
{
  "messageId": "string (partition key)",
  "status": "pending | completed | failed",
  "response": "string (AI response text, empty if failed)",
  "error": "string (error description, empty if completed)",
  "userId": "string",
  "timestamp": "string (ISO 8601)",
  "expiresAt": "number (epoch seconds, creation + 604800)"
}
```

---

### 3. Responses Reader Lambda (`infra/modules/lambda/responses_reader/`)

A thin Lambda that reads from the Responses_Table by `messageId` and returns the result.

**Handler pseudocode (Python 3.12):**

```python
# src/responses_reader/handler.py
def handler(event, context):
    message_id = event["pathParameters"]["messageId"]
    item = table.get_item(Key={"messageId": message_id})

    if "Item" not in item:
        return {"statusCode": 404, "body": json.dumps({"error": "not_found", "message": f"No response found for messageId: {message_id}"})}

    record = item["Item"]
    return {"statusCode": 200, "body": json.dumps(record)}
```

**Terraform resources:**
- `aws_lambda_function.responses_reader` (Python 3.12, timeout=10s, shared layer)
- `aws_iam_role` with `dynamodb:GetItem` on responses table
- `aws_lambda_permission` for API Gateway invocation

---

### 4. Orchestrator Retry Logic (Requirement 3)

The existing orchestrator handler is refactored to:
1. Catch transient errors in `invoke_ai_caller` and `invoke_tool_executor`
2. Retry with exponential backoff internally
3. On success → write `completed` to Responses_Table
4. On exhausted retries → write `failed` to Responses_Table
5. **Never re-raise** — the Lambda always returns successfully, preventing SQS redelivery

**Retry wrapper pseudocode:**

```python
import time
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit

metrics = Metrics(namespace="ChatbotRAG", service="orchestrator")

BACKOFF_BASE = 2  # seconds
MAX_RETRY_ATTEMPTS = int(os.environ.get("MAX_RETRY_ATTEMPTS", "3"))
RESPONSES_TABLE_NAME = os.environ.get("RESPONSES_TABLE_NAME", "")

responses_table = dynamodb.Table(RESPONSES_TABLE_NAME) if RESPONSES_TABLE_NAME else None


def _retry_with_backoff(func, *args, correlation_id="", **kwargs):
    """Retry a callable with exponential backoff. Returns (success, result_or_error)."""
    last_error = None
    for attempt in range(1, MAX_RETRY_ATTEMPTS + 1):
        try:
            result = func(*args, **kwargs)
            return True, result
        except Exception as e:
            last_error = e
            backoff = BACKOFF_BASE ** attempt
            logger.warning(
                "Retry attempt",
                extra={
                    "correlationId": correlation_id,
                    "attempt": attempt,
                    "maxAttempts": MAX_RETRY_ATTEMPTS,
                    "errorType": type(e).__name__,
                    "errorMessage": str(e),
                    "backoffSeconds": backoff,
                },
            )
            if attempt < MAX_RETRY_ATTEMPTS:
                time.sleep(backoff)
    return False, last_error


def _write_response(message_id, status, response="", error="", user_id=""):
    """Write processing result to the Responses Table."""
    import time as t
    now = int(t.time())
    expires_at = now + 604800  # 7 days

    responses_table.put_item(Item={
        "messageId": message_id,
        "status": status,
        "response": response,
        "error": error,
        "userId": user_id,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "expiresAt": expires_at,
    })
```

**Modified handler flow:**

```python
@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event, context):
    record = event["Records"][0]
    body = json.loads(record["body"])
    message_id = body.get("messageId", context.aws_request_id)

    # Write "pending" immediately
    _write_response(message_id, status="pending", user_id=body.get("userId", ""))

    try:
        response = _process_message(body, message_id)
        _write_response(message_id, status="completed", response=response, user_id=body.get("userId", ""))
    except Exception as e:
        # All retries exhausted — write failure, DO NOT re-raise
        _write_response(message_id, status="failed", error=str(e), user_id=body.get("userId", ""))
        logger.error("All retries exhausted", extra={"messageId": message_id, "error": str(e)})

    # Always return success so SQS deletes the message
    return {"statusCode": 200}
```

---

### 5. KB Sync Lambda (`infra/modules/lambda/kb_sync/`)

**Pattern**: Follows `~/upd8/Secretaria-Eva-IA/src/lambda/kb_sync/lambda_function.py` exactly.

**Lambda code (`src/kb_sync/handler.py`):**

```python
"""KB Sync Lambda — triggers Bedrock Knowledge Base ingestion on S3 events."""

import os
import boto3
from botocore.exceptions import ClientError
from shared.logging_config import get_logger

logger = get_logger("kb_sync")

KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
DATA_SOURCE_ID = os.environ.get("DATA_SOURCE_ID", "")

bedrock_client = boto3.client("bedrock-agent")


@logger.inject_lambda_context
def handler(event, context):
    """S3 event trigger handler."""
    logger.info("KB Sync triggered", extra={"event_records": len(event.get("Records", []))})

    try:
        response = bedrock_client.start_ingestion_job(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            dataSourceId=DATA_SOURCE_ID,
        )
        job_id = response.get("ingestionJob", {}).get("ingestionJobId", "unknown")
        logger.info("Ingestion job started", extra={"ingestionJobId": job_id})
        return {"success": True, "ingestionJobId": job_id}

    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code == "ConflictException":
            logger.info("Ingestion job already running — skipping")
            return {"success": True, "skipped": True, "reason": "concurrent_job"}
        logger.error("StartIngestionJob failed", extra={"errorCode": error_code, "error": str(exc)})
        raise

    except Exception as exc:
        logger.error("Unexpected error", extra={"error": str(exc)})
        raise
```

**Terraform module structure:**
- `lambda.tf` — Lambda function resource (Python 3.12, timeout=30s, shared layer, env vars: KNOWLEDGE_BASE_ID, DATA_SOURCE_ID)
- `iam.tf` — IAM role with `bedrock:StartIngestionJob` permission and basic execution role
- `variables.tf` — project_prefix, shared_layer_arn, knowledge_base_id, data_source_id, s3_bucket_arn, log_level
- `outputs.tf` — function_arn, function_name

**S3 notification (added to `infra/modules/s3/main.tf`):**

```hcl
resource "aws_s3_bucket_notification" "rag_documents" {
  bucket = aws_s3_bucket.rag_documents.id

  lambda_function {
    lambda_function_arn = var.kb_sync_lambda_arn
    events             = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
  }
}

resource "aws_lambda_permission" "s3_invoke_kb_sync" {
  statement_id  = "AllowS3InvokeKBSync"
  action        = "lambda:InvokeFunction"
  function_name = var.kb_sync_lambda_function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.rag_documents.arn
}
```

---

### 6. Bedrock Knowledge Base Module (`infra/modules/bedrock_kb/`)

**Resources:**

```hcl
# IAM Role for Bedrock KB to access S3
resource "aws_iam_role" "bedrock_kb" {
  name = "${var.project_prefix}-bedrock-kb-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "bedrock_kb_s3_access" {
  name = "s3-data-source-access"
  role = aws_iam_role.bedrock_kb.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [var.rag_bucket_arn, "${var.rag_bucket_arn}/*"]
      }
    ]
  })
}

resource "aws_bedrockagent_knowledge_base" "main" {
  name     = "${var.project_prefix}-knowledge-base"
  role_arn = aws_iam_role.bedrock_kb.arn

  knowledge_base_configuration {
    type = "VECTOR"
    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v2:0"
    }
  }

  storage_configuration {
    type = "OPENSEARCH_SERVERLESS"
    opensearch_serverless_configuration {
      collection_arn    = var.opensearch_collection_arn
      vector_index_name = "${var.project_prefix}-index"
      field_mapping {
        vector_field   = "embedding"
        text_field     = "text"
        metadata_field = "metadata"
      }
    }
  }
}

resource "aws_bedrockagent_data_source" "s3" {
  name                 = "${var.project_prefix}-s3-data-source"
  knowledge_base_id    = aws_bedrockagent_knowledge_base.main.id

  data_source_configuration {
    type = "S3"
    s3_configuration {
      bucket_arn = var.rag_bucket_arn
    }
  }
}
```

**Variables**: project_prefix, aws_region, rag_bucket_arn, opensearch_collection_arn
**Outputs**: knowledge_base_id, data_source_id

> **Note**: The Bedrock KB requires a vector store backend. The module uses OpenSearch Serverless by default. If the template user prefers a different vector store (Pinecone, RDS pgvector), they must modify the `storage_configuration` block. An OpenSearch Serverless collection must be provisioned separately or added as a sub-module.

---

### 7. API Gateway Throttling & Caching (Requirement 5)

**Additions to `infra/modules/api_gateway/main.tf`:**

```hcl
resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.chatbot.id
  stage_name  = aws_api_gateway_stage.chatbot.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_burst_limit
  }
}

resource "aws_api_gateway_method_settings" "get_responses_cache" {
  rest_api_id = aws_api_gateway_rest_api.chatbot.id
  stage_name  = aws_api_gateway_stage.chatbot.stage_name
  method_path = "responses/{messageId}/GET"

  settings {
    caching_enabled = true
    cache_ttl_in_seconds = var.cache_ttl
  }
}

resource "aws_api_gateway_usage_plan" "main" {
  name = "${var.project_prefix}-usage-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.chatbot.id
    stage  = aws_api_gateway_stage.chatbot.stage_name
  }

  throttle_settings {
    rate_limit  = var.throttle_rate_limit
    burst_limit = var.throttle_burst_limit
  }

  quota_settings {
    limit  = var.quota_limit
    period = "DAY"
  }
}

resource "aws_api_gateway_api_key" "default" {
  name    = "${var.project_prefix}-default-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan_key" "default" {
  key_id        = aws_api_gateway_api_key.default.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.main.id
}
```

**Stage modification:**

```hcl
resource "aws_api_gateway_stage" "chatbot" {
  deployment_id        = aws_api_gateway_deployment.chatbot.id
  rest_api_id          = aws_api_gateway_rest_api.chatbot.id
  stage_name           = var.stage_name
  xray_tracing_enabled = true
  cache_cluster_enabled = var.cache_enabled
  cache_cluster_size    = var.cache_size
}
```

**New variables**: `throttle_rate_limit` (default 100), `throttle_burst_limit` (default 200), `quota_limit` (default 10000), `cache_enabled` (default true), `cache_size` (default "0.5"), `cache_ttl` (default 60).

---

### 8. Monitoring Module (`infra/modules/monitoring/`)

**Structure**: `main.tf`, `variables.tf`, `outputs.tf`

**Resources:**

1. **CloudWatch Dashboard** — widgets for:
   - MessageProcessingLatency (p50, p99)
   - AIModelLatency (p50, p99)
   - ToolExecutionLatency (p50, p99)
   - ConversationLength (avg)
   - DLQ ApproximateNumberOfMessagesVisible
   - Lambda Errors per function
   - Lambda Duration per function

2. **Alarms:**
   - `{project_prefix}-lambda-error-rate`: Errors/Invocations > 5% over 5 minutes for each Lambda
   - `{project_prefix}-p99-latency`: p99 Duration > SLA threshold (configurable, default 120000ms)
   - `{project_prefix}-dlq-depth`: ApproximateNumberOfMessagesVisible > threshold (configurable, default 1)

**Variables**: project_prefix, orchestrator_function_name, ai_caller_function_name, tool_executor_function_name, kb_sync_function_name, dlq_name, sla_latency_threshold_ms, dlq_depth_threshold, sns_alarm_topic_arn (optional).

---

### 9. X-Ray & Powertools Metrics (Requirement 6 — Lambda code changes)

**All Lambdas** get `tracing_config { mode = "Active" }` in their Terraform resources.

**Orchestrator** metrics:

```python
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit

metrics = Metrics(namespace="ChatbotRAG", service="orchestrator")

# After processing completes:
metrics.add_metric(name="MessageProcessingLatency", unit=MetricUnit.Milliseconds, value=duration_ms)
metrics.add_metric(name="ConversationLength", unit=MetricUnit.Count, value=len(conversation_history))
```

**AI Caller** metrics:

```python
metrics = Metrics(namespace="ChatbotRAG", service="ai-caller")
metrics.add_metric(name="AIModelLatency", unit=MetricUnit.Milliseconds, value=latency_ms)
```

**Tool Executor** metrics:

```python
metrics = Metrics(namespace="ChatbotRAG", service="tool-executor")
metrics.add_metric(name="ToolExecutionLatency", unit=MetricUnit.Milliseconds, value=duration_ms)
```

---

## Data Flow

### Happy Path — Chat Message Processing

```
Client                API GW              SQS FIFO          Orchestrator        AI Caller       Responses Table
  |                     |                    |                   |                  |                 |
  |-- POST /chat ------>|                    |                   |                  |                 |
  |                     |-- SendMessage ---->|                   |                  |                 |
  |<-- 200 {messageId} -|                    |                   |                  |                 |
  |                     |                    |-- trigger ------->|                  |                 |
  |                     |                    |                   |-- PutItem ------->|  (pending)     |
  |                     |                    |                   |                  |                 |
  |                     |                    |                   |-- Invoke -------->|                |
  |                     |                    |                   |<-- AI response ---|                |
  |                     |                    |                   |                  |                 |
  |                     |                    |                   |-- PutItem ------->|  (completed)   |
  |                     |                    |                   |                  |                 |
  |-- GET /responses/id>|                    |                   |                  |                 |
  |                     |-- Lambda proxy --->| responses_reader  |                  |                 |
  |                     |                    |-- GetItem ------->|                  |  <------------- |
  |<-- 200 {response} --|                    |                   |                  |                 |
```

### Retry Flow — Transient Failure

```
Orchestrator (inside single Lambda execution)
  |
  |-- invoke_ai_caller() --> TIMEOUT
  |   [attempt 1, backoff 2s]
  |
  |-- invoke_ai_caller() --> THROTTLE
  |   [attempt 2, backoff 4s]
  |
  |-- invoke_ai_caller() --> SUCCESS
  |   [proceed normally]
  |
  OR after MAX_RETRY_ATTEMPTS:
  |-- write_response(status="failed", error="...")
  |-- return 200 (SQS deletes message, no re-raise)
```

### KB Sync Flow — S3 Event

```
User/Pipeline          S3 RAG Bucket         KB_Sync_Lambda        Bedrock KB
  |                        |                      |                    |
  |-- upload doc --------->|                      |                    |
  |                        |-- S3 event --------->|                    |
  |                        |                      |-- StartIngestionJob ->|
  |                        |                      |<-- jobId -------------|
  |                        |                      |  (log jobId)         |
  |                        |                      |                    |-- re-index S3 -->
```

---

## API Contract

### POST /chat (Modified Response)

**Request** (unchanged):
```json
{
  "userId": "string (required)",
  "message": "string (required)"
}
```

**Response** (modified — now includes `messageId`):
```json
{
  "messageId": "string (unique ID for polling)",
  "status": "accepted",
  "timestamp": "string (ISO 8601)"
}
```

The `messageId` is derived from `$context.requestId` in the API Gateway VTL response template.

---

### GET /responses/{messageId} (New Endpoint)

**Path Parameters:**
- `messageId` (string, required) — The ID returned from POST /chat

**Success Response (200) — Completed:**
```json
{
  "messageId": "abc-123",
  "status": "completed",
  "response": "Here is the AI-generated answer...",
  "userId": "user-456",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Success Response (200) — Pending:**
```json
{
  "messageId": "abc-123",
  "status": "pending",
  "userId": "user-456",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Success Response (200) — Failed:**
```json
{
  "messageId": "abc-123",
  "status": "failed",
  "error": "AI Caller timed out after 3 retry attempts",
  "userId": "user-456",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Error Response (404) — Not Found:**
```json
{
  "error": "not_found",
  "message": "No response found for messageId: xyz-999"
}
```

---

## File Structure (New & Modified Files)

```
templates/chatbot-rag-mantle/             (identical changes in chatbot-rag-agentcore/)
├── infra/
│   ├── environment/dev/
│   │   ├── main.tf                        [MODIFIED] — add new module calls
│   │   └── variables.tf                   [MODIFIED] — add new variables
│   ├── modules/
│   │   ├── api_gateway/
│   │   │   ├── main.tf                    [MODIFIED] — stage settings, usage plan, cache, responses endpoint
│   │   │   ├── variables.tf               [MODIFIED] — throttle/cache vars, responses_reader_arn
│   │   │   └── outputs.tf                 [UNCHANGED]
│   │   ├── bedrock_kb/                    [NEW MODULE]
│   │   │   ├── main.tf                    — KB + data source + IAM role
│   │   │   ├── variables.tf               — project_prefix, aws_region, rag_bucket_arn, opensearch_collection_arn
│   │   │   └── outputs.tf                 — knowledge_base_id, data_source_id
│   │   ├── dynamodb/
│   │   │   └── (unchanged)
│   │   ├── dynamodb_responses/            [NEW MODULE]
│   │   │   ├── main.tf                    — responses table with TTL
│   │   │   ├── variables.tf               — project_prefix
│   │   │   └── outputs.tf                 — table_name, table_arn
│   │   ├── lambda/
│   │   │   ├── ai_caller/
│   │   │   │   └── lambda.tf              [MODIFIED] — timeout=90, tracing_config Active
│   │   │   ├── kb_sync/                   [NEW MODULE]
│   │   │   │   ├── lambda.tf              — Lambda function resource
│   │   │   │   ├── iam.tf                 — bedrock:StartIngestionJob permission
│   │   │   │   ├── variables.tf           — project_prefix, shared_layer_arn, knowledge_base_id, data_source_id, log_level
│   │   │   │   └── outputs.tf             — function_arn, function_name
│   │   │   ├── orchestrator/
│   │   │   │   ├── lambda.tf              [MODIFIED] — timeout=150, tracing_config Active, new env vars
│   │   │   │   ├── iam.tf                 [MODIFIED] — add PutItem on responses table
│   │   │   │   └── variables.tf           [MODIFIED] — add responses_table_arn, responses_table_name
│   │   │   ├── responses_reader/          [NEW MODULE]
│   │   │   │   ├── lambda.tf              — Lambda function resource
│   │   │   │   ├── iam.tf                 — dynamodb:GetItem on responses table
│   │   │   │   ├── variables.tf           — project_prefix, shared_layer_arn, responses_table_arn, responses_table_name, log_level
│   │   │   │   └── outputs.tf             — function_arn, function_name, invoke_arn
│   │   │   ├── shared_layer/
│   │   │   │   └── (unchanged)
│   │   │   └── tool_executor/
│   │   │       └── lambda.tf              [MODIFIED] — tracing_config Active
│   │   ├── monitoring/                    [NEW MODULE]
│   │   │   ├── main.tf                    — dashboard + 3 alarms
│   │   │   ├── variables.tf               — function names, thresholds, dlq_name
│   │   │   └── outputs.tf                 — dashboard_arn, alarm_arns
│   │   ├── s3/
│   │   │   ├── main.tf                    [MODIFIED] — S3 event notification + Lambda permission
│   │   │   ├── variables.tf               [MODIFIED] — add kb_sync_lambda_arn, kb_sync_lambda_function_name
│   │   │   └── outputs.tf                 [UNCHANGED]
│   │   └── sqs/
│   │       └── main.tf                    [MODIFIED] — visibility_timeout_seconds=900
│   └── openapi/
│       └── api-spec.json                  [MODIFIED] — add GET /responses/{messageId}, update POST /chat response
├── src/
│   ├── ai_caller/
│   │   └── handler.py                     [MODIFIED] — add Powertools Metrics (AIModelLatency)
│   ├── kb_sync/                           [NEW]
│   │   └── handler.py                     — KB sync Lambda handler
│   ├── orchestrator/
│   │   └── handler.py                     [MODIFIED] — retry logic, response writes, Powertools Metrics
│   ├── responses_reader/                  [NEW]
│   │   └── handler.py                     — GET /responses reader Lambda handler
│   └── tool_executor/
│       └── handler.py                     [MODIFIED] — add Powertools Metrics (ToolExecutionLatency)
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| AI Caller timeout/throttle | Orchestrator retries internally up to MAX_RETRY_ATTEMPTS with exponential backoff |
| Tool Executor error | Orchestrator retries the full AI+tool loop iteration |
| All retries exhausted | Orchestrator writes `failed` to Responses_Table, returns success (no SQS redeliver) |
| Lambda crash/OOM/timeout | SQS redelivers up to maxReceiveCount, then goes to DLQ |
| KB Sync ConflictException | Log at INFO, return success (idempotent) |
| KB Sync unexpected error | Re-raise (Lambda fails), S3 event retries automatically |
| GET /responses non-existent ID | Return 404 |
| DynamoDB write failure for response | Log error, do not re-raise (best-effort response storage) |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: TTL computation correctness

*For any* item creation timestamp T, the computed `expiresAt` value SHALL equal T + 604800 (exactly 7 days in epoch seconds).

**Validates: Requirements 2.3**

### Property 2: Successful processing writes completed response

*For any* valid chat message that the Orchestrator processes successfully (AI Caller returns a response without exhausting retries), the Orchestrator SHALL write a record to the Responses Table with `status="completed"` and a non-empty `response` field containing the AI-generated text.

**Validates: Requirements 2.5**

### Property 3: Exhausted retries write failed response

*For any* transient failure scenario where all retry attempts are exhausted, the Orchestrator SHALL write a record to the Responses Table with `status="failed"` and a non-empty `error` field describing the failure.

**Validates: Requirements 2.6, 3.3**

### Property 4: Response reader round-trip

*For any* valid response record stored in the Responses Table, calling the responses reader handler with that record's `messageId` SHALL return a response containing the same `status`, `response`, and `userId` values.

**Validates: Requirements 2.8**

### Property 5: Retry count bounded by configuration

*For any* retry configuration value N and any transient failure that persists indefinitely, the Orchestrator SHALL make exactly N invocation attempts (no more, no less), with exponential backoff delays between them.

**Validates: Requirements 3.2**

### Property 6: No re-raise after retry exhaustion

*For any* failure scenario where retries are exhausted, the Orchestrator handler SHALL return without raising an exception (return a successful response to SQS event source mapping), preventing message redelivery.

**Validates: Requirements 3.4**

### Property 7: KB Sync calls StartIngestionJob for any S3 event

*For any* valid S3 event notification (ObjectCreated or ObjectRemoved), the KB Sync Lambda SHALL call `StartIngestionJob` exactly once with the configured Knowledge Base ID and Data Source ID.

**Validates: Requirements 4.2**

### Property 8: Custom metrics emission on processing

*For any* successfully processed message, the Orchestrator SHALL emit both `MessageProcessingLatency` (positive integer, milliseconds) and `ConversationLength` (positive integer, message count) metrics.

**Validates: Requirements 6.3**

---

## Testing Strategy

### Unit Tests (example-based)

- Responses Reader: 404 for non-existent ID, 200 for pending/completed/failed records
- KB Sync: ConflictException handling returns success, success path logs job ID
- AI Caller: Metrics emission after successful invocation
- Tool Executor: Metrics emission after execution

### Property-Based Tests (universal properties)

**Library**: `hypothesis` (Python)
**Configuration**: minimum 100 examples per property test

| Property | Test Description | Tag |
|----------|-----------------|-----|
| 1 | Generate random timestamps, verify expiresAt = timestamp + 604800 | Feature: chatbot-rag-scalability-improvements, Property 1: TTL computation correctness |
| 2 | Generate random valid messages with mocked successful AI responses, verify completed record written | Feature: chatbot-rag-scalability-improvements, Property 2: Successful processing writes completed response |
| 3 | Generate random error types/messages with mocked failing AI caller, verify failed record written | Feature: chatbot-rag-scalability-improvements, Property 3: Exhausted retries write failed response |
| 4 | Generate random response records, store them, call reader handler, verify round-trip | Feature: chatbot-rag-scalability-improvements, Property 4: Response reader round-trip |
| 5 | Generate random MAX_RETRY values (1-10), mock persistent failure, count invocation attempts | Feature: chatbot-rag-scalability-improvements, Property 5: Retry count bounded by configuration |
| 6 | Generate random error scenarios, verify handler returns without exception | Feature: chatbot-rag-scalability-improvements, Property 6: No re-raise after retry exhaustion |
| 7 | Generate random S3 event payloads, mock bedrock client, verify StartIngestionJob called once | Feature: chatbot-rag-scalability-improvements, Property 7: KB Sync calls StartIngestionJob for any S3 event |
| 8 | Generate random messages with mocked success, capture metrics calls, verify both emitted | Feature: chatbot-rag-scalability-improvements, Property 8: Custom metrics emission on processing |

### Infrastructure Validation (smoke tests)

- `terraform validate` passes for both templates
- `terraform plan` shows expected resource counts
- Timeout alignment: assert SQS visibility >= 6 * orchestrator timeout in Terraform variables

### Integration Tests (optional, post-deploy)

- POST /chat → GET /responses polling cycle (1-2 examples)
- S3 upload → verify ingestion job triggered via CloudWatch logs
