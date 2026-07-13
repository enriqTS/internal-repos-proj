# Requirements Document

## Introduction

This feature delivers two downloadable project templates for the internal repositories platform that bootstrap chatbot applications with Retrieval-Augmented Generation (RAG). Both templates share an identical architecture — API Gateway, SQS FIFO queue, orchestrator Lambda, AI caller Lambda, tool executor Lambda, DynamoDB for conversation context, and S3 for RAG documents — differing only in the AI service integration layer. Template 1 uses AWS Bedrock AgentCore Runtime for AI orchestration, while Template 2 uses the Bedrock Mantle API (OpenAI-compatible protocol). Each template is a complete, deployable project scaffold containing Python Lambda application code and Terraform infrastructure-as-code, following the template artifact structure defined by the existing template-content spec. These are non-streaming implementations with emphasis on observability and configurable naming via Terraform tfvars.

## Glossary

- **Template_Artifact**: A zip archive stored in S3 at `templates/{name}/artifact.zip` containing the full downloadable project scaffold including application code and Terraform configuration, following the structure defined by the template-content spec.
- **Orchestrator_Lambda**: The central Lambda function triggered by SQS messages that manages conversation flow, coordinates AI calls, handles tool execution results, and stores conversation context.
- **AI_Caller_Lambda**: A Lambda function responsible for invoking the AI service (either Bedrock AgentCore Runtime or Bedrock Mantle API) with the conversation messages, system prompt, and tool definitions.
- **Tool_Executor_Lambda**: A Lambda function that executes tools requested by the AI model during conversation, returning results to the AI runtime or back to the orchestrator depending on the template variant.
- **RAG_Bucket**: An S3 bucket provisioned by the template's Terraform that stores documents for Retrieval-Augmented Generation retrieval, created empty by default.
- **User_Context_DB**: A DynamoDB table that stores per-user conversation history and context, enabling multi-turn conversations.
- **Message_Queue**: An SQS FIFO queue that sits between the API Gateway and the Orchestrator_Lambda, providing asynchronous message processing with ordering guarantees.
- **Entry_API**: An API Gateway HTTP endpoint that receives chatbot requests from clients and enqueues them to the Message_Queue, also used for bidirectional communication to return responses.
- **System_Prompt**: A placeholder text configuration within the AI_Caller_Lambda that instructs the AI model on its persona and behavior, designed to be easily replaceable by the developer.
- **Bedrock_AgentCore_Runtime**: AWS Bedrock AgentCore's runtime service that provides AI orchestration with built-in tool-use loops, session management, and agent execution.
- **Bedrock_Mantle_API**: AWS Bedrock's OpenAI-compatible API endpoint (`bedrock-mantle.{region}.api.aws/v1`) that supports the responses protocol (`POST /responses`) for model invocation using the OpenAI Python SDK.
- **AI_Interaction_Log**: A structured log entry capturing AI service calls including request payload, response payload, token usage (input/output/total), model identifier, latency, and any errors.
- **Terraform_Tfvars**: Variable definition files used by Terraform to inject deployment-specific values (project name prefix, AWS region, account ID) into resource naming and configuration.

## Requirements

### Requirement 1: Template Artifact Structure

**User Story:** As a developer downloading a chatbot template, I want the zip to follow the platform's standard template artifact structure, so that it integrates seamlessly with the internal repositories platform.

#### Acceptance Criteria

1. THE Template_Artifact SHALL contain a root-level directory named after the template (e.g., `chatbot-rag-agentcore/` or `chatbot-rag-mantle/`) containing all project files, with no files placed outside this root directory.
2. THE Template_Artifact SHALL include a top-level `README.md` file within the root directory containing the following sections: template purpose, architecture overview (describing the components: API Gateway, SQS FIFO queue, Lambda functions, DynamoDB, and S3), prerequisites, project structure explanation, configuration (Terraform variables, system prompt, AI model), deployment instructions, RAG knowledge base usage, logging and observability guidance, and customization tips.
3. THE Template_Artifact SHALL include an `infra/` directory containing Terraform configuration files with at minimum `main.tf`, `variables.tf`, and `terraform.tfvars.example`.
4. THE Template_Artifact SHALL include a `src/` directory containing Python Lambda function source files with at minimum one file per function responsibility: orchestrator, ai-caller, and tool-executor, where each file is identifiable by its filename (e.g., `orchestrator.py`, `ai_caller.py`, `tool_executor.py`).
5. THE Template_Artifact SHALL include a `requirements.txt` file in the `src/` directory declaring pinned Python dependencies required by the Lambda functions.
6. THE Template_Artifact SHALL include a `metadata.json` file within the root directory conforming to the TemplateMetadata interface defined by the template-content spec, containing at minimum: name, description, tags, and date fields.
7. THE Template_Artifact SHALL include a `.gitignore` file at the root directory containing exclusion patterns for Terraform state and cache (`.terraform/`, `*.tfstate`, `*.tfplan`), build artifacts (`build/`, `*.zip`), Python cache (`__pycache__/`, `*.pyc`, `.venv/`), environment files (`.env`, `.env.*`), and IDE/OS files (`.idea/`, `.vscode/`, `.DS_Store`).

### Requirement 2: Shared Architecture Components

**User Story:** As a developer, I want both chatbot templates to use the same proven architecture, so that I can choose between AI services without learning a different system design.

#### Acceptance Criteria

1. THE Template_Artifact SHALL provision an API Gateway HTTP endpoint (Entry_API) that accepts POST requests containing chatbot messages from clients.
2. THE Template_Artifact SHALL provision an SQS FIFO queue (Message_Queue) that receives messages from the Entry_API for asynchronous processing with message ordering guarantees.
3. THE Template_Artifact SHALL provision an Orchestrator_Lambda triggered by the Message_Queue that manages the conversation flow, retrieves user context, invokes the AI_Caller_Lambda, and processes tool execution results.
4. THE Template_Artifact SHALL provision an AI_Caller_Lambda that accepts conversation messages, a system prompt, and tool definitions, and invokes the configured AI service to generate a response.
5. THE Template_Artifact SHALL provision a Tool_Executor_Lambda that receives tool call requests and executes the corresponding tool logic, returning structured results.
6. THE Template_Artifact SHALL provision a DynamoDB table (User_Context_DB) with a partition key for user identification that stores conversation history and context per user session.
7. THE Template_Artifact SHALL provision an S3 bucket (RAG_Bucket) for storing RAG documents, created empty with no pre-loaded content.
8. THE Template_Artifact SHALL define IAM roles and policies granting each Lambda function the minimum permissions required to interact with its dependent services.

### Requirement 3: Terraform Configuration

**User Story:** As a platform engineer deploying a chatbot template, I want all resource names and deployment-specific values to be configurable via Terraform variables, so that I can deploy multiple instances without naming conflicts.

#### Acceptance Criteria

1. THE Terraform configuration SHALL define variables for project name prefix, AWS region, and AWS account identifier, used to construct unique resource names across all provisioned services.
2. THE Terraform configuration SHALL construct resource names by combining the project name prefix variable with a base name indicating the service's function (e.g., `{prefix}-orchestrator`, `{prefix}-ai-caller`, `{prefix}-tool-executor`, `{prefix}-message-queue`, `{prefix}-user-context`, `{prefix}-rag-documents`).
3. THE Terraform configuration SHALL include a `terraform.tfvars.example` file documenting all required and optional variables with placeholder values and comments explaining each variable's purpose and expected format.
4. THE Terraform configuration SHALL declare the AWS provider with the region sourced from a variable, and pin provider versions to avoid breaking changes on deployment.
5. THE Terraform configuration SHALL use Terraform variables for the AI model identifier, allowing the deployer to specify which foundation model to use without modifying application code.

### Requirement 4: System Prompt Configuration

**User Story:** As a developer customizing the chatbot, I want a clearly marked placeholder system prompt, so that I can easily replace it with my own instructions without searching through code.

#### Acceptance Criteria

1. THE AI_Caller_Lambda source code SHALL define the system prompt as a named constant at module level, before any function definitions, annotated with a comment containing the word "PLACEHOLDER" that instructs the developer to replace the value with their own instructions.
2. THE system prompt placeholder SHALL contain a single string value with generic assistant instructions (e.g., "You are a helpful assistant. Replace this prompt with your own instructions.") that is between 10 and 200 characters in length, not referencing any specific domain or use case.
3. THE Template_Artifact README SHALL include a section with a heading containing the phrase "System Prompt" that explains how to customize the system prompt, specifying the exact file path relative to the template root and the constant name where the prompt is defined.
4. IF the developer deploys the template without modifying the system prompt placeholder, THEN THE AI_Caller_Lambda SHALL function correctly using the placeholder text as the system prompt, producing valid AI responses.

### Requirement 5: AgentCore Runtime Integration (Template 1)

**User Story:** As a developer who wants to use Bedrock AgentCore for AI orchestration, I want a template that integrates with the AgentCore Runtime, so that I can leverage its built-in agent execution capabilities.

#### Acceptance Criteria

1. THE AI_Caller_Lambda in the AgentCore template SHALL invoke the Bedrock AgentCore Runtime API to send conversation messages and receive AI-generated responses.
2. THE AI_Caller_Lambda in the AgentCore template SHALL pass tool definitions to the AgentCore Runtime, enabling the AI model to request tool executions during conversation.
3. WHEN the AgentCore Runtime invokes the Tool_Executor_Lambda as part of a tool-use request, THE Tool_Executor_Lambda SHALL execute the requested tool and return structured results to the AgentCore Runtime.
4. THE Terraform configuration for the AgentCore template SHALL provision the AgentCore agent resource and an associated agent alias, and configure the Tool_Executor_Lambda ARN as an action group so the runtime can invoke it directly for tool execution.
5. IF no existing AgentCore Runtime session is found for the user identifier from the conversation context, THEN THE AI_Caller_Lambda SHALL create a new session; otherwise it SHALL resume the existing session for that user identifier.
6. IF the Bedrock AgentCore Runtime API returns an error or is unreachable, THEN THE AI_Caller_Lambda SHALL raise an exception containing the error details, allowing the Orchestrator_Lambda to handle the failure according to its retry and logging policies.

### Requirement 6: Bedrock Mantle API Integration (Template 2)

**User Story:** As a developer who wants to use the OpenAI-compatible Bedrock Mantle API, I want a template that integrates with the Mantle chat completions endpoint, so that I can use familiar OpenAI SDK patterns.

#### Acceptance Criteria

1. THE AI_Caller_Lambda in the Mantle template SHALL invoke the Bedrock Mantle API responses endpoint (`POST /responses`) using the OpenAI Python SDK client configured with the Bedrock Mantle base URL and AWS credential-based authentication, passing the system prompt via the `instructions` parameter.
2. THE AI_Caller_Lambda in the Mantle template SHALL pass tool definitions in the OpenAI function tool format, enabling the AI model to request tool executions via function_call output items in the response.
3. WHEN the Mantle API response contains function_call output items, THE Orchestrator_Lambda SHALL invoke the Tool_Executor_Lambda for each requested tool, collect results, and send a follow-up request to the Mantle API with tool results until the model produces a response containing no function_call output items, up to a configurable maximum of tool-use loop iterations (defaulting to 10).
4. THE AI_Caller_Lambda in the Mantle template SHALL configure the OpenAI client with `stream=False` to ensure non-streaming request-response behavior.
5. THE Terraform configuration for the Mantle template SHALL define the Mantle API base URL and model identifier as variables, defaulting to the us-east-1 regional endpoint (`https://bedrock-mantle.us-east-1.api.aws/v1`) and a model identifier value of `"your-model-id"` with a comment instructing the deployer to replace it with an available Bedrock model.
6. IF the Mantle API returns an error response or the request fails due to a network or timeout error, THEN THE AI_Caller_Lambda SHALL raise an exception containing the error code and error message, allowing the Orchestrator_Lambda to handle the failure through its standard error-handling and logging flow.
7. IF the tool-use loop reaches the configured maximum iteration limit without the model producing a text-only response, THEN THE Orchestrator_Lambda SHALL terminate the loop and return an error indicating the conversation exceeded the maximum allowed tool-use iterations.

### Requirement 7: Lambda Function Observability

**User Story:** As a developer operating the chatbot in production, I want comprehensive logging in all Lambda functions, so that I can debug issues and monitor system health.

#### Acceptance Criteria

1. WHEN any Lambda function is invoked, THE Lambda function SHALL log the invocation event at INFO level with a correlation identifier (message ID or request ID) that can be used to trace a single request across all functions.
2. WHEN any Lambda function encounters an error, THE Lambda function SHALL log the error with the correlation identifier, error type, error message, and stack trace at ERROR level.
3. WHEN any Lambda function completes processing, THE Lambda function SHALL log the completion status (success or failure) at INFO level with the correlation identifier and processing duration in milliseconds.
4. THE Lambda function source code SHALL use structured JSON logging (e.g., Python `logging` module with a JSON formatter) with consistent fields: `timestamp`, `level`, `correlationId`, `function`, and `message`.
5. IF the Orchestrator_Lambda fails to process a message after the configured retry attempts, THEN THE Orchestrator_Lambda SHALL log the failure at ERROR level with the correlation identifier, the original message body (user identifier and message content), and the number of attempts made.
6. WHEN the Orchestrator_Lambda invokes the AI_Caller_Lambda or Tool_Executor_Lambda, THE Orchestrator_Lambda SHALL pass the correlation identifier in the invocation payload so that downstream functions include the same identifier in their log entries.
7. THE Terraform configuration SHALL define a variable for the maximum retry attempts for Orchestrator_Lambda message processing with a default value of 3.

### Requirement 8: AI Interaction Logging

**User Story:** As a developer monitoring AI costs and performance, I want dedicated logging for all AI service interactions, so that I can track token usage, latency, and model behavior.

#### Acceptance Criteria

1. WHEN the AI_Caller_Lambda sends a request to the AI service, THE AI_Caller_Lambda SHALL log the AI_Interaction_Log entry at INFO level containing: correlation identifier, model identifier, number of input messages, total input token estimate, and request timestamp.
2. WHEN the AI_Caller_Lambda receives a response from the AI service, THE AI_Caller_Lambda SHALL log the AI_Interaction_Log entry at INFO level containing: correlation identifier, model identifier, response token usage (input tokens, output tokens, total tokens as reported by the service), response latency in milliseconds measured from request send to response received, and finish reason.
3. IF the AI service returns an error response or the request fails due to a timeout or connection error, THEN THE AI_Caller_Lambda SHALL log the error with the correlation identifier, error type (service error, timeout, or connection failure), error message, and the elapsed request time in milliseconds at ERROR level.
4. THE AI_Interaction_Log entries SHALL use a distinct log field `logType: "ai-interaction"` to enable easy filtering and aggregation of AI-specific logs separate from general application logs.
5. WHEN the AI model requests tool calls, THE AI_Caller_Lambda SHALL log the number of tool calls requested and the tool names at INFO level with the correlation identifier.

### Requirement 9: Conversation Context Management

**User Story:** As a chatbot user, I want my conversation history to be preserved across messages, so that the AI can provide contextually relevant responses.

#### Acceptance Criteria

1. WHEN the Orchestrator_Lambda receives a new message, THE Orchestrator_Lambda SHALL retrieve the existing conversation history for the user from the User_Context_DB using the user identifier.
2. WHEN the AI service produces a response, THE Orchestrator_Lambda SHALL append both the user message and the AI response to the conversation history in the User_Context_DB.
3. THE User_Context_DB table SHALL use a partition key derived from the user identifier and store conversation entries as an ordered list preserving message chronology.
4. THE Orchestrator_Lambda SHALL pass the most recent conversation history, limited to the configurable maximum number of messages (trimming the oldest messages first when the history exceeds the maximum), to the AI_Caller_Lambda to provide conversational context for each AI invocation.
5. THE Terraform configuration SHALL define a variable for the maximum conversation history length with a default value of 50 messages, allowing the deployer to tune context window usage.
6. IF the Orchestrator_Lambda fails to retrieve conversation history from the User_Context_DB, THEN THE Orchestrator_Lambda SHALL proceed with an empty conversation history and log the retrieval failure at ERROR level with the correlation identifier and user identifier.
7. IF the Orchestrator_Lambda fails to write the updated conversation history to the User_Context_DB, THEN THE Orchestrator_Lambda SHALL still return the AI response to the user and log the write failure at ERROR level with the correlation identifier and user identifier.

### Requirement 10: RAG Document Storage

**User Story:** As a developer extending the chatbot, I want an S3 bucket ready for RAG documents, so that I can add knowledge base documents without modifying infrastructure.

#### Acceptance Criteria

1. THE Terraform configuration SHALL provision the RAG_Bucket as an S3 bucket with versioning enabled and S3 Block Public Access enabled on all four settings (BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets) to support document updates and rollbacks while preventing unintended public exposure.
2. THE RAG_Bucket SHALL be created empty with no pre-loaded documents, serving as a placeholder for the developer to populate with their own knowledge base content.
3. THE Template_Artifact README SHALL include a section explaining the RAG_Bucket's purpose, the supported document formats (plain text `.txt`, Markdown `.md`, and PDF `.pdf`), maximum recommended file size per document, and instructions for uploading documents via the AWS CLI or console.
4. THE Tool_Executor_Lambda SHALL include a placeholder tool implementation named `search_knowledge_base` that accepts a query string parameter, demonstrates reading objects from the RAG_Bucket by key prefix, and returns the object content as a string result, with inline comments marking the sections where document retrieval logic, relevance filtering, and response formatting should be customized by the developer.
5. THE Terraform configuration SHALL grant the Tool_Executor_Lambda IAM role read-only access (`s3:GetObject` and `s3:ListBucket`) to the RAG_Bucket, scoped to that specific bucket resource.

### Requirement 11: Non-Streaming Request-Response Flow

**User Story:** As a developer integrating the chatbot with other services, I want a simple request-response flow without streaming, so that I can easily process complete responses.

#### Acceptance Criteria

1. THE Entry_API SHALL accept a synchronous-style POST request containing the user message and user identifier, and return a complete response body only after the AI processing pipeline produces a final text response with no pending tool calls, within a maximum response time of 29 seconds.
2. THE AI_Caller_Lambda SHALL configure all AI service calls with streaming disabled, receiving the complete response in a single payload.
3. WHEN the Orchestrator_Lambda receives a message from the Message_Queue, THE Orchestrator_Lambda SHALL execute tool-use loops until the AI response contains no further tool call requests or until a maximum of 10 tool-use iterations is reached, and then send the final response back through the Message_Queue to the Entry_API for client delivery.
4. THE Entry_API response body SHALL contain at minimum the AI-generated text response, the conversation identifier, and a timestamp in ISO 8601 format.
5. IF the AI processing pipeline fails due to an AI service error or the tool-use loop iteration limit is reached without a final text response, THEN THE Entry_API SHALL return an error response containing an error indicator, the correlation identifier, and a message describing the failure category.
6. IF the Entry_API does not receive a complete response from the Orchestrator_Lambda within the maximum response time, THEN THE Entry_API SHALL return a timeout error response to the client containing an error indicator and the correlation identifier.

### Requirement 12: Template Differentiation

**User Story:** As a developer browsing templates on the platform, I want clear identification of which AI service each template uses, so that I can choose the right template for my needs.

#### Acceptance Criteria

1. THE Template_Artifact for the AgentCore variant SHALL be named `chatbot-rag-agentcore` and its README title (first H1 heading) SHALL include the text "Bedrock AgentCore Runtime" to identify the AI service used for orchestration.
2. THE Template_Artifact for the Mantle variant SHALL be named `chatbot-rag-mantle` and its README title (first H1 heading) SHALL include the text "Bedrock Mantle API" to identify the AI service used for orchestration.
3. THE metadata.json for each template SHALL include the tags `chatbot`, `rag`, `python`, and `terraform`, and additionally the tag `bedrock-agentcore` for the AgentCore variant or `bedrock-mantle` for the Mantle variant to identify the AI service used.
4. THE metadata.json description field for the AgentCore variant SHALL contain the phrase "Bedrock AgentCore Runtime" and the description field for the Mantle variant SHALL contain the phrase "Bedrock Mantle API", within the 200-character field limit, to distinguish the two templates in the platform's template listing.
