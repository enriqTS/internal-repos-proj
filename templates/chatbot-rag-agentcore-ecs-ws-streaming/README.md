# Chatbot RAG Template — Bedrock AgentCore (ECS, WebSocket, Streaming)

## Overview

A chatbot RAG template using Bedrock AgentCore Runtime for AI inference, ECS Fargate for compute, and WebSocket for real-time bidirectional communication. Streaming: AI-generated tokens are delivered progressively to the client as they are produced by the AgentCore Runtime.

**Key characteristics:**
- **AI Service:** Bedrock AgentCore Runtime (managed orchestration with built-in tool handling)
- **Compute:** ECS Fargate (persistent container)
- **Transport:** WebSocket (API Gateway v2 → VPC Link → NLB → ECS)
- **Streaming:** Yes (tokens streamed progressively to client)

## Architecture

```
Client → API Gateway WebSocket → VPC Link → NLB → ECS Fargate (FastAPI)
                                                       ├── Orchestrator (streaming single-call)
                                                       ├── AI Caller (AgentCore Runtime, streaming)
                                                       ├── Tool Executor (RAG/S3)
                                                       ├── Connection Manager (DynamoDB)
                                                       └── Message Sender (@connections)
```

The ECS service handles WebSocket lifecycle events ($connect, $disconnect, sendMessage) forwarded from API Gateway as HTTP POST requests via a VPC Link + NLB integration. Streaming responses are sent chunk-by-chunk to clients via the API Gateway Management API `@connections` endpoint.

AgentCore Runtime handles tool-use orchestration internally — the application consumes the streaming completion event-by-event and forwards text chunks to the client as they arrive.

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
        ├── orchestrator.py      # Streaming chunk delivery
        ├── ai_caller.py         # AgentCore Runtime streaming invocation
        ├── tool_executor.py     # RAG knowledge base search
        ├── connection_manager.py # DynamoDB connection tracking
        ├── message_sender.py    # @connections delivery with retry
        ├── conversation_context.py
        ├── config.py
        ├── models.py
        └── logging_config.py
└── infra/
    ├── environment/{dev,staging,prod}/
    └── modules/{vpc,ecs,ecr,nlb,websocket_api,dynamodb,s3,agentcore}/
```

## Configuration

All configuration is via environment variables injected by the ECS task definition:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Container port | `8080` |
| `DYNAMODB_TABLE_NAME` | User context table | — |
| `CONNECTION_TABLE_NAME` | WebSocket connections table | — |
| `RAG_BUCKET_NAME` | S3 RAG documents bucket | — |
| `AGENT_RUNTIME_ARN` | AgentCore Runtime ARN | — |
| `AGENT_ALIAS_ID` | AgentCore agent alias ID | `TSTALIASID` |
| `AGENT_ID` | AgentCore agent ID | — |
| `WEBSOCKET_API_ENDPOINT` | API GW Management endpoint | — |
| `MAX_CHUNK_SIZE` | Max tokens per WebSocket frame (1-50) | `1` |
| `MAX_CONVERSATION_HISTORY` | Max messages in history | `50` |
| `POWERTOOLS_SERVICE_NAME` | Logging service name | `chatbot-ecs-ws-streaming` |
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

## Streaming Behavior

The streaming AgentCore variant consumes the Runtime's streaming completion event-by-event:

1. **Streaming request:** The AI Caller invokes the AgentCore Runtime with streaming enabled
2. **Event consumption:** As the Runtime produces text chunks in the completion stream, each chunk is yielded immediately to the orchestrator
3. **Progressive delivery:** The orchestrator forwards each chunk to the client via WebSocket as `{"type": "chunk"}` messages
4. **No application-level tool loop:** AgentCore Runtime handles tool calling internally — all streamed tokens represent the final response
5. **Token batching:** The `MAX_CHUNK_SIZE` variable (1-50) controls how many tokens are batched per WebSocket frame. Default is 1 (immediate delivery per token).

### Client-Side Chunk Assembly

```javascript
let fullResponse = '';

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'chunk':
      fullResponse += data.content;
      updateUI(fullResponse); // Progressive display
      break;
    case 'done':
      finalize(fullResponse);
      break;
    case 'error':
      handleError(data.message, data.correlationId);
      break;
  }
};
```

### Error Scenarios

- **AI streaming error:** If the AgentCore Runtime errors mid-stream, an error message is sent to the client and partial response is discarded.
- **Client disconnect:** If the WebSocket closes during streaming, the stream is aborted within 5 seconds and partial response is not saved.

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

**Streaming chunk:**
```json
{"type": "chunk", "content": "Based on"}
```

**Stream completion:**
```json
{
  "type": "done",
  "conversationId": "user-123",
  "timestamp": "2024-01-15T10:30:47+00:00"
}
```

**Error:**
```json
{"type": "error", "message": "Stream processing failed", "correlationId": "req-abc"}
```

| Message Type | Fields | Description |
|--------------|--------|-------------|
| `chunk` | `type`, `content` | Streamed token/chunk |
| `done` | `type`, `conversationId`, `timestamp` | Stream complete |
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

let responseText = '';

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'chunk':
      responseText += data.content;
      document.getElementById('output').textContent = responseText;
      break;
    case 'done':
      console.log('Stream complete:', data.conversationId);
      break;
    case 'error':
      console.error('Error:', data.message, data.correlationId);
      break;
  }
};
```

## Logging & Observability

Structured JSON logging via aws-lambda-powertools Logger. All log entries include:
- `timestamp`, `level`, `service`, `correlation_id`, `message`
- AI interactions: `logType: "ai-interaction"`, `model`, `inputTokens`, `outputTokens`, `latencyMs`
- Streaming calls emit a single AI interaction log entry after the stream completes (not per-chunk)

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

**Graceful shutdown:** On SIGTERM, the service stops accepting new requests, drains in-flight requests (up to 30s stop timeout), sends WebSocket close frames to remaining clients, and exits with code 0.

**Circuit breaker:** ECS deployment circuit breaker with automatic rollback on failure.

## Customization

1. **System prompt:** Edit `SYSTEM_PROMPT` in `src/app/ai_caller.py`
2. **Tools:** Add tools in `src/app/tool_executor.py` via `register_tool()`
3. **Agent configuration:** Update AgentCore agent settings via `terraform.tfvars`
4. **Scaling:** Adjust `desired_count`, `cpu_units`, `memory_mib` in `terraform.tfvars`
5. **Chunk batching:** Adjust `max_chunk_size` (1-50) to trade latency for reduced WebSocket frame overhead
