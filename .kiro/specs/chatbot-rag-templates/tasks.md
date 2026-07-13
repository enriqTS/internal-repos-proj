s# Implementation Plan: Chatbot RAG Templates

## Overview

This plan delivers two complete, deployable project templates (`chatbot-rag-agentcore` and `chatbot-rag-mantle`) under `/templates/` in the repository. Both templates share an identical serverless architecture (API Gateway → SQS FIFO → Orchestrator Lambda → AI Caller Lambda → Tool Executor Lambda, with DynamoDB and S3) but differ in the AI integration layer. The implementation starts with shared infrastructure (Lambda Layer, common modules), builds the Mantle template first (simpler tool-use loop), then creates the AgentCore template (adds agentcore module), and finishes with metadata, README, and tests.

## Tasks

- [x] 1. Create shared Lambda Layer and common Python utilities
  - [x] 1.1 Create the shared Lambda Layer directory structure and logging configuration
    - Create `templates/chatbot-rag-mantle/src/layers/shared/python/shared/__init__.py`
    - Create `templates/chatbot-rag-mantle/src/layers/shared/python/shared/logging_config.py` with `get_logger()`, `get_tracer()`, and `log_ai_interaction()` functions using aws-lambda-powertools
    - Create `templates/chatbot-rag-mantle/src/layers/shared/python/shared/models.py` with `ChatMessage` and `ChatRequest` dataclasses
    - Create `templates/chatbot-rag-mantle/src/layers/shared/requirements.txt` with pinned `aws-lambda-powertools[all]==3.4.0`
    - _Requirements: 1.4, 1.5, 7.4, 8.4_

- [x] 2. Create Mantle template — Lambda function source code
  - [x] 2.1 Implement the Mantle Orchestrator Lambda handler
    - Create `templates/chatbot-rag-mantle/src/orchestrator/handler.py` with SQS trigger handler, conversation history retrieval/save (DynamoDB), AI Caller invocation, tool-use loop (max 10 iterations), correlation ID propagation, and structured logging
    - Create `templates/chatbot-rag-mantle/src/orchestrator/requirements.txt` with `boto3>=1.34.0,<2.0.0`
    - _Requirements: 2.3, 6.3, 6.7, 7.1, 7.2, 7.3, 7.5, 7.6, 9.1, 9.2, 9.4, 9.5, 9.6, 9.7, 11.3_

  - [x] 2.2 Implement the Mantle AI Caller Lambda handler
    - Create `templates/chatbot-rag-mantle/src/ai_caller/handler.py` with SYSTEM_PROMPT placeholder constant (annotated with PLACEHOLDER comment), OpenAI SDK client configured with Mantle base URL, `POST /responses` invocation with `stream=False`, `instructions` parameter for system prompt, tool definitions in OpenAI function format, AI interaction logging with `logType: "ai-interaction"`, and error handling raising exceptions
    - Create `templates/chatbot-rag-mantle/src/ai_caller/requirements.txt` with `openai>=1.50.0,<2.0.0`
    - _Requirements: 4.1, 4.2, 6.1, 6.2, 6.4, 6.6, 8.1, 8.2, 8.3, 8.4, 8.5, 11.2_

  - [x] 2.3 Implement the Mantle Tool Executor Lambda handler
    - Create `templates/chatbot-rag-mantle/src/tool_executor/handler.py` with `search_knowledge_base` placeholder tool (reads from RAG bucket by key prefix), inline TODO comments marking sections for customization, correlation ID logging, and structured error handling
    - Create `templates/chatbot-rag-mantle/src/tool_executor/requirements.txt` with `boto3>=1.34.0,<2.0.0`
    - _Requirements: 2.5, 10.4, 7.1, 7.2, 7.3_

- [x] 3. Create Mantle template — Terraform infrastructure modules
  - [x] 3.1 Create the API Gateway module with OpenAPI spec
    - Create `templates/chatbot-rag-mantle/infra/openapi/api-spec.json` with OpenAPI 3.0 spec defining POST /chat endpoint, request/response schemas, and x-amazon-apigateway-integration for SQS
    - Create `templates/chatbot-rag-mantle/infra/modules/api_gateway/main.tf` with REST API resource using `body` parameter, deployment with redeployment trigger, and stage
    - Create `templates/chatbot-rag-mantle/infra/modules/api_gateway/variables.tf` and `outputs.tf`
    - _Requirements: 2.1, 11.1, 11.4, 11.5, 11.6_

  - [x] 3.2 Create the SQS FIFO queue module
    - Create `templates/chatbot-rag-mantle/infra/modules/sqs/main.tf` with FIFO queue named `{prefix}-message-queue.fifo`
    - Create `templates/chatbot-rag-mantle/infra/modules/sqs/variables.tf` and `outputs.tf`
    - _Requirements: 2.2, 3.2_

  - [x] 3.3 Create the Lambda modules (orchestrator, ai_caller, tool_executor, shared_layer)
    - Create `templates/chatbot-rag-mantle/infra/modules/lambda/orchestrator/lambda.tf` with archive_file data source, Lambda function resource (Python 3.12), environment variables (MAX_CONVERSATION_HISTORY, MAX_RETRY_ATTEMPTS, MAX_TOOL_ITERATIONS, POWERTOOLS_SERVICE_NAME, etc.), SQS event source mapping
    - Create `templates/chatbot-rag-mantle/infra/modules/lambda/orchestrator/iam.tf` with least-privilege IAM role (SQS, DynamoDB, Lambda invoke permissions)
    - Create `templates/chatbot-rag-mantle/infra/modules/lambda/orchestrator/variables.tf`
    - Create similar structure for `ai_caller/` (lambda.tf, iam.tf, variables.tf) with Bedrock permissions
    - Create similar structure for `tool_executor/` (lambda.tf, iam.tf, variables.tf) with S3 read-only permissions
    - Create `templates/chatbot-rag-mantle/infra/modules/lambda/shared_layer/lambda_layer.tf` and `variables.tf`
    - _Requirements: 2.3, 2.4, 2.5, 2.8, 3.2, 10.5_

  - [x] 3.4 Create the DynamoDB module
    - Create `templates/chatbot-rag-mantle/infra/modules/dynamodb/main.tf` with table named `{prefix}-user-context`, partition key `userId` (String)
    - Create `templates/chatbot-rag-mantle/infra/modules/dynamodb/variables.tf` and `outputs.tf`
    - _Requirements: 2.6, 3.2, 9.3_

  - [x] 3.5 Create the S3 module
    - Create `templates/chatbot-rag-mantle/infra/modules/s3/main.tf` with bucket named `{prefix}-rag-documents`, versioning enabled, Block Public Access on all four settings
    - Create `templates/chatbot-rag-mantle/infra/modules/s3/variables.tf` and `outputs.tf`
    - _Requirements: 2.7, 3.2, 10.1, 10.2_

  - [x] 3.6 Create environment configurations (dev/staging/prod)
    - Create `templates/chatbot-rag-mantle/infra/environment/dev/main.tf` wiring all modules together with AWS provider (~> 6.0)
    - Create `templates/chatbot-rag-mantle/infra/environment/dev/variables.tf` with project_prefix, aws_region, aws_account_id, model_id, mantle_base_url, max_conversation_history, max_retry_attempts, log_level
    - Create `templates/chatbot-rag-mantle/infra/environment/dev/outputs.tf`
    - Create `templates/chatbot-rag-mantle/infra/environment/dev/backend.tf` with S3 backend placeholder
    - Create `templates/chatbot-rag-mantle/infra/environment/dev/terraform.tfvars.example` with documented placeholders
    - Create `staging/` and `prod/` with same structure (different backend keys)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.5, 7.7, 9.5_

- [x] 4. Checkpoint — Mantle template infrastructure
  - Ensure all Terraform files are syntactically valid, all module references are correct, and the template structure matches the design. Ask the user if questions arise.

- [x] 5. Create AgentCore template from Mantle template with AI-layer differences
  - [x] 5.1 Copy shared structure and create AgentCore Lambda source code
    - Copy `templates/chatbot-rag-mantle/src/layers/` to `templates/chatbot-rag-agentcore/src/layers/` (identical shared layer)
    - Create `templates/chatbot-rag-agentcore/src/orchestrator/handler.py` — same as Mantle but WITHOUT the tool-use loop (AgentCore Runtime manages it internally); orchestrator just invokes AI Caller and returns
    - Create `templates/chatbot-rag-agentcore/src/orchestrator/requirements.txt`
    - _Requirements: 2.3, 7.1, 7.2, 7.3, 7.5, 7.6, 9.1, 9.2, 9.4, 9.5, 9.6, 9.7_

  - [x] 5.2 Implement the AgentCore AI Caller Lambda handler
    - Create `templates/chatbot-rag-agentcore/src/ai_caller/handler.py` with SYSTEM_PROMPT placeholder constant (PLACEHOLDER comment), Bedrock AgentCore Runtime API invocation, session management (create new or resume existing by userId), tool definitions passed to runtime, AI interaction logging, and error handling raising exceptions
    - Create `templates/chatbot-rag-agentcore/src/ai_caller/requirements.txt` with `boto3>=1.34.0,<2.0.0`
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 5.5, 5.6, 8.1, 8.2, 8.3, 8.4, 8.5, 11.2_

  - [x] 5.3 Create AgentCore Tool Executor Lambda handler
    - Create `templates/chatbot-rag-agentcore/src/tool_executor/handler.py` — same `search_knowledge_base` tool as Mantle but invoked directly by AgentCore Runtime (returns results to the runtime, not the orchestrator)
    - Create `templates/chatbot-rag-agentcore/src/tool_executor/requirements.txt`
    - _Requirements: 2.5, 5.3, 10.4, 7.1, 7.2, 7.3_

  - [x] 5.4 Create AgentCore Terraform modules (copy shared + add agentcore module)
    - Copy all shared Terraform modules from Mantle template (`api_gateway/`, `sqs/`, `lambda/`, `dynamodb/`, `s3/`) to `templates/chatbot-rag-agentcore/infra/modules/`
    - Create `templates/chatbot-rag-agentcore/infra/modules/agentcore/main.tf` with `aws_bedrockagentcore_agent_runtime` resource, agent alias, and action group registering the Tool Executor Lambda ARN
    - Create `templates/chatbot-rag-agentcore/infra/modules/agentcore/variables.tf` and `outputs.tf`
    - Copy OpenAPI spec to `templates/chatbot-rag-agentcore/infra/openapi/api-spec.json`
    - _Requirements: 5.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 5.5 Create AgentCore environment configurations (dev/staging/prod)
    - Create `templates/chatbot-rag-agentcore/infra/environment/dev/main.tf` wiring all modules including `agentcore` module
    - Create variables.tf, outputs.tf, backend.tf, terraform.tfvars.example
    - Create `staging/` and `prod/` environments
    - Ensure AI Caller Lambda IAM includes `bedrock:InvokeAgent` permission
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.4, 7.7, 9.5_

- [x] 6. Checkpoint — AgentCore template complete
  - Ensure all AgentCore Terraform files are syntactically valid, the agentcore module is correctly wired, and the AI Caller uses AgentCore Runtime API. Ask the user if questions arise.

- [x] 7. Add template metadata, README, and .gitignore for both templates
  - [x] 7.1 Create metadata.json for both templates
    - Create `templates/chatbot-rag-mantle/metadata.json` with name, description (containing "Bedrock Mantle API", ≤200 chars), tags (chatbot, rag, python, terraform, bedrock-mantle), and date
    - Create `templates/chatbot-rag-agentcore/metadata.json` with name, description (containing "Bedrock AgentCore Runtime", ≤200 chars), tags (chatbot, rag, python, terraform, bedrock-agentcore), and date
    - _Requirements: 1.6, 12.3, 12.4_

  - [x] 7.2 Create README.md for both templates
    - Create `templates/chatbot-rag-mantle/README.md` with H1 title containing "Bedrock Mantle API", sections for: Overview, Architecture, Prerequisites, Project Structure, Configuration (Terraform Variables, System Prompt referencing `src/ai_caller/handler.py` and `SYSTEM_PROMPT` constant, AI Model), Deployment, RAG Knowledge Base (supported formats: .txt, .md, .pdf), Logging & Observability, Customization
    - Create `templates/chatbot-rag-agentcore/README.md` with H1 title containing "Bedrock AgentCore Runtime" and same section structure adapted for AgentCore
    - _Requirements: 1.2, 4.3, 10.3, 12.1, 12.2_

  - [x] 7.3 Create .gitignore and build/ directory for both templates
    - Create `templates/chatbot-rag-mantle/.gitignore` with patterns for Terraform state/cache, build artifacts, Python cache, environment files, and IDE/OS files
    - Create `templates/chatbot-rag-mantle/build/.gitkeep` (empty build directory)
    - Create identical files for `templates/chatbot-rag-agentcore/`
    - _Requirements: 1.1, 1.7_

- [x] 8. Checkpoint — Template artifacts complete
  - Ensure both templates have all required files (README.md, metadata.json, .gitignore, src/, infra/, build/), correct directory structure, and all requirements are covered. Ask the user if questions arise.

- [ ] 9. Property-based tests for shared application logic
  - [ ]* 9.1 Write property test for metadata JSON schema validation
    - **Property 1: Metadata JSON schema validation**
    - **Validates: Requirements 1.6**
    - Create test using Hypothesis to generate arbitrary JSON objects and verify the metadata validation function accepts/rejects correctly based on schema rules (name regex, description length, tags array constraints, date ISO format)

  - [ ]* 9.2 Write property test for tool-use loop termination
    - **Property 2: Tool-use loop termination**
    - **Validates: Requirements 6.3, 6.7, 11.3**
    - Create test using Hypothesis to generate sequences of AI responses (with/without function_call items) and configurable max iterations, verifying loop always terminates within N iterations

  - [ ]* 9.3 Write property test for structured JSON log format
    - **Property 3: Structured JSON log format**
    - **Validates: Requirements 7.4**
    - Create test using Hypothesis to generate arbitrary log levels, messages, and optional extra fields, verifying Powertools Logger output is valid JSON with required fields (timestamp, level, service, correlation_id, message)

  - [ ]* 9.4 Write property test for correlation ID propagation
    - **Property 4: Correlation ID propagation**
    - **Validates: Requirements 7.6**
    - Create test using Hypothesis to generate arbitrary correlation ID strings, verifying the orchestrator includes the same ID in invocation payloads to AI Caller and Tool Executor

  - [ ]* 9.5 Write property test for AI interaction logging completeness
    - **Property 5: AI interaction logging completeness**
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.5**
    - Create test using Hypothesis to generate AI interaction data (tokens, latency, model, tool calls), verifying log entries contain all required fields with logType "ai-interaction"

  - [ ]* 9.6 Write property test for conversation history trimming
    - **Property 6: Conversation history trimming preserves recency**
    - **Validates: Requirements 9.4**
    - Create test using Hypothesis to generate conversation histories of varying lengths and max limits, verifying trimmed output has correct length, contains most recent messages, and preserves chronological order

  - [ ]* 9.7 Write property test for conversation history append
    - **Property 7: Conversation history append**
    - **Validates: Requirements 9.2**
    - Create test using Hypothesis to generate user messages and AI responses, verifying append operation increases count by 2 and preserves order

  - [ ]* 9.8 Write property test for API success response format
    - **Property 8: API success response format**
    - **Validates: Requirements 11.4**
    - Create test using Hypothesis to generate response text, user IDs, and timestamps, verifying the formatted response JSON contains exactly response, conversationId, and timestamp fields

  - [ ]* 9.9 Write property test for API error response format
    - **Property 9: API error response format**
    - **Validates: Requirements 11.5**
    - Create test using Hypothesis to generate error types and correlation IDs, verifying the formatted error JSON contains error=true, correlationId, and non-empty message

- [x] 10. Final checkpoint — All artifacts and tests complete
  - Ensure all tests pass, both template structures are complete, and all 12 requirements are covered by implementation tasks. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using Hypothesis (Python PBT library)
- Unit tests validate specific examples and edge cases
- Both templates use Python 3.12, aws-lambda-powertools for logging, and Terraform AWS provider ~> 6.0
- The AgentCore template's orchestrator does NOT have a tool-use loop (AgentCore Runtime manages it internally)
- The Mantle template's orchestrator manages the tool-use loop iteratively (max 10 iterations)
- All Lambda functions are packaged via Terraform's `archive_file` data source into the `build/` folder

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.4", "3.5"] },
    { "id": 3, "tasks": ["3.3", "3.6"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["5.4", "5.5"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9"] }
  ]
}
```
