# Requirements Document

## Introduction

This feature delivers ten new chatbot RAG template variants for the internal repositories platform, extending the existing two templates (`chatbot-rag-agentcore` and `chatbot-rag-mantle`) across three new dimensions: WebSocket transport (non-streaming), WebSocket transport with streaming AI responses, and ECS Fargate compute. Each new template reuses the same core business logic (orchestration, AI calling, tool execution, conversation context via DynamoDB, RAG via S3) while varying the communication protocol (REST vs WebSocket), response delivery mode (complete vs streaming), and compute layer (Lambda vs ECS Fargate).

The new templates are:
- **Lambda WebSocket non-streaming** (2): WebSocket transport with non-streaming AI — same AI logic, different transport
- **Lambda WebSocket streaming** (2): WebSocket transport with streaming AI — tokens sent progressively to the client
- **ECS REST non-streaming** (2): ECS Fargate compute with REST API, non-streaming AI
- **ECS WebSocket non-streaming** (2): ECS Fargate compute with WebSocket transport, non-streaming AI
- **ECS WebSocket streaming** (2): ECS Fargate compute with WebSocket transport, streaming AI responses

All templates follow the same artifact structure, naming conventions, observability patterns, and Terraform modular organization as the existing templates, ensuring developers can compare variants side by side.

## Glossary

- **Template_Artifact**: A directory stored under `/templates/{name}/` containing the full downloadable project scaffold including application code, Terraform infrastructure-as-code, tests, documentation, and metadata, following the platform's template structure.
- **WebSocket_API**: An API Gateway WebSocket API that enables bidirectional communication between the client and the backend, using `$connect`, `$disconnect`, and `sendMessage` routes for managing connections and delivering messages.
- **REST_API**: An API Gateway REST API that accepts synchronous HTTP POST requests and returns complete responses, as used by the existing templates.
- **Streaming_Response**: A response delivery mode where the AI service generates tokens incrementally and each token or chunk is sent to the client via the WebSocket connection as it becomes available, using the `@connections` POST endpoint of API Gateway.
- **Non_Streaming_Response**: A response delivery mode where the AI service generates a complete response in a single payload before it is delivered to the client.
- **ECS_Service**: An AWS ECS Fargate service running a long-lived containerized Python application that replaces Lambda as the compute layer, using a Docker container with the same application logic.
- **Connection_Table**: A DynamoDB table that stores active WebSocket connection IDs mapped to user identifiers, enabling the backend to push messages back to specific clients.
- **ALB**: An Application Load Balancer that fronts ECS services for REST API variants, providing HTTP routing and health checks.
- **Architecture_Diagram**: A Draw.io-generated diagram (`.drawio` source and exported `.png`) stored alongside each template that visually represents the infrastructure components, their relationships, and data flow patterns for the template variant. Generated using the Draw.io MCP with AWS4 shape library icons and architectural group containers.
- **Orchestrator_Lambda**: The central Lambda function (in Lambda-based variants) that manages conversation flow, coordinates AI calls, handles tool execution, and stores conversation context.
- **Orchestrator_Service**: The ECS Fargate service (in ECS-based variants) that performs the same role as Orchestrator_Lambda but runs as a persistent container process.
- **AI_Caller**: The component (Lambda or ECS service module) responsible for invoking the AI service (Bedrock AgentCore Runtime or Bedrock Mantle API) with conversation messages, system prompt, and tool definitions.
- **Tool_Executor**: The component (Lambda or ECS service module) that executes tools requested by the AI model, including the RAG knowledge base search.
- **User_Context_DB**: A DynamoDB table that stores per-user conversation history and context, shared across all template variants.
- **RAG_Bucket**: An S3 bucket for storing RAG documents, shared across all template variants.
- **Bedrock_AgentCore_Runtime**: AWS Bedrock AgentCore's runtime service that provides AI orchestration with built-in tool-use loops and session management.
- **Bedrock_Mantle_API**: AWS Bedrock's OpenAI-compatible API endpoint that supports the responses protocol for model invocation using the OpenAI Python SDK.
- **Connection_Manager**: A Lambda function (or ECS module) responsible for handling WebSocket `$connect` and `$disconnect` events, storing and removing connection IDs in the Connection_Table.
- **Message_Sender**: A utility module that sends messages back to WebSocket clients using the API Gateway Management API `@connections` endpoint.

## Requirements

### Requirement 1: Template Naming and Catalog Organization

**User Story:** As a developer browsing the template catalog, I want each template variant clearly named by its AI service, transport, streaming mode, and compute layer, so that I can quickly identify the right variant for my use case.

#### Acceptance Criteria

1. THE Template_Artifact for each variant SHALL be named following the pattern `chatbot-rag-{ai_service}[-{compute}][-ws][-streaming]` where `ai_service` is `agentcore` or `mantle`, `compute` is `ecs` (omitted for Lambda), `ws` indicates WebSocket transport (omitted for REST), and `streaming` indicates streaming AI responses (omitted for non-streaming), with optional segments appearing in the exact order specified.
2. THE Template_Artifact names for the ten new variants SHALL be: `chatbot-rag-agentcore-ws`, `chatbot-rag-mantle-ws`, `chatbot-rag-agentcore-ws-streaming`, `chatbot-rag-mantle-ws-streaming`, `chatbot-rag-agentcore-ecs`, `chatbot-rag-mantle-ecs`, `chatbot-rag-agentcore-ecs-ws`, `chatbot-rag-mantle-ecs-ws`, `chatbot-rag-agentcore-ecs-ws-streaming`, `chatbot-rag-mantle-ecs-ws-streaming`.
3. THE metadata.json for each template SHALL include, at minimum, the tags `chatbot`, `rag`, `python`, `terraform`, the AI-service-specific tag (`bedrock-agentcore` or `bedrock-mantle`), and additional tags matching its characteristics: `websocket` for WebSocket variants, `streaming` for streaming variants, and `ecs` for ECS-based variants, all in lowercase kebab-case format.
4. THE metadata.json description field for each template SHALL explicitly mention the AI service name, transport protocol (REST or WebSocket), streaming mode (streaming or non-streaming), and compute layer (Lambda or ECS) using a single sentence of no more than 200 characters.
5. IF the metadata.json description field for a template exceeds 200 characters, THEN THE system SHALL reject the template metadata as invalid and indicate that the description exceeds the maximum allowed length.

### Requirement 2: WebSocket API Transport Layer (Lambda Variants)

**User Story:** As a developer building a real-time chatbot UI, I want templates that use WebSocket transport, so that I can receive messages without polling and maintain persistent connections.

#### Acceptance Criteria

1. THE WebSocket Lambda template variants SHALL provision an API Gateway WebSocket API (WebSocket_API) with three routes: `$connect` for connection establishment, `$disconnect` for connection cleanup, and `sendMessage` for receiving client messages.
2. WHEN a client establishes a WebSocket connection with a valid user identifier present in the query string parameter or authorization context, THE Connection_Manager SHALL store the connection ID and user identifier in the Connection_Table.
3. IF a client attempts to establish a WebSocket connection without a user identifier in both the query string parameter and the authorization context, THEN THE Connection_Manager SHALL reject the connection by returning a non-success response from the `$connect` handler.
4. WHEN a client disconnects from the WebSocket, THE Connection_Manager SHALL remove the connection ID entry from the Connection_Table.
5. THE Template_Artifact SHALL provision a DynamoDB table (Connection_Table) with the connection ID as the partition key and a TTL attribute set to 7200 seconds (2 hours, matching API Gateway WebSocket maximum connection duration) for automatic cleanup of stale connections.
6. WHEN the Orchestrator_Lambda completes processing a message, THE Orchestrator_Lambda SHALL use the Message_Sender utility to send the response back to the client via the API Gateway Management API `@connections` POST endpoint using the stored connection ID.
7. IF the API Gateway Management API returns a 410 Gone status when the Message_Sender attempts to send a response, THEN THE Message_Sender SHALL log the stale connection at WARN level and remove the connection entry from the Connection_Table.
8. IF the Message_Sender encounters a transient error (throttling or network failure) when sending a response via the API Gateway Management API, THEN THE Message_Sender SHALL retry the send operation up to 3 times with exponential backoff and log the failure at ERROR level if all attempts are exhausted.
9. IF the Connection_Manager fails to store the connection ID in the Connection_Table during `$connect` handling, THEN THE Connection_Manager SHALL return a non-success response from the `$connect` handler to reject the WebSocket connection.
10. THE Terraform configuration SHALL grant the Orchestrator_Lambda (and any component sending WebSocket responses) the `execute-api:ManageConnections` permission scoped to the WebSocket_API stage ARN.

### Requirement 3: Streaming AI Response Delivery

**User Story:** As a developer building a chatbot with progressive token display, I want templates where AI responses are streamed token-by-token to the client via WebSocket, so that users see answers appearing in real time.

#### Acceptance Criteria

1. THE streaming template variants SHALL configure AI service calls with streaming enabled (`stream=True` for Mantle, streaming event collection for AgentCore) so that tokens are received incrementally.
2. WHEN the AI service produces a token or chunk during streaming, THE AI_Caller SHALL yield each chunk to the Orchestrator without buffering subsequent chunks, rather than waiting for the full response.
3. WHEN the Orchestrator receives a streamed chunk from the AI_Caller, THE Orchestrator SHALL send the chunk to the client via the Message_Sender using the WebSocket `@connections` endpoint with a message type indicating it is a partial chunk (e.g., `{"type": "chunk", "content": "..."}`).
4. WHEN the AI service signals the end of the streaming response, THE Orchestrator SHALL send a final message to the client with a message type indicating completion (e.g., `{"type": "done", "content": ""}`) and then save the full assembled response to the conversation history.
5. THE non-streaming WebSocket variants SHALL NOT use streaming AI calls; they SHALL wait for the complete AI response and send it as a single WebSocket message with type `"message"`.
6. IF a streaming AI call encounters an error mid-stream, THEN THE Orchestrator SHALL send an error message to the client via WebSocket (e.g., `{"type": "error", "message": "..."}`), log the error at ERROR level with the correlation identifier, and discard the partial response without saving it to the conversation history.
7. THE streaming variants SHALL define a Terraform variable for the maximum token chunk size sent per WebSocket frame, with a default of 1 (one token per frame) and an upper bound of 50 tokens, allowing the deployer to batch tokens for reduced frame overhead.
8. IF the WebSocket connection is closed by the client while a streaming AI call is in progress, THEN THE Orchestrator SHALL abort the AI service streaming call, log the disconnection at WARN level with the correlation identifier, and not save the partial response to the conversation history.

### Requirement 4: ECS Fargate Compute Layer

**User Story:** As a platform engineer who needs long-running or high-throughput chatbot processing without Lambda timeout constraints, I want ECS-based template variants, so that I can run the same chatbot logic on persistent containers.

#### Acceptance Criteria

1. THE ECS template variants SHALL provision an ECS Fargate cluster, task definition, and service running a containerized Python application that implements the same orchestration, AI calling, and tool execution logic as the Lambda variants.
2. THE ECS template variants SHALL include a `Dockerfile` at the template root that builds a Python 3.12 container image with all application dependencies installed, using a multi-stage build with a slim base image.
3. THE ECS REST non-streaming variants SHALL provision an Application Load Balancer (ALB) that routes HTTP POST requests to the ECS service, with a health check endpoint that the ALB polls every 30 seconds (healthy threshold: 2, unhealthy threshold: 3, timeout: 5 seconds) to determine task health before routing traffic.
4. THE ECS WebSocket variants SHALL provision an API Gateway WebSocket API that integrates with the ECS service via a VPC Link and Network Load Balancer, enabling WebSocket connections to reach the ECS containers.
5. THE ECS template variants SHALL use a single ECS service with the application structured as modules (orchestrator, ai_caller, tool_executor) within the same container, communicating via in-process function calls rather than Lambda invocations.
6. THE Terraform configuration for ECS variants SHALL define variables for desired task count (default 1), CPU units (default 512), memory in MiB (default 1024), and container port (default 8080), allowing the deployer to scale the service.
7. THE ECS task definition SHALL configure CloudWatch Logs as the log driver with a dedicated log group named `{prefix}-{environment}-chatbot-logs` with a retention period of 30 days, using the same structured JSON logging format (aws-lambda-powertools compatible) as the Lambda variants.
8. THE ECS template variants SHALL provision a VPC with public and private subnets across 2 Availability Zones, a NAT Gateway, and security groups scoped to allow only inbound traffic from the ALB/NLB to ECS tasks on the container port and outbound traffic from ECS tasks to AWS services via HTTPS (port 443).
9. THE Terraform configuration for ECS variants SHALL provision an ECR repository named `{prefix}-{environment}-chatbot` for storing the container image, and include a `Makefile` target for building and pushing the image.
10. THE ECS template variants SHALL define a task execution role (for pulling images from ECR and writing to CloudWatch Logs) and a separate task role granting least-privilege access only to the specific AWS services the application requires (Bedrock, DynamoDB table, S3 bucket, Secrets Manager secret), with no wildcard resource permissions.
11. THE ECS service SHALL be configured with a minimum healthy percent of 100 and maximum percent of 200, and IF a task fails its health check 3 consecutive times, THEN THE ECS service SHALL replace the unhealthy task automatically and retain the failed task's last 100 log events in CloudWatch for diagnosis.

### Requirement 5: Shared Core Logic Across Variants

**User Story:** As a developer comparing template variants, I want the core business logic (AI calling, tool execution, conversation management, RAG) to be identical across all variants, so that switching compute or transport only changes infrastructure wiring, not application behavior.

#### Acceptance Criteria

1. THE AI_Caller core functions (prompt construction, model invocation, response parsing, token usage extraction, error handling) SHALL contain the same implementation source code across all variants that use the same AI service, regardless of compute layer or transport protocol — with the only permitted differences being: (a) the `stream` parameter value in streaming variants, (b) module import paths dictated by the variant's file structure, and (c) the Lambda handler entry-point wrapper which is absent in ECS variants.
2. THE Tool_Executor core functions (tool dispatch, RAG bucket search, result formatting) SHALL contain the same implementation source code across all template variants, with the only permitted differences being module import paths and the Lambda handler entry-point wrapper.
3. THE conversation context management functions (DynamoDB read/write, history trimming to `MAX_CONVERSATION_HISTORY` messages, message appending) SHALL contain the same implementation source code across all template variants, with the only permitted differences being module import paths and the Lambda handler entry-point wrapper.
4. THE structured JSON logging configuration SHALL produce log entries with the same JSON field schema (`timestamp`, `level`, `service`, `correlation_id`, `message`, and AI interaction fields `logType`, `model`, `tokens`, `latencyMs`) across all template variants, using the same Powertools Logger initialization parameters (service name from environment variable, correlation ID injection, log level from environment variable).
5. WHEN an ECS variant implements the orchestration flow, THE orchestrator module SHALL use the same tool-use loop algorithm (for Mantle variants: iterate until no function_call items, up to `MAX_TOOL_ITERATIONS`) or single-call pattern (for AgentCore variants: delegate tool handling to the runtime) as the corresponding Lambda template, with the only difference being that ECS invokes AI_Caller and Tool_Executor via direct function calls instead of Lambda invocations.
6. THE system prompt placeholder (`SYSTEM_PROMPT` constant with `PLACEHOLDER` comment) SHALL be defined as a module-level constant before any function definitions within the AI_Caller source file in all template variants.
7. WHEN verifying shared logic identity across variants, THE source code of each core function (AI_Caller, Tool_Executor, conversation context management) SHALL produce zero differences when compared between variants of the same AI service after removing the Lambda handler boilerplate and normalizing import paths — verifiable by extracting the function bodies and running a textual diff.

### Requirement 6: Template Artifact Structure Consistency

**User Story:** As a developer familiar with the existing templates, I want all new variants to follow the same project structure conventions, so that I can navigate any variant without re-learning the layout.

#### Acceptance Criteria

1. THE Template_Artifact for Lambda-based variants SHALL maintain the same directory structure as the existing templates: `src/` (with one subdirectory per Lambda function and one per shared layer), `infra/` (with `environment/`, `modules/`, `openapi/`), `tests/`, `docs/`, `build/`, `README.md`, `metadata.json`, `pyproject.toml`, `Makefile`, `.gitignore`, and `uv.lock`.
2. THE Template_Artifact for ECS-based variants SHALL include the same top-level structure as Lambda variants (`infra/`, `tests/`, `docs/`, `build/`, `README.md`, `metadata.json`, `pyproject.toml`, `Makefile`, `.gitignore`, `uv.lock`) with the following differences: `src/` containing a single application directory with Python modules instead of per-function subdirectories, a `Dockerfile` at the template root, and `infra/modules/` including ECS-specific modules (`ecs/`, `vpc/`, `alb/` or `nlb/`, `ecr/`) in place of the Lambda compute module (`lambda/`), while retaining shared infrastructure modules (e.g., `dynamodb/`, `s3/`, `sqs/`) present in both variant types.
3. THE `infra/environment/` directory in all variants SHALL contain per-environment folders (`dev/`, `staging/`, `prod/`) with `main.tf`, `variables.tf`, `outputs.tf`, `backend.tf`, and `terraform.tfvars.example`.
4. THE Terraform configuration in all variants SHALL use the S3 remote backend with DynamoDB lock, a version-constrained AWS provider (using the `~>` operator pinned to a minor version), and resource names following the pattern `{var.project_name}-{var.environment}-{resource_function}` where `var.project_name` and `var.environment` are declared Terraform variables.
5. THE `.gitignore` in all variants SHALL exclude: `*.tfstate` and `.terraform/` (Terraform state and cache), `dist/` and `build/` (build artifacts), `__pycache__/` and `*.pyc` (Python cache), `.env` and `*.tfvars` excluding `*.tfvars.example` (environment files with secrets), and `.idea/`, `.vscode/`, `.DS_Store` (IDE/OS files).
6. THE `Makefile` in all variants SHALL provide targets for common operations: `build`, `deploy`, `test`, `lint`, and `format` — with ECS variants additionally providing `docker-build` and `docker-push` targets.
7. IF a Template_Artifact is generated missing any mandatory file or directory defined in criteria 1 through 3, THEN THE System SHALL reject the artifact and return an error indicating which required paths are absent.

### Requirement 7: WebSocket Message Protocol

**User Story:** As a frontend developer integrating with a WebSocket chatbot template, I want a well-defined message protocol for sending and receiving messages, so that I can build a client without ambiguity.

#### Acceptance Criteria

1. THE client-to-server message format on the `sendMessage` route SHALL be a JSON object containing: `action` (value `"sendMessage"`, required string), `userId` (required non-empty string, 1–256 characters), and `message` (required non-empty string, 1–4096 characters).
2. THE server-to-client message format for non-streaming variants SHALL be a JSON object containing: `type` (value `"message"`), `response` (the complete AI-generated text, non-empty string), `conversationId` (the user identifier, non-empty string), and `timestamp` (ISO 8601 format with timezone offset).
3. THE server-to-client message format for streaming variants SHALL use four message types: `{"type": "chunk", "content": "..."}` for each streamed token/chunk, `{"type": "status", "message": "..."}` for processing status during tool-use loops, `{"type": "done", "conversationId": "...", "timestamp": "..."}` for stream completion, and `{"type": "error", "message": "...", "correlationId": "..."}` for errors.
4. IF the client sends a message with malformed JSON (not parseable), THEN THE backend SHALL respond with `{"type": "error", "message": "Invalid JSON format"}` on the WebSocket connection.
5. IF the client sends a valid JSON message with missing required fields or field values exceeding length constraints, THEN THE backend SHALL respond with `{"type": "error", "message": "Invalid message format: {specific_field_issue}"}` on the WebSocket connection.
6. THE server SHALL deliver streaming messages (chunk, status, done, error) in the order they are generated by the backend, with no reordering permitted — chunks SHALL arrive in the same sequence the AI service produced them.
7. THE Template_Artifact README for WebSocket variants SHALL include a section titled "WebSocket Protocol" documenting the complete message protocol (client-to-server and server-to-client formats) with code examples for each message type in at least one client language (JavaScript/TypeScript).

### Requirement 8: ECS Health Checks and Lifecycle

**User Story:** As a platform engineer operating ECS-based chatbot templates, I want proper health checks and graceful shutdown, so that deployments are safe and traffic is not lost during updates.

#### Acceptance Criteria

1. THE ECS REST variants SHALL expose a `GET /health` endpoint on the ALB target group that returns HTTP 200 when the service is healthy and ready to accept requests, and returns HTTP 503 when the service is unhealthy or shutting down.
2. THE ECS WebSocket variants SHALL configure the NLB target group health check on a dedicated HTTP health port exposed by the container alongside the WebSocket port.
3. THE ECS task definition SHALL configure a `stopTimeout` of 30 seconds to allow in-flight requests to complete during container shutdown.
4. WHEN the ECS container receives a SIGTERM signal, THE application SHALL stop accepting new connections (including new WebSocket upgrades), wait for in-flight HTTP requests and open WebSocket connections to complete (up to the stop timeout), send a close frame to any remaining WebSocket clients before the timeout expires, and then exit with code 0.
5. THE ECS service SHALL be configured with a deployment circuit breaker enabled (with rollback) to automatically roll back failed deployments.
6. THE Terraform configuration SHALL define variables for health check interval (default 30 seconds), health check timeout (default 5 seconds), healthy threshold (default 2), unhealthy threshold (default 3), and target group deregistration delay (default 30 seconds) for the load balancer target group.

### Requirement 9: Connection Management and Cleanup (WebSocket Variants)

**User Story:** As a platform engineer, I want automatic cleanup of stale WebSocket connections, so that the Connection_Table does not grow unboundedly and resources are not wasted on dead connections.

#### Acceptance Criteria

1. THE Connection_Table SHALL have a TTL attribute configured on the `expiresAt` field, set to 24 hours after the connection is established, enabling DynamoDB to automatically remove stale entries.
2. WHEN a `$connect` event is received, THE Connection_Manager SHALL store the connection ID with a `connectedAt` timestamp and the computed `expiresAt` value (current time + 24 hours, expressed as a Unix epoch in seconds).
3. WHEN a `$disconnect` event is received, THE Connection_Manager SHALL delete the connection entry from the Connection_Table before the handler returns a response.
4. IF the backend detects a GoneException (HTTP 410) when attempting to post a message to a connection, THEN THE Message_Sender SHALL delete the connection entry from the Connection_Table and log the cleanup at INFO level.
5. THE Terraform configuration for WebSocket variants SHALL enable DynamoDB TTL on the Connection_Table `expiresAt` attribute.
6. IF storing the connection entry in the Connection_Table fails during `$connect` processing, THEN THE Connection_Manager SHALL return an error response that rejects the WebSocket connection and log the failure at ERROR level.
7. IF deletion of the connection entry fails during `$disconnect` processing or during GoneException cleanup, THEN THE responsible handler SHALL log the failure at WARN level and not retry, relying on TTL-based expiration to remove the entry within 48 hours.
8. IF the Message_Sender attempts to post to a connection whose `expiresAt` value is in the past but has not yet been removed by DynamoDB TTL, THEN THE Message_Sender SHALL treat the connection as stale, skip delivery, and delete the entry from the Connection_Table.

### Requirement 10: Streaming with Tool-Use Loop (Mantle Streaming Variants)

**User Story:** As a developer using the streaming Mantle template, I want the tool-use loop to work correctly with streaming enabled, so that intermediate tool calls are handled and only final response tokens are streamed to the client.

#### Acceptance Criteria

1. WHEN the streaming Mantle AI_Caller receives a response that contains function_call items, THE Orchestrator SHALL NOT stream those items to the client; instead it SHALL invoke the Tool_Executor, collect results, and make a follow-up streaming request to the Mantle API with tool results.
2. THE Orchestrator SHALL only stream tokens to the client from the AI response iteration that produces text output with no function_call items (the final response in the tool-use loop).
3. WHEN the Orchestrator begins a tool-use loop iteration (receives function_call items and invokes the Tool_Executor), THE Orchestrator SHALL send a single WebSocket message `{"type": "status", "message": "Processing..."}` to the client once per iteration to indicate ongoing processing before making the follow-up API request.
4. IF the tool-use loop reaches the configured maximum iteration limit during streaming, THEN THE Orchestrator SHALL send an error message `{"type": "error", "message": "Maximum tool iterations exceeded", "correlationId": "..."}` to the client via WebSocket, stop further processing of the request, log the error at ERROR level with the correlation identifier, and NOT save partial tool results to conversation history.
5. THE streaming Mantle variants SHALL define the same `MAX_TOOL_ITERATIONS` configuration variable (default 10) as the non-streaming Mantle variants.
6. WHEN the streaming tool-use loop completes successfully (final response streamed to client), THE Orchestrator SHALL save the complete assembled response text and all intermediate tool call results to conversation history in the same format as the non-streaming Mantle variants.

### Requirement 11: Streaming with AgentCore Runtime (AgentCore Streaming Variants)

**User Story:** As a developer using the streaming AgentCore template, I want the AgentCore Runtime's streaming response to be progressively forwarded to the client, so that users see tokens as they are generated by the runtime.

#### Acceptance Criteria

1. THE streaming AgentCore AI_Caller SHALL consume the AgentCore Runtime streaming response event-by-event, yielding each text chunk as it arrives from the `completion` stream.
2. WHEN the AgentCore Runtime produces a chunk containing text bytes, THE Orchestrator SHALL forward that chunk to the client via the WebSocket Message_Sender without buffering additional chunks before sending, wrapping the text content in a JSON message with a type field identifying it as a stream chunk.
3. THE streaming AgentCore variants SHALL NOT require application-level tool-use loop management since the AgentCore Runtime handles tool calling internally; tokens streamed to the client represent the final response being generated.
4. WHEN the AgentCore Runtime streaming response ends (the completion event stream closes), THE Orchestrator SHALL send a `{"type": "done"}` message and save the concatenation of all received text chunks as the assistant response in conversation history.
5. IF the AgentCore Runtime streaming response encounters an error mid-stream, THEN THE Orchestrator SHALL send an error message to the client via WebSocket indicating the stream failed, log the error with correlation identifier and elapsed time, and discard the incomplete response without saving it to conversation history.
6. IF the client WebSocket connection closes while the AgentCore Runtime stream is still active, THEN THE Orchestrator SHALL stop consuming the AgentCore Runtime stream and release associated resources within 5 seconds of detecting the disconnection.

### Requirement 12: ECS Application Structure

**User Story:** As a developer working with ECS template variants, I want the application code organized into clear modules within a single service, so that I can understand and modify the orchestration, AI calling, and tool execution independently.

#### Acceptance Criteria

1. THE ECS application source SHALL be structured as a Python package under `src/app/` with submodules: `orchestrator.py`, `ai_caller.py`, `tool_executor.py`, `connection_manager.py` (WebSocket variants), `message_sender.py` (WebSocket variants), `logging_config.py`, and `models.py`.
2. THE ECS application SHALL include a `main.py` entry point that initializes the FastAPI web framework, registers route handlers, and starts the server on the port specified by the `PORT` environment variable, defaulting to `8080` if the variable is not set.
3. THE ECS REST variants SHALL expose a `POST /chat` endpoint that accepts a JSON request body containing `userId` (string, 1–256 characters) and `message` (string, 1–4096 characters) fields, returning a JSON response body in the same format as the Lambda REST variants.
4. IF the `POST /chat` request body is missing required fields or contains values outside the specified bounds, THEN THE ECS REST variant SHALL return an HTTP 400 response with a JSON body containing an `error` field indicating the validation failure.
5. IF an unrecoverable error occurs during `POST /chat` processing (AI service unavailable, timeout exceeding 60 seconds, or unexpected exception), THEN THE ECS REST variant SHALL return an HTTP 500 response with a JSON body containing an `error` field indicating a processing failure, without exposing internal stack traces.
6. THE ECS WebSocket variants SHALL handle WebSocket lifecycle events—connection open, incoming message, client disconnect, and unexpected connection drop—within the application, with the API Gateway WebSocket API forwarding `$connect`, `$disconnect`, and `$default` route events to the ECS service endpoints via VPC Link.
7. THE ECS application SHALL expose a `GET /health` endpoint that returns HTTP 200 when the service is ready to accept requests, used by the ECS task health check configuration.
8. THE `pyproject.toml` for ECS variants SHALL declare application dependencies including the web framework, `boto3`, and AI-service-specific SDK, managed by `uv`.
9. THE ECS application SHALL reuse the same `shared/logging_config.py` and `shared/models.py` patterns from the Lambda layer, adapted as direct module imports instead of Lambda Layer imports.

### Requirement 13: Infrastructure Isolation Between Variants

**User Story:** As a platform engineer deploying multiple template variants, I want each template to be fully self-contained with its own infrastructure, so that deploying one variant does not affect another.

#### Acceptance Criteria

1. THE Terraform configuration for each template variant SHALL be self-contained, provisioning all required resources (compute, networking, storage, IAM) without using `terraform_remote_state` data sources, cross-stack data lookups, or hardcoded ARNs referencing resources from other templates.
2. THE Terraform configuration SHALL use the pattern `{var.project_name}-{var.environment}-{resource_function}` in all resource names — including IAM roles, security groups, log groups, and DynamoDB tables — to enable at least 2 simultaneous deployments of the same template variant in the same AWS account without naming conflicts.
3. THE ECS template variants SHALL provision their own VPC resources (VPC, subnets, NAT Gateway, security groups) rather than referencing shared VPCs, with the VPC CIDR configurable via a Terraform variable (default `10.0.0.0/16`).
4. THE DynamoDB tables (User_Context_DB, Connection_Table) in each template SHALL use resource names following the pattern `{var.project_name}-{var.environment}-{table_purpose}` (e.g., `mybot-dev-user-context`, `mybot-dev-connections`), ensuring no cross-template collisions, verifiable via `aws dynamodb list-tables`.
5. THE Terraform backend configuration in `backend.tf` SHALL use a unique state key per template incorporating the template variant name and environment (e.g., `chatbot-rag-agentcore-ws/dev/terraform.tfstate`), preventing state file collisions.
6. THE IAM roles and policies in each template SHALL include the project prefix and environment in all role names (e.g., `{var.project_name}-{var.environment}-orchestrator-role`), preventing IAM namespace collisions when multiple template variants or instances are deployed in the same AWS account.

### Requirement 14: Documentation and README Consistency

**User Story:** As a developer evaluating template variants, I want comprehensive READMEs that explain the variant's architecture, deployment, and usage, so that I can deploy and customize any variant without external help.

#### Acceptance Criteria

1. THE README for each template variant SHALL include sections with the following headings: "Overview", "Architecture", "Prerequisites", "Project Structure", "Configuration", "Deployment", "RAG Knowledge Base", "Logging & Observability", and "Customization" — with WebSocket variants additionally including "WebSocket Protocol", streaming variants additionally including "Streaming Behavior", and ECS variants additionally including "Container Operations".
2. THE README for WebSocket variants SHALL include a section titled "WebSocket Protocol" containing: a table defining client-to-server fields (action, userId, message) with types and constraints, a table defining server-to-client message types with their fields, and at least one complete JavaScript/TypeScript code example demonstrating connection establishment and message exchange.
3. THE README for streaming variants SHALL include a section titled "Streaming Behavior" explaining: how tokens are delivered progressively, how to handle the chunk/done/error message types on the client side, how tool-use iterations interact with streaming (Mantle variants), and a client-side code example showing how to assemble streamed chunks into a complete response.
4. THE README for ECS variants SHALL include a section titled "Container Operations" explaining: Docker image building command, ECR authentication and push instructions, ECS service scaling via `desired_count` variable, health check configuration and troubleshooting, graceful shutdown behavior with SIGTERM handling, and Makefile targets (`docker-build`, `docker-push`).
5. THE README title (first H1 heading) for each variant SHALL clearly identify the AI service, compute layer, transport, and streaming mode using the format: "Chatbot RAG Template — {AI Service} ({Compute}, {Transport}, {Streaming})" (e.g., "Chatbot RAG Template — Bedrock Mantle API (ECS, WebSocket, Streaming)"), with components omitted when they are the default (Lambda, REST, Non-Streaming).

### Requirement 15: Observability Consistency Across Variants

**User Story:** As a developer monitoring chatbot performance, I want all variants to produce the same structured logging and metrics regardless of compute or transport layer, so that I can use the same dashboards and alerts across deployments.

#### Acceptance Criteria

1. THE structured JSON logging format SHALL be consistent across all variants, using fields: `timestamp` (ISO 8601 format with UTC timezone, e.g., `2024-01-15T10:30:00.123Z`), `level` (one of `DEBUG`, `INFO`, `WARNING`, `ERROR`), `service` (non-empty string identifying the component), `correlation_id` (non-empty string, or omitted if unavailable at log time), `message` (non-empty string), and optional extra fields (`logType`, `model`, `tokens`, `latencyMs`).
2. THE AI interaction logging (with `logType: "ai-interaction"`) SHALL be produced by all variants when AI service calls complete, containing at minimum: `correlation_id`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `latencyMs`, and `finishReason` — regardless of whether streaming is enabled.
3. WHEN a streaming AI call completes, THE AI_Caller SHALL log the total token usage and total latency as a single AI interaction log entry after the stream finishes, consistent with non-streaming variants — the streaming nature SHALL NOT result in per-chunk AI interaction log entries.
4. THE ECS variants SHALL use `aws-lambda-powertools` Logger (which works outside Lambda environments) configured with the same parameters (service name from `POWERTOOLS_SERVICE_NAME` environment variable, log level from `POWERTOOLS_LOG_LEVEL`) to produce the same JSON field format as Lambda variants.
5. THE correlation ID SHALL be propagated through the entire request flow in all variants: from the initial client message (using the API Gateway request ID or a generated UUID) through orchestration, AI calling, and tool execution, appearing in every log entry for the request.
6. IF a correlation ID is not available in the incoming request context (e.g., due to a malformed event), THEN THE entry-point handler SHALL generate a new UUID v4 correlation ID and use it for all subsequent log entries within that request.

### Requirement 16: Architecture Diagram Generation via Draw.io MCP

**User Story:** As a developer evaluating template variants, I want each template to include a professional architecture diagram generated using the Draw.io MCP, so that I can visually understand the infrastructure components, their relationships, and the data flow before deploying.

#### Acceptance Criteria

1. THE implementation process SHALL use the Draw.io MCP server (with AWS4 shape library) to generate a `.drawio` architecture diagram for each of the ten new template variants, saved at `templates/{name}/architecture.drawio` within the project repository.
2. THE architecture diagram for each template variant SHALL include AWS service icons from the aws4 library representing all provisioned infrastructure components: API Gateway (REST or WebSocket), compute layer (Lambda functions or ECS Fargate service), SQS FIFO queue (where applicable), DynamoDB tables (User_Context_DB, Connection_Table for WebSocket variants), S3 RAG bucket, and AI service (Bedrock AgentCore or Bedrock Mantle).
3. THE architecture diagram for ECS-based variants SHALL additionally include VPC, public/private subnet groups, ALB or NLB, NAT Gateway, and ECR repository icons arranged within proper AWS architectural grouping containers (VPC group, subnet groups, availability zone groups).
4. THE architecture diagram for WebSocket variants SHALL additionally include the Connection_Manager component and the API Gateway Management API `@connections` path showing bidirectional communication flow between the backend and the client.
5. THE architecture diagram SHALL use labeled directional edges (arrows) to represent data flow between components, with labels indicating the interaction type (e.g., "POST /chat", "SendMessage", "Invoke", "GetItem", "PutItem", "stream chunks", "WebSocket frames").
6. THE architecture diagram SHALL organize components using AWS architectural group containers: `awsCloud` for the overall AWS boundary, `vpc` for VPC-scoped resources (ECS variants), `publicSubnet` and `privateSubnet` for subnet separation (ECS variants), and a logical grouping for the client/external boundary.
7. THE architecture diagram SHALL be exported as a PNG file at `templates/{name}/architecture.png` for display on the template detail page, in addition to the source `.drawio` file.
8. THE architecture diagram for streaming variants SHALL visually differentiate the streaming data path from the non-streaming path using a distinct edge style (e.g., dashed lines or a different color) with a label indicating "streaming tokens" or "stream chunks".
9. THE architecture diagram layout SHALL follow a left-to-right flow pattern starting with the Client on the left, progressing through the API layer, compute layer, and terminating at data stores and AI services on the right, with consistent spacing between components.
10. THE architecture diagram SHALL include a title label at the top identifying the template variant name and its key characteristics (AI service, transport, compute, streaming mode).

