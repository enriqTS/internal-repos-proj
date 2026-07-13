# Implementation Plan: Bedrock Mantle Migration

## Overview

Migrate AI model invocations from AWS Bedrock SDK to Anthropic SDK via the Bedrock Mantle API. The implementation proceeds in order: shared client module → handler migrations → infrastructure updates → dependency cleanup → test updates.

## Tasks

- [x] 1. Create shared AI client module
  - [x] 1.1 Create `lambda/src/ai-client.ts` with singleton `getAIClient()` and `MODEL_ID` export
    - Export `getAIClient()` returning a singleton Anthropic client configured with Mantle base URL, API key from `ANTHROPIC_API_KEY` env var, and `anthropic-workspace-id` header from `ANTHROPIC_WORKSPACE_ID` env var
    - Export `MODEL_ID` constant set to `moonshotai.kimi-k2.5-0613-v1:0`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 1.2 Write property test for client singleton identity
    - **Property 3: Client singleton identity**
    - **Validates: Requirements 1.5**

- [x] 2. Migrate suggest-tags handler
  - [x] 2.1 Update `lambda/src/suggest-tags.ts` to use Anthropic SDK
    - Replace `BedrockRuntimeClient` and `InvokeModelCommand` imports with import of `getAIClient` and `MODEL_ID` from `./ai-client`
    - Replace the `InvokeModelCommand` invocation with `client.messages.create({ model: MODEL_ID, max_tokens: 1024, messages })`
    - Replace the complex response parsing logic with direct access to `message.content[0].text`
    - Remove the `bedrockClient` singleton at module level
    - Keep all existing tag filtering, registry lookup, CORS, and error handling logic intact
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 2.2 Write property test for tag filtering correctness
    - **Property 4: Tag filtering correctness**
    - **Validates: Requirements 2.3**

- [x] 3. Migrate generate-readme handler
  - [x] 3.1 Update `lambda/src/generate-readme.ts` to use Anthropic SDK
    - Replace `BedrockRuntimeClient` and `InvokeModelCommand` imports with import of `getAIClient` and `MODEL_ID` from `./ai-client`
    - Replace the `InvokeModelCommand` invocation with `client.messages.create({ model, max_tokens, messages }, { signal: abortController.signal })`
    - Replace the `bedrockClient` singleton at module level
    - Keep all file prioritization, prompt building, and validation logic unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Simplify `extractModelContent` to accept structured message object
    - Change function signature from accepting a raw JSON string to accepting `{ content: Array<{ type: string; text?: string }> }`
    - Return `message.content[0].text` when content array is non-empty and first block has type "text"
    - Return null for empty content arrays or missing text fields
    - Update the call site in `generateReadme()` to pass the message object directly
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 3.3 Write property test for response extraction consistency
    - **Property 1: Response extraction consistency**
    - **Validates: Requirements 4.2**

- [x] 4. Checkpoint - Verify handler migrations compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update infrastructure configuration
  - [x] 5.1 Add Terraform variables for Anthropic credentials
    - Add `anthropic_api_key` variable (type: string, sensitive: true) to `infra/variables.tf`
    - Add `anthropic_workspace_id` variable (type: string, sensitive: true) to `infra/variables.tf`
    - _Requirements: 6.1, 6.2_

  - [x] 5.2 Add environment variables to Lambda resources
    - Add `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` to `suggest_tags_lambda` environment block in `infra/tags.tf`
    - Add `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID` to `process_lambda` environment block in `infra/api.tf`
    - _Requirements: 6.3, 6.4_

  - [x] 5.3 Remove Bedrock IAM policy from tags.tf
    - Modify `lambda_bedrock_policy` to remove the `bedrock:InvokeModel` statement
    - Keep the S3 `GetObject` permission for `tags.json` access
    - Rename the resource/policy name to reflect it's now S3-only (e.g., `lambda_tags_s3_policy`)
    - _Requirements: 6.5_

- [x] 6. Update dependencies and build configuration
  - [x] 6.1 Update `lambda/package.json`
    - Add `@anthropic-ai/sdk` to dependencies
    - Remove `@aws-sdk/client-bedrock-runtime` from dependencies
    - Update the esbuild build script: remove `--external:@aws-sdk` or make it more specific to only externalize `@aws-sdk/client-s3` (since `@anthropic-ai/sdk` must be bundled)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 6.2 Install dependencies and verify build
    - Run `npm install` in the lambda directory
    - Run the build script to verify esbuild bundles successfully
    - _Requirements: 7.1, 7.2_

- [x] 7. Update existing tests
  - [x] 7.1 Update test mocks to use Anthropic SDK response format
    - Update any existing test files that mock `@aws-sdk/client-bedrock-runtime` to instead mock `./ai-client` or `@anthropic-ai/sdk`
    - Ensure mock responses follow Anthropic MessageResponse structure: `{ content: [{ type: "text", text: "..." }] }`
    - _Requirements: 8.1, 8.2_

  - [ ]* 7.2 Write property test for graceful degradation
    - **Property 2: Graceful degradation on AI failure**
    - **Validates: Requirements 5.1, 5.2**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Wave 1 - Shared Module",
      "tasks": ["1.1"],
      "description": "Create the shared AI client module that both handlers depend on"
    },
    {
      "name": "Wave 2 - Handler Migrations",
      "tasks": ["2.1", "3.1", "3.2"],
      "description": "Migrate both Lambda handlers to use the new AI client"
    },
    {
      "name": "Wave 3 - Verification",
      "tasks": ["4"],
      "description": "Verify handler migrations compile and pass basic checks"
    },
    {
      "name": "Wave 4 - Infrastructure & Dependencies",
      "tasks": ["5.1", "5.2", "5.3", "6.1", "6.2"],
      "description": "Update Terraform config and npm dependencies"
    },
    {
      "name": "Wave 5 - Tests & Final Verification",
      "tasks": ["7.1", "8"],
      "description": "Update test mocks and run final verification"
    }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The esbuild `--external:@aws-sdk` flag currently externalizes ALL AWS SDK packages; since `@anthropic-ai/sdk` is not an AWS package it would be bundled regardless, but `@aws-sdk/client-bedrock-runtime` removal means we should keep `--external:@aws-sdk` for `@aws-sdk/client-s3` which is still used
- The `MODEL_ID` value (`moonshotai.kimi-k2.5-0613-v1:0`) should be verified against the Mantle API — the design notes this is TBD for exact format
- Property tests validate universal correctness properties; unit tests validate specific examples and edge cases
