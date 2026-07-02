# Chatbot RAG Template — Bedrock AgentCore (ECS)

Chatbot RAG template using **Bedrock AgentCore Runtime** on **ECS Fargate** with REST transport and non-streaming AI responses.

## Overview

This template provides a production-ready chatbot with Retrieval-Augmented Generation (RAG) running on ECS Fargate. It uses the Bedrock AgentCore Runtime for AI orchestration, which handles tool-use loops and session management internally. **AgentCore Runtime manages conversation context natively via `sessionId`** — the Orchestrator does not retrieve history from DynamoDB before invoking the AI. Conversation exchanges are still persisted to DynamoDB after each response for compliance and audit purposes.

Key characteristics:
- **AI Service:** Bedrock AgentCore Runtime
- **Compute:** ECS Fargate (persistent container)
- **Transport:** REST (POST /chat)
- **Streaming:** Non-streaming (complete response)
- **Tool-use:** Delegated to AgentCore Runtime (handles tool calling internally)
- **Context Management:** AgentCore Runtime manages conversation context via `sessionId`; DynamoDB writes retained for compliance/audit

## Architecture

```
Client → ALB → ECS Fargate (FastAPI) → Bedrock AgentCore Runtime
                    ↓                           ↓
              DynamoDB (context,         Tool Executor → S3 (RAG)
               write-only for audit)
```

The application runs as a single container with in-process modules:
- **Orchestrator** — manages conversation flow, delegates to AI caller (passes only current message + `sessionId`)
- **AI Caller** — invokes Bedrock AgentCore Runtime (single-call pattern with `sessionId` for context)
- **Tool Executor** — executes tools (RAG knowledge base search)

## Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (package manager)
- AWS CLI configured with appropriate credentials
- Terraform >= 1.5
- Docker (for container builds)
- Bedrock AgentCore agent configured in your AWS account

## Project Structure

```
├── src/app/              # Application source code
│   ├── main.py           # FastAPI entry point
│   ├── orchestrator.py   # Conversation flow management
│   ├── ai_caller.py      # Bedrock AgentCore Runtime invocation
│   ├── tool_executor.py  # Tool dispatch + RAG search
│   ├── conversation_context.py  # DynamoDB history management
│   ├── config.py         # Environment variable loading
│   ├── models.py         # Pydantic request/response models
│   └── logging_config.py # Structured JSON logging
├── infra/                # Terraform infrastructure
│   ├── environment/      # Per-environment configs (dev/staging/prod)
│   └── modules/          # Reusable Terraform modules
├── tests/                # Test suite
├── Dockerfile            # Multi-stage Python 3.12 container
├── Makefile              # Build/deploy/test commands
└── pyproject.toml        # Python project configuration
```

## Configuration

All configuration is via environment variables (injected by Terraform):

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `AGENT_RUNTIME_ARN` | AgentCore Runtime ARN | — |
| `AGENT_ALIAS_ID` | AgentCore agent alias ID | `TSTALIASID` |
| `AGENT_ID` | AgentCore agent ID | — |
| `MAX_CONVERSATION_HISTORY` | Max messages in context | `50` |
| `DYNAMODB_TABLE_NAME` | User context DynamoDB table | — |
| `RAG_BUCKET_NAME` | S3 bucket for RAG documents | — |
| `POWERTOOLS_SERVICE_NAME` | Service name for logging | `chatbot-ecs` |
| `POWERTOOLS_LOG_LEVEL` | Log level | `INFO` |

## Deployment

1. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in values:
   ```bash
   cd infra/environment/dev
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your values
   ```

2. Deploy infrastructure:
   ```bash
   make deploy ENV=dev
   ```

3. Build and push the container image:
   ```bash
   make docker-build ECR_REPO=<ecr_repository_url>
   make docker-push ECR_REPO=<ecr_repository_url> AWS_REGION=us-east-1
   ```

4. The ECS service will automatically pull the latest image.

## RAG Knowledge Base

Upload documents to the S3 RAG bucket. The tool executor searches by key prefix:

```bash
aws s3 cp my-documents/ s3://<rag_bucket_name>/ --recursive
```

## Logging & Observability

Structured JSON logs via `aws-lambda-powertools` Logger (works in ECS):
- All logs include `correlation_id` for request tracing
- AI interactions logged with `logType: "ai-interaction"` including token usage and latency
- CloudWatch Logs group: `{project}-{env}-chatbot-logs` (30-day retention)

> **Note:** Model latency and tool execution latency metrics are no longer emitted as custom metrics. AgentCore Runtime provides vended CloudWatch logs with built-in model invocation and tool execution latency data, eliminating the need for application-level instrumentation.

## Container Operations

### Docker Image Build

```bash
make docker-build ECR_REPO=<your-ecr-repo-url>
```

### ECR Authentication and Push

```bash
make docker-push ECR_REPO=<your-ecr-repo-url> AWS_REGION=us-east-1
```

### Scaling

Adjust `desired_count` in `terraform.tfvars`:
```hcl
desired_count = 3  # Scale to 3 tasks
```

### Health Check

The container exposes `GET /health` which returns:
- `200 {"status": "healthy"}` — ready to accept traffic
- `503 {"detail": "Shutting down"}` — draining connections

ALB health check: interval 30s, timeout 5s, healthy threshold 2, unhealthy threshold 3.

### Graceful Shutdown

On SIGTERM (ECS task stop):
1. Health endpoint returns 503 (stops new traffic from ALB)
2. In-flight requests complete (up to 30s stop timeout)
3. Process exits with code 0

### Makefile Targets

| Target | Description |
|--------|-------------|
| `make build` | Install dependencies via uv |
| `make deploy ENV=dev` | Deploy infrastructure |
| `make test` | Run test suite |
| `make lint` | Run ruff linter |
| `make format` | Format code with ruff |
| `make docker-build` | Build container image |
| `make docker-push` | Push image to ECR |

## Customization

1. **System Prompt:** Edit `SYSTEM_PROMPT` in `src/app/ai_caller.py`
2. **Tools:** Add tools in `src/app/tool_executor.py` using `register_tool()`
3. **Agent Configuration:** Adjust agent settings in your AWS Bedrock AgentCore console
4. **Scaling:** Adjust `desired_count`, `cpu_units`, `memory_mib` in `terraform.tfvars`
