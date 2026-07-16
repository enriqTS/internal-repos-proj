# Implementation Plan: CI Differential Upload

## Overview

This plan implements a differential (hash-based) upload script (`.github/scripts/differential-upload.ts`) that replaces the existing "Package and deploy templates" and "Expand template files for file browser" workflow steps in `deploy.yml`. The script computes SHA-256 hashes, compares against a persisted manifest in S3, and uploads only changed files. Implementation builds incrementally: core utilities first, then the diff engine, then S3 operations, artifact generation, CLI orchestration, and finally workflow integration.

## Tasks

- [x] 1. Core utilities and interfaces
  - [x] 1.1 Create `.github/scripts/differential-upload.ts` with shared types, constants, and content-type resolver
    - Define `LocalFile`, `HashResult`, `HashManifest`, `DiffResult`, `FileTreeEntry`, `FileTreeManifest` interfaces
    - Copy `EXCLUDED_DIRS` set and `CONTENT_TYPE_MAP` + `getContentType()` from `expand-template-files.ts`
    - Define `DEFAULT_CONTENT_TYPE = 'application/octet-stream'`
    - Add manifest version constant `MANIFEST_VERSION = 1`
    - Add `MAX_MANIFEST_SIZE = 5 * 1024 * 1024` constant
    - _Requirements: 1.2, 8.1, 8.6, 9.1, 9.2, 9.3_

  - [x] 1.2 Implement the directory walker function
    - Implement `async function walkDirectory(baseDir: string): Promise<LocalFile[]>`
    - Recursively traverse directories, skip entries in `EXCLUDED_DIRS`
    - Return `{ relativePath, absolutePath, size }` for each file using forward-slash separators
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 1.3 Implement the hash computation module
    - Implement `async function computeFileHashes(files: LocalFile[]): Promise<HashResult[]>`
    - Use `crypto.createHash('sha256')` to produce both hex (64 chars lowercase) and base64 representations from the same digest
    - Read each file sequentially for deterministic output
    - _Requirements: 1.1, 1.5, 1.6_

- [x] 2. Diff engine and manifest management
  - [x] 2.1 Implement the diff engine (pure function)
    - Implement `function computeDiff(local: HashManifest, remote: HashManifest | null): DiffResult`
    - Classify files as added, modified, deleted, or unchanged by comparing hash values
    - If `remote` is null, all local files go into `added`
    - _Requirements: 3.1, 3.4, 3.6_

  - [x] 2.2 Implement manifest validation and fetch/upload
    - Implement `function validateManifest(parsed: unknown): HashManifest | null` — checks version === 1, required fields, returns null on invalid
    - Implement `async function fetchRemoteManifest(s3, bucket, key): Promise<HashManifest | null>` — returns null on 404/NoSuchKey, throws on transient errors
    - Implement `async function uploadManifest(s3, bucket, key, manifest): Promise<void>` — validates size < 5 MB before PUT
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.7_

  - [ ]* 2.3 Write property tests for diff engine (Properties 3–8)
    - **Property 3: Diff Correctness — Added Files**
    - **Property 4: Diff Correctness — Modified Files**
    - **Property 5: Diff Correctness — Deleted Files**
    - **Property 6: Diff Correctness — Unchanged Files**
    - **Property 7: Diff Completeness**
    - **Property 8: Null Remote Manifest Means Full Upload**
    - Use `fast-check` to generate random manifests and verify partition correctness
    - **Validates: Requirements 3.1, 3.4, 3.6, 2.3**

- [x] 3. Checkpoint — Core logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. S3 operations and artifact generation
  - [x] 4.1 Implement the S3 upload engine with checksum verification
    - Implement `async function uploadWithChecksum(s3, options: UploadOptions): Promise<void>`
    - Include `ChecksumSHA256` (base64) and `ChecksumAlgorithm: "SHA256"` on every PutObject
    - Retry up to 2 additional times on checksum mismatch (re-read + re-hash on each retry)
    - Implement `async function deleteS3Object(s3, bucket, key): Promise<void>`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 3.3_

  - [x] 4.2 Implement file-tree.json generation
    - Implement `function generateFileTree(files: LocalFile[]): FileTreeManifest`
    - Produce `{ version: 1, totalFiles, totalSize, entries }` matching existing schema
    - Include directory entries deduced from file paths
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 4.3 Implement artifact.zip generation
    - Implement `async function generateArtifactZip(sourceDir: string, excludePatterns: string[]): Promise<Buffer>`
    - Use `archiver` to create zip in-memory
    - Exclude: `docs/`, `.git*`, `build/`, `.kiro/`, `*.zip`
    - _Requirements: 5.4, 5.5_

  - [ ]* 4.4 Write property tests for hash determinism, base64 round-trip, content-type, file-tree, and manifest serialization (Properties 1, 2, 9, 10, 11, 12)
    - **Property 1: Hash Determinism**
    - **Property 2: Hash-to-Base64 Round Trip**
    - **Property 9: Content-Type Resolution**
    - **Property 10: Manifest Serialization Round Trip**
    - **Property 11: Directory Exclusion Consistency**
    - **Property 12: File Tree Manifest Integrity**
    - **Validates: Requirements 1.1, 1.5, 1.6, 9.1, 9.2, 9.3, 8.1, 8.2, 8.3, 1.2, 4.3, 4.4, 10.5**

- [x] 5. CLI orchestration and metadata handling
  - [x] 5.1 Implement metadata and architecture image upload logic
    - Implement conditional upload for `metadata.json` → `templates/{name}/metadata.json`
    - Implement conditional upload for `README.md` → `templates/{name}/readme.md`
    - Implement architecture image resolution: prefer SVG over PNG, upload to `templates/{name}/architecture.{ext}`
    - Include metadata/readme/architecture hashes in the manifest for differential tracking
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 6.3, 6.4, 6.5, 6.6, 6.8_

  - [x] 5.2 Implement the main CLI entry point and orchestration pipeline
    - Parse CLI args: `<name> <source-dir> [prefix]` with prefix defaulting to `"templates"`
    - Validate `BUCKET_NAME` env var, directory existence, non-empty file list
    - Orchestrate: walk → hash → fetch manifest → diff → upload changed → delete removed → generate file-tree → upload metadata/readme/arch if changed → generate artifact.zip if needed → upload new manifest
    - Log summary (added/modified/deleted/unchanged counts)
    - Exit 0 on success (including zero-changes), exit 1 on any failure
    - Track per-file errors, continue processing, exit non-zero if any failures occurred
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 3.2, 3.5, 3.7, 3.8, 1.4, 6.1, 6.2, 6.7_

  - [ ]* 5.3 Write unit tests for CLI argument parsing, error handling, and metadata logic
    - Test missing args → exit 1 with usage message
    - Test missing BUCKET_NAME → exit 1
    - Test empty directory → exit 1
    - Test architecture image priority (SVG > PNG)
    - Test artifact exclusion patterns
    - _Requirements: 7.3, 7.4, 1.4, 6.5, 5.4_

- [x] 6. Checkpoint — Script complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. CI workflow integration
  - [x] 7.1 Update `.github/workflows/deploy.yml` to use differential-upload.ts
    - Replace "Package and deploy templates" step and "Expand template files for file browser" step with a single step
    - New step iterates over `templates/chatbot-rag-*/` directories and invokes `npx tsx .github/scripts/differential-upload.ts "$TEMPLATE" "$TEMPLATE_DIR"` for each
    - Set `BUCKET_NAME` env var from `steps.tf_outputs.outputs.templates_bucket`
    - Fail job on non-zero exit code (stop processing remaining templates)
    - _Requirements: 7.1, 7.2, 7.5_

  - [ ]* 7.2 Write unit tests for manifest validation edge cases
    - Test unknown version (> 1) → logs warning, triggers full upload
    - Test invalid JSON → triggers full upload
    - Test missing required fields → triggers full upload
    - Test manifest > 5 MB → exit 1
    - _Requirements: 8.4, 8.5, 8.7_

- [x] 8. Final checkpoint — Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses TypeScript with Node.js 22 runtime
- `fast-check` is the property-based testing library
- Test file location: `.github/scripts/differential-upload.test.ts`
- The existing `expand-template-files.ts` is kept for backward compatibility (`deploy-project.yml` still uses it)
- `archiver` is already a project dependency (used in Lambda workspace)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3", "4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "5.1"] },
    { "id": 5, "tasks": ["5.2"] },
    { "id": 6, "tasks": ["5.3", "7.1"] },
    { "id": 7, "tasks": ["7.2"] }
  ]
}
```
