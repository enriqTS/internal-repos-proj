# Chatbot RAG Template — Bedrock AgentCore Runtime

## Overview

This template deploys a complete serverless chatbot application with Retrieval-Augmented Generation (RAG) capabilities, powered by the **AWS Bedrock AgentCore Runtime**. The AgentCore Runtime manages the tool-use loop internally, invoking the Tool Executor Lambda directly as an action group — simplifying the orchestration logic compared to manual loop management.

The template provides a fully deployable project scaffold with Python Lambda application code and Terraform infrastructure-as-code. All resource names are configurable via Terraform variables, allowing multiple deployments without naming conflicts.

## Architecture

The application uses a non-streaming, synchronous request-response architecture:

```
Client → API Gateway (REST) → SQS FIFO → Orchestrator Lambda → AI Caller Lambda → AgentCore Runtime
                                                ↕                                        ↕
                                          DynamoDB                              Tool Executor Lambda → S3 RAG Bucket
```

### Components

| Component | Purpose |
|-----------|---------|
| **API Gateway (REST)** | Entry point — accepts POST /chat requests from clients |
| **SQS FIFO Queue** | Asynchronous message processing with ordering guarantees |
| **Orchestrator Lambda** | Manages conversation flow and context storage |
| **AI Caller Lambda** | Invokes Bedrock AgentCore Runtime with session management |
| **Tool Executor Lambda** | Executes tool calls (RAG document retrieval from S3) |
| **DynamoDB** | Stores per-user conversation history and context |
| **S3 RAG Bucket** | Stores knowledge base documents for retrieval |

### Tool Calling (AgentCore)

In this template, the **AgentCore Runtime manages tool calling internally**:

1. Orchestrator invokes AI Caller with conversation messages
2. AI Caller sends the request to AgentCore Runtime
3. AgentCore Runtime decides when to call tools and invokes Tool Executor directly as an action group
4. Tool Executor returns results to the AgentCore Runtime
5. AgentCore Runtime produces the final response and returns it to the AI Caller

The Orchestrator does not manage a tool-use loop — AgentCore handles it end-to-end.

## Prerequisites

- AWS account with Bedrock model access enabled
- Terraform >= 1.5
- Python 3.12
- AWS CLI configured with appropriate credentials

## Project Structure

```
chatbot-rag-agentcore/
├── README.md
├── metadata.json
├── .gitignore
├── build/                          # Zip artifacts (gitignored)
│   ├── orchestrator.zip
│   ├── ai_caller.zip
│   ├── tool_executor.zip
│   └── shared-layer.zip
├── src/
│   ├── layers/
│   │   └── shared/                 # Lambda Layer — shared utilities
│   │       ├── python/
│   │       │   └── shared/
│   │       │       ├── __init__.py
│   │       │       ├── logging_config.py
│   │       │       └── models.py
│   │       └── requirements.txt
│   ├── orchestrator/
│   │   ├── handler.py              # Conversation flow (no tool-use loop)
│   │   └── requirements.txt
│   ├── ai_caller/
│   │   ├── handler.py              # AgentCore Runtime integration
│   │   └── requirements.txt
│   └── tool_executor/
│       ├── handler.py              # RAG search tool implementation
│       └── requirements.txt
└── infra/
    ├── openapi/
    │   └── api-spec.json           # OpenAPI 3.0 spec for the REST API
    ├── environment/
    │   ├── dev/
    │   │   ├── main.tf
    │   │   ├── variables.tf
    │   │   ├── outputs.tf
    │   │   ├── backend.tf
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
        │   └── shared_layer/
        ├── dynamodb/
        ├── s3/
        └── agentcore/              # AgentCore-specific resources
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
| `project_prefix` | Prefix for all resource names | `"my-chatbot-dev"` |
| `aws_region` | AWS region for deployment | `"us-east-1"` |
| `aws_account_id` | AWS account ID for ARN construction | `"123456789012"` |
| `model_id` | Bedrock foundation model identifier | `"us.anthropic.claude-sonnet-4-20250514"` |
| `max_conversation_history` | Max messages retained in context | `50` |
| `max_retry_attempts` | Max retry attempts for message processing | `3` |
| `log_level` | Powertools log level | `"INFO"` |

### System Prompt

The system prompt is defined in:

- **File:** `src/ai_caller/handler.py`
- **Constant:** `SYSTEM_PROMPT`

The default placeholder value is:

```python
SYSTEM_PROMPT = "You are a helpful assistant. Replace this prompt with your own instructions."
```

Replace this with your own instructions to customize the chatbot's persona and behavior. The template works correctly with the placeholder text — deploying without modification will produce valid AI responses using the generic assistant prompt.

### AI Model

Set the `model_id` variable in your `terraform.tfvars` file to specify which Bedrock foundation model to use:

```hcl
model_id = "us.anthropic.claude-sonnet-4-20250514"
```

The model ID is passed to the AgentCore module as a variable and used when provisioning the agent runtime resource.

## Deployment

### 1. Install Dependencies

Install Python dependencies for each Lambda function and the shared layer:

```bash
pip install -r src/layers/shared/requirements.txt -t src/layers/shared/python/
pip install -r src/orchestrator/requirements.txt -t src/orchestrator/package/
pip install -r src/ai_caller/requirements.txt -t src/ai_caller/package/
pip install -r src/tool_executor/requirements.txt -t src/tool_executor/package/
```

### 2. Configure Environment

```bash
cd infra/environment/dev
cp terraform.tfvars.example terraform.tfvars
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

The template provisions an S3 bucket (`{prefix}-rag-documents`) for storing knowledge base documents used by the chatbot's retrieval tool.

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

The bucket is created empty by default. The `search_knowledge_base` tool in `src/tool_executor/handler.py` provides a placeholder implementation that retrieves documents by key prefix — customize it with your own retrieval logic (vector search, chunking, relevance filtering).

## Logging & Observability

All Lambda functions use **aws-lambda-powertools** for structured JSON logging with consistent fields:

- `timestamp` — ISO 8601 timestamp
- `level` — Log level (INFO, ERROR, etc.)
- `service` — Lambda function name
- `correlation_id` — Unique request identifier traced across all functions

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

## Customization

### Adding Tools

1. Add your tool function to `src/tool_executor/handler.py`
2. Register the tool as an action group in the AgentCore module (`infra/modules/agentcore/main.tf`)
3. The AgentCore Runtime will automatically invoke your tool when the AI model requests it

### Modifying Orchestration

The Orchestrator Lambda (`src/orchestrator/handler.py`) controls:
- Conversation history retrieval and storage
- Error handling and retry logic

Note: Tool-use orchestration is managed by AgentCore Runtime, not the Orchestrator Lambda.

### Extending the API

All API changes are made in the OpenAPI specification at `infra/openapi/api-spec.json`. Terraform references this file to deploy the API Gateway REST API — add new endpoints or modify request/response schemas there.
