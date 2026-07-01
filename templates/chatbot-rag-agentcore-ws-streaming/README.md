# Chatbot RAG Template — Bedrock AgentCore (WebSocket, Streaming)

## Overview

Production-ready chatbot template using **Bedrock AgentCore Runtime** for AI orchestration, **AWS Lambda** for compute, **WebSocket** transport for bidirectional communication, and **streaming** AI responses delivered token-by-token to the client.

Key characteristics:
- **AI Service**: Bedrock AgentCore Runtime (built-in tool-use orchestration)
- **Compute**: AWS Lambda (serverless, pay-per-use)
- **Transport**: API Gateway WebSocket API (persistent connections)
- **Response Mode**: Streaming (tokens delivered progressively as generated)

## Architecture

The architecture follows a serverless event-driven pattern:

1. Client connects via WebSocket → Connection Manager stores connection
2. Client sends message → API Gateway routes to SQS FIFO queue
3. SQS triggers Orchestrator Lambda
4. Orchestrator invokes AgentCore Runtime in streaming mode
5. Each token chunk is forwarded to client via `@connections` POST
6. After stream completes, `done` message sent and full response saved to history

See `docs/arquitetura/chatbot-agentcore-ws-streaming.drawio` for the full diagram.

## Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (package manager)
- AWS CLI configured with appropriate credentials
- Terraform >= 1.5
- An AWS Bedrock AgentCore agent configured with your tools

## Project Structure

```
├── README.md
├── metadata.json
├── pyproject.toml
├── Makefile
├── .gitignore
├── docs/
│   └── architecture.drawio
├── build/                          # Lambda zip artifacts (gitignored)
├── tests/
│   ├── unit/
│   └── property/
├── src/
│   ├── layers/shared/python/shared/  # Shared Lambda layer modules
│   │   ├── ai_caller_agentcore.py
│   │   ├── connection_manager.py
│   │   ├── conversation_context.py
│   │   ├── logging_config.py
│   │   ├── message_protocol.py
│   │   ├── message_sender.py
│   │   ├── models.py
│   │   └── tool_executor.py
│   ├── connection_manager/handler.py   # $connect/$disconnect
│   ├── orchestrator/handler.py         # Streaming orchestration
│   ├── ai_caller/handler.py            # AgentCore invocation
│   └── tool_executor/handler.py        # Tool execution
└── infra/
    ├── environment/{dev,staging,prod}/
    └── modules/{websocket_api,sqs,lambda,dynamodb,s3,agentcore}/
```

## Configuration

Copy `infra/environment/dev/terraform.tfvars.example` to `terraform.tfvars` and fill in values:

| Variable | Description | Default |
|----------|-------------|---------|
| `project_name` | Resource name prefix (max 20 chars) | — |
| `environment` | dev, staging, or prod | — |
| `client` | Client name for tagging | — |
| `model_id` | Bedrock model identifier | — |
| `max_conversation_history` | Max messages in context | 50 |
| `max_chunk_size` | Tokens per WebSocket frame (1-50) | 1 |
| `connection_ttl_seconds` | Connection TTL | 86400 |
| `log_level` | Powertools log level | INFO |

## Deployment

```bash
make build          # Package Lambda functions
make deploy ENV=dev # Deploy to dev environment
```

## RAG Knowledge Base

Upload documents to the S3 RAG bucket (output after deploy):

```bash
aws s3 cp my-docs/ s3://<rag-bucket-name>/ --recursive
```

The tool executor performs prefix-based search. Replace with vector search for production use.

## Logging & Observability

All components produce structured JSON logs via `aws-lambda-powertools`:
- `correlation_id` propagated across all components
- AI interaction logs with `logType: "ai-interaction"` including token usage and latency
- Single AI interaction log entry emitted after stream completes (not per-chunk)

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
| `action` | string | Must be `"sendMessage"` |
| `userId` | string | 1–256 characters, non-empty |
| `message` | string | 1–4096 characters, non-empty |

### Server-to-Client (Streaming)

**Chunk** (one per token or batch of tokens):
```json
{"type": "chunk", "content": "Based on"}
```

**Done** (stream complete):
```json
{"type": "done", "conversationId": "user-123", "timestamp": "2024-01-15T10:30:47+00:00"}
```

**Error**:
```json
{"type": "error", "message": "Processing failed — please retry", "correlationId": "req-abc"}
```

### JavaScript Client Example

```typescript
const ws = new WebSocket('wss://<api-id>.execute-api.<region>.amazonaws.com/dev?userId=user-123');

ws.onopen = () => {
  ws.send(JSON.stringify({
    action: 'sendMessage',
    userId: 'user-123',
    message: 'Hello, what can you help me with?'
  }));
};

let assembledResponse = '';

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'chunk':
      assembledResponse += msg.content;
      // Update UI progressively
      updateChatUI(assembledResponse);
      break;
    case 'done':
      // Stream complete — final response is assembledResponse
      finalizeChatMessage(assembledResponse, msg.conversationId);
      assembledResponse = '';
      break;
    case 'error':
      showError(msg.message);
      assembledResponse = '';
      break;
  }
};
```

## Streaming Behavior

Tokens are delivered progressively from the AgentCore Runtime to the client:

1. The Orchestrator invokes AgentCore Runtime with streaming enabled
2. As each text chunk arrives from the completion stream, it is immediately forwarded to the client as a `{"type": "chunk"}` message
3. The `max_chunk_size` variable controls batching (default: 1 token per frame)
4. After the stream ends, a `{"type": "done"}` message is sent
5. The full assembled response is saved to conversation history

**AgentCore handles tool calling internally** — there is no application-level tool-use loop. Tokens streamed to the client represent the final response.

**Error handling**:
- If an error occurs mid-stream, an `{"type": "error"}` message is sent and the partial response is discarded
- If the client disconnects mid-stream, the stream is aborted and the partial response is not saved

**Client-side assembly**: Buffer all `chunk` messages and concatenate their `content` fields. The assembled text equals the full AI response.

## Customization

1. **System Prompt**: Edit `SYSTEM_PROMPT` in `src/layers/shared/python/shared/ai_caller_agentcore.py`
2. **Tools**: Configure tools in your AgentCore agent (the runtime handles invocation)
3. **RAG Strategy**: Replace prefix-based S3 search in `tool_executor.py` with vector search
4. **Chunk Batching**: Adjust `max_chunk_size` (1-50) to balance latency vs. frame overhead
5. **History Length**: Adjust `max_conversation_history` for longer/shorter context windows
