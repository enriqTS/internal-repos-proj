# Implementation Plan: UI Consistency Improvements

## Overview

Extract shared markdown rendering into a common module, update both detail pages to use it, unify download button accessibility attributes, and add property-based tests for the correctness properties defined in the design.

## Tasks

- [x] 1. Create shared markdown module
  - [x] 1.1 Create `frontend/src/shared-markdown.ts` with configured Marked instance, `renderReadmeSection()`, and `renderReadmeError()`
    - Export a `Marked` instance configured with `markedHighlight` and highlight.js (`hljs language-` prefix, auto-detection fallback)
    - `renderReadmeSection(htmlContent: string, contextClass: string)` returns a `<section class="{contextClass}">` containing a `<div class="readme-content">` with the HTML, or a placeholder message if content is empty/whitespace
    - `renderReadmeError(message: string)` returns a `<p class="error-message">` with the given message
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 4.1, 4.3, 4.4_

- [x] 2. Update template detail page to use shared module
  - [x] 2.1 Refactor `frontend/src/template-detail.ts` to import from `./shared-markdown`
    - Remove the local `Marked` import, `markedHighlight` import, `hljs` import, and the local `marked` instance
    - Import `marked`, `renderReadmeSection`, `renderReadmeError` from `./shared-markdown`
    - Replace inline readme section DOM construction with `renderReadmeSection(readmeHtml, 'template-readme')`
    - Replace inline error element construction with `renderReadmeError('Template documentation is unavailable')`
    - Remove the now-unused local `renderReadmeSection` and `renderReadmeError` functions
    - _Requirements: 3.3, 4.2_

- [x] 3. Update project detail page to use shared module and fix download button
  - [x] 3.1 Refactor `frontend/src/project-detail.ts` to import from `./shared-markdown`
    - Remove the local `Marked` import, `markedHighlight` import, `hljs` import, and the local `marked` instance
    - Import `marked`, `renderReadmeSection`, `renderReadmeError` from `./shared-markdown`
    - Replace inline readme section DOM construction with `renderReadmeSection(readmeHtml, 'project-readme')`
    - Replace inline readme error with `renderReadmeError('Documentation is unavailable')`
    - _Requirements: 3.1, 3.3, 3.5, 4.2_

  - [x] 3.2 Add `aria-label` and `download` attribute to the project download button in `renderDownloadSection()`
    - On the enabled `<a>` element, set `aria-label` to `Download {projectName} project zip archive` and `download` attribute to `{projectName}.zip`
    - Extract the project name from the path for use in the attributes
    - Ensure the disabled `<span>` state retains `aria-disabled="true"` and adjacent unavailable message
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

- [x] 4. Update readme-preview to use shared Marked instance
  - [x] 4.1 Refactor `frontend/src/readme-preview.ts` to import `marked` from `./shared-markdown`
    - Remove the `markedInstance` field from `ReadmePreviewOptions` interface
    - Import `marked` from `./shared-markdown`
    - Replace all uses of `options.markedInstance` with the imported `marked`
    - Remove the `Marked` type import if no longer needed
    - _Requirements: 3.4, 4.2, 4.3_

  - [x] 4.2 Update all callers of `createReadmePreview()` to stop passing `markedInstance`
    - Search for all usages of `createReadmePreview` and remove the `markedInstance` argument
    - Verify no TypeScript compilation errors remain
    - _Requirements: 4.2_

- [x] 5. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Property-based tests for shared markdown module
  - [ ]* 6.1 Set up fast-check dependency and test file `frontend/src/shared-markdown.test.ts`
    - Install `fast-check` as a dev dependency
    - Create the test file with Vitest and jsdom environment config
    - _Requirements: 4.1_

  - [ ]* 6.2 Write property test: Download button accessibility contract
    - **Property 1: Download button accessibility contract**
    - For any non-empty resource name, the rendered download button has a `download` attribute, an `aria-label` containing the name and "download" (case-insensitive), and visible text starting with "Download"
    - Test both `renderDownloadButton` from template-detail and the project download link rendering
    - **Validates: Requirements 1.3**

  - [ ]* 6.3 Write property test: Download button href construction
    - **Property 2: Download button href construction**
    - For any non-empty resource name and base URL, the enabled download button is an `<a>` with href equal to `{baseUrl}/templates/{name}/artifact.zip` (templates) or `{baseUrl}/{path}artifact.zip` (projects)
    - **Validates: Requirements 1.5**

  - [ ]* 6.4 Write property test: Readme render function structure contract
    - **Property 3: Readme render function structure contract**
    - For any non-empty, non-whitespace HTML string and any context class string, `renderReadmeSection(html, contextClass)` returns a `<section>` with the given class containing a `<div class="readme-content">` whose innerHTML equals the input
    - **Validates: Requirements 3.1, 4.4**

  - [ ]* 6.5 Write property test: Syntax highlighting configuration
    - **Property 4: Syntax highlighting configuration**
    - For any markdown with a fenced code block using a recognized language, parsing with the shared Marked instance produces a `<code>` element with class matching `hljs language-{lang}`
    - **Validates: Requirements 3.4**

  - [ ]* 6.6 Write property test: Empty/whitespace content shows placeholder
    - **Property 5: Empty/whitespace content shows placeholder**
    - For any string composed entirely of whitespace (including empty string), `renderReadmeSection(whitespaceStr, contextClass)` returns an element containing a placeholder message rather than rendered whitespace
    - **Validates: Requirements 3.6**

- [ ] 7. Unit tests for consistency verification
  - [ ]* 7.1 Write unit tests in `frontend/src/shared-markdown.test.ts` for cross-page consistency
    - Verify both pages produce download buttons with class `download-link`
    - Verify disabled state renders as `<span>` with `aria-disabled="true"` and adjacent message
    - Verify error fallback structure (`<p class="error-message">`) matches across pages
    - _Requirements: 1.1, 1.4, 2.4, 3.5_

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The shared module approach ensures a single Marked instance across the entire frontend

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2"] },
    { "id": 2, "tasks": ["4.1", "4.2"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "7.1"] }
  ]
}
```
