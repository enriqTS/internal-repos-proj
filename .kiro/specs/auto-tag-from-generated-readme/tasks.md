# Implementation Plan: Auto-Tag from Generated README

## Overview

This plan implements automatic tag suggestion within the Finalize_Lambda. The core work involves extracting the tag suggestion logic from `suggest-tags.ts` into a reusable `suggestTagsFromReadme` function, integrating it into the finalize flow in `process.ts` after README generation, and adding comprehensive tests. All changes are contained within the `lambda/src/` directory.

## Tasks

- [x] 1. Extract reusable `suggestTagsFromReadme` function
  - [x] 1.1 Create `suggestTagsFromReadme` exported function in `lambda/src/suggest-tags.ts`
    - Extract the core logic (steps 2–7) from the existing `handler` function into a new exported async function `suggestTagsFromReadme(readme: string): Promise<string[]>`
    - Add early return of `[]` if readme is empty, undefined, or whitespace-only (without invoking AI)
    - Implement 10-second AbortController timeout
    - Truncate README to 10,000 characters before sending to model
    - Reuse the same prompt format, model parameters, and response parsing as the handler
    - Wrap entire function body in try/catch that returns `[]` on any error (never throws)
    - Log errors to console for CloudWatch visibility
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2_

  - [ ]* 1.2 Write unit tests for `suggestTagsFromReadme`
    - Test that empty/whitespace README returns `[]` without AI call
    - Test that README is truncated to 10,000 chars before model invocation
    - Test that returned tags are filtered to registry entries (case-insensitive) and capped at 10
    - Test that AI timeout after 10s returns `[]`
    - Test that model invocation error returns `[]` (never throws)
    - Test that empty registry returns `[]` without AI call
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 4.1, 4.2_

  - [ ]* 1.3 Write property test: registry subset capped at 10
    - **Property 2: Tag suggestion output is a registry subset capped at 10**
    - Generate random README + random registries + mock AI responses with arbitrary tags, assert output ⊆ registry and length ≤ 10
    - **Validates: Requirements 2.3, 3.3**

  - [ ]* 1.4 Write property test: README truncation
    - **Property 3: README content is truncated to 10,000 characters**
    - Generate READMEs of length 0 to 50,000, assert model input ≤ 10,000 chars
    - **Validates: Requirements 2.4**

  - [ ]* 1.5 Write property test: empty/whitespace guard
    - **Property 4: Empty or whitespace README returns empty without AI invocation**
    - Generate whitespace-only strings, assert empty return and no AI call
    - **Validates: Requirements 2.5**

- [x] 2. Integrate auto-tagging into Finalize_Lambda
  - [x] 2.1 Add `hasUserTags` helper function in `lambda/src/process.ts`
    - Implement `function hasUserTags(tags: string): boolean` that splits by comma and returns true if at least one non-whitespace tag exists
    - _Requirements: 1.2, 3.5_

  - [x] 2.2 Add auto-tagging step (step 6.75) in `lambda/src/process.ts`
    - Import `suggestTagsFromReadme` from `./suggest-tags`
    - After step 6.5 (README generation) and before step 7 (artifact creation), add the auto-tagging block
    - Check preconditions: mode is not "replace", `hasUserTags` returns false, readmeContent is non-empty, not whitespace-only, and not "No description provided"
    - Call `suggestTagsFromReadme(readmeContent)` when preconditions are met
    - Store result in `autoTags` variable; set `tagWarning` on failure
    - _Requirements: 1.1, 1.3, 1.4, 4.1, 5.1, 5.2, 5.3_

  - [x] 2.3 Update ProjectMetadata construction to use auto-tags
    - Modify the metadata construction in create mode to use `autoTags` when user has no tags: `tags: hasUserTags(sessionMeta.tags) ? sessionMeta.tags.split(',').map(...) : autoTags`
    - Add `tagWarning` to the warnings array for the response
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.3, 4.5_

  - [ ]* 2.4 Write unit tests for `hasUserTags` helper
    - Test returns false for empty string, whitespace-only, and commas-only
    - Test returns true for strings with at least one non-empty tag
    - _Requirements: 1.2, 3.5_

  - [ ]* 2.5 Write property test: auto-tag decision matrix
    - **Property 1: Auto-tag decision matrix correctness**
    - Generate random SessionMetadata (varying mode, tags, readme) and readmeContent, assert auto-tagging trigger condition matches the specification
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 3.5**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integration tests for the full finalize flow
  - [x] 4.1 Write integration tests for auto-tag in process handler
    - Test full finalize flow: no readme + no tags in create mode → project gets auto-tags in metadata
    - Test full finalize flow: user provides tags → auto-tagging skipped, user tags preserved
    - Test full finalize flow: replace mode → auto-tagging skipped regardless
    - Test full finalize flow: README generation fails (fallback text) → auto-tagging skipped
    - Test that `addTagsToRegistry` is NOT called with auto-suggested tags
    - Test that both README gen and tag suggestion failure → fallback content + both warnings in response
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.4, 4.5_

  - [ ]* 4.2 Write property test: auto-tag results flow to ProjectMetadata
    - **Property 5: Auto-tag results flow to ProjectMetadata when user has no tags**
    - Generate auto-tag results, assert ProjectMetadata.tags matches exactly
    - **Validates: Requirements 3.1**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript with vitest as the test runner
- `fast-check` should be used for property-based tests (compatible with vitest)
- All changes are within `lambda/src/` — no infrastructure changes required

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "4.1"] },
    { "id": 4, "tasks": ["4.2"] }
  ]
}
```
