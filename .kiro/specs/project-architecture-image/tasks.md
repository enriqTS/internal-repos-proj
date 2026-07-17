# Implementation Plan: Project Architecture Image

## Overview

This plan implements optional architecture image support for projects, following the dependency order: shared types → backend handlers → frontend display → frontend forms → tests. The feature mirrors the existing template architecture rendering and reuses `renderArchitectureSection`, `showImageLightbox`, and `resolveArchitectureImageUrl` from `template-detail.ts`.

## Tasks

- [x] 1. Extend shared types with architecture image fields
  - [x] 1.1 Add `architectureImage` field to `ProjectMetadata`, `InitiateRequest`, `InitiateResponse`, and `EditRequest` interfaces in `shared/src/types.ts`
    - Add `architectureImage?: 'architecture.png' | 'architecture.svg'` to `ProjectMetadata`
    - Add `architectureImage?: 'architecture.png' | 'architecture.svg'` to `InitiateRequest`
    - Add `architectureImageUploadUrl?: string` to `InitiateResponse`
    - Add `architectureImage?: 'architecture.png' | 'architecture.svg' | null` to `EditRequest`
    - _Requirements: 1.1, 3.5, 3.6, 4.5_

- [x] 2. Implement backend: Initiate handler extension
  - [x] 2.1 Extend `lambda/src/handlers/initiate.ts` to generate presigned URL for architecture image during upload initiation
    - When `architectureImage` is present in the request body, generate an additional presigned PUT URL targeting `staging/{sessionId}/architecture.{ext}`
    - Include `architectureImageUploadUrl` in the response
    - Add Content-Type condition (`image/png` or `image/svg+xml`) and Content-Length max 10 MB
    - Set presigned URL expiry to 900 seconds (consistent with `PRESIGNED_URL_EXPIRY`)
    - _Requirements: 3.4, 3.5, 3.6_

  - [x] 2.2 Add validation for `architectureImage` field in `lambda/src/utils/validate.ts`
    - Accept only exact values `'architecture.png'` or `'architecture.svg'` for InitiateRequest
    - Accept those values or `null` for EditRequest
    - Reject any other string values
    - _Requirements: 3.5, 4.5, 5.6_

- [x] 3. Implement backend: Process handler extension (finalize)
  - [x] 3.1 Extend `lambda/src/handlers/process.ts` to handle architecture image during finalization
    - After finalize is triggered, HEAD-check `staging/{sessionId}/architecture.{ext}` using session metadata
    - If the image exists, copy it to `projects/{name}/architecture.{ext}`
    - Set `architectureImage` field in the project's `metadata.json`
    - If the image does not exist in staging, proceed without it (no error)
    - _Requirements: 3.7, 3.8_

- [x] 4. Implement backend: Edit handler extensions
  - [x] 4.1 Add presigned URL sub-endpoint in `lambda/src/handlers/edit.ts` for architecture image upload during edit
    - Handle `POST /projects/{name}/architecture-upload-url` requests
    - Accept `{ extension: 'png' | 'svg' }` in the request body
    - Validate the project exists (return 404 if not)
    - Validate extension is `'png'` or `'svg'` (return 400 if not)
    - Generate presigned PUT URL targeting `projects/{name}/architecture.{ext}` with Content-Type condition and 10 MB Content-Length limit
    - Return `{ uploadUrl, contentType, expiresAt }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 4.2 Extend PATCH handler in `lambda/src/handlers/edit.ts` to handle `architectureImage` field
    - When `architectureImage` is a valid filename string, update the field in `metadata.json`
    - When `architectureImage` is `null`, delete the image file from S3 and remove the field from `metadata.json`
    - When format changes (e.g., `.png` → `.svg`), delete the old image file from S3
    - If S3 delete fails, still update metadata and return success
    - _Requirements: 4.8, 4.9, 6.3, 6.4_

- [x] 5. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement frontend: API layer extensions
  - [x] 6.1 Add `requestArchitectureUploadUrl` function to `frontend/src/utils/api.ts`
    - Function signature: `requestArchitectureUploadUrl(name: string, extension: 'png' | 'svg'): Promise<ApiResult<{ uploadUrl: string; contentType: string; expiresAt: string }>>`
    - POST to `{apiUrl}/projects/{name}/architecture-upload-url` with `{ extension }` body
    - Include `x-api-key` header for authentication
    - _Requirements: 5.1, 5.2_

  - [x] 6.2 Extend `updateProject` function in `frontend/src/utils/api.ts` to accept `architectureImage` field
    - Update the `updates` parameter type to include `architectureImage?: string | null`
    - Ensure the field is included in the PATCH body when present
    - _Requirements: 4.5, 6.2_

- [x] 7. Implement frontend: Project detail page architecture section
  - [x] 7.1 Add architecture image display to `frontend/src/pages/project-detail.ts`
    - Import `resolveArchitectureImageUrl`, `renderArchitectureSection`, and `showImageLightbox` from `template-detail.ts`
    - After fetching metadata, resolve architecture image URL using project path (adapt for `projects/{name}/` base path)
    - Insert the architecture section into supplementary content before the readme section
    - Hide architecture section when viewing a file (same as other supplementary content)
    - If image fails to load, remove the section silently (handled by `renderArchitectureSection` onerror)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 8. Implement frontend: Upload form architecture image input
  - [x] 8.1 Add optional architecture image file input to `frontend/src/pages/upload-form.ts`
    - Add file input accepting `.png` and `.svg` files (set `accept=".png,.svg"`)
    - Implement client-side validation: extension check (case-insensitive) and 5 MB size limit
    - Display validation error messages adjacent to the input
    - Include `architectureImage` filename in the `InitiateRequest` when a file is selected
    - After receiving `architectureImageUploadUrl`, upload the image file to S3 in parallel with the artifact upload
    - Use correct Content-Type header (`image/png` or `image/svg+xml`) for the presigned URL upload
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 9. Implement frontend: Edit form architecture image management
  - [x] 9.1 Add architecture image upload and removal controls to `frontend/src/pages/edit-form.ts`
    - Add file input accepting `.png` and `.svg` files with 5 MB size limit
    - Implement client-side validation for file extension (case-insensitive) and size
    - When project has existing architecture image, show a removal control (checkbox or button)
    - On upload: request presigned URL via `requestArchitectureUploadUrl`, upload file to S3, then include `architectureImage` field in PATCH body
    - On removal: set `architectureImage: null` in the PATCH body
    - If presigned URL upload fails, display error and do not proceed with PATCH
    - On success, navigate to project detail page within 2 seconds
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 6.1, 6.2, 6.5_

- [x] 10. Checkpoint - Ensure frontend builds and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Add Terraform/API Gateway route for architecture upload URL endpoint
  - [x] 11.1 Add `POST /projects/{name}/architecture-upload-url` route to API Gateway in `infra/api.tf`
    - Wire to the edit Lambda handler (same Lambda, different route)
    - Ensure the route requires API key authentication
    - _Requirements: 5.1_

- [ ] 12. Tests
  - [ ]* 12.1 Write property test for architecture image file validation (Property 4)
    - **Property 4: Architecture image file validation**
    - **Validates: Requirements 3.2, 4.2**
    - Test that validation accepts only `.png`/`.svg` (case-insensitive) with size ≤ 5 MB
    - Test that all other extensions and oversized files are rejected with appropriate error messages
    - Place test in `frontend/src/pages/upload-form.test.ts` or colocated test file

  - [ ]* 12.2 Write property test for metadata merge with architectureImage (Property 5)
    - **Property 5: Metadata merge with architectureImage**
    - **Validates: Requirements 4.8, 6.3**
    - Test that setting a valid filename results in that value in metadata
    - Test that setting `null` removes the field from metadata
    - Place test in `lambda/src/handlers/edit.test.ts` or colocated test file

  - [ ]* 12.3 Write property test for presigned URL S3 key construction (Property 6)
    - **Property 6: Presigned URL S3 key construction**
    - **Validates: Requirements 5.2**
    - Test that for any valid project name and extension (`'png'`/`'svg'`), the key equals `projects/{name}/architecture.{ext}`
    - Place test in `lambda/src/handlers/edit.test.ts`

  - [ ]* 12.4 Write property test for extension validation on presigned URL endpoint (Property 7)
    - **Property 7: Extension validation on presigned URL endpoint**
    - **Validates: Requirements 5.6**
    - Test that any string not exactly `'png'` or `'svg'` is rejected
    - Place test in `lambda/src/utils/validate.test.ts`

  - [ ]* 12.5 Write unit tests for initiate handler architecture image presigned URL generation
    - Test that `architectureImageUploadUrl` is included when `architectureImage` is provided
    - Test that it is absent when `architectureImage` is not provided
    - Mock S3 presigned URL generation
    - Place test in `lambda/src/handlers/initiate.test.ts`

  - [ ]* 12.6 Write unit tests for process handler architecture image copy logic
    - Test HEAD check + copy when image exists in staging
    - Test graceful skip when image does not exist in staging
    - Test that metadata.json is updated with `architectureImage` field
    - Place test in `lambda/src/handlers/process.test.ts`

  - [ ]* 12.7 Write unit tests for edit handler architecture image removal and format change
    - Test `architectureImage: null` triggers S3 delete and metadata field removal
    - Test format change (png→svg) triggers old file deletion
    - Test S3 delete failure still returns success
    - Place test in `lambda/src/handlers/edit.test.ts`

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The architecture image rendering reuses existing functions from `template-detail.ts` for consistency
- Backend tests are colocated with handlers (e.g., `edit.test.ts` next to `edit.ts`)
- Frontend tests are colocated with source (e.g., `upload-form.test.ts` next to `upload-form.ts`)
- The `resolveArchitectureImageUrl` function from `template-detail.ts` uses `templates/` prefix — when reusing for projects, adapt the base path to `projects/{name}/`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "4.1", "4.2"] },
    { "id": 3, "tasks": ["6.1", "6.2"] },
    { "id": 4, "tasks": ["7.1", "8.1", "11.1"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7"] }
  ]
}
```
