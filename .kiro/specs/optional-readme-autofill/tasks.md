# Implementation Plan: Optional README Autofill

## Overview

This plan implements the optional README autofill feature across three layers: shared types, backend validation, and frontend form logic. Tasks are ordered so that shared type changes come first (since both frontend and backend depend on them), followed by backend and frontend validation changes, then the new autofill functionality, and finally property-based and unit tests.

## Tasks

- [x] 1. Update shared types and backend validation
  - [x] 1.1 Make `readme` field optional in `UploadRequest` interface
    - In `shared/src/types.ts`, change `readme: string` to `readme?: string`
    - Update the JSDoc comment to reflect the field is optional
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 1.2 Update backend `validateRequest()` to make readme optional
    - In `lambda/src/handler.ts`, remove `readme` from the required-fields check in `validateRequest()`
    - Keep the max-length check but only apply it when `data.readme` is provided and non-empty
    - Treat undefined/empty/whitespace-only readme as valid (no error)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.3 Update existing backend tests for new readme behavior
    - In `lambda/src/handler.test.ts`, update the test "should return error for missing readme" to assert that missing readme is now accepted (returns null)
    - Update the test "should return error listing multiple missing fields" to no longer include `readme` in the missing fields
    - Update the handler test "should return 400 for missing required fields" to no longer expect `readme` in the error
    - Add a new test verifying that a request with valid name + files but no readme returns null
    - Add a new test verifying that a request with whitespace-only readme returns null
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Update frontend validation and form rendering
  - [x] 3.1 Remove required readme check from frontend `validateForm()`
    - In `frontend/src/upload-form.ts`, remove the `if (!readme.trim())` check that produces the "Readme content is required" error
    - Keep the max-length check: only validate `readme.length > MAX_README_LENGTH` when content is present
    - _Requirements: 1.1, 1.2_

  - [x] 3.2 Update `renderUploadForm()` to remove required attribute and add notice container
    - Remove `required: true` from the `createTextareaGroup` call for the readme field
    - Add a `<div>` with class `readme-notice-container` after the readme textarea for autofill/truncation messages
    - _Requirements: 1.3, 4.3_

  - [x] 3.3 Implement `detectReadmeFile(files: FileList): File | null`
    - Add a new exported function that scans a FileList for root-level README files
    - Root level = `webkitRelativePath` has exactly one path separator (e.g., `folder/README.md`)
    - Match filenames case-insensitively against pattern: `readme`, `readme.md`, `readme.txt`
    - Priority order: `.md` > `.txt` > no extension; ties broken by file list order
    - Return the highest-priority match or `null`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.4 Implement `handleReadmeAutofill(files, textarea, noticeContainer): Promise<void>`
    - Add a new exported async function that orchestrates autofill logic
    - Clear previous notices from the container
    - Skip if textarea already has non-whitespace content (preserve user input)
    - Call `detectReadmeFile()` and return early if null
    - Read file content via `File.text()`, catch errors silently
    - Truncate to `MAX_README_LENGTH` if content exceeds limit
    - Set `textarea.value` to the content
    - Show autofill notice (`readme-autofill-notice` class) with `aria-live="polite"`
    - Show truncation warning (`readme-truncation-warning` class) with `role="alert"` if truncated
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 3.5 Wire autofill into `renderUploadForm()`
    - Attach a `change` event listener on the file input that calls `handleReadmeAutofill()`
    - Attach an `input` event listener on the readme textarea to clear the notice container when user edits
    - _Requirements: 4.1, 4.3_

  - [x] 3.6 Update existing frontend tests for new readme behavior
    - In `frontend/src/upload-form.test.ts`, update the tests "returns error when readme is empty" and "returns error when readme is only whitespace" to assert no readme error is returned
    - Update the "returns multiple errors simultaneously" test to not expect `errors.readme` when readme is empty
    - Add a test verifying the textarea does not have the `required` attribute after rendering
    - _Requirements: 1.1, 1.3_

- [x] 4. Checkpoint - Ensure all frontend and backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Property-based tests for validation
  - [ ]* 5.1 Write property test: frontend accepts empty/whitespace readme (Property 1)
    - **Property 1: Frontend accepts empty or whitespace-only readme**
    - Generate arbitrary whitespace-only strings; verify `validateForm` returns no `readme` error when name and files are valid
    - **Validates: Requirements 1.1**

  - [ ]* 5.2 Write property test: frontend rejects readme exceeding max length (Property 2)
    - **Property 2: Frontend rejects readme exceeding max length**
    - Generate strings with length 50,001–100,000; verify `validateForm` returns a `readme` error
    - **Validates: Requirements 1.2**

  - [ ]* 5.3 Write property test: backend accepts empty/whitespace/undefined readme (Property 3)
    - **Property 3: Backend accepts empty, whitespace-only, or undefined readme**
    - Generate `ParsedFormData` with valid name, files, and readme that is undefined/empty/whitespace; verify `validateRequest` returns null
    - **Validates: Requirements 2.1**

  - [ ]* 5.4 Write property test: backend rejects readme exceeding max length (Property 4)
    - **Property 4: Backend rejects readme exceeding max length**
    - Generate `ParsedFormData` with readme length > 50,000; verify `validateRequest` returns non-null error mentioning readme
    - **Validates: Requirements 2.2**

  - [ ]* 5.5 Write property test: backend accepts readme within valid bounds (Property 5)
    - **Property 5: Backend accepts readme within valid bounds**
    - Generate `ParsedFormData` with non-empty readme of length 1–50,000; verify `validateRequest` returns null
    - **Validates: Requirements 2.3**

- [ ] 6. Property-based tests for README detection and autofill
  - [ ]* 6.1 Write property test: README detection selects highest-priority root-level match (Property 6)
    - **Property 6: README detection selects highest-priority root-level match**
    - Generate file lists with varying paths, filenames (README case permutations, extensions), nesting depths; verify correct selection or null
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 6.2 Write property test: autofill populates textarea when empty (Property 7)
    - **Property 7: Autofill populates textarea when content is empty**
    - Generate FileList with valid root-level README and empty/whitespace textarea; verify textarea value is set to file content (up to max length)
    - **Validates: Requirements 4.1**

  - [ ]* 6.3 Write property test: autofill preserves existing non-whitespace content (Property 8)
    - **Property 8: Autofill preserves existing non-whitespace content**
    - Generate FileList with valid README and textarea with non-whitespace content; verify textarea value unchanged
    - **Validates: Requirements 4.2**

  - [ ]* 6.4 Write property test: autofill truncates content exceeding max length (Property 9)
    - **Property 9: Autofill truncates content exceeding max length**
    - Generate README file content longer than 50,000 chars; verify resulting textarea value is exactly 50,000 chars (first 50,000 of original)
    - **Validates: Requirements 4.4**

- [ ] 7. Unit tests for DOM/rendering behavior
  - [ ]* 7.1 Write unit tests for autofill UI behavior
    - Test: autofill notice element appears after README detection
    - Test: autofill notice disappears when user edits textarea
    - Test: truncation warning appears when content exceeds limit
    - Test: file read failure leaves textarea unchanged (no notice shown)
    - Test: no README in folder leaves textarea unchanged
    - Test: textarea remains editable after autofill
    - _Requirements: 3.4, 3.5, 4.3, 4.4, 4.5_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases for DOM behavior
- The `fast-check` library is already installed as a dev dependency
- Test files: `frontend/src/upload-form.test.ts` (frontend) and `lambda/src/handler.test.ts` (backend)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "3.6"] },
    { "id": 4, "tasks": ["3.5"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 7, "tasks": ["7.1"] }
  ]
}
```
