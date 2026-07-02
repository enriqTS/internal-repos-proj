# Chatbot RAG Template — Bedrock AgentCore Runtime

## Overview

This template deploys a complete serverless chatbot application with Retrieval-Augmented Generation (RAG) capabilities, powered by the **AWS Bedrock AgentCore Runtime**. The AgentCore Runtime manages the tool-use loop internally, invoking the Tool Executor Lambda directly as an action group — simplifying the orchestration logic compared to manual loop management.

The template provides a fully deployable project scaffold with Python Lambda application code and Terraform infrastructure-as-code. All resource names are configurable via Terraform variables, allowing multiple deployments without naming conflicts.

## Architecture

The application uses an asynchronous request-response architecture with client polling. **AgentCore Runtime manages conversation context natively via `sessionId`** — the Orchestrator does not retrieve history from DynamoDB before invoking the AI. Conversation exchanges are still persisted to DynamoDB after each response for compliance and audit purposes.

```
Client → API Gateway (REST) → SQS FIFO → Orchestrator Lambda → AI Caller Lambda → AgentCore Runtime
              ↕                                  ↕                                        ↕
    GET /responses/{messageId}             DynamoDB (context,                   Tool Executor Lambda → Bedrock KB
              ↕                             write-only for audit)
    Responses Reader Lambda            DynamoDB (responses)
                                             ↕
                                       Retry (exponential backoff)

S3 RAG Bucket → (S3 Events) → KB Sync Lambda → Bedrock Knowledge Base (Titan Embed)

CloudWatch Dashboard + Alarms ← X-Ray + Powertools Metrics ← All Lambdas
```

### Components

| Component | Purpose |
|-----------|---------|
| **API Gateway (REST)** | Entry point — accepts POST /chat requests from clients |
| **SQS FIFO Queue** | Asynchronous message processing with ordering guarantees |
| **Orchestrator Lambda** | Manages conversation flow; saves exchanges to DynamoDB for audit (no pre-invocation history read) |
| **AI Caller Lambda** | Invokes Bedrock AgentCore Runtime with the current user message and `sessionId` |
| **Tool Executor Lambda** | Executes tool calls (RAG document retrieval via Bedrock KB) |
| **DynamoDB (Context)** | Stores per-user conversation history for compliance/audit (write-only — AgentCore manages live context) |
| **DynamoDB (Responses)** | Stores async processing results for client polling (7-day TTL) |
| **S3 RAG Bucket** | Stores knowledge base documents for retrieval |
| **Responses Reader Lambda** | GET /responses/{messageId} — returns processing status and AI response |
| **KB Sync Lambda** | Triggered by S3 events — calls Bedrock StartIngestionJob for RAG re-indexing |
| **Bedrock Knowledge Base** | Managed RAG indexing with Amazon Titan Embed v2 and S3 Vectors |
| **Monitoring Module** | CloudWatch Dashboard, alarms (error rate, p99 latency, DLQ depth), X-Ray tracing |

### Tool Calling (AgentCore)

In this template, the **AgentCore Runtime manages tool calling internally**:

1. Orchestrator invokes AI Caller with the current user message and `sessionId`
2. AI Caller sends the request to AgentCore Runtime (which maintains conversation context via `sessionId`)
3. AgentCore Runtime decides when to call tools and invokes Tool Executor directly as an action group
4. Tool Executor returns results to the AgentCore Runtime
5. AgentCore Runtime produces the final response and returns it to the AI Caller

The Orchestrator does not manage a tool-use loop — AgentCore handles it end-to-end.

## Response Polling

The API uses an asynchronous pattern where clients poll for results:

1. **POST /chat** accepts the user message and returns a `messageId` immediately
2. **Client polls GET /responses/{messageId}** until the status is `completed` or `failed`
3. Responses are stored in DynamoDB with a **7-day TTL** — no manual cleanup needed
4. Status flow: `pending` → `completed` | `failed`

Clients should implement polling with a reasonable interval (e.g., 1–2 seconds) and a maximum timeout.

## Prerequisites

- AWS account with Bedrock model access enabled
- [uv](https://docs.astral.sh/uv/) (Astral Python package manager)
- Terraform >= 1.5
- Python 3.12
- GNU Make
- AWS CLI configured with appropriate credentials

## Project Structure

```
chatbot-rag-agentcore/
├── README.md
├── metadata.json
├── pyproject.toml                      # Centralized Python deps + tool config
├── uv.lock                             # Committed lock file (reproducibility)
├── Makefile                            # Lambda packaging automation
├── .gitignore
├── tests/                              # Pytest test directory
│   ├── conftest.py                     # Shared fixtures (env vars, mocks)
│   ├── test_orchestrator.py
│   ├── test_ai_caller.py
│   ├── test_tool_executor.py
│   ├── test_responses_reader.py
│   └── test_kb_sync.py
├── src/
│   ├── layers/
│   │   └── shared/                     # Lambda Layer — shared utilities
│   │       └── python/
│   │           └── shared/
│   │               ├── __init__.py
│   │               ├── logging_config.py
│   │               └── models.py
│   ├── orchestrator/
│   │   └── handler.py                  # Conversation flow (no tool-use loop)
│   ├── ai_caller/
│   │   └── handler.py                  # AgentCore Runtime integration
│   ├── tool_executor/
│   │   └── handler.py                  # RAG search tool implementation
│   ├── responses_reader/
│   │   └── handler.py                  # GET /responses/{messageId} handler
│   └── kb_sync/
│       └── handler.py                  # S3 event → Bedrock StartIngestionJob
└── infra/
    ├── openapi/
    │   └── api-spec.json               # OpenAPI 3.0 spec for the REST API
    ├── environment/
    │   ├── dev/
    │   │   ├── backend.tf              # S3 backend configuration
    │   │   ├── providers.tf            # Provider + required_providers
    │   │   ├── main.tf                 # Module calls
    │   │   ├── variables.tf            # Variable declarations
    │   │   ├── outputs.tf              # Output declarations
    │   │   └── terraform.tfvars.example
    │   ├── staging/
    │   └── prod/
    └── modules/
        ├── api_gateway/
        ├── sqs/
        ├── lambda/
        │   ├── orchestrator/
        │   ├── ai_caller/
        │   ├── tool_executor/
        │   ├── responses_reader/
        │   ├── kb_sync/
        │   └── shared_layer/
        ├── dynamodb/
        ├── dynamodb_responses/
        ├── s3/
        ├── agentcore/              # AgentCore-specific resources
        ├── bedrock_kb/
        └── monitoring/
```

## Development Setup

Install all dependencies (runtime + dev):

```bash
uv sync
```

Format code:

```bash
uv run ruff format .
```

Lint code:

```bash
uv run ruff check .
```

Run tests:

```bash
uv run pytest
```

> **Note:** The `uv.lock` file is committed to version control for reproducibility. When you add or update dependencies in `pyproject.toml`, run `uv lock` to regenerate the lock file and commit both files together.

## Testing

Run the full test suite:

```bash
uv run pytest
```

Test directory convention: `tests/test_<function_name>.py`

Tests mock all AWS services — no real credentials or live services needed. Each test file demonstrates the mocking pattern using `unittest.mock.patch` for AWS SDK clients and `pytest.MonkeyPatch` (via `monkeypatch` fixture) for environment variables. Shared fixtures in `tests/conftest.py` set the required Lambda environment variables automatically for all tests.

## Configuration

### Terraform Variables

Copy the example file and fill in your values:

```bash
cp infra/environment/dev/terraform.tfvars.example infra/environment/dev/terraform.tfvars
```

Key variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `project_name` | Project name (lowercase, hyphens, max 20 chars) | `"my-chatbot"` |
| `environment` | Deployment environment (dev, staging, prod) | `"dev"` |
| `client` | Client name for cost allocation tags | `"acme-corp"` |
| `aws_region` | AWS region for deployment | `"us-east-1"` |
| `aws_account_id` | AWS account ID for ARN construction | `"123456789012"` |
| `model_id` | Bedrock foundation model identifier | `"us.anthropic.claude-sonnet-4-20250514"` |
| `max_conversation_history` | Max messages retained in context | `50` |
| `max_retry_attempts` | Max retry attempts for message processing | `3` |
| `log_level` | Powertools log level | `"INFO"` |

Resource names are computed as `${project_name}-${environment}-<function>` (e.g., `my-chatbot-dev-orchestrator`).

### Backend Setup

Before running `terraform init`, replace the placeholders in `infra/environment/<env>/backend.tf`:

- `<cliente>` → your upd8 client slug (e.g., `acme`)
- `<project>` → your project identifier (e.g., `chatbot-rag-agentcore/dev`)

The S3 bucket (`upd8-tfstate-<cliente>`) and DynamoDB table (`upd8-tfstate-lock`) must exist before running `terraform init`. If they don't exist yet, create them:

```bash
aws s3api create-bucket --bucket upd8-tfstate-<cliente> --region us-east-1
aws s3api put-bucket-versioning --bucket upd8-tfstate-<cliente> --versioning-configuration Status=Enabled
aws dynamodb create-table \
  --table-name upd8-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### System Prompt

The system prompt is defined in:

- **File:** `src/ai_caller/handler.py`
- **Constant:** `SYSTEM_PROMPT`

The default placeholder value is:

```python
SYSTEM_PROMPT = "You are a helpful assistant. Replace this prompt with your own instructions."
```

Replace this with your own instructions to customize the chatbot's persona and behavior. The system prompt is passed to the AgentCore Runtime, which uses it when orchestrating tool calls and generating responses. The template works correctly with the placeholder text — deploying without modification will produce valid AI responses using the generic assistant prompt.

### AI Model

Set the `model_id` variable in your `terraform.tfvars` file to specify which Bedrock foundation model to use:

```hcl
model_id = "us.anthropic.claude-sonnet-4-20250514"
```

The model ID is passed to the AgentCore module as a variable and used when provisioning the agent runtime resource.

## Deployment

### 1. Package Lambda Dependencies

```bash
make all
```

This exports runtime dependencies from `pyproject.toml` via `uv export --format requirements-txt` and installs them into each Lambda's source directory, targeting the Lambda runtime platform (`manylinux2014_x86_64`). Terraform's `archive_file` then zips each directory for deployment.

### 2. Configure Environment

```bash
cp infra/environment/dev/terraform.tfvars.example infra/environment/dev/terraform.tfvars
# Edit terraform.tfvars with your values
```

### 3. Deploy

```bash
cd infra/environment/dev
terraform init
terraform plan
terraform apply
```

Repeat for `staging/` and `prod/` environments as needed.

## RAG Knowledge Base

The template provisions a fully managed **Bedrock Knowledge Base** backed by Amazon Titan Embed v2 and S3 Vectors. An S3 bucket (`{prefix}-rag-documents`) stores the source documents, and uploads/deletions automatically trigger re-indexing — no manual steps needed.

### Automatic Re-Indexing

Documents uploaded to (or removed from) the S3 RAG bucket automatically trigger the **KB Sync Lambda** via S3 event notifications. The Lambda calls Bedrock's `StartIngestionJob` API to re-index the data source. This means:

- No manual re-indexing needed — S3 event notifications handle it
- Both `ObjectCreated` and `ObjectRemoved` events are captured
- The Knowledge Base uses Amazon Titan Embed v2 for vector embeddings

### Supported Formats

- `.txt` — Plain text documents
- `.md` — Markdown documents
- `.pdf` — PDF documents

### Maximum File Size

Recommended maximum file size per document is **10 MB**. Larger documents should be split into smaller chunks for efficient retrieval.

### Uploading Documents

Upload documents using the AWS CLI:

```bash
aws s3 cp document.pdf s3://{prefix}-rag-documents/
aws s3 cp ./docs/ s3://{prefix}-rag-documents/docs/ --recursive
```

Re-indexing starts automatically within seconds of upload.

## Reliability

The template includes multiple layers of fault tolerance:

- **Immediate retry with exponential backoff** — the Orchestrator retries transient failures up to a configurable number of attempts (default: 3) with exponential backoff before marking a message as failed
- **Failure feedback** — on failure, the client receives a `failed` status via the responses table with an error message (clients are never left waiting indefinitely)
- **DLQ safety net** — a dead-letter queue captures messages that cause catastrophic Lambda failures (crash, OOM) as a last-resort safety net
- **SQS visibility timeout alignment** — set to 6x the Orchestrator timeout (900s) to prevent message redelivery during retries

## Observability

All Lambda functions use **aws-lambda-powertools** for structured JSON logging with consistent fields:

- `timestamp` — ISO 8601 timestamp
- `level` — Log level (INFO, ERROR, etc.)
- `service` — Lambda function name
- `correlation_id` — Unique request identifier traced across all functions

### X-Ray Distributed Tracing

X-Ray active tracing is enabled across all Lambdas and API Gateway, providing end-to-end request visualization from client to AgentCore Runtime and back.

### Custom CloudWatch Metrics

Business metrics emitted via Powertools Metrics (EMF):

- `MessageProcessingLatency` — total time from SQS receive to response write
- `ConversationLength` — number of messages in the conversation context

> **Note:** Model latency and tool execution latency metrics are no longer emitted as custom metrics. AgentCore Runtime provides vended CloudWatch logs with built-in model invocation and tool execution latency data, eliminating the need for application-level instrumentation.

### CloudWatch Dashboard

A pre-configured dashboard (`{prefix}-dashboard`) provides widgets for business metrics, Lambda invocations/errors/duration, SQS queue depth, and DLQ depth.

### Alarms

| Alarm | Condition | Default Threshold |
|-------|-----------|-------------------|
| Lambda Error Rate | Error percentage exceeds threshold | > 5% |
| P99 Latency | 99th percentile duration exceeds SLA | Configurable |
| DLQ Depth | Messages in dead-letter queue | > 0 |

### Correlation ID Tracing

A correlation ID is propagated from the initial SQS message through the Orchestrator to the AI Caller and Tool Executor, enabling end-to-end request tracing across all functions.

### Filtering AI Logs

AI interaction logs include a dedicated field for easy filtering:

```json
{
  "logType": "ai-interaction",
  "model": "agentcore",
  "inputTokens": 150,
  "outputTokens": 320,
  "totalTokens": 470,
  "latencyMs": 2340,
  "finishReason": "end_turn"
}
```

Filter AI-specific logs in CloudWatch:

```
{ $.logType = "ai-interaction" }
```

## API Throttling

The API Gateway is configured with usage plans to protect backend resources:

| Setting | Default | Configurable |
|---------|---------|--------------|
| Rate limit | 100 requests/second | Yes |
| Burst limit | 200 requests | Yes |
| Daily quota | 10,000 per API key | Yes |

Response caching is enabled on **GET /responses/{messageId}** to reduce Lambda invocations for repeated polling requests.

## Customization

### Adding Tools

1. Add your tool function to `src/tool_executor/handler.py`
2. Register the tool as an action group in the AgentCore module (`infra/modules/agentcore/main.tf`)
3. The AgentCore Runtime will automatically invoke your tool when the AI model requests it

### Modifying Orchestration

The Orchestrator Lambda (`src/orchestrator/handler.py`) controls:
- Saving conversation exchanges to DynamoDB (for compliance/audit)
- Error handling and retry logic

Note: Conversation context during AI invocations is managed by AgentCore Runtime via `sessionId` — the Orchestrator does not read history before calling the AI. Tool-use orchestration is also managed by AgentCore Runtime, not the Orchestrator Lambda.

### Extending the API

All API changes are made in the OpenAPI specification at `infra/openapi/api-spec.json`. Terraform references this file to deploy the API Gateway REST API — add new endpoints or modify request/response schemas there.
