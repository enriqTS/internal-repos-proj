# Implementation Plan

## Overview

Fix the stale project list bug where the home page does not reflect add/edit/delete operations. The fix addresses two root causes: (1) missing `Cache-Control` header on `global-index.json` in S3 causing CloudFront to serve stale data, and (2) the frontend's `searchIndexLoaded` flag never resetting after mutations, preventing re-fetch of the index.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Stale Index After Mutation
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists in both layers (backend cache header + frontend flag)
  - **Scoped PBT Approach**: Scope the property to concrete failing cases:
    - Backend: `regenerateIndex()` is called → assert `PutObjectCommand` includes `CacheControl: 'no-cache, must-revalidate'`
    - Frontend: After successful upload/edit/delete flow → assert `searchIndexLoaded` is reset to `false`
  - **Lambda test** (`lambda/src/index-generator.test.ts`): Assert that `regenerateIndex()` calls `PutObjectCommand` with `CacheControl: 'no-cache, must-revalidate'` for `global-index.json`
  - **Frontend test** (`frontend/src/main.test.ts`): Assert that after a successful mutation (upload, edit, delete), `searchIndexLoaded` is set to `false` so the next home page render re-fetches the index
  - Run tests on UNFIXED code with `npx vitest run` from `lambda/` and `frontend/` directories
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bug exists: no CacheControl header, flag never reset)
  - Document counterexamples found:
    - `PutObjectCommand` is called without `CacheControl` property
    - `searchIndexLoaded` remains `true` after all mutation operations
  - Mark task complete when tests are written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Unchanged Behavior for Non-Mutation Flows
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (interactions that do NOT involve a successful mutation)
  - **Lambda preservation** (`lambda/src/index-generator.test.ts`):
    - Observe: `regenerateIndex()` correctly aggregates valid metadata entries into `global-index.json`
    - Observe: `regenerateIndex()` skips malformed/invalid metadata entries
    - Observe: `regenerateIndex()` sets `ContentType: 'application/json'` on the PutObjectCommand
    - Write property-based test: for all valid project metadata inputs, `regenerateIndex()` produces correct index entries with unchanged aggregation logic
  - **Frontend preservation** (`frontend/src/main.test.ts`):
    - Observe: On first page load, `searchIndexLoaded` is `false` and `fetchSearchIndex()` is called
    - Observe: After initial load succeeds, `searchIndexLoaded` becomes `true` and subsequent renders skip re-fetch
    - Observe: Failed mutations do NOT reset `searchIndexLoaded`
    - Write property-based test: for all non-mutation interactions (page loads, searches, navigation), index loading behavior is unchanged
  - Run tests on UNFIXED code with `npx vitest run` from `lambda/` and `frontend/` directories
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for stale project list after mutations

  - [x] 3.1 Add CacheControl header to PutObjectCommand in index generator
    - In `lambda/src/index-generator.ts`, add `CacheControl: 'no-cache, must-revalidate'` to the `PutObjectCommand` params when writing `global-index.json`
    - This instructs CloudFront to always revalidate with the S3 origin before serving the cached copy
    - _Bug_Condition: isBugCondition(input) where input.mutationPerformed IN ['upload', 'edit', 'delete'] AND cloudFrontServesStaleCache == true_
    - _Expected_Behavior: global-index.json is served fresh after regeneration due to CacheControl header_
    - _Preservation: Other S3 objects (metadata.json, readme, artifacts, tags.json) must NOT receive CacheControl header_
    - _Requirements: 2.4, 3.4, 3.5_

  - [x] 3.2 Export invalidateSearchIndex function from main.ts
    - In `frontend/src/main.ts`, export a function `invalidateSearchIndex()` that sets `searchIndexLoaded = false`
    - This allows other modules to signal that the index should be re-fetched on the next home page render
    - _Bug_Condition: isBugCondition(input) where searchIndexLoaded == true after mutation_
    - _Expected_Behavior: invalidateSearchIndex() resets the flag so next renderSearchView re-fetches_
    - _Preservation: The function only resets the flag; it does not trigger a fetch or modify any other state_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Call invalidateSearchIndex after successful upload
    - In `frontend/src/upload-form.ts`, import `invalidateSearchIndex` from `./main` and call it in the success path (step 7), before form reset
    - _Bug_Condition: isBugCondition(input) where input.mutationPerformed == 'upload' AND input.mutationResult == 'success'_
    - _Expected_Behavior: After successful upload, searchIndexLoaded is false so next home render fetches fresh index_
    - _Preservation: Failed uploads must NOT call invalidateSearchIndex_
    - _Requirements: 1.1, 2.1_

  - [x] 3.4 Call invalidateSearchIndex after successful edit
    - In `frontend/src/edit-form.ts`, import `invalidateSearchIndex` from `./main` and call it in the success path, before the `setTimeout` that navigates back
    - _Bug_Condition: isBugCondition(input) where input.mutationPerformed == 'edit' AND input.mutationResult == 'success'_
    - _Expected_Behavior: After successful edit, searchIndexLoaded is false so next home render fetches fresh index_
    - _Preservation: Failed edits must NOT call invalidateSearchIndex_
    - _Requirements: 1.3, 2.3_

  - [x] 3.5 Call invalidateSearchIndex after successful delete
    - In `frontend/src/delete-dialog.ts`, import `invalidateSearchIndex` from `./main` and call it in the `result.ok` branch, before the `setTimeout` that navigates to home
    - _Bug_Condition: isBugCondition(input) where input.mutationPerformed == 'delete' AND input.mutationResult == 'success'_
    - _Expected_Behavior: After successful delete, searchIndexLoaded is false so next home render fetches fresh index_
    - _Preservation: Failed deletes must NOT call invalidateSearchIndex_
    - _Requirements: 1.2, 2.2_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Fresh Index After Mutation
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (CacheControl present, flag reset after mutations)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1 with `npx vitest run` from `lambda/` and `frontend/`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Unchanged Behavior for Non-Mutation Flows
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2 with `npx vitest run` from `lambda/` and `frontend/`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite: `npx vitest run` from both `lambda/` and `frontend/` directories
  - Ensure all existing tests continue to pass alongside the new bug condition and preservation tests
  - Ask the user if questions arise


## Notes

- Lambda tests run with `npx vitest run` from `/home/henrique/upd8/internal-repos-proj/lambda/`
- Frontend tests run with `npx vitest run` from `/home/henrique/upd8/internal-repos-proj/frontend/`
- The exploration test (task 1) is expected to FAIL on unfixed code — this confirms the bug exists
- The preservation test (task 2) is expected to PASS on unfixed code — this establishes the baseline
- After the fix (task 3), both test suites should PASS

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 3, "tasks": ["3.6", "3.7"] },
    { "id": 4, "tasks": ["4"] }
  ]
}
```
