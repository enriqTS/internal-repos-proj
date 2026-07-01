# Chatbot RAG Template — Bedrock Mantle API (WebSocket)

## Overview

This template deploys a serverless chatbot application with Retrieval-Augmented Generation (RAG) capabilities using **AWS Bedrock Mantle API** (OpenAI-compatible endpoint) and **WebSocket transport**. Unlike the REST variant that uses client polling, this template uses an API Gateway WebSocket API for bidirectional real-time communication — the server pushes the AI response directly to the client as soon as processing completes.

The Mantle variant uses the OpenAI Python SDK pointed at the Bedrock Mantle endpoint, with the Orchestrator managing the tool-use loop (iterating until no `function_call` items remain, up to `MAX_TOOL_ITERATIONS`). The WebSocket transport eliminates the need for client-side polling. A Connection Table in DynamoDB tracks active WebSocket connections with automatic TTL-based cleanup.

The template provides a fully deployable project scaffold with Python Lambda application code and Terraform infrastructure-as-code. All resource names are configurable via Terraform variables, allowing multiple deployments without naming conflicts.

## Architecture

```
Client ←→ API Gateway (WebSocket) → $connect/$disconnect → Connection Manager Lambda → DynamoDB (Connections)
                                   → sendMessage → SQS FIFO → Orchestrator Lambda → AI Caller Lambda → Bedrock Mantle API
                                                                     ↕                    ↕
                                                               DynamoDB (context)    Tool Executor Lambda → S3 RAG Bucket
                                                                     ↕
                                                              @connections POST → Client (response pushed via WebSocket)
```

### Components

| Component | Purpose |
|-----------|---------|
| **API Gateway (WebSocket)** | Bidirectional communication — `$connect`, `$disconnect`, `sendMessage` routes |
| **Connection Manager Lambda** | Handles WebSocket lifecycle — stores/removes connection IDs in DynamoDB |
| **SQS FIFO Queue** | Asynchronous message processing with ordering guarantees |
| **Orchestrator Lambda** | Manages conversation flow, tool-use loop, pushes response via `@connections` |
| **AI Caller Lambda** | Invokes Bedrock Mantle API via OpenAI SDK |
| **Tool Executor Lambda** | Executes tool calls (RAG document retrieval) |
| **DynamoDB (Connections)** | Tracks active WebSocket connections with TTL-based cleanup (24h) |
| **DynamoDB (Context)** | Stores per-user conversation history |
| **S3 RAG Bucket** | Stores knowledge base documents for retrieval |

### Message Flow

1. Client opens a WebSocket connection (`$connect`) — Connection Manager stores the connection ID
2. Client sends a message via WebSocket (`sendMessage` action)
3. API Gateway routes the message body to SQS FIFO
4. SQS triggers the Orchestrator Lambda
5. Orchestrator retrieves conversation context, invokes the AI Caller
6. AI Caller calls the Bedrock Mantle API via OpenAI SDK
7. If the response contains `function_call` items, Orchestrator invokes Tool Executor and loops
8. Once the final response has no tool calls, Orchestrator pushes it to the client via `@connections` POST
9. Client receives the response as a WebSocket frame — no polling needed

### Tool Calling (Mantle)

The Mantle variant manages tool calling at the **application level**:

1. Orchestrator invokes AI Caller with conversation messages
2. AI Caller sends the request to Bedrock Mantle API (OpenAI-compatible)
3. If the response contains `function_call` items, Orchestrator invokes Tool Executor
4. Tool results are appended to messages and a follow-up request is made
5. Loop continues until no `function_call` items remain (max `MAX_TOOL_ITERATIONS`)
6. Final text response is sent to the client via WebSocket

## Prerequisites

- AWS account with Bedrock model access enabled
- [uv](https://docs.astral.sh/uv/) (Astral Python package manager)
- Terraform >= 1.5
- Python 3.12
- GNU Make
- AWS CLI configured with appropriate credentials

## Project Structure

```
chatbot-rag-mantle-ws/
├── README.md
├── metadata.json
├── pyproject.toml                      # Centralized Python deps + tool config
├── uv.lock                             # Committed lock file (reproducibility)
├── Makefile                            # Lambda packaging automation
├── .gitignore
├── tests/                              # Pytest test directory
│   ├── unit/
│   │   ├── test_connection_manager.py
│   │   ├── test_message_sender.py
│   │   └── test_orchestrator.py
│   └── property/
│       └── test_properties.py
├── src/
│   ├── layers/
│   │   └── shared/                     # Lambda Layer — shared utilities
│   │       └── python/
│   │           └── shared/
│   │               ├── __init__.py
│   │               ├── logging_config.py
│   │               ├── models.py
│   │               └── message_protocol.py
│   ├── connection_manager/
│   │   └── handler.py                  # $connect/$disconnect handler
│   ├── orchestrator/
│   │   └── handler.py                  # SQS-triggered, tool-use loop, WebSocket response
│   ├── ai_caller/
│   │   └── handler.py                  # Bedrock Mantle API via OpenAI SDK
│   └── tool_executor/
│       └── handler.py                  # RAG search tool implementation
├── build/                              # Zip artifacts (gitignored)
├── docs/
│   ├── architecture.drawio             # Architecture diagram source
│   └── architecture.png                # Exported diagram
└── infra/
    ├── openapi/
    ├── environment/
    │   ├── dev/
    │   │   ├── backend.tf              # S3 backend configuration
    │   │   ├── main.tf                 # Module calls
    │   │   ├── variables.tf            # Variable declarations
    │   │   ├── outputs.tf              # Output declarations
    │   │   └── terraform.tfvars.example
    │   ├── staging/
    │   └── prod/
    └── modules/
        ├── websocket_api/              # API Gateway v2 WebSocket API
        ├── sqs/                        # SQS FIFO queue
        ├── lambda/                     # All Lambda functions + shared layer
        ├── dynamodb/                   # User context + Connection table (with TTL)
        └── s3/                         # RAG bucket
```

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
| `max_tool_iterations` | Max tool-use loop iterations | `10` |
| `max_retry_attempts` | Max retry attempts for message processing | `3` |
| `log_level` | Powertools log level | `"INFO"` |
| `connection_ttl_seconds` | TTL for connection entries (seconds) | `86400` |

Resource names are computed as `${project_name}-${environment}-<function>` (e.g., `my-chatbot-dev-orchestrator`).

### Backend Setup

Before running `terraform init`, replace the placeholders in `infra/environment/<env>/backend.tf`:

- `<cliente>` — your upd8 client slug (e.g., `acme`)

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

The system prompt is defined in `src/ai_caller/handler.py` as the `SYSTEM_PROMPT` constant:

```python
SYSTEM_PROMPT = "You are a helpful assistant. Replace this prompt with your own instructions."
```

Replace this with your own instructions to customize the chatbot's persona and behavior. The template works correctly with the placeholder text.

### AI Model

Set the `model_id` variable in your `terraform.tfvars` to specify the Bedrock foundation model:

```hcl
model_id = "us.anthropic.claude-sonnet-4-20250514"
```

The model is accessed via the Bedrock Mantle endpoint (OpenAI-compatible API). The API key is stored in Secrets Manager and referenced by the Lambda at runtime.

### Tool-Use Loop

The Orchestrator manages the tool-use loop with a configurable maximum:

- `max_tool_iterations` — Maximum iterations before aborting (default: `10`)
- Each iteration: AI response → check for `function_call` → invoke tool → append results → repeat
- If the limit is reached, the request fails with an error message

## Deployment

### 1. Package Lambda Dependencies

```bash
make build
```

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

The WebSocket API endpoint URL is output after deployment — use it to connect clients.

### 4. Verify

Connect to the WebSocket endpoint and send a test message:

```bash
wscat -c "wss://<api-id>.execute-api.<region>.amazonaws.com/dev?userId=test-user"
> {"action": "sendMessage", "userId": "test-user", "message": "Hello!"}
```

## RAG Knowledge Base

The template uses an S3 bucket (`{prefix}-rag-documents`) for storing knowledge base documents. Upload documents and the AI will use them for retrieval-augmented responses.

### Uploading Documents

```bash
aws s3 cp document.pdf s3://{prefix}-rag-documents/
aws s3 cp ./docs/ s3://{prefix}-rag-documents/docs/ --recursive
```

### Supported Formats

- `.txt` — Plain text documents
- `.md` — Markdown documents
- `.pdf` — PDF documents

### Maximum File Size

Recommended maximum file size per document is **10 MB**. Larger documents should be split for efficient retrieval.

## Logging & Observability

All Lambda functions use **aws-lambda-powertools** for structured JSON logging with consistent fields:

```json
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "INFO",
  "service": "orchestrator",
  "correlation_id": "req-abc-123",
  "message": "Processing message"
}
```

### Correlation ID

A correlation ID is propagated from the initial request through the Orchestrator to the AI Caller and Tool Executor, enabling end-to-end request tracing across all functions.

### AI Interaction Logs

AI interaction logs include dedicated fields for performance monitoring:

```json
{
  "logType": "ai-interaction",
  "model": "us.anthropic.claude-sonnet-4-20250514",
  "inputTokens": 150,
  "outputTokens": 320,
  "totalTokens": 470,
  "latencyMs": 2340,
  "finishReason": "stop"
}
```

Filter AI-specific logs in CloudWatch:

```
{ $.logType = "ai-interaction" }
```

### Log Levels

Configure via the `log_level` Terraform variable (`DEBUG`, `INFO`, `WARNING`, `ERROR`). The `POWERTOOLS_LOG_LEVEL` environment variable is set on all Lambda functions.

## Customization

### Adding Tools

1. Add your tool function to `src/tool_executor/handler.py`
2. Define the tool schema in the AI Caller's tool definitions array
3. The Orchestrator's tool-use loop will automatically invoke your tool when the AI model requests it

### Modifying Orchestration

The Orchestrator Lambda (`src/orchestrator/handler.py`) controls:
- Conversation history retrieval and storage
- Tool-use loop management (iterate until no `function_call` items)
- Response delivery via WebSocket `@connections`
- Error handling and retry logic

### Development Commands

```bash
uv sync           # Install dependencies
uv run pytest     # Run tests
uv run ruff check . # Lint
uv run ruff format . # Format
```

## WebSocket Protocol

### Client-to-Server Message Format

Messages are sent on the `sendMessage` route as JSON:

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `action` | string | Yes | Must be `"sendMessage"` | WebSocket route key |
| `userId` | string | Yes | 1–256 characters, non-empty | User identifier for conversation context |
| `message` | string | Yes | 1–4096 characters, non-empty | The user's message text |

### Server-to-Client Message Types

| Type | Fields | Description |
|------|--------|-------------|
| `message` | `type`, `response`, `conversationId`, `timestamp` | Complete AI response (non-streaming) |
| `error` | `type`, `message`, `correlationId` (optional) | Error notification |

**Non-streaming response:**

```json
{
  "type": "message",
  "response": "Based on the knowledge base documents...",
  "conversationId": "user-123",
  "timestamp": "2024-01-15T10:30:45+00:00"
}
```

**Error response:**

```json
{
  "type": "error",
  "message": "Invalid message format: userId must be a non-empty string (1-256 chars)",
  "correlationId": "req-abc-123"
}
```

### Code Example (TypeScript)

```typescript
const WS_URL = "wss://<api-id>.execute-api.<region>.amazonaws.com/dev?userId=my-user";

const ws = new WebSocket(WS_URL);

ws.onopen = () => {
  console.log("Connected to chatbot WebSocket");

  // Send a message
  ws.send(JSON.stringify({
    action: "sendMessage",
    userId: "my-user",
    message: "What documents do you have about security?"
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "message":
      // Complete AI response received
      console.log("AI:", data.response);
      console.log("Timestamp:", data.timestamp);
      break;

    case "error":
      // Error occurred
      console.error("Error:", data.message);
      if (data.correlationId) {
        console.error("Correlation ID:", data.correlationId);
      }
      break;
  }
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = (event) => {
  console.log("Disconnected:", event.code, event.reason);
};
```
