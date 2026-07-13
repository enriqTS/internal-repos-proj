# Implementation Plan: Template Content

## Overview

Extend the template detail page to display architecture diagrams, rendered markdown readmes, and a download button. Add the optional `architectureImage` field to shared types, a new API function for fetching readme content, and rewrite the template-detail renderer with proper layout ordering. Property-based tests validate URL construction, image resolution logic, accessibility attributes, and page structure.

## Tasks

- [x] 1. Extend shared types and API layer
  - [x] 1.1 Add `architectureImage` field to TemplateMetadata and TemplateIndexEntry
    - In `shared/src/types.ts`, add the optional field `architectureImage?: 'architecture.png' | 'architecture.svg'` to both `TemplateMetadata` and `TemplateIndexEntry` interfaces
    - Add JSDoc comment explaining the field's purpose
    - _Requirements: 7.1, 7.4_

  - [x] 1.2 Add `fetchTemplateReadme` function to the API module
    - In `frontend/src/api.ts`, implement `fetchTemplateReadme(name: string): Promise<ApiResult<string>>`
    - Construct URL as `{baseUrl}/templates/{name}/readme.md`
    - Return `{ ok: true, data: text }` on success, `{ ok: false, error: message }` on failure
    - Follow the same error handling pattern as `fetchProjectReadme`
    - _Requirements: 3.1_

- [x] 2. Rewrite template-detail page with full content rendering
  - [x] 2.1 Set up markdown rendering and imports in template-detail.ts
    - Import `Marked`, `markedHighlight`, and `hljs` — replicate the same marked configuration from `project-detail.ts`
    - Import `fetchTemplateReadme` from `./api`
    - Add a `getBaseUrl()` helper (same pattern as project-detail.ts)
    - _Requirements: 3.2, 3.4_

  - [x] 2.2 Implement architecture image resolution function
    - Create `resolveArchitectureImageUrl(name: string, metadata: TemplateMetadata): Promise<string | null>`
    - If `metadata.architectureImage` is `"architecture.png"` or `"architecture.svg"`, construct the direct URL and HEAD-check it; return URL if ok, null otherwise
    - If `metadata.architectureImage` is absent or any other value, try PNG first (HEAD), then SVG (HEAD); return first successful URL or null
    - _Requirements: 4.1, 7.2, 7.3, 7.5, 7.6_

  - [x] 2.3 Implement download button rendering
    - Create `renderDownloadButton(name: string): HTMLElement` that returns an anchor element
    - Set `href` to `{baseUrl}/templates/{name}/artifact.zip`
    - Set `download` attribute to `{name}.zip`
    - Set `aria-label` to `"Download {name} template zip archive"`
    - Set visible text to "Download Template"
    - Ensure the element is keyboard-accessible (anchor elements are by default)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.4 Implement architecture image rendering
    - Create `renderArchitectureSection(imageUrl: string, name: string): HTMLElement`
    - Render an `<img>` with `alt="Architecture diagram for {name}"` and `style="max-width:100%"`
    - Wrap in an `<a>` with `href` pointing to the image URL, `target="_blank"`, `rel="noopener noreferrer"`, and `aria-label="View full-size architecture diagram for {name}"`
    - Add an `onerror` handler on the `<img>` that removes the entire architecture section from the DOM
    - _Requirements: 4.2, 4.4, 4.5_

  - [x] 2.5 Implement readme section rendering
    - Create `renderReadmeSection(readmeHtml: string): HTMLElement`
    - Return a `<section>` containing a `<div class="readme-content">` with the rendered HTML
    - If readme fetch failed, render a `<p class="error-message">Template documentation is unavailable</p>` instead
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 2.6 Rewrite `renderTemplateDetail` to compose all sections in correct order
    - Keep existing empty-name guard and back-link rendering
    - After metadata fetch succeeds: render h1 (template name), metadata section (tags as `<span class="tag">`, `<time>` with `datetime` and `formatRelativeDate`, language paragraph if present), download button, architecture image (if resolved), readme section
    - If metadata fetch fails: show "Template details are unavailable" error + back link only, no download button
    - Fetch readme in parallel with architecture image resolution for performance
    - _Requirements: 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 4.3_

- [x] 3. Checkpoint - Verify build passes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Unit tests for template detail page
  - [x] 4.1 Write unit tests for template-detail rendering
    - Create/extend `frontend/src/template-detail.test.ts`
    - Test: successful render shows metadata, download button, architecture image, and readme
    - Test: metadata fetch failure renders error message and no download button
    - Test: readme fetch failure renders fallback text "Template documentation is unavailable" but rest of page still renders
    - Test: both image fetches fail → no architecture section in DOM
    - Test: image onerror removes architecture section
    - Test: empty/missing template name shows "No template was specified"
    - Test: download anchor has correct `href`, `download`, and `aria-label` attributes
    - Test: `architectureImage` field in metadata uses direct URL without fallback
    - Test: invalid `architectureImage` value triggers fallback strategy
    - Test: no edit/delete controls rendered on template detail page
    - Mock fetch responses using `vi.fn()` pattern from existing project-detail.test.ts
    - _Requirements: 3.3, 4.3, 4.5, 5.3, 5.4, 5.5, 8.1, 9.1, 9.2_

- [ ] 5. Property-based tests for template content
  - [ ]* 5.1 Write property test for URL construction correctness
    - **Property 1: URL construction correctness**
    - Generate random valid template names (1–64 chars matching `/^[a-zA-Z0-9_-]+$/`)
    - Assert all constructed CDN URLs follow `{baseUrl}/templates/{name}/{file}` pattern
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 1.1, 3.1, 5.2, 5.3**

  - [ ]* 5.2 Write property test for template metadata validation
    - **Property 2: Template metadata validation**
    - Generate arbitrary JSON objects and valid/invalid metadata
    - Assert validation accepts valid metadata and rejects invalid metadata
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 1.2, 6.5, 7.1**

  - [ ]* 5.3 Write property test for architecture image resolution logic
    - **Property 3: Architecture image resolution logic**
    - Generate valid template names and TemplateMetadata with various `architectureImage` values
    - Assert: present field → single URL constructed; absent/invalid field → PNG then SVG fallback; failed fetch → null
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 4.1, 7.2, 7.3, 7.6**

  - [ ]* 5.4 Write property test for accessibility attributes
    - **Property 4: Accessibility attributes derived from template name**
    - Generate valid template names
    - Assert rendered elements contain correct alt text, aria-labels, and download attribute values derived from the name
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 4.2, 4.4, 5.3, 5.4**

  - [ ]* 5.5 Write property test for markdown rendering
    - **Property 5: Markdown rendering produces HTML in correct container**
    - Generate non-empty markdown strings
    - Assert rendering produces non-empty HTML inside a `<div class="readme-content">`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 3.2, 3.4**

  - [ ]* 5.6 Write property test for AND-logic tag filtering
    - **Property 6: AND-logic tag filtering**
    - Generate arrays of template index entries with random tags and random filter selections
    - Assert filtered results contain only entries whose tags include every selected filter tag
    - Assert presented tag list is the unique alphabetically-sorted set of all tags
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 6.2, 6.3**

  - [ ]* 5.7 Write property test for detail page render structure
    - **Property 7: Template detail page render structure**
    - Generate valid TemplateMetadata objects
    - Assert rendered page has elements in correct order: back-link, h1, metadata, download, architecture (if present), readme
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementations use TypeScript
- fast-check must be installed as a dev dependency before running property tests
- Vitest with jsdom environment is already configured in the project
- The existing `template-detail.ts` already handles back-link and metadata — task 2.6 extends it rather than starting from scratch

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 2, "tasks": ["2.6"] },
    { "id": 3, "tasks": ["4.1", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7"] }
  ]
}
```
