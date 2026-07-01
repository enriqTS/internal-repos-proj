# Chatbot RAG Template — Bedrock Mantle API (WebSocket, Streaming)

## Overview

Production-ready chatbot template using **Bedrock Mantle API** (OpenAI-compatible endpoint) for AI orchestration, **AWS Lambda** for compute, **WebSocket** transport for bidirectional communication, and **streaming** AI responses delivered token-by-token to the client.

Key characteristics:
- **AI Service**: Bedrock Mantle API (OpenAI-compatible, uses OpenAI Python SDK)
- **Compute**: AWS Lambda (serverless, pay-per-use)
- **Transport**: API Gateway WebSocket API (persistent connections)
- **Response Mode**: Streaming (tokens delivered progressively as generated)

## Architecture

The architecture follows a serverless event-driven pattern with a streaming tool-use loop:

1. Client connects via WebSocket → Connection Manager stores connection
2. Client sends message → API Gateway routes to SQS FIFO queue
3. SQS triggers Orchestrator Lambda
4. Orchestrator invokes Mantle API in streaming mode
5. If tool calls are detected: execute tools, send status message, make follow-up streaming request
6. Only the final iteration (no function_calls) is streamed to the client
7. Each token chunk is forwarded to client via `@connections` POST
8. After stream completes, `done` message sent and full response saved to history

See `docs/architecture.drawio` for the full diagram.

## Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (package manager)
- AWS CLI configured with appropriate credentials
- Terraform >= 1.5
- A Bedrock Mantle API key stored in AWS Secrets Manager

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
│   │   ├── ai_caller_mantle.py
│   │   ├── connection_manager.py
│   │   ├── conversation_context.py
│   │   ├── logging_config.py
│   │   ├── message_protocol.py
│   │   ├── message_sender.py
│   │   ├── models.py
│   │   └── tool_executor.py
│   ├── connection_manager/handler.py   # $connect/$disconnect
│   ├── orchestrator/handler.py         # Streaming tool-use loop orchestration
│   ├── ai_caller/handler.py            # Mantle API invocation
│   └── tool_executor/handler.py        # Tool execution
└── infra/
    ├── environment/{dev,staging,prod}/
    └── modules/{websocket_api,sqs,lambda,dynamodb,s3}/
```

## Configuration

Copy `infra/environment/dev/terraform.tfvars.example` to `terraform.tfvars` and fill in values:

| Variable | Description | Default |
|----------|-------------|---------|
| `project_name` | Resource name prefix (max 20 chars) | — |
| `environment` | dev, staging, or prod | — |
| `client` | Client name for tagging | — |
| `model_id` | Bedrock model identifier | — |
| `mantle_base_url` | Bedrock Mantle API endpoint URL | — |
| `max_conversation_history` | Max messages in context | 50 |
| `max_tool_iterations` | Max tool-use loop iterations | 10 |
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

The tool executor performs prefix-based search via the `search_knowledge_base` tool. Replace with vector search for production use.

## Logging & Observability

All components produce structured JSON logs via `aws-lambda-powertools`:
- `correlation_id` propagated across all components
- AI interaction logs with `logType: "ai-interaction"` including token usage and latency
- Single AI interaction log entry emitted after stream completes (not per-chunk)
- Tool-use loop iterations logged with iteration count

## Customization

1. **System Prompt**: Edit `SYSTEM_PROMPT` in `src/layers/shared/python/shared/ai_caller_mantle.py`
2. **Tools**: Add tool definitions in the `TOOLS` list within `src/orchestrator/handler.py`
3. **RAG Strategy**: Replace prefix-based S3 search in `tool_executor.py` with vector search
4. **Chunk Batching**: Adjust `max_chunk_size` (1-50) to balance latency vs. frame overhead
5. **Tool Iterations**: Adjust `max_tool_iterations` for more complex multi-tool workflows
6. **History Length**: Adjust `max_conversation_history` for longer/shorter context windows

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

**Status** (sent during tool-use loop iterations):
```json
{"type": "status", "message": "Processing..."}
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
    case 'status':
      // Tool-use loop in progress — show processing indicator
      showProcessingStatus(msg.message);
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

Tokens are delivered progressively from the Bedrock Mantle API to the client via a streaming tool-use loop:

1. The Orchestrator invokes Mantle API with streaming enabled (`stream=True` via OpenAI SDK)
2. The response is consumed fully for each iteration of the tool-use loop
3. **If function_call items are detected**: the tokens are NOT streamed to the client. Instead:
   - A `{"type": "status", "message": "Processing..."}` message is sent to the client
   - Tools are executed (e.g., RAG knowledge base search)
   - A follow-up streaming request is made with the tool results
4. **If no function_call items** (final iteration): the response text is streamed to the client as `{"type": "chunk"}` messages
5. After the final stream ends, a `{"type": "done"}` message is sent
6. The full assembled response and all intermediate tool results are saved to conversation history

The `max_chunk_size` variable controls batching (default: 1 token per frame). Set higher to reduce WebSocket frame overhead at the cost of perceived latency.

**Tool-use loop termination**:
- The loop completes successfully when an iteration produces text without function_call items
- If the loop exceeds `MAX_TOOL_ITERATIONS` (default: 10), an error message `{"type": "error", "message": "Maximum tool iterations exceeded"}` is sent to the client and processing stops

**Error handling**:
- If an error occurs mid-stream, an `{"type": "error"}` message is sent and the partial response is discarded
- If the client disconnects mid-stream, the stream is aborted and the partial response is not saved

**Client-side assembly**:

```typescript
// Buffer all chunk messages and concatenate their content fields.
// Ignore status messages for assembly — they indicate tool-use processing.
// The assembled text equals the full AI response.

let response = '';

function handleMessage(msg: { type: string; content?: string }) {
  if (msg.type === 'chunk') {
    response += msg.content;
  } else if (msg.type === 'done') {
    // response now contains the complete AI answer
    console.log('Full response:', response);
    response = '';
  }
}
```
