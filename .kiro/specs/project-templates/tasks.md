# Implementation Plan: Project Templates

## Overview

This plan implements the project templates feature in incremental steps: infrastructure first (Terraform S3 bucket + CloudFront origin), then shared types, API layer, reusable card grid component, templates page with search/filter/pagination, template detail page, navigation update, and finally converting the existing project list to use the shared card grid.

## Tasks

- [x] 1. Infrastructure — Template S3 bucket and CloudFront origin
  - [x] 1.1 Provision the templates S3 bucket with OAC and CloudFront cache behaviors
    - Add `aws_s3_bucket.templates` with naming `{bucket_name_prefix}-templates`, all public access blocks enabled, and tags `Project = "internal-repos"`, `Name = "internal-repos-templates"`
    - Add `aws_cloudfront_origin_access_control.templates` (type S3, signing always, sigv4)
    - Add `aws_s3_bucket_policy.templates` granting `s3:GetObject` to `cloudfront.amazonaws.com` conditioned on the distribution ARN
    - Add a second origin to `aws_cloudfront_distribution.frontend` pointing to the templates bucket with the new OAC
    - Add ordered cache behaviors: `templates-index.json` → templates origin (TTL 0/0/0), `templates/*/metadata.json` → templates origin (TTL 0/0/0), `templates/*` → templates origin (default caching)
    - Ensure CloudFront does NOT apply custom error responses (SPA fallback) to `templates/*` paths — errors from the templates bucket return the original status code
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 2. Shared types — Template data model
  - [x] 2.1 Define TemplateIndexEntry, TemplateIndex, and TemplateMetadata types in shared/src/types.ts
    - Add `TemplateIndexEntry` interface with `name` (string, 1–64 chars, `^[a-zA-Z0-9_-]+$`), `description` (string, 0–200 chars), `tags` (string[], 0–50 items, each 1–32 chars `^[a-z0-9_-]+$`), `date` (string, ISO 8601 "YYYY-MM-DD"), `path` (string, prefix `templates/{name}/`)
    - Add `TemplateIndex` type as `TemplateIndexEntry[]`
    - Add `TemplateMetadata` interface with same fields as `TemplateIndexEntry` plus optional `language` (string, 0–64 chars)
    - Export all three types
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.2 Write property test for template data validation (Property 1)
    - **Property 1: Template data validation accepts valid entries and rejects invalid ones**
    - Create `shared/src/template-validation.test.ts`
    - Write a validation function and use fast-check generators for valid/invalid `TemplateIndexEntry` objects
    - **Validates: Requirements 3.1, 3.3**

- [x] 3. Frontend API — fetchTemplateIndex function
  - [x] 3.1 Implement fetchTemplateIndex in frontend/src/api.ts
    - Add `fetchTemplateIndex(): Promise<ApiResult<TemplateIndex>>` that fetches `templates-index.json` from CDN base URL
    - Handle success (2xx + JSON content-type) → parse and return data
    - Handle missing file (non-JSON content-type, text not starting with `[`) → return `{ ok: true, data: [] }`
    - Handle HTTP error (non-2xx) → return `{ ok: false, error: "Failed to load template index (HTTP {status})" }`
    - Handle network error → return `{ ok: false, error: "Failed to load template index: {message}" }`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 3.2 Write property test for fetchTemplateIndex parse round-trip (Property 4)
    - **Property 4: fetchTemplateIndex parse round-trip**
    - Extend `frontend/src/api.test.ts` with fast-check generators for valid `TemplateIndex` arrays
    - Mock fetch to return generated arrays as JSON with 200 + application/json content-type
    - Assert `fetchTemplateIndex` returns `{ ok: true, data }` deeply equal to the input
    - **Validates: Requirements 6.2**

  - [ ]* 3.3 Write property test for error response handling (Property 5)
    - **Property 5: Error responses preserve error information**
    - Extend `frontend/src/api.test.ts` with fast-check generators for non-2xx status codes and network error messages
    - Assert error string contains numeric status code or error message respectively
    - **Validates: Requirements 6.4, 6.5**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Card grid component — Shared renderer for projects and templates
  - [x] 5.1 Create renderCardGrid utility in frontend/src/card-grid.ts
    - Define `CardGridOptions` interface: `container`, `onCardActivate`, optional `breakpoints` (sm/md), optional `ariaLabelPrefix`
    - Define `CardItem` interface: `name`, `description`, `tags`, `date`
    - Implement `renderCardGrid(items: CardItem[], options: CardGridOptions): void` that renders a responsive card grid
    - Each card: displays name, description (CSS 2-line clamp with ellipsis), tags, relative date
    - Each card: `tabindex="0"`, `role="link"`, `aria-label` containing the item name with prefix
    - Each card: click handler and Enter/Space keydown handler invoke `onCardActivate`
    - Responsive columns via CSS classes: 1 col below sm breakpoint, 2 cols sm–md, 3 cols at md+
    - Show "No results found" message when items array is empty
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 5.2 Write property test for card grid rendering (Property 6)
    - **Property 6: Card grid renders all required fields for every item**
    - Create `frontend/src/card-grid.test.ts`
    - Use fast-check to generate arrays of `CardItem` objects
    - Assert one card element per item, each containing name text, tag elements, and date element
    - **Validates: Requirements 7.2, 8.2**

  - [ ]* 5.3 Write property test for card grid accessibility (Property 7)
    - **Property 7: Card grid accessibility attributes**
    - Extend `frontend/src/card-grid.test.ts`
    - Assert each card has `tabindex="0"`, `role="link"`, and `aria-label` containing the item name
    - **Validates: Requirements 7.3, 8.3**

  - [ ]* 5.4 Write property test for card activation navigation (Property 8)
    - **Property 8: Card activation navigates to correct route**
    - Extend `frontend/src/card-grid.test.ts`
    - Generate card items and a navigation prefix, simulate click/keypress, assert `window.location.hash` is set to prefix + `encodeURIComponent(name)`
    - **Validates: Requirements 7.4, 8.4**

- [x] 6. Templates page — Route, search, tag filter, paginator
  - [x] 6.1 Implement the templates page in frontend/src/templates-page.ts
    - Create the `#/templates` route handler function
    - Fetch template index via `fetchTemplateIndex()`; show loading state during fetch
    - On success with entries: initialize Fuse.js instance (keys: name, description, tags; threshold: 0.4), render search input (placeholder "Search templates by name, description, or tags…", aria-label), tag filter, card grid, and paginator (10 items/page)
    - On empty index: show "No templates available yet", hide search/filter/paginator
    - On fetch error: show error message + retry button that re-invokes the fetch
    - Wire debounced search (200ms) to filter results and reset paginator to page 1
    - Wire tag filter with AND-logic to card grid results
    - Empty query returns all templates sorted by date descending
    - No results state: display "No results found" message
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 6.2 Write property test for tag filter AND-logic (Property 2)
    - **Property 2: Tag filter AND-logic correctness**
    - Create `frontend/src/templates-page.test.ts`
    - Use fast-check to generate template arrays and active filter tag sets
    - Assert filtered results contain only entries whose tags include every active filter tag
    - **Validates: Requirements 5.3**

  - [ ]* 6.3 Write property test for empty query sorting (Property 3)
    - **Property 3: Empty query returns all templates sorted by date descending**
    - Extend `frontend/src/templates-page.test.ts`
    - Generate non-empty template indices, invoke search with empty query
    - Assert all entries present and ordered by date descending
    - **Validates: Requirements 5.4**

- [x] 7. Template detail page — Route + metadata display
  - [x] 7.1 Implement template detail page in frontend/src/template-detail.ts
    - Register route `#/template/{name}` (regex with named `name` group)
    - If name param is empty/missing: show "No template was specified" error
    - Fetch `templates/{name}/metadata.json` via CDN
    - On success: display name, description, tags, date; if `language` field present, display it
    - On fetch error: display "Template details are unavailable" + back link to `#/templates`
    - Include a back-navigation link to `#/templates`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 7.2 Write property test for template detail metadata display (Property 9)
    - **Property 9: Template detail displays all metadata fields**
    - Create `frontend/src/template-detail.test.ts`
    - Generate valid `TemplateMetadata` objects with fast-check (including optional language)
    - Assert rendered view contains name, description, each tag, date, and language when present
    - **Validates: Requirements 9.3**

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Navigation update — Projects/Templates/Upload links with active state
  - [x] 9.1 Update navigation in index.html and main.ts
    - In `index.html`: replace "Search" nav link with "Projects" (href `#/`), add "Templates" link (href `#/templates`), keep "Upload" link (href `#/upload`)
    - In `main.ts`: add logic to update active nav link class on route change (listen to `hashchange`)
    - Active style applied to "Projects" when hash is `/` or starts with `/project/`
    - Active style applied to "Templates" when hash starts with `/templates`
    - Ensure all nav links remain keyboard-focusable
    - Active indicator updates within the hashchange event (no full page reload)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 9.2 Write property test for navigation active state (Property 10)
    - **Property 10: Navigation active state matches route prefix**
    - Create `frontend/src/nav-active.test.ts`
    - Generate route hashes with fast-check, assert active style applied to correct link
    - Assert exactly one nav link has active style at any time
    - **Validates: Requirements 10.2**

- [x] 10. Convert existing project list to card grid
  - [x] 10.1 Refactor search.ts to use renderCardGrid for project results
    - Replace the `renderResults` function's `ul.results-list` layout with `renderCardGrid`
    - Pass `ariaLabelPrefix: "View project"` and `breakpoints: { sm: 640, md: 1024 }`
    - Wire `onCardActivate` to navigate to `#/project/${encodeURIComponent(item.name)}`
    - Ensure paginator integration still works (pass sliced results to card grid)
    - Maintain "No results found" message for zero-result state
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 11. Route registration — Wire templates routes into main.ts
  - [x] 11.1 Register templates page and template detail routes in main.ts
    - Import the templates page handler from `templates-page.ts`
    - Import the template detail handler from `template-detail.ts`
    - Add route `{ pattern: /^\/templates$/, handler: renderTemplatesPage }` to the routes array
    - Add route `{ pattern: /^\/template\/(?<name>[^/]+)$/, handler: renderTemplateDetail }` to the routes array
    - Ensure route order is correct (more specific patterns before generic ones)
    - _Requirements: 4.1, 4.2, 9.1_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check (already a dev dependency)
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all code should be TypeScript
- The card grid component is shared between projects and templates pages to avoid duplication
- Infrastructure changes (task 1.1) require awareness of CloudFront's custom error response behavior — templates paths must NOT get the SPA fallback

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 5, "tasks": ["7.2", "9.1"] },
    { "id": 6, "tasks": ["9.2", "10.1", "11.1"] }
  ]
}
```
