# Implementation Plan: Presigned Upload

## Overview

This plan migrates the upload flow from multipart-through-API-Gateway to a presigned S3 URL pattern. The frontend zips files client-side, uploads directly to a staging bucket via presigned URL, then triggers server-side processing through a lightweight finalize call. This removes the 10MB payload ceiling and decouples file transfer from request processing.

## Tasks

- [x] 1. Update shared types and constants
  - [x] 1.1 Add new types and constants for presigned upload flow
    - Add `InitiateRequest`, `InitiateResponse`, `FinalizeRequest`, `FinalizeResponse`, `SessionMetadata` interfaces to `shared/src/types.ts`
    - Add `MAX_CLIENT_ZIP_SIZE` (500 MB) and `PRESIGNED_URL_EXPIRY` (900 seconds) constants to `shared/src/constants.ts`
    - Remove `MAX_UPLOAD_SIZE` constant (no longer relevant with presigned URLs)
    - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2_

- [x] 2. Extract shared validation logic
  - [x] 2.1 Create lambda/src/validate.ts from existing handler validation
    - Extract `validateMetadata` function from `handler.ts` that validates name, tags, and readme fields
    - Same validation rules: name format (regex), name length (64), tags count (10), tag length (32), readme length (50,000)
    - Return error message string or null on success
    - _Requirements: 1.1, 1.4_

- [x] 3. Implement Initiate Lambda
  - [x] 3.1 Create lambda/src/initiate.ts handler
    - Parse JSON request body into `InitiateRequest`
    - Call `validateMetadata` for field validation (return 400 on failure)
    - Check project doesn't already exist via `HeadObject` on frontend bucket (return 409 if exists)
    - Generate UUID v4 session ID
    - Write `SessionMetadata` JSON to `staging/{sessionId}/metadata.json` in staging bucket
    - Generate presigned PUT URL for `staging/{sessionId}/upload.zip` with 15-minute expiry and content-length condition (max 500 MB)
    - Return `InitiateResponse` with sessionId, uploadUrl, expiresAt
    - Include CORS headers on all responses
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 4. Implement Processing Lambda
  - [x] 4.1 Create lambda/src/process.ts handler
    - Parse JSON request body into `FinalizeRequest`
    - Download `staging/{sessionId}/metadata.json` from staging bucket (return 404 if not found)
    - Download `staging/{sessionId}/upload.zip` from staging bucket (return 404 if not found)
    - Extract zip contents into `FileEntry[]` array using JSZip
    - Apply server-side filtering via `filterFiles` from `filter.ts`
    - Generate `artifact.zip` via `createArtifactZip` from `archiver-wrapper.ts`
    - Write project to frontend bucket via `writeProject` from `s3-writer.ts`
    - Regenerate search index via `regenerateIndex` from `index-generator.ts`
    - Delete staged files (`metadata.json` and `upload.zip`) from staging bucket (cleanup)
    - Return `FinalizeResponse` with message, path, and optional warning
    - Include CORS headers on all responses
    - Handle errors: AllFilesFilteredError → 400, ArtifactTooLargeError → 400, ProjectExistsError → 409
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 5. Update Lambda build configuration
  - [x] 5.1 Update lambda/package.json build script and dependencies
    - Change esbuild command to produce two entrypoints: `src/initiate.ts` and `src/process.ts` with `--outdir=dist`
    - Add `@aws-sdk/s3-request-presigner` dependency
    - Add `jszip` dependency
    - Remove `busboy` dependency (no longer needed)
    - Remove `@types/busboy` dev dependency
    - _Requirements: 3.1, 3.2_

  - [x] 5.2 Remove old handler.ts and create handler.test.ts replacements
    - Delete `lambda/src/handler.ts` and `lambda/src/handler.test.ts`
    - Create tests for `validate.ts`, `initiate.ts`, and `process.ts`
    - _Requirements: 1.1, 3.1_

- [x] 6. Implement Terraform staging infrastructure
  - [x] 6.1 Add staging bucket with lifecycle and CORS to infra/main.tf
    - Create `aws_s3_bucket` for staging
    - Add `aws_s3_bucket_lifecycle_configuration` with 1-day expiration on `staging/` prefix
    - Add `aws_s3_bucket_cors_configuration` allowing PUT from all origins with all headers
    - Add `aws_s3_bucket_public_access_block` blocking all public access
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.2 Update IAM permissions for Lambda roles
    - Add S3 PutObject, GetObject, DeleteObject permissions on staging bucket `staging/*` prefix
    - Ensure frontend bucket permissions remain for project writes and index generation
    - _Requirements: 4.4, 4.5_

- [x] 7. Update API Gateway routes in infra/api.tf
  - [x] 7.1 Replace /upload endpoint with /upload/initiate and /upload/finalize
    - Remove existing `/upload` resource, method, and integration
    - Create `/upload` parent resource, then `/upload/initiate` and `/upload/finalize` child resources
    - Create POST methods on both with `api_key_required = true`
    - Create `AWS_PROXY` integrations pointing to initiate and processing Lambda functions respectively
    - Add OPTIONS methods with CORS mock integration on both endpoints
    - Create separate Lambda function resources: initiate (256MB, 10s timeout) and processing (1024MB, 120s timeout)
    - Add Lambda invoke permissions for API Gateway on both functions
    - Update deployment triggers to include new resources
    - _Requirements: 1.6, 3.8_

  - [x] 7.2 Update infra/outputs.tf with staging bucket details
    - Add `staging_bucket_name` output
    - Add `staging_bucket_arn` output
    - Update `lambda_function_name` to output both function names
    - _Requirements: 4.1_

- [x] 8. Update Frontend API module
  - [x] 8.1 Rewrite frontend/src/api.ts upload functions
    - Add `initiateUpload(params: InitiateRequest): Promise<ApiResult<InitiateResponse>>` — POST JSON to `/upload/initiate`
    - Add `finalizeUpload(sessionId: string): Promise<ApiResult<FinalizeResponse>>` — POST JSON to `/upload/finalize`
    - Add `uploadToS3(url: string, blob: Blob, onProgress?: (pct: number) => void): Promise<void>` — PUT to presigned URL using XMLHttpRequest for progress tracking
    - Remove old `submitUpload(formData: FormData)` function
    - _Requirements: 2.3, 2.4, 2.5, 2.6_

- [x] 9. Update Frontend upload form
  - [x] 9.1 Add JSZip dependency and update frontend/package.json
    - Add `jszip@^3.10.0` to frontend dependencies
    - _Requirements: 2.2_

  - [x] 9.2 Rewrite upload form submission flow in frontend/src/upload-form.ts
    - Keep existing form UI, validation, README autofill, and client-side file filtering
    - Replace FormData submission with new flow: filter → zip → size check → initiate → S3 upload → finalize
    - Create Client_Zip using JSZip with files added using paths stripped of top-level folder
    - Check zip blob size against `MAX_CLIENT_ZIP_SIZE` (show error if exceeded)
    - Show multi-stage progress: "Zipping files...", "Uploading... X%", "Processing..."
    - Handle errors at each stage with appropriate user messages and retry option for S3 upload failures
    - If no files remain after filtering, show error and abort (do not call initiate)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 5.2_

- [x] 10. Update tests
  - [x] 10.1 Update frontend/src/upload-form.test.ts for new upload flow
    - Update submission tests to verify initiate → S3 upload → finalize sequence
    - Test that client-side filtering still applies before zipping
    - Test progress state transitions
    - Test error handling at each stage
    - Test size limit enforcement
    - _Requirements: 2.1, 2.5, 2.7, 5.2_

  - [x] 10.2 Update frontend/src/api.test.ts for new API functions
    - Test `initiateUpload` sends correct JSON body and handles success/error
    - Test `finalizeUpload` sends correct session ID and handles responses
    - Test `uploadToS3` progress events and error handling
    - Remove old `submitUpload` tests
    - _Requirements: 2.3, 2.4, 2.5_

- [x] 11. Build verification
  - [x] 11.1 Verify full build succeeds and tests pass
    - Run `npm run build` across all workspaces
    - Run `npx vitest --run` to confirm all tests pass
    - Verify no TypeScript errors remain
    - _Requirements: 1.1, 2.1, 3.1_

## Notes

- The old `handler.ts` (multipart upload) is completely replaced — no backward compatibility needed
- Existing modules (`filter.ts`, `archiver-wrapper.ts`, `s3-writer.ts`, `index-generator.ts`) are reused as-is
- JSZip is used on both frontend (zip creation) and backend (zip extraction) for consistency
- The staging bucket uses the same AWS account and region as the frontend bucket
- Presigned URLs are scoped to specific session paths and expire after 15 minutes
- Session metadata is stored server-side to prevent client tampering at finalize time

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "6.1"] },
    { "id": 2, "tasks": ["3.1", "5.1", "6.2"] },
    { "id": 3, "tasks": ["4.1", "5.2", "7.1"] },
    { "id": 4, "tasks": ["7.2", "8.1", "9.1"] },
    { "id": 5, "tasks": ["9.2", "10.1", "10.2"] },
    { "id": 6, "tasks": ["11.1"] }
  ]
}
```
