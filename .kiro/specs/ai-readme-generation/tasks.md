# Implementation Plan: AI-Generated README for Projects

## Overview

Implement automatic README generation using Kimi K2.5 via Amazon Bedrock. The feature slots into the existing finalize Lambda between file filtering (step 5) and artifact creation (step 7). All new logic lives in a single module (`generate-readme.ts`) with pure helper functions for classification/prioritization and an async orchestrator for Bedrock invocation. Graceful fallback ensures uploads never fail due to generation errors.

## Tasks

- [x] 1. Implement core file classification and prioritization
  - [x] 1.1 Create `lambda/src/generate-readme.ts` with constants, types, and pure helper functions
    - Define module-local constants: `README_TOKEN_BUDGET`, `CHARS_PER_TOKEN`, `README_MAX_OUTPUT_TOKENS`, `README_GENERATION_TIMEOUT_MS`, `README_MODEL_ID`
    - Define classification data: `ENTRY_POINT_BASES`, `ROOT_CONFIG_FILES`, `SOURCE_EXTENSIONS`, `BINARY_EXTENSIONS`, `LOCK_FILES`, `TEST_SEGMENTS`
    - Export `FileTier` type, `PrioritizedFile` and `PrioritizationResult` interfaces
    - Implement and export `estimateTokens(charCount: number): number` — returns `Math.ceil(charCount / 4)`
    - Implement and export `classifyFile(filePath: string, contentSize: number): FileTier` with precedence order Tier_1 > Skip > Tier_2 > Tier_3
    - Implement and export `trimPackageJson(content: string): string` — keeps only name, version, description, scripts, dependencies, devDependencies
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.2, 3.6_

  - [x] 1.2 Implement and export `prioritizeFiles(files: FileEntry[]): PrioritizationResult`
    - Classify all files using `classifyFile`
    - Include all Tier_1 files with full content (package.json trimmed via `trimPackageJson`)
    - Sort Tier_2 files case-insensitive alphabetically by path
    - Add Tier_2 files sequentially until next file would exceed 100K token budget
    - Collect Tier_3 file paths for directory listing
    - Return `PrioritizationResult` with `includedFiles`, `directoryListing`, `totalTokens`
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.7, 3.8_

- [x] 2. Implement prompt construction and model invocation
  - [x] 2.1 Implement and export `buildPrompt(projectName: string, prioritization: PrioritizationResult): string`
    - Build system instruction (README sections directive, no-fabrication rule)
    - Include project name
    - For each included file: file path header + full text content
    - Append directory listing section with Tier_3 file paths
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 2.2 Implement and export `extractModelContent(responseBody: string): string | null`
    - Parse JSON response body
    - Check `choices[0].message.content`, then `content`, then `completion`
    - Return first non-empty value found, or null
    - _Requirements: 5.3_

  - [x] 2.3 Implement and export `validateReadmeOutput(content: string): string | null`
    - Reject empty/whitespace-only content (return null)
    - If content ≤ 50,000 chars and has non-whitespace, return as-is
    - If content > 50,000 chars, truncate at last newline at or before 50,000 boundary
    - Import `MAX_README_LENGTH` from `shared/constants`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 2.4 Implement and export `generateReadme(projectName: string, files: FileEntry[]): Promise<GenerateReadmeResult>`
    - Create module-level `BedrockRuntimeClient` singleton (reuse pattern from suggest-tags)
    - Call `prioritizeFiles`, then `buildPrompt`
    - Invoke Bedrock with `InvokeModelCommand`, model ID, 30s `AbortController` timeout
    - Parse response with `extractModelContent`, validate with `validateReadmeOutput`
    - On any error: log with `console.error('[generate-readme] Error: ...')`, return `{ readme: '', warning: '...' }`
    - _Requirements: 5.1, 5.2, 5.4, 6.1, 6.2, 7.4_

- [x] 3. Checkpoint - Verify core module compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integrate into process.ts and wire end-to-end
  - [x] 4.1 Add README generation step in `lambda/src/process.ts` between step 5 (filtering) and step 7 (artifact creation)
    - Import `generateReadme` from `./generate-readme`
    - Add conditional: if `sessionMeta.mode !== 'replace'` AND readme is empty/whitespace, invoke `generateReadme`
    - Use generated content or fall back to `'No description provided'`
    - Propagate `readmeWarning` into the warnings array in the response
    - Use `readmeContent` instead of `sessionMeta.readme` for metadata description and readme.md writes
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 6.3, 6.4, 7.1, 7.2, 7.3_

- [ ] 5. Property-based tests
  - [ ]* 5.1 Write property test for trigger decision correctness
    - **Property 1: Trigger decision correctness**
    - Generate arbitrary SessionMetadata objects, verify generation triggers iff mode="create" AND readme is empty/whitespace/undefined
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [ ]* 5.2 Write property test for file classification correctness
    - **Property 2: File classification correctness**
    - Generate arbitrary file paths and content sizes, verify `classifyFile` returns correct tier per classification rules
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**

  - [ ]* 5.3 Write property test for classification precedence
    - **Property 3: Classification precedence**
    - Generate file paths that match multiple category rules, verify highest-precedence tier is assigned and exactly one tier per file
    - **Validates: Requirements 2.1, 2.7**

  - [ ]* 5.4 Write property test for Tier_1 files always included
    - **Property 4: Tier_1 files always included**
    - Generate file sets with known Tier_1 files, verify all appear in output with full content regardless of budget
    - **Validates: Requirements 3.1, 3.8**

  - [ ]* 5.5 Write property test for package.json field trimming
    - **Property 5: package.json field trimming**
    - Generate arbitrary JSON objects with package.json fields plus extra fields, verify `trimPackageJson` retains only allowed fields
    - **Validates: Requirements 3.2**

  - [ ]* 5.6 Write property test for budget-bounded alphabetical inclusion
    - **Property 6: Tier_2 budget-bounded alphabetical inclusion**
    - Generate Tier_2 file sets, verify inclusion order is case-insensitive alphabetical and cumulative tokens never exceed 100K, with no partial content
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 5.7 Write property test for token estimation formula
    - **Property 7: Token estimation formula**
    - Generate arbitrary strings, verify `estimateTokens(str.length)` equals `Math.ceil(str.length / 4)`
    - **Validates: Requirements 3.6**

  - [ ]* 5.8 Write property test for prompt structure completeness
    - **Property 8: Prompt structure completeness**
    - Generate project names and prioritization results with at least one file, verify prompt contains system instruction, project name, file paths with content, and directory listing in order
    - **Validates: Requirements 4.1**

  - [ ]* 5.9 Write property test for response field extraction order
    - **Property 9: Response field extraction order**
    - Generate Bedrock response body strings with various field combinations, verify `extractModelContent` returns first non-empty in order: choices[0].message.content → content → completion → null
    - **Validates: Requirements 5.3**

  - [ ]* 5.10 Write property test for output truncation at newline boundary
    - **Property 10: Output truncation at newline boundary**
    - Generate strings exceeding 50,000 chars with embedded newlines, verify truncation at last newline ≤ 50,000 boundary and result ≥ 1 char
    - **Validates: Requirements 8.3**

  - [ ]* 5.11 Write property test for output validity enforcement
    - **Property 11: Output validity enforcement**
    - Generate arbitrary strings, verify: whitespace-only → null, 1–50K chars with non-whitespace → unchanged, >50K → truncated per Property 10
    - **Validates: Requirements 8.1, 8.2, 8.4**

- [ ] 6. Unit tests for specific scenarios
  - [ ]* 6.1 Write unit tests for trigger conditions and graceful fallback
    - Test: mode="replace" skips generation regardless of readme content
    - Test: mode="create" with non-empty readme skips generation
    - Test: mode="create" with empty/whitespace readme triggers generation
    - Test: `generateReadme` returns empty + warning on Bedrock timeout (mocked)
    - Test: `generateReadme` returns empty + warning on empty model response (mocked)
    - Test: warning field present in FinalizeResponse on failure
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 6.2 Write unit tests for file classification edge cases
    - Test: `src/main.ts` → Tier_1, `lib/main.ts` → Tier_2 (not at root or src/)
    - Test: `tests/foo.test.ts` → Skip (test segment + source ext → Tier_2 rule excludes tests → falls to Tier_3)
    - Test: `package-lock.json` → Skip
    - Test: `image.png` → Skip
    - Test: `data.json` with size >10,240 → Skip; with size ≤10,240 → Tier_3
    - Test: `.github/workflows/deploy.yml` → Skip
    - Test: `infra/main.tf` → Skip
    - Test: `utils.generated.ts` → Skip
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 6.3 Write unit tests for prompt construction details
    - Test: system instruction contains required README section names
    - Test: system instruction contains no-fabrication directive
    - Test: included files appear with path headers and content
    - Test: directory listing contains Tier_3 paths
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 6.4 Write integration-style unit tests for process.ts flow (mocked Bedrock)
    - Test: empty readme in create mode → generation invoked, result written to metadata and S3
    - Test: Bedrock failure → upload succeeds with "No description provided" + warning
    - Test: provided readme → generation skipped, user readme preserved
    - _Requirements: 7.1, 7.2, 6.3_

- [x] 7. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All code is TypeScript, matching the existing codebase
- `fast-check` is already available as a dev dependency
- `@aws-sdk/client-bedrock-runtime` is already available (used by suggest-tags)
- Constants are module-local in `generate-readme.ts` (except `MAX_README_LENGTH` which is imported from shared)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "5.5", "5.7", "5.9", "5.10", "5.11"] },
    { "id": 6, "tasks": ["5.4", "5.6", "5.8", "6.1", "6.2", "6.3"] },
    { "id": 7, "tasks": ["6.4"] }
  ]
}
```
