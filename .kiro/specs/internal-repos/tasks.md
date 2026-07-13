# Implementation Plan: Internal Repos

## Overview

This plan implements a serverless internal tool for searching, browsing, and uploading company projects. The stack consists of a Vite-built SPA (vanilla JS/TS) served via S3 + CloudFront, a Node.js Lambda behind API Gateway for uploads, and a JSON-based client-side search index powered by Fuse.js. Infrastructure is managed with Terraform and deployed via CI/CD pipeline.

## Tasks

- [x] 1. Set up project structure and shared types
  - [x] 1.1 Initialize project with Vite frontend and Lambda backend directories
    - Create monorepo structure: `frontend/` (Vite project), `lambda/` (Node.js Lambda), `infra/` (Terraform), `shared/` (shared types)
    - Initialize `package.json` at root with workspaces
    - Set up TypeScript configuration for both frontend and lambda
    - Install core dependencies: vite, typescript, fuse.js, marked, highlight.js (frontend); archiver, ignore, @aws-sdk/client-s3 (lambda); fast-check, vitest (dev)
    - _Requirements: 7.1, 7.2_

  - [x] 1.2 Define shared TypeScript interfaces and constants
    - Create `shared/types.ts` with `ProjectIndexEntry`, `ProjectMetadata`, `UploadRequest`, `FileEntry` interfaces
    - Create `shared/constants.ts` with `DENY_LIST` array, project name regex, and validation limits
    - _Requirements: 3.1, 4.1, 5.2_

- [x] 2. Implement Upload Lambda - Input validation
  - [x] 2.1 Implement Lambda handler with request parsing and validation
    - Create `lambda/src/handler.ts` as Lambda entry point
    - Parse multipart/form-data request body
    - Validate required fields: name, readme, files (return 400 with missing field names)
    - Validate project name format against regex `/^[a-zA-Z0-9_-]+$/` (return 400 with allowed chars message)
    - Validate name length (max 64), tags count (max 10), tag length (max 32), readme length (max 50,000)
    - _Requirements: 3.1, 3.3, 3.5, 3.7_

  - [ ]* 2.2 Write property test for missing fields validation
    - **Property 4: Missing required fields produce specific validation errors**
    - **Validates: Requirements 3.5**

  - [ ]* 2.3 Write property test for invalid project name rejection
    - **Property 5: Invalid project names are rejected**
    - **Validates: Requirements 3.7**

- [x] 3. Implement Upload Lambda - File filtering
  - [x] 3.1 Implement file filtering module with deny list and .gitignore support
    - Create `lambda/src/filter.ts`
    - Implement deny list matching using glob-style patterns from `DENY_LIST`
    - Parse `.gitignore` if present at project root using the `ignore` npm package
    - Ensure deny list patterns take precedence and cannot be overridden by .gitignore negation
    - Return 400 if all files filtered out
    - Handle .gitignore parse errors gracefully (proceed with deny list only, include warning)
    - _Requirements: 4.1, 4.2, 4.4, 4.6_

  - [ ]* 3.2 Write property test for file filtering correctness
    - **Property 6: File filtering excludes deny-listed and gitignore-matched files**
    - **Validates: Requirements 4.1, 4.2**

- [x] 4. Implement Upload Lambda - Archiver and S3 writer
  - [x] 4.1 Implement archiver wrapper to create artifact.zip
    - Create `lambda/src/archiver-wrapper.ts`
    - Use `archiver` library to compress filtered files into zip
    - Preserve original directory structure relative to project root
    - Return 400 if resulting zip exceeds 100 MB
    - _Requirements: 4.3, 4.5_

  - [ ]* 4.2 Write property test for artifact zip round-trip
    - **Property 7: Artifact zip preserves directory structure**
    - **Validates: Requirements 4.3**

  - [x] 4.3 Implement S3 writer module
    - Create `lambda/src/s3-writer.ts`
    - Write `readme.md`, `metadata.json`, and `artifact.zip` to `projects/{name}/` in S3
    - Check for existing project (headObject) and return 409 if name taken
    - _Requirements: 3.3, 3.6_

- [x] 5. Implement Upload Lambda - Index generation
  - [x] 5.1 Implement search index generator
    - Create `lambda/src/index-generator.ts`
    - Scan all `projects/` prefixes in S3 using `listObjectsV2`
    - Fetch each `metadata.json` using `getObject`
    - Skip malformed metadata (invalid JSON or missing required fields: name, description, tags, date)
    - Build JSON array with name, description, tags, date, path fields
    - Write `global-index.json` to S3 bucket root
    - If write fails, return error without deleting existing index
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 5.2 Write property test for index generation from mixed metadata
    - **Property 8: Index generation produces valid entries from mixed metadata**
    - **Validates: Requirements 5.2, 5.4**

- [x] 6. Checkpoint - Lambda implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Frontend - Search functionality
  - [x] 7.1 Implement API client and search index loading
    - Create `frontend/src/api.ts`
    - Fetch `global-index.json` from CloudFront origin
    - Handle fetch failures with error state and retry option
    - Include API key from build-time env config (`import.meta.env.VITE_API_KEY`) for upload requests
    - _Requirements: 1.1, 1.5, 6.3_

  - [x] 7.2 Implement Fuse.js search module with debounced input
    - Create `frontend/src/search.ts`
    - Initialize Fuse.js with keys: name, description, tags; threshold 0.4
    - Debounce search input by 200ms
    - Return all projects sorted by date descending when query is empty or fewer than 1 character
    - Display "no results found" message when no matches
    - Render results list with project name, description, and tags
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

  - [ ]* 7.3 Write property test for search relevance ranking
    - **Property 1: Search results are ranked by relevance**
    - **Validates: Requirements 1.2**

  - [ ]* 7.4 Write property test for empty query sort order
    - **Property 2: Empty query returns all projects sorted by date descending**
    - **Validates: Requirements 1.3, 1.6**

- [x] 8. Implement Frontend - Project detail view
  - [x] 8.1 Implement project detail page
    - Create `frontend/src/project-detail.ts`
    - Fetch and render `readme.md` using `marked` with syntax highlighting via `highlight.js`
    - Display metadata: name, description, tags, date in "YYYY-MM-DD" format
    - Provide download link for `artifact.zip` (direct S3 link via CloudFront)
    - Handle readme.md load failure: show error, still display metadata
    - Handle metadata.json load failure: show error, hide project details
    - Handle artifact unavailable: disable download link with "unavailable" message
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 8.2 Write property test for metadata display completeness
    - **Property 3: Project detail view displays all metadata fields**
    - **Validates: Requirements 2.2**

- [x] 9. Implement Frontend - Upload form
  - [x] 9.1 Implement upload form with validation and submission
    - Create `frontend/src/upload-form.ts`
    - Form fields: project name (max 64 chars, alphanumeric + hyphens + underscores), tags (comma-separated, max 10 tags each max 32 chars), readme (textarea, max 50,000 chars), files (webkitdirectory input)
    - Client-side validation before submission
    - POST to API Gateway as multipart/form-data with `x-api-key` header
    - Handle responses: 200 (show confirmation, clear form), 400 (show validation error), 403 (show unauthorized), 409 (show name taken)
    - _Requirements: 3.1, 3.2, 3.8, 6.3_

- [x] 10. Implement Frontend - SPA router
  - [x] 10.1 Implement client-side router
    - Create `frontend/src/router.ts`
    - Handle routes: `/` (search view), `/project/:name` (detail view), `/upload` (upload view)
    - Create `frontend/src/main.ts` as app entry point wiring router, search, detail, and upload modules
    - Create `frontend/index.html` with base structure
    - _Requirements: 8.1_

- [x] 11. Checkpoint - Frontend implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Terraform infrastructure
  - [x] 12.1 Create S3 bucket and CloudFront distribution
    - Create `infra/main.tf` with S3 bucket configured for static website hosting (index.html as default and error document)
    - Create CloudFront distribution with S3 origin, HTTPS enforcement, HTTP-to-HTTPS redirect
    - Configure custom domain with ACM TLS certificate
    - Set up Origin Access Identity for S3
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 12.2 Create API Gateway and Lambda infrastructure
    - Define API Gateway REST API with single POST `/upload` endpoint
    - Configure API key requirement with usage plan
    - Define Lambda function resource (Node.js runtime)
    - Set up IAM role with S3 read/write permissions
    - Configure Lambda environment variables (bucket name)
    - _Requirements: 6.1, 6.2, 6.4_

  - [x] 12.3 Create Terraform variables and outputs
    - Define variables for domain name, certificate ARN, API key value
    - Define outputs for CloudFront distribution URL, API Gateway endpoint URL, S3 bucket name
    - _Requirements: 7.1_

- [x] 13. Implement CI/CD pipeline
  - [x] 13.1 Create CI/CD pipeline configuration
    - Create pipeline config file (e.g., `.github/workflows/deploy.yml`)
    - Step 1: `terraform plan` and `terraform apply` for infrastructure provisioning
    - Step 2: `npm run build` for frontend
    - Step 3: `aws s3 sync` to deploy build output to S3
    - Step 4: `aws cloudfront create-invalidation --paths "/*"`
    - Halt pipeline on any step failure, report which step failed
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [x] 13.2 Create CI/CD pipeline for project PR deployments
    - Add workflow triggered on PR merge to main with changes in `projects/` directory
    - Validate project directory contains `readme.md` and `metadata.json`
    - Deploy project files to S3 project entry path
    - Regenerate search index (invoke Lambda or run equivalent script)
    - _Requirements: 7.4_

  - [ ]* 13.3 Write property test for PR validation logic
    - **Property 9: PR validation requires both readme.md and metadata.json**
    - **Validates: Requirements 7.4**

- [x] 14. Final checkpoint - Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript/Node.js throughout as specified in the architecture
- fast-check is used for property-based testing with vitest as the test runner
- AWS SDK v3 (`@aws-sdk/client-s3`) is used for Lambda S3 operations

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "7.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "4.1", "4.3", "7.2"] },
    { "id": 4, "tasks": ["4.2", "5.1", "7.3", "7.4", "9.1"] },
    { "id": 5, "tasks": ["5.2", "8.1", "10.1"] },
    { "id": 6, "tasks": ["8.2", "12.1", "12.2"] },
    { "id": 7, "tasks": ["12.3", "13.1"] },
    { "id": 8, "tasks": ["13.2", "13.3"] }
  ]
}
```
