# Chatbot RAG Template — Bedrock Mantle API (ECS, WebSocket, Streaming)

## Overview

A chatbot RAG template using Bedrock Mantle API (OpenAI-compatible) for AI inference, ECS Fargate for compute, and WebSocket for real-time bidirectional communication. Streaming: AI-generated tokens are delivered progressively to the client as they are produced, with tool-use iterations handled transparently.

**Key characteristics:**
- **AI Service:** Bedrock Mantle API (OpenAI SDK with bedrock-mantle endpoint)
- **Compute:** ECS Fargate (persistent container)
- **Transport:** WebSocket (API Gateway v2 → VPC Link → NLB → ECS)
- **Streaming:** Yes (tokens streamed progressively to client)

## Architecture

```
Client → API Gateway WebSocket → VPC Link → NLB → ECS Fargate (FastAPI)
                                                       ├── Orchestrator (streaming tool-use loop)
                                                       ├── AI Caller (Mantle/OpenAI SDK, stream=True)
                                                       ├── Tool Executor (RAG/S3)
                                                       ├── Connection Manager (DynamoDB)
                                                       └── Message Sender (@connections)
```

The ECS service handles WebSocket lifecycle events ($connect, $disconnect, sendMessage) forwarded from API Gateway as HTTP POST requests via a VPC Link + NLB integration. Streaming responses are sent chunk-by-chunk to clients via the API Gateway Management API `@connections` endpoint.

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
        ├── orchestrator.py      # Streaming tool-use loop + chunk delivery
        ├── ai_caller.py         # Mantle API via OpenAI SDK (stream=True)
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

The streaming Mantle variant implements a tool-use loop with streaming:

1. **Streaming request:** Each AI invocation uses `stream=True` via the OpenAI SDK
2. **Tool-use handling:** If the stream produces function_call items, the orchestrator:
   - Does NOT forward those items to the client
   - Sends a `{"type": "status", "message": "Processing..."}` message once per iteration
   - Executes the requested tools
   - Makes a follow-up streaming request with tool results
3. **Final response:** Only the iteration that produces text without function_calls is streamed to the client
4. **Token batching:** The `MAX_CHUNK_SIZE` variable (1-50) controls how many tokens are batched per WebSocket frame. Default is 1 (immediate delivery per token).

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
    case 'status':
      showSpinner(data.message);
      break;
    case 'error':
      handleError(data.message, data.correlationId);
      break;
  }
};
```

### Error Scenarios

- **Max iterations exceeded:** If the tool-use loop reaches `MAX_TOOL_ITERATIONS` without a text response, an error message is sent and no partial data is saved.
- **AI streaming error:** If the AI service errors mid-stream, an error is sent to the client and partial response is discarded.
- **Client disconnect:** If the WebSocket closes during streaming, the stream is aborted and partial response is not saved.

## WebSocket Protocol

### Client-to-Server

```json
{
  "action": "sendMessage",
  "userId": "user-123",
  "message": "What documents do you have about security?"
}
```

### Server-to-Client

**Streaming chunk:**
```json
{"type": "chunk", "content": "Based on"}
```

**Status (during tool-use loop iterations):**
```json
{"type": "status", "message": "Processing..."}
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
{"type": "error", "message": "Maximum tool iterations exceeded", "correlationId": "req-abc"}
```

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
    case 'status':
      console.log('Processing:', data.message);
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
3. **Model:** Change `model_id` in `terraform.tfvars`
4. **Scaling:** Adjust `desired_count`, `cpu_units`, `memory_mib` in `terraform.tfvars`
5. **Chunk batching:** Adjust `max_chunk_size` (1-50) to trade latency for reduced WebSocket frame overhead
