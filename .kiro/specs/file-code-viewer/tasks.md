# Implementation Plan: File Code Viewer

## Overview

This plan implements a GitHub/GitLab-style file browser and syntax-highlighted code viewer for project and template detail pages. The approach uses pre-exploded files stored individually in S3, a lightweight `file-tree.json` manifest for instant directory rendering, and on-demand file fetching. The implementation builds incrementally: shared modules first, then backend file expansion, then frontend components, and finally integration and migration.

## Tasks

- [ ] 1. Shared modules and data types
  - [ ] 1.1 Create shared `FileTreeManifest` and `FileTreeEntry` types in `shared/types.ts`
    - Add `FileTreeManifest` interface (`version`, `totalFiles`, `totalSize`, `entries`)
    - Add `FileTreeEntry` interface (`path`, `type`, `size?`)
    - Add updated `SessionMetadata` with `uploadType` and `filePaths` fields
    - Add updated `InitiateResponse` with `uploadUrls?` and `mode` fields
    - _Requirements: 1.10, 1.11_

  - [ ] 1.2 Create `shared/content-type-map.ts` with the content-type mapping module
    - Implement `CONTENT_TYPE_MAP` record mapping file extensions to MIME types
    - Implement `getContentType(filename: string): string` function
    - Export `DEFAULT_CONTENT_TYPE` constant
    - _Requirements: 1.13, 2.3_

  - [ ] 1.3 Create `frontend/src/language-mapper.ts` with language detection and file classification
    - Implement `EXTENSION_MAP` for highlight.js language identifiers
    - Implement `FILENAME_MAP` for special filenames (Dockerfile, Makefile, etc.)
    - Implement `BINARY_EXTENSIONS` and `IMAGE_EXTENSIONS` sets
    - Implement `detectLanguage(filename): string | null`
    - Implement `isBinaryFile(filename): boolean`
    - Implement `isImageFile(filename): boolean`
    - _Requirements: 9.1, 9.2, 10.1_

  - [ ]* 1.4 Write property tests for content-type and language mapping (Properties 3, 10)
    - **Property 3: Content-Type / Language Mapping Consistency**
    - **Property 10: File Type Classification**
    - Install `fast-check` as dev dependency
    - Verify mappings are consistent and classification is mutually exclusive/exhaustive
    - **Validates: Requirements 1.13, 9.1, 9.2, 10.2, 10.3**

- [ ] 2. Backend — File Expander Lambda module
  - [ ] 2.1 Create `lambda/src/file-expander.ts` with manifest generation logic
    - Implement `generateManifest(files: FileEntry[]): FileTreeManifest` — generates flat manifest from file entries, deducing parent directories
    - Implement `constructS3Key(prefix: string, name: string, filePath: string): string` — builds S3 key for individual files
    - Implement `expandFiles(files, projectName, bucket): Promise<FileExpanderResult>` — writes individual files to S3 with correct Content-Type, generates manifest, handles errors per-file
    - _Requirements: 1.5, 1.8, 1.10, 1.11, 1.12, 1.13, 1.14_

  - [ ]* 2.2 Write property tests for manifest generation and S3 key construction (Properties 1, 2)
    - **Property 1: S3 Key Construction**
    - **Property 2: Manifest Generation Correctness**
    - **Validates: Requirements 1.5, 1.8, 1.10, 1.11**

  - [ ] 2.3 Update `lambda/src/process.ts` to invoke File Expander after zip extraction
    - After filtering files, call `expandFiles()` to write individual S3 objects under `projects/{name}/files/`
    - Upload generated `file-tree.json` manifest to `projects/{name}/file-tree.json`
    - Preserve existing artifact.zip generation and upload logic
    - Handle folder upload mode: read staged files from `staging/{sessionId}/files/` instead of zip
    - Generate artifact.zip server-side for folder mode uploads
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [ ]* 2.4 Write unit tests for process.ts file expansion integration
    - Test zip mode produces individual files + manifest + artifact.zip
    - Test folder mode produces same output structure
    - Test error handling when individual file writes fail
    - _Requirements: 1.7, 1.8, 1.14_

- [ ] 3. Checkpoint — Backend file expansion
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Backend — Initiate Lambda dual-mode presigned URLs
  - [ ] 4.1 Update `lambda/src/initiate.ts` to support folder upload mode
    - Accept `uploadType: 'zip' | 'folder'` and `filePaths: string[]` in request body
    - For folder mode: generate presigned PUT URLs for each file path at `staging/{sessionId}/files/{filePath}`
    - For zip mode: preserve existing single presigned URL behavior
    - Store `uploadType` and `filePaths` in session metadata
    - Return `InitiateResponse` with either `uploadUrl` (zip) or `uploadUrls` record (folder) and `mode` field
    - _Requirements: 1.15, 1.16, 1.17_

  - [ ]* 4.2 Write unit tests for dual-mode initiate handler
    - Test folder mode returns multiple presigned URLs
    - Test zip mode returns single presigned URL (backwards-compatible)
    - Test session metadata includes uploadType
    - _Requirements: 1.15, 1.16, 1.17_

- [ ] 5. Frontend — Drop Zone dual-mode updates
  - [ ] 5.1 Update `frontend/src/drop-zone.ts` to support zip file detection and dual-mode
    - Add `.zip` file drop support alongside existing folder (webkitdirectory) support
    - Implement `detectUploadMode(files: FileList): 'zip' | 'folder'` — single .zip file → zip mode, otherwise → folder mode
    - Update display text to indicate detected mode
    - Export `detectUploadMode` for use in upload-form
    - _Requirements: 1.15, 1.18_

  - [ ]* 5.2 Write property test for upload mode detection (Property 4)
    - **Property 4: Upload Mode Detection**
    - **Validates: Requirements 1.18**

  - [ ] 5.3 Update `frontend/src/upload-form.ts` to handle folder-mode staging
    - For folder mode: call initiate with `uploadType: 'folder'` and `filePaths`, then upload each file to its respective presigned URL
    - For zip mode: preserve existing behavior (client-side zip + single presigned URL)
    - Update progress reporting for multi-file uploads
    - _Requirements: 1.16, 1.17_

- [ ] 6. Checkpoint — Dual-mode upload pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Frontend — File Browser orchestrator component
  - [ ] 7.1 Create `frontend/src/file-browser.ts` — top-level File Browser component
    - Implement state machine: IDLE → LOADING_MANIFEST → BROWSING → LOADING_FILE → VIEWING_FILE
    - Implement `mount()` — renders "Browse Files" button
    - Implement `navigateTo(path)` — handles deep link restoration
    - Implement `destroy()` — cleanup event listeners and DOM
    - Fetch and parse `file-tree.json` manifest on activation
    - Implement in-memory file content cache (Map<string, string>)
    - Handle manifest fetch errors (404 → legacy message, 5xx → retry button)
    - Dispatch `onNavigate` callback for URL hash updates
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.4_

  - [ ] 7.2 Implement directory children extraction and sorting utilities in `file-browser.ts`
    - `getDirectoryChildren(manifest, dirPath): FileTreeEntry[]` — filters entries to immediate children of a directory path
    - `sortEntries(entries): FileTreeEntry[]` — directories first, then files, alphabetical within each group (case-insensitive)
    - `hasReadme(manifest, dirPath): FileTreeEntry | null` — case-insensitive match for readme.md/readme
    - _Requirements: 5.1, 5.2, 7.1_

  - [ ]* 7.3 Write property tests for directory listing utilities (Properties 5, 6, 8)
    - **Property 5: Directory Listing Shows Immediate Children Only**
    - **Property 6: Directory Listing Sort Order**
    - **Property 8: Per-Folder README Detection**
    - **Validates: Requirements 3.4, 5.1, 5.2, 7.1**

- [ ] 8. Frontend — Directory Listing component
  - [ ] 8.1 Create `frontend/src/directory-listing.ts`
    - Render flat table of entries with folder/file icon, name, and optional size
    - Handle directory activation → call `onDirectorySelect(path)`
    - Handle file activation → call `onFileSelect(entry)`
    - Implement keyboard navigation (arrow keys for traversal, Enter/Space for activation)
    - Add visible focus indicator and ARIA attributes (`role="listbox"`, `role="option"`)
    - Apply max-height with vertical scrolling for long directories
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 13.2, 13.4_

  - [ ]* 8.2 Write unit tests for Directory Listing component
    - Test rendering with mixed entries (files and directories)
    - Test keyboard navigation
    - Test callback invocation on activation
    - _Requirements: 5.5, 5.6, 5.7_

- [ ] 9. Frontend — Breadcrumb Navigation component
  - [ ] 9.1 Create `frontend/src/breadcrumb-nav.ts`
    - Implement `generateBreadcrumbs(path): BreadcrumbSegment[]` — produces segments array with root as first segment
    - Render horizontal nav bar with clickable segments separated by `/`
    - Each segment navigates to that directory level via `onNavigate` callback
    - Keyboard accessible (Tab for focus, Enter/Space for activation)
    - Wrap gracefully when path is long (CSS flex-wrap)
    - Add ARIA attributes (`nav`, `aria-label="Breadcrumb"`, `aria-current` on last item)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 13.5_

  - [ ]* 9.2 Write property test for breadcrumb segment generation (Property 7)
    - **Property 7: Breadcrumb Segment Generation**
    - **Validates: Requirements 6.1, 6.3**

- [ ] 10. Frontend — Code Viewer component
  - [ ] 10.1 Create `frontend/src/code-viewer.ts`
    - Implement `generateLineNumbers(content): number[]` — 1..N line number generation
    - Render file content with syntax highlighting via highlight.js (`detectLanguage` from language-mapper)
    - Display line numbers alongside content (gutter column)
    - Implement "Copy" button that copies raw content to clipboard; show "Copied!" feedback for 2 seconds
    - Handle clipboard failure → show "Copy failed" feedback
    - Horizontal scrolling for long lines, no word-wrap
    - For files > 500 KB: skip syntax highlighting, render plain text with notice
    - For binary files (non-image): show "Binary file — cannot preview" message
    - For image files: render inline `<img>` with max-width 100%, aspect ratio preserved
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.3, 9.4, 10.2, 10.3, 10.4, 13.3_

  - [ ]* 10.2 Write property test for line number generation (Property 9)
    - **Property 9: Line Number Generation**
    - **Validates: Requirements 8.3**

  - [ ]* 10.3 Write unit tests for Code Viewer component
    - Test copy button interaction
    - Test large file warning (>500 KB threshold from manifest)
    - Test binary file detection and image preview rendering
    - _Requirements: 8.4, 8.5, 8.7, 10.2, 10.3_

- [ ] 11. Frontend — Per-folder README rendering
  - [ ] 11.1 Integrate README detection and rendering into File Browser
    - When displaying a directory that contains a README, fetch it from CDN and render below the listing
    - Use existing `marked` + `hljs` pipeline from `shared-markdown.ts`
    - Show loading indicator while README is fetching
    - Silently hide README section if fetch fails (no error shown)
    - Skip README rendering when viewing a file (Code Viewer active)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 12. Checkpoint — Core frontend components
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Frontend — Deep linking and router integration
  - [ ] 13.1 Update `frontend/src/router.ts` and `frontend/src/main.ts` with file browsing routes
    - Add route pattern: `/project/{name}/files/{path?}` for project file browsing
    - Add route pattern: `/template/{name}/files/{path?}` for template file browsing
    - Implement URL encoding/decoding helpers: `encodeFilePath(name, path)` and `decodeFilePath(hash)`
    - When routes match, render detail page with File Browser auto-navigated to the specified path
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ]* 13.2 Write property test for deep link URL encoding round-trip (Property 11)
    - **Property 11: Deep Link URL Encoding Round-Trip**
    - **Validates: Requirements 12.1, 12.2**

  - [ ] 13.3 Handle invalid deep link paths
    - If path from URL hash is not found in manifest, navigate to root listing and show notice
    - _Requirements: 12.5_

- [ ] 14. Frontend — Integration with detail pages
  - [ ] 14.1 Update `frontend/src/project-detail.ts` to mount File Browser
    - Add File Browser section below the download section
    - Pass `basePath` constructed from CDN URL + project path
    - Pass `onNavigate` callback to update URL hash on navigation
    - Pass `initialPath` from URL hash for deep link restoration
    - Show only "Browse Files" button initially (minimal vertical space)
    - _Requirements: 11.1, 11.3, 11.4_

  - [ ] 14.2 Update `frontend/src/template-detail.ts` to mount File Browser
    - Add File Browser section below the download button
    - Same integration pattern as project-detail
    - _Requirements: 11.2, 11.3, 11.4_

- [ ] 15. CI/CD — Template expansion script
  - [ ] 15.1 Create `.github/scripts/expand-template-files.ts` (or shell script)
    - Walk the template directory tree
    - Upload each file individually to `templates/{name}/files/{filePath}` with correct Content-Type
    - Generate `file-tree.json` manifest and upload to `templates/{name}/file-tree.json`
    - Continue to produce `artifact.zip` as before
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 15.2 Update `.github/workflows/deploy-project.yml` to invoke the expansion script
    - Add step to run the template expansion script during deploy
    - Ensure template files are exploded before index regeneration
    - _Requirements: 2.1_

- [ ] 16. Migration script for existing projects
  - [ ] 16.1 Create `scripts/migrate-files.ts` — one-time migration script
    - List all `projects/*/artifact.zip` without a sibling `file-tree.json`
    - For each: download artifact.zip, explode into `projects/{name}/files/{filePath}` with Content-Type mapping
    - Generate and upload `file-tree.json` for each project
    - Idempotent — safe to re-run (check existence before writing)
    - Log progress and continue on individual project errors
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [ ]* 16.2 Write property test for migration idempotence (Property 12)
    - **Property 12: Migration Idempotence**
    - **Validates: Requirements 14.6**

- [ ] 17. Final checkpoint — Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses TypeScript throughout (frontend via Vite, Lambda via Node.js)
- `fast-check` is the property-based testing library for TypeScript (equivalent to Hypothesis for Python)
- highlight.js is already bundled in the project (used for README rendering)
- The `marked` library is already available for markdown rendering
- Existing patterns in `shared/` should be followed for type definitions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4"] },
    { "id": 2, "tasks": ["2.1", "5.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "5.2", "5.3"] },
    { "id": 4, "tasks": ["2.4", "4.1"] },
    { "id": 5, "tasks": ["4.2", "7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1", "9.1", "10.1"] },
    { "id": 7, "tasks": ["7.3", "8.2", "9.2", "10.2", "10.3", "11.1"] },
    { "id": 8, "tasks": ["13.1", "15.1"] },
    { "id": 9, "tasks": ["13.2", "13.3", "14.1", "14.2", "15.2"] },
    { "id": 10, "tasks": ["16.1"] },
    { "id": 11, "tasks": ["16.2"] }
  ]
}
```
