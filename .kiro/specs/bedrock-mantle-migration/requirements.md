# Requirements Document

## Introduction

This document captures the requirements for migrating all AI model invocations from the AWS Bedrock SDK (`@aws-sdk/client-bedrock-runtime`) to the Anthropic SDK (`@anthropic-ai/sdk`) via the Bedrock Mantle API endpoint. The migration resolves the "invalid model identifier" error with the current Bedrock integration and switches to API-key-based authentication.

## Glossary

- **AI_Client_Module**: The shared module (`lambda/src/ai-client.ts`) providing a singleton Anthropic client instance configured for the Bedrock Mantle endpoint.
- **Suggest_Tags_Handler**: The Lambda handler (`lambda/src/suggest-tags.ts`) that accepts a README and returns AI-suggested tags from the registry.
- **Generate_Readme_Handler**: The Lambda handler (`lambda/src/generate-readme.ts`) that generates a README for a project using AI.
- **Bedrock_Mantle_API**: The Anthropic-compatible API endpoint at `https://bedrock-mantle.us-east-1.api.aws/anthropic` that accepts API-key and workspace-id based authentication.
- **Model_ID**: The model identifier constant used for AI invocations (`moonshotai.kimi-k2.5-0613-v1:0`).
- **Singleton_Client**: A module-level Anthropic client instance that is created once and reused across all invocations within the same Lambda execution context.

## Requirements

### Requirement 1: Shared AI Client Module

**User Story:** As a developer, I want a shared AI client module so that both Lambda handlers use a consistent, correctly configured Anthropic SDK client without code duplication.

#### Acceptance Criteria

1. THE AI_Client_Module SHALL export a `getAIClient()` function that returns a configured Anthropic client instance
2. THE AI_Client_Module SHALL configure the client with the base URL `https://bedrock-mantle.us-east-1.api.aws/anthropic`
3. THE AI_Client_Module SHALL read the API key from the `ANTHROPIC_API_KEY` environment variable
4. THE AI_Client_Module SHALL set the `anthropic-workspace-id` default header from the `ANTHROPIC_WORKSPACE_ID` environment variable
5. WHEN `getAIClient()` is called multiple times within the same execution context, THE AI_Client_Module SHALL return the same client instance (singleton pattern)
6. THE AI_Client_Module SHALL export the `MODEL_ID` constant for use by both Lambda handlers

### Requirement 2: Suggest Tags Migration

**User Story:** As a developer, I want the suggest-tags handler to use the Anthropic SDK so that tag suggestions work correctly with the Mantle API endpoint.

#### Acceptance Criteria

1. WHEN a valid POST request with a README is received, THE Suggest_Tags_Handler SHALL invoke the AI model via `client.messages.create()` using the shared AI_Client_Module
2. WHEN the model returns a response, THE Suggest_Tags_Handler SHALL extract the text content from `message.content[0].text`
3. WHEN the model response contains suggested tags, THE Suggest_Tags_Handler SHALL filter them against the tag registry (case-insensitive) and cap results at 10
4. THE Suggest_Tags_Handler SHALL pass `max_tokens: 1024` to the model invocation
5. THE Suggest_Tags_Handler SHALL remove all references to `@aws-sdk/client-bedrock-runtime` imports and the `BedrockRuntimeClient` instantiation

### Requirement 3: Generate README Migration

**User Story:** As a developer, I want the generate-readme handler to use the Anthropic SDK so that README generation works correctly with the Mantle API endpoint.

#### Acceptance Criteria

1. WHEN `generateReadme()` is called, THE Generate_Readme_Handler SHALL invoke the AI model via `client.messages.create()` using the shared AI_Client_Module
2. THE Generate_Readme_Handler SHALL pass the abort signal via the second argument to `client.messages.create()` to preserve the 30-second timeout behavior
3. WHEN the model returns a response, THE Generate_Readme_Handler SHALL extract the text content from `message.content[0].text`
4. THE Generate_Readme_Handler SHALL pass `max_tokens: 4096` to the model invocation
5. THE Generate_Readme_Handler SHALL remove all references to `@aws-sdk/client-bedrock-runtime` imports and the `BedrockRuntimeClient` instantiation

### Requirement 4: Response Extraction Simplification

**User Story:** As a developer, I want the `extractModelContent` function simplified so that it directly reads the structured Anthropic response format instead of guessing across multiple legacy response shapes.

#### Acceptance Criteria

1. THE Generate_Readme_Handler SHALL accept a structured message object (with a `content` array) instead of a raw JSON string
2. WHEN the message content array is non-empty and the first block has `type: "text"`, THE `extractModelContent` function SHALL return the `text` field
3. WHEN the message content array is empty, THE `extractModelContent` function SHALL return null
4. WHEN the first content block does not have a `text` field, THE `extractModelContent` function SHALL return null

### Requirement 5: Error Handling and Graceful Degradation

**User Story:** As a user, I want AI failures to be handled gracefully so that the application remains functional even when the AI service is unavailable.

#### Acceptance Criteria

1. IF the Anthropic SDK throws an error during model invocation in suggest-tags, THEN THE Suggest_Tags_Handler SHALL log the error and return HTTP 200 with an empty tags array
2. IF the Anthropic SDK throws an error during model invocation in generate-readme, THEN THE Generate_Readme_Handler SHALL log the error and return an empty readme string with a warning message
3. IF the abort signal fires (timeout) during generate-readme, THEN THE Generate_Readme_Handler SHALL catch the abort error and return a timeout warning
4. IF the `ANTHROPIC_API_KEY` or `ANTHROPIC_WORKSPACE_ID` environment variables are missing at invocation time, THEN THE AI_Client_Module SHALL allow the error to propagate (caught by the handler-level try/catch)

### Requirement 6: Infrastructure Configuration

**User Story:** As a DevOps engineer, I want Terraform variables and Lambda environment configuration updated so that the deployed Lambdas have access to the Anthropic API credentials.

#### Acceptance Criteria

1. THE Terraform configuration SHALL define a `anthropic_api_key` variable of type string marked as sensitive
2. THE Terraform configuration SHALL define a `anthropic_workspace_id` variable of type string marked as sensitive
3. THE `suggest_tags_lambda` resource SHALL include `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` in its environment variables
4. THE `process_lambda` resource SHALL include `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` in its environment variables
5. THE `lambda_bedrock_policy` resource SHALL be modified to remove the `bedrock:InvokeModel` statement while keeping the S3 `GetObject` permission for tag registry access

### Requirement 7: Dependency Management

**User Story:** As a developer, I want the correct npm packages installed so that the Lambda code can use the Anthropic SDK and no longer bundles the unused Bedrock SDK.

#### Acceptance Criteria

1. THE lambda `package.json` SHALL include `@anthropic-ai/sdk` as a dependency
2. THE lambda `package.json` SHALL remove `@aws-sdk/client-bedrock-runtime` from dependencies
3. THE esbuild build script SHALL add `@anthropic-ai/sdk` to the bundled entry points (not marked as external)
4. THE esbuild build script SHALL remove `@aws-sdk/client-bedrock-runtime` from the external exclusion pattern if it was specifically listed

### Requirement 8: Test Updates

**User Story:** As a developer, I want existing tests updated so that they mock the Anthropic SDK instead of the Bedrock SDK and continue to validate correct behavior.

#### Acceptance Criteria

1. WHEN tests mock the AI client, THE test suite SHALL mock the `@anthropic-ai/sdk` module or the `./ai-client` module instead of `@aws-sdk/client-bedrock-runtime`
2. THE test mocks SHALL return responses matching the Anthropic MessageResponse structure (`{ content: [{ type: "text", text: "..." }] }`)
3. THE test suite SHALL verify that error cases still result in graceful degradation (empty results, not 500 errors)
