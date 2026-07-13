# Implementation Plan: Project Edit & Delete

## Overview

This plan implements edit and delete capabilities for the Internal Repos tool. Two new Lambda handlers (edit, delete) are added alongside modifications to the existing initiate/process Lambdas for artifact replacement. The frontend gains an edit form and a delete confirmation dialog on the project detail page. Terraform infrastructure is extended with new API Gateway resources and Lambda functions.

## Tasks

- [x] 1. Add shared types and validation helpers
  - [x] 1.1 Add `EditRequest`, `EditResponse`, and `DeleteResponse` types to `shared/src/types.ts`
    - Add `EditRequest` interface with optional `name`, `tags`, and `readme` fields
    - Add `EditResponse` interface with `message`, `metadata`, and optional `renamed` field
    - Add `DeleteResponse` interface with `message` and `name` fields
    - Extend `SessionMetadata` with optional `mode?: 'create' | 'replace'` field
    - Export all new types from `shared/src/index.ts`
    - _Requirements: 6.1, 6.7_

  - [x] 1.2 Add `validateEditRequest` function to `lambda/src/validate.ts`
    - Create function that validates an `EditRequest` object: name format (1–64 chars, `/^[a-zA-Z0-9_-]+$/`), tags (max 10, each 1–32 chars, `/^[a-z0-9_-]+$/`), readme (max 50,000 chars)
    - Return `null` if valid, or an error message string if invalid
    - Must require at least one field to be present (return error if body has no updatable fields)
    - Reuse existing constants from `shared/src/constants.ts`
    - _Requirements: 1.6, 1.7, 1.8, 1.12, 6.5_

  - [ ]* 1.3 Write property test for edit validation (Property 2)
    - **Property 2: Edit validation correctly classifies inputs**
    - Generate random strings for name (0–100 chars, mixed charset), random tag arrays (0–15 items, varying lengths/chars), random readme strings (0–60,000 chars)
    - Verify that `validateEditRequest` accepts iff all fields satisfy their constraints
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 1.6, 1.7, 1.8, 3.7, 4.4**

  - [x] 1.4 Add `mergeMetadata` utility function to `lambda/src/edit.ts` (or a shared helper)
    - Implement function that takes existing `ProjectMetadata` and an `EditRequest`, returning merged metadata
    - Fields present in `EditRequest` override existing values; omitted fields are preserved
    - When `tags` is provided, update `metadata.tags`; when `readme` is provided, update `metadata.description` (first 200 chars) and keep full readme for separate write
    - _Requirements: 1.1, 6.6_

  - [ ]* 1.5 Write property test for metadata merge (Property 1)
    - **Property 1: Partial update preserves omitted fields**
    - Generate random `ProjectMetadata` + random subsets of `EditRequest` fields
    - Verify: updated fields have new values, omitted fields retain original values
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 1.1, 6.6**

- [x] 2. Implement Edit Lambda handler (`lambda/src/edit.ts`)
  - [x] 2.1 Create the Edit Lambda handler scaffold
    - Create `lambda/src/edit.ts` with `handler` function signature matching `APIGatewayProxyEvent → APIGatewayProxyResult`
    - Parse path parameter `{name}` from `event.pathParameters`
    - Validate path parameter format using `PROJECT_NAME_REGEX` and length check
    - Include standard CORS headers in all responses
    - Return 400 if path parameter is invalid
    - _Requirements: 1.6, 6.1, 6.4_

  - [x] 2.2 Implement project existence check and metadata fetch
    - Use `HeadObjectCommand` then `GetObjectCommand` on `projects/{name}/metadata.json` to verify project exists
    - Return 404 with `"Project not found: {name}"` if project does not exist
    - Fetch and parse existing `metadata.json` for merge operations
    - _Requirements: 1.4, 6.9_

  - [x] 2.3 Implement body parsing, validation, and metadata merge
    - Parse JSON request body as `EditRequest`
    - Call `validateEditRequest` — return 400 if invalid
    - Call `mergeMetadata` with existing metadata and validated request
    - _Requirements: 1.1, 1.9, 1.12, 6.5, 6.6_

  - [x] 2.4 Implement rename flow (copy-then-delete with rollback)
    - If `request.name` differs from path parameter name, check if new name is taken (return 409 if so)
    - Copy all three objects (`metadata.json`, `readme.md`, `artifact.zip`) to `projects/{new-name}/`
    - On copy success, delete all objects at `projects/{old-name}/`
    - On delete failure, rollback by deleting copied objects at `projects/{new-name}/` and return 500
    - _Requirements: 1.2, 1.3, 1.11_

  - [x] 2.5 Implement S3 writes, tag registry update, and index regeneration
    - Write updated `metadata.json` and `readme.md` (if readme provided) to S3
    - If request includes new tags not in the registry, call `addTagsToRegistry`
    - Call `regenerateIndex()` to rebuild `global-index.json`
    - Return 200 with `EditResponse` containing updated metadata
    - _Requirements: 1.5, 1.10, 6.7_

  - [ ]* 2.6 Write property test for no-mutation on invalid requests (Property 3)
    - **Property 3: Invalid edit requests produce no state mutations**
    - Generate invalid edit requests (bad names, too many tags, oversized readme)
    - Mock S3 client and verify zero S3 write/delete/copy calls when validation fails
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 1.9**

  - [ ]* 2.7 Write unit tests for Edit Lambda
    - Test 404 when project doesn't exist
    - Test 409 when rename target name is taken
    - Test 400 when body has no updatable fields
    - Test successful partial update (metadata merge with specific examples)
    - Test index regeneration is triggered after successful edit
    - Test new tags are added to tag registry
    - Test rename rollback on partial copy failure
    - _Requirements: 1.1–1.12, 6.5–6.9_

- [x] 3. Implement Delete Lambda handler (`lambda/src/delete.ts`)
  - [x] 3.1 Create the Delete Lambda handler
    - Create `lambda/src/delete.ts` with `handler` function matching `APIGatewayProxyEvent → APIGatewayProxyResult`
    - Parse and validate path parameter `{name}` (format and length)
    - Check project existence via `HeadObjectCommand` on `projects/{name}/metadata.json` — return 404 if not found
    - Delete all three objects (`metadata.json`, `readme.md`, `artifact.zip`) under `projects/{name}/`
    - If any deletion fails, return 500 without regenerating index
    - On full success, call `regenerateIndex()` and return 200 with `DeleteResponse`
    - Include standard CORS headers in all responses
    - _Requirements: 3.1–3.7, 6.2, 6.3, 6.4, 6.8, 6.9_

  - [ ]* 3.2 Write unit tests for Delete Lambda
    - Test 404 when project doesn't exist
    - Test 400 for invalid name format
    - Test 200 with project name on success
    - Test index regeneration is triggered after successful delete
    - Test 500 on partial deletion failure without regenerating index
    - _Requirements: 3.1–3.7_

- [x] 4. Checkpoint - Ensure all Lambda tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Modify existing Lambdas for artifact replacement
  - [x] 5.1 Modify `lambda/src/initiate.ts` to support `mode: 'replace'`
    - Accept optional `mode` field in `InitiateRequest` (default `'create'`)
    - When `mode === 'replace'`: verify project EXISTS (return 404 if not), skip duplicate-name check
    - Store `mode` field in `SessionMetadata` written to staging bucket
    - _Requirements: 2.5_

  - [x] 5.2 Modify `lambda/src/process.ts` to handle replace mode
    - Read `mode` from session metadata
    - When `mode === 'replace'`: overwrite only `artifact.zip` in the project entry using `PutObjectCommand`
    - Do NOT overwrite `metadata.json` or `readme.md`
    - Do NOT regenerate search index
    - Clean up staged files as normal
    - _Requirements: 2.1, 2.2, 2.7_

  - [ ]* 5.3 Write unit tests for modified initiate and process handlers
    - Test initiate with `mode: 'replace'` verifies project exists
    - Test initiate with `mode: 'replace'` returns 404 if project missing
    - Test process with `mode: 'replace'` overwrites only artifact.zip
    - Test process with `mode: 'replace'` does not regenerate index
    - _Requirements: 2.1, 2.2, 2.5, 2.7_

- [x] 6. Add Terraform infrastructure for Edit and Delete endpoints
  - [x] 6.1 Add API Gateway resources, methods, and Lambda functions in `infra/api.tf`
    - Add `aws_api_gateway_resource` for `/projects` and `/projects/{name}` (path parameter)
    - Add PATCH method on `/projects/{name}` → Edit Lambda integration (API key required)
    - Add DELETE method on `/projects/{name}` → Delete Lambda integration (API key required)
    - Add OPTIONS method on `/projects/{name}` → CORS mock integration for PATCH/DELETE
    - Add `aws_lambda_function` resources for edit and delete handlers
    - Add `aws_lambda_permission` for API Gateway to invoke both new Lambdas
    - Add `s3:DeleteObject` and `s3:CopyObject` to the IAM policy for the Lambda role on the frontend bucket
    - Update `aws_api_gateway_deployment` triggers to include new resources
    - Update Lambda build script in `lambda/package.json` to include `edit.ts` and `delete.ts` entry points
    - _Requirements: 6.1–6.4_

- [x] 7. Checkpoint - Verify infrastructure and backend are complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement frontend API functions
  - [x] 8.1 Add `updateProject` and `deleteProject` to `frontend/src/api.ts`
    - Implement `updateProject(name, updates)` — sends PATCH to `/projects/{name}` with JSON body, returns `ApiResult<EditResponse>`
    - Implement `deleteProject(name)` — sends DELETE to `/projects/{name}`, returns `ApiResult<DeleteResponse>`
    - Both include `x-api-key` header and CORS-compatible configuration
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 8.2 Add `computePatchBody` helper function to `frontend/src/api.ts` (or a utility file)
    - Takes original metadata and edited form values, returns object containing only the fields that differ
    - Omits fields whose values are identical to the original
    - _Requirements: 4.5_

  - [ ]* 8.3 Write property test for frontend diff (Property 4)
    - **Property 4: Frontend diff sends only modified fields**
    - Generate random pairs of (original metadata, form values)
    - Verify PATCH body contains exactly the fields whose values differ
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 4.5**

- [x] 9. Implement frontend edit form component
  - [x] 9.1 Create `frontend/src/edit-form.ts` with the edit form component
    - Register route `#/project/:name/edit` in the router
    - Fetch current metadata and readme to pre-fill form fields
    - Show error message if fetch fails (do not render form)
    - Reuse `TagSelector` component for tag editing
    - Include optional folder picker for artifact replacement
    - On submit with metadata only: call `computePatchBody` then `updateProject`
    - On submit with new artifact: run presigned upload flow (initiate with `mode: 'replace'`, upload, finalize), then metadata PATCH
    - On success: show confirmation message, navigate back to project detail after 2 seconds
    - On failure: show API error, preserve form values, keep form editable
    - Add "Edit" button to `project-detail.ts` that navigates to the edit route
    - _Requirements: 4.1–4.8_

  - [ ]* 9.2 Write unit tests for edit form component
    - Test form pre-fills with fetched metadata
    - Test error display when metadata fetch fails
    - Test navigation back to detail page on success
    - Test form values preserved on failure
    - _Requirements: 4.1–4.8_

- [x] 10. Implement frontend delete dialog component
  - [x] 10.1 Create `frontend/src/delete-dialog.ts` with the delete confirmation dialog
    - Render as modal overlay from project detail page
    - Show project name and text input for confirmation
    - Confirm button disabled until typed text exactly matches project name (case-sensitive)
    - On confirm: disable button, show loading indicator, send DELETE request via `deleteProject`
    - On success: show success message, navigate to `#/`
    - On failure: show API error message, re-enable confirm button
    - Add "Delete" button to `project-detail.ts` that opens the dialog
    - _Requirements: 5.1–5.7_

  - [ ]* 10.2 Write property test for delete confirmation match (Property 5)
    - **Property 5: Delete confirmation enabled iff exact name match**
    - Generate random project names + random typed strings (including near-misses with case differences)
    - Verify button enabled state matches exact equality check
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 5.2**

  - [ ]* 10.3 Write unit tests for delete dialog component
    - Test confirmation input renders with disabled button
    - Test button enables only on exact name match
    - Test button disabled during request
    - Test loading indicator shown during request
    - Test navigation to home on success
    - Test error display and button re-enable on failure
    - _Requirements: 5.1–5.7_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all code uses the existing project conventions (esbuild, Vitest, fast-check)
- The Edit Lambda reuses existing `regenerateIndex`, `addTagsToRegistry`, and `validateMetadata` helpers
- The artifact replacement flow reuses the existing presigned upload pipeline with a `mode: 'replace'` flag

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "3.1"] },
    { "id": 2, "tasks": ["1.5", "2.1", "3.2"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5"] },
    { "id": 5, "tasks": ["2.6", "2.7", "5.1"] },
    { "id": 6, "tasks": ["5.2", "6.1"] },
    { "id": 7, "tasks": ["5.3", "8.1"] },
    { "id": 8, "tasks": ["8.2"] },
    { "id": 9, "tasks": ["8.3", "9.1", "10.1"] },
    { "id": 10, "tasks": ["9.2", "10.2", "10.3"] }
  ]
}
```
