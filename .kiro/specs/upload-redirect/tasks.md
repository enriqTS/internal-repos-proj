# Implementation Plan: Upload Redirect

## Overview

Replace the success handling block (step 7) in the upload form's submit handler with `invalidateSearchIndex(); window.location.hash = '#/';` so that after a successful upload the user is immediately redirected to the project list. Update the existing test suite to verify the new behavior.

## Tasks

- [x] 1. Modify upload form success handling
  - [x] 1.1 Replace the success block in the submit handler with redirect logic
    - In `frontend/src/upload-form.ts`, locate step 7 ("Success") in the `form.addEventListener('submit', ...)` handler
    - Remove the status message assignment, success CSS class, button re-enable, and `form.reset()` call
    - Replace with: `invalidateSearchIndex(); window.location.hash = '#/';`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Update existing tests
  - [x] 2.1 Update the success test to verify redirect behavior
    - In `frontend/src/upload-form.test.ts`, modify the test "shows success message on successful upload (initiate → S3 → finalize)"
    - Change assertions to verify `window.location.hash === '#/'`
    - Verify `invalidateSearchIndex()` was called (mock `search-state` module)
    - Verify the status element does NOT contain a success message or success CSS class
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.2 Update the "disables submit button during upload" test
    - After the S3 upload resolves and finalize completes, the button is no longer re-enabled (page navigates away)
    - Adjust the post-upload assertions: remove the check for `submitBtn.disabled === false` and `submitBtn.textContent === 'Upload Project'` after success, or verify the redirect occurred instead
    - _Requirements: 1.4_

  - [x]* 2.3 Add a test verifying `form.reset()` is not called on success
    - Spy on `form.reset` and assert it was not called after a successful upload flow
    - _Requirements: 1.4_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The design has no correctness properties section — property-based tests are not applicable for this minimal control-flow change
- Error handling paths remain completely unchanged and are already covered by existing tests (initiate failure, S3 failure, finalize failure, oversized zip, all files filtered)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] }
  ]
}
```
