# Requirements Document

## Introduction

This document specifies the requirements for migrating the 6 AgentCore chatbot-RAG template variants to leverage native AgentCore Runtime session management. The migration removes redundant conversation history retrieval (letting AgentCore manage state via `sessionId`), eliminates the SQS async processing pattern from WebSocket variants, and simplifies monitoring by leveraging AgentCore built-in observability. Conversation history writing to DynamoDB is retained for compliance and logging purposes.

## Glossary

- **AgentCore_Runtime**: AWS Bedrock AgentCore Runtime service that manages agent sessions, tool calling, and conversation state internally via `sessionId`
- **Orchestrator**: Lambda function (or ECS module) that coordinates the conversation flow — receives user messages, invokes the AI Caller, and saves conversation exchanges
- **AI_Caller**: Lambda function (or ECS module) that wraps the `invoke_agent()` call to the AgentCore Runtime
- **Tool_Executor**: Lambda function registered as an AgentCore action group that executes RAG retrieval via Bedrock Knowledge Base (unchanged in this migration)
- **User_Context_Table**: DynamoDB table keyed by `userId` that stores conversation history for compliance/logging
- **Responses_Table**: DynamoDB table keyed by `messageId` used for async polling in the REST variant (stores processing status and AI response)
- **SQS_Queue**: SQS FIFO queue used as an async buffer between the API entry point and the Orchestrator Lambda
- **REST_Variant**: Template variant using REST API Gateway with client polling (`chatbot-rag-agentcore`, `chatbot-rag-agentcore-ecs`)
- **WS_Variant**: Template variant using WebSocket API Gateway for real-time delivery (`chatbot-rag-agentcore-ws`, `chatbot-rag-agentcore-ecs-ws`)
- **WS_Streaming_Variant**: Template variant using WebSocket with progressive chunk streaming (`chatbot-rag-agentcore-ws-streaming`, `chatbot-rag-agentcore-ecs-ws-streaming`)
- **Lambda_WS_Variant**: Specifically the Lambda-compute WebSocket variants (`chatbot-rag-agentcore-ws`, `chatbot-rag-agentcore-ws-streaming`)
- **Bedrock_KB**: Amazon Bedrock Knowledge Base used for RAG document retrieval (unchanged in this migration)
- **Vended_Logs**: AgentCore Runtime built-in CloudWatch log groups that automatically capture agent invocation details, session events, and tool call traces

## Requirements

### Requirement 1: Remove Conversation History Retrieval

**User Story:** As a template maintainer, I want to remove the conversation history retrieval logic from the Orchestrator, so that AgentCore Runtime manages conversation state natively via `sessionId` without redundant DynamoDB reads.

#### Acceptance Criteria

1. WHEN the Orchestrator processes a user message, THE Orchestrator SHALL NOT call `retrieve_conversation_history()` or `get_conversation_history()` to load previous messages from the User_Context_Table
2. WHEN invoking the AI_Caller, THE Orchestrator SHALL pass only the current user message (not the full history), relying on AgentCore_Runtime to maintain session context via `sessionId`
3. WHEN the Orchestrator is modified, THE Orchestrator SHALL continue to use the `userId` as the `sessionId` for AgentCore_Runtime session management
4. IF a DynamoDB read operation for conversation history retrieval exists in the code, THEN THE migration SHALL remove that operation from all 6 AgentCore template variants

### Requirement 2: Retain Conversation History Saving for Compliance

**User Story:** As a compliance officer, I want conversation exchanges to remain persisted in DynamoDB, so that audit trails and logging records are maintained regardless of AgentCore session management.

#### Acceptance Criteria

1. WHEN the Orchestrator receives a successful AI response, THE Orchestrator SHALL save both the user message and the assistant response to the User_Context_Table
2. THE User_Context_Table DynamoDB resource SHALL remain provisioned in all 6 AgentCore template variants
3. WHEN saving conversation history, THE Orchestrator SHALL include a timestamp, user role, and assistant role fields for each message entry
4. IF a DynamoDB write to the User_Context_Table fails, THEN THE Orchestrator SHALL log the error at ERROR level and continue returning the AI response to the user without blocking

### Requirement 3: Remove SQS Async Pattern from Lambda WebSocket Variants

**User Story:** As a template maintainer, I want to remove the SQS FIFO queue from the Lambda WebSocket variants, so that the architecture is simplified since WebSocket connections have no 30-second timeout constraint.

#### Acceptance Criteria

1. WHEN processing a WebSocket message in the Lambda_WS_Variant, THE Orchestrator SHALL be invoked directly (synchronously or via direct Lambda invocation) without routing through the SQS_Queue
2. THE Lambda_WS_Variant infrastructure SHALL NOT provision the SQS FIFO queue or its associated dead-letter queue
3. THE Lambda_WS_Variant infrastructure SHALL NOT provision the Responses_Table (already absent in current WS variants)
4. WHEN the SQS module is removed from the Lambda_WS_Variant, THE Orchestrator handler SHALL be refactored to accept invocation events directly from the WebSocket API route integration instead of SQS Records
5. THE REST_Variant (`chatbot-rag-agentcore`) SHALL continue to use the SQS_Queue and Responses_Table for async polling where a 30-second API Gateway timeout cannot be guaranteed

### Requirement 4: Simplify Monitoring to Leverage AgentCore Observability

**User Story:** As a DevOps engineer, I want to simplify the custom monitoring setup by leveraging AgentCore built-in observability features, so that there is less custom infrastructure to maintain while retaining visibility into system health.

#### Acceptance Criteria

1. WHEN AgentCore_Runtime vended logs are available, THE monitoring module SHALL rely on Vended_Logs for agent invocation details, session events, and tool call traces instead of custom CloudWatch metrics that duplicate this information
2. THE monitoring module SHALL retain custom business metrics that are NOT covered by AgentCore Vended_Logs, including: `MessageProcessingLatency` (end-to-end orchestrator timing) and `ConversationLength` (message count for capacity planning)
3. THE monitoring module SHALL remove the `AIModelLatency` custom metric from the dashboard and alarms, relying on AgentCore Vended_Logs for model invocation timing instead
4. THE monitoring module SHALL remove the `ToolExecutionLatency` custom metric from the dashboard, relying on AgentCore Vended_Logs for tool execution timing instead
5. THE monitoring module SHALL retain the DLQ depth alarm for the REST_Variant that still uses SQS
6. THE monitoring module SHALL retain X-Ray distributed tracing across all Lambda functions
7. WHEN the Lambda_WS_Variant no longer uses SQS, THE monitoring module for those variants SHALL remove DLQ-related dashboard widgets and alarms

### Requirement 5: Maintain All 6 AgentCore Template Variants

**User Story:** As a template maintainer, I want all 6 AgentCore template variants to be maintained after migration, so that each client can choose the compute and transport pattern that fits their needs.

#### Acceptance Criteria

1. THE migration SHALL produce updated versions of all 6 AgentCore template variants: `chatbot-rag-agentcore`, `chatbot-rag-agentcore-ws`, `chatbot-rag-agentcore-ws-streaming`, `chatbot-rag-agentcore-ecs`, `chatbot-rag-agentcore-ecs-ws`, `chatbot-rag-agentcore-ecs-ws-streaming`
2. WHEN the migration is complete, each template variant SHALL remain independently deployable with `terraform init && terraform plan && terraform apply`
3. THE migration SHALL NOT modify any Mantle template variants (`chatbot-rag-mantle-*`)
4. THE migration SHALL NOT modify the Tool_Executor Lambda or its action group registration in any variant
5. THE migration SHALL NOT modify the Bedrock_KB module, KB Sync Lambda, or S3 RAG bucket in any variant

### Requirement 6: Preserve Variant-Specific Transport Patterns

**User Story:** As a template maintainer, I want each variant's transport mechanism to remain functionally correct after the migration, so that clients experience the same behavior for REST polling, WebSocket messaging, and WebSocket streaming.

#### Acceptance Criteria

1. WHEN a REST_Variant client sends a POST /chat request, THE system SHALL still return a `messageId` immediately and support GET /responses/{messageId} polling until `completed` or `failed` status
2. WHEN a WS_Variant client sends a WebSocket message, THE Orchestrator SHALL deliver the complete AI response back via the same WebSocket connection as a single `message` type frame
3. WHEN a WS_Streaming_Variant client sends a WebSocket message, THE Orchestrator SHALL progressively stream response chunks via WebSocket as `chunk` type frames, followed by a `done` frame upon completion
4. WHEN the ECS variants process messages, THE ECS Orchestrator module SHALL invoke the AI_Caller via direct in-process function call (no Lambda invocation or SQS routing)
5. IF a WebSocket client disconnects mid-stream in the WS_Streaming_Variant, THEN THE Orchestrator SHALL abort the stream and discard the partial response without persisting it to history

### Requirement 7: Update AI Caller to Remove History Passthrough

**User Story:** As a template maintainer, I want the AI Caller to receive only the current user message from the Orchestrator, so that the interface is simplified to match the AgentCore session-managed approach.

#### Acceptance Criteria

1. WHEN the AI_Caller receives an invocation, THE AI_Caller SHALL accept a simplified payload containing only the current user message text, the `sessionId` (userId), and the `correlationId`
2. THE AI_Caller SHALL NOT receive or process a full `messages` array from the Orchestrator, since AgentCore_Runtime manages conversation history via the session
3. WHEN constructing the `invoke_agent()` call, THE AI_Caller SHALL pass only `inputText` (current message), `sessionId`, `agentId`, and `agentAliasId` — without building message arrays from conversation history
4. THE AI_Caller SHALL continue to extract and log token usage, finish reason, and tool call information from the AgentCore_Runtime response traces
