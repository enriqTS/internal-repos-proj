# Chatbot RAG Template — Bedrock Mantle API (ECS, WebSocket)

## Overview

A chatbot RAG template using Bedrock Mantle API (OpenAI-compatible) for AI inference, ECS Fargate for compute, and WebSocket for real-time bidirectional communication. Non-streaming: the AI generates the complete response before sending it to the client as a single WebSocket message.

**Key characteristics:**
- **AI Service:** Bedrock Mantle API (OpenAI SDK with bedrock-mantle endpoint)
- **Compute:** ECS Fargate (persistent container)
- **Transport:** WebSocket (API Gateway v2 → VPC Link → NLB → ECS)
- **Streaming:** No (complete response delivered as single message)

## Architecture

```
Client → API Gateway WebSocket → VPC Link → NLB → ECS Fargate (FastAPI)
                                                       ├── Orchestrator (tool-use loop)
                                                       ├── AI Caller (Mantle/OpenAI SDK)
                                                       ├── Tool Executor (RAG/S3)
                                                       ├── Connection Manager (DynamoDB)
                                                       └── Message Sender (@connections)
```

The ECS service handles WebSocket lifecycle events ($connect, $disconnect, sendMessage) forwarded from API Gateway as HTTP POST requests via a VPC Link + NLB integration. Responses are sent back to clients via the API Gateway Management API `@connections` endpoint.

## Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (package manager)
- [Terraform](https://www.terraform.io/) >= 1.5
- AWS CLI configured with appropriate credentials
- Docker (for building container images)

## Project Structure

```
├── README.md
├── metadata.json
├── pyproject.toml
├── Dockerfile
├── Makefile
├── .gitignore
├── docs/
│   └── architecture.drawio
├── tests/
│   ├── unit/
│   └── property/
└── src/
    └── app/
        ├── main.py              # FastAPI entry (health, connect, disconnect, message)
        ├── orchestrator.py      # Conversation flow + tool-use loop
        ├── ai_caller.py         # Mantle API via OpenAI SDK
        ├── tool_executor.py     # RAG knowledge base search
        ├── connection_manager.py # DynamoDB connection tracking
        ├── message_sender.py    # @connections delivery with retry
        ├── message_protocol.py  # WebSocket message format builders
        ├── conversation_context.py
        ├── config.py
        ├── models.py
        └── logging_config.py
└── infra/
    ├── environment/{dev,staging,prod}/
    └── modules/{vpc,ecs,ecr,nlb,websocket_api,dynamodb,s3}/
```

## Configuration

All configuration is via environment variables injected by the ECS task definition:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Container port | `8080` |
| `DYNAMODB_TABLE_NAME` | User context table | — |
| `CONNECTION_TABLE_NAME` | WebSocket connections table | — |
| `RAG_BUCKET_NAME` | S3 RAG documents bucket | — |
| `MANTLE_BASE_URL` | Bedrock Mantle API endpoint | `https://bedrock-mantle.us-east-1.api.aws/v1` |
| `MODEL_ID` | Bedrock model identifier | — |
| `WEBSOCKET_API_ENDPOINT` | API GW Management endpoint | — |
| `MAX_TOOL_ITERATIONS` | Max tool-use loop iterations | `10` |
| `MAX_CONVERSATION_HISTORY` | Max messages in history | `50` |
| `POWERTOOLS_SERVICE_NAME` | Logging service name | `chatbot-ecs-ws` |
| `POWERTOOLS_LOG_LEVEL` | Log level | `INFO` |

## Deployment

```bash
# 1. Build and push Docker image
make docker-build ECR_REPO=<your-ecr-url>
make docker-push ECR_REPO=<your-ecr-url> AWS_REGION=us-east-1

# 2. Deploy infrastructure
cp infra/environment/dev/terraform.tfvars.example infra/environment/dev/terraform.tfvars
# Edit terraform.tfvars with your values
make deploy ENV=dev
```

## RAG Knowledge Base

Upload documents to the S3 RAG bucket. The tool executor performs prefix-based lookups:

```bash
aws s3 cp docs/ s3://<rag-bucket-name>/ --recursive
```

## WebSocket Protocol

### Client-to-Server

```json
{
  "action": "sendMessage",
  "userId": "user-123",
  "message": "What documents do you have about security?"
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `action` | string | Required, must be `"sendMessage"` |
| `userId` | string | Required, 1–256 characters |
| `message` | string | Required, 1–4096 characters |

### Server-to-Client

**Complete response (non-streaming):**
```json
{
  "type": "message",
  "response": "Based on the knowledge base...",
  "conversationId": "user-123",
  "timestamp": "2024-01-15T10:30:45+00:00"
}
```

**Status (during tool-use loop):**
```json
{"type": "status", "message": "Processing..."}
```

**Error:**
```json
{"type": "error", "message": "Processing failed", "correlationId": "req-abc"}
```

| Message Type | Fields | Description |
|--------------|--------|-------------|
| `message` | `type`, `response`, `conversationId`, `timestamp` | Complete AI response |
| `status` | `type`, `message` | Processing status during tool-use loop |
| `error` | `type`, `message`, `correlationId` | Processing error |

### JavaScript Client Example

```javascript
const ws = new WebSocket('wss://<api-id>.execute-api.us-east-1.amazonaws.com/dev?userId=user-123');

ws.onopen = () => {
  ws.send(JSON.stringify({
    action: 'sendMessage',
    userId: 'user-123',
    message: 'Hello, what can you help me with?'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'message':
      console.log('Response:', data.response);
      break;
    case 'status':
      console.log('Status:', data.message);
      break;
    case 'error':
      console.error('Error:', data.message);
      break;
  }
};
```

## Logging & Observability

Structured JSON logging via aws-lambda-powertools Logger. All log entries include:
- `timestamp`, `level`, `service`, `correlation_id`, `message`
- AI interactions: `logType: "ai-interaction"`, `model`, `inputTokens`, `outputTokens`, `latencyMs`

Logs are sent to CloudWatch Logs group: `{project}-{env}-chatbot-logs` (30-day retention).

## Container Operations

```bash
# Build Docker image
make docker-build ECR_REPO=<ecr-url>

# Authenticate and push
make docker-push ECR_REPO=<ecr-url> AWS_REGION=us-east-1

# Scale service
# Update desired_count in terraform.tfvars, then:
make deploy ENV=dev
```

**Health check:** `GET /health` returns `{"status": "healthy"}` (HTTP 200) or HTTP 503 during shutdown.

**Graceful shutdown:** On SIGTERM, the service stops accepting new requests, drains in-flight requests (up to 30s stop timeout), and exits with code 0.

**Circuit breaker:** ECS deployment circuit breaker with automatic rollback on failure.

## Customization

1. **System prompt:** Edit `SYSTEM_PROMPT` in `src/app/ai_caller.py`
2. **Tools:** Add tools in `src/app/tool_executor.py` via `register_tool()`
3. **Model:** Change `model_id` in `terraform.tfvars`
4. **Scaling:** Adjust `desired_count`, `cpu_units`, `memory_mib` in `terraform.tfvars`
