# Implementation Plan: UI/UX Overhaul

## Overview

This plan implements the frontend UX overhaul in dependency order: standalone utility modules first, then new components, then rewrites of existing modules, then integration into consuming modules, and finally CSS additions and build verification. All code is vanilla TypeScript with Vite; tests use vitest.

## Tasks

- [x] 1. Create utility modules (no dependencies)
  - [x] 1.1 Implement `frontend/src/relative-date.ts`
    - Create the `formatRelativeDate(isoDate: string): string` pure function
    - Use midnight-to-midnight day difference in local timezone
    - Implement all thresholds: "today", "yesterday", "N days ago", "1 week ago", "N weeks ago", "1 month ago", "N months ago", "1 year ago", "N years ago"
    - Return raw input string for invalid dates (`isNaN`) or future dates
    - Export the function as a named export
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 1.2 Write property tests for `relative-date.ts`
    - **Property 7: Relative date monotonicity** — For two valid past dates d1 < d2, the older date produces an equal or larger "ago" value
    - **Property 8: Relative date fallback** — Invalid or future date inputs return the raw string unchanged
    - **Validates: Requirements 6.1, 6.5**

  - [ ]* 1.3 Write unit tests for `relative-date.ts`
    - Test all threshold boundaries (0, 1, 2, 6, 7, 13, 14, 29, 30, 59, 60, 364, 365 days)
    - Test "today" and "yesterday" using local timezone
    - Test invalid date strings and future dates return raw input
    - _Requirements: 6.1, 6.3, 6.4, 6.5_

  - [x] 1.4 Implement `frontend/src/paginator.ts`
    - Create `createPaginator(options: PaginatorOptions): PaginatorAPI` factory function
    - Implement `PaginatorOptions` interface: `container`, `onPageChange`, `pageSize` (default 10), `maxButtons` (default 7)
    - Implement `PaginatorAPI` interface: `update(totalItems, currentPage?)`, `getCurrentPage()`, `getTotalPages()`, `getSliceRange()`, `destroy()`
    - Render prev/next buttons, up to 7 numbered page buttons with ellipsis logic, and "Page X of Y" text
    - Disable prev on first page, next on last page
    - Hide all controls when totalItems ≤ pageSize
    - Call `onPageChange` callback when user selects a page
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10_

  - [ ]* 1.5 Write property tests for `paginator.ts`
    - **Property 1: Pagination slice integrity** — For any page p (1 ≤ p ≤ totalPages), `getSliceRange()` returns correct start/end and `end - start ≤ pageSize`
    - **Property 2: Pagination completeness** — Union of all page slices equals the full result set, no items lost or duplicated
    - **Validates: Requirements 1.1, 1.4**

  - [ ]* 1.6 Write unit tests for `paginator.ts`
    - Test hiding controls when ≤ 10 items
    - Test ellipsis rendering for various page counts (≤7, >7 with current near start/middle/end)
    - Test prev disabled on page 1, next disabled on last page
    - Test `getSliceRange()` returns correct indices
    - _Requirements: 1.2, 1.3, 1.7, 1.8, 1.10_

- [x] 2. Create new components
  - [x] 2.1 Implement `frontend/src/drop-zone.ts`
    - Create `createDropZone(options: DropZoneOptions): DropZoneAPI` factory function
    - Implement `DropZoneOptions` interface: `container`, `onFiles`
    - Implement `DropZoneAPI` interface: `getFiles()`, `reset()`, `destroy()`
    - Render DOM structure: `div.drop-zone > div.drop-zone__content > p.drop-zone__text + p.drop-zone__summary[hidden] + input[type=file][hidden][webkitdirectory]`
    - Show instructional text when empty, file count summary after selection
    - Handle dragenter/dragover for hover state (`.drop-zone--drag-over` class)
    - Revert hover state on dragleave/drop within 150ms
    - On drop: extract files from DataTransferItemList, call `onFiles`
    - On click: trigger hidden file input, call `onFiles`
    - Feature-detect drag-and-drop; fall back to styled click-to-browse button
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 2.2 Write unit tests for `drop-zone.ts`
    - Test feature detection fallback path
    - Test that `reset()` clears file state and restores instructional text
    - Test file count summary display after files are provided
    - Mock DataTransfer for drop handling verification
    - **Property 6: Drop zone file parity** — Files via onFiles from drop are identical to click selection of the same folder
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7**

  - [x] 2.3 Implement `frontend/src/readme-preview.ts`
    - Create `createReadmePreview(options: ReadmePreviewOptions): ReadmePreviewAPI` factory function
    - Accept `container`, `markedInstance`, optional `textareaId`, `maxLength`, `placeholder`, `rows`
    - Implement `ReadmePreviewAPI`: `getValue()`, `setValue(content)`, `getTextarea()`, `setEditMode()`, `setPreviewMode()`, `getMode()`, `destroy()`
    - Render toggle control with `role="tablist"` / `role="tab"` pattern (Edit | Preview buttons)
    - Default to Edit mode (textarea visible, preview hidden)
    - On Preview: parse textarea with `marked.parse()`, display rendered HTML; escape embedded HTML tags
    - Show "Nothing to preview" placeholder when textarea is empty in Preview mode
    - Preserve textarea content across mode toggles
    - `getValue()` always reads from textarea regardless of current mode
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ]* 2.4 Write unit tests for `readme-preview.ts`
    - Test default mode is Edit
    - Test toggle switches between modes
    - Test `getValue()` returns textarea content in both modes
    - Test "Nothing to preview" placeholder when empty
    - **Property 5: Readme content preservation** — For all toggle sequences, `getValue()` returns the last textarea value unchanged
    - **Validates: Requirements 3.5, 3.7, 3.8, 3.9**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Rewrite existing modules
  - [x] 4.1 Rewrite `frontend/src/tag-filter.ts` as dropdown
    - Replace flat tag button list with collapsible dropdown containing checkboxes
    - Keep the same external interface (`TagFilterOptions`, `TagFilterAPI`, `createTagFilter`)
    - New DOM structure: `div.tag-filter-dropdown > button.tag-filter-toggle[aria-expanded] + div.tag-filter-panel[hidden] > ul.tag-filter-list[role=group] > li > label > input[type=checkbox] + span`
    - Toggle button shows/hides panel, sets `aria-expanded`
    - Panel has `max-height: 300px; overflow-y: auto`
    - Each checkbox fires `onFilterChange` with full list of checked tags
    - Show badge count in toggle text when filters active (e.g., "Filter by tags (3)")
    - Panel stays open while any child has focus (blur handler with `relatedTarget` check)
    - Keyboard: Enter/Space on toggle expands/collapses
    - On collapse, checked state is preserved
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [ ]* 4.2 Write unit tests for tag filter dropdown
    - Test toggle expand/collapse with aria-expanded
    - Test checkbox selection fires onFilterChange with correct tags
    - Test badge count updates in toggle text
    - Test keyboard activation (Enter/Space)
    - **Property 4: Tag filter AND-logic** — For any active tags T, every displayed result r satisfies T ⊆ r.tags
    - **Validates: Requirements 4.6, 4.9, 4.10**

- [x] 5. Integration tasks
  - [x] 5.1 Update `frontend/src/search.ts` — integrate paginator, relative dates, keyboard nav
    - Import `createPaginator` from `./paginator` and `formatRelativeDate` from `./relative-date`
    - In `setupSearch()`: create paginator instance in resultsContainer (after results list), wire `onPageChange` to re-render the visible slice
    - Modify `performSearch()`: call `paginator.update(filteredResults.length, 1)` to reset to page 1 on query/filter change
    - Slice results using `paginator.getSliceRange()` before passing to `renderResults()`
    - Add scroll-to-top on page change (scroll resultsContainer into view)
    - In `renderResults()`: add `<time>` element with `formatRelativeDate(item.date)`, `title=item.date`, `datetime=item.date` to each result card
    - In `renderResults()`: add `tabindex="0"`, `role="link"`, `aria-label="View project ${item.name}"` to each `<li>`
    - Add keydown listener on each `<li>`: Enter or Space navigates to `#/project/${encodeURIComponent(item.name)}`
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.9, 1.11, 6.1, 6.2, 7.1, 7.2, 7.3_

  - [ ]* 5.2 Write unit tests for search.ts integration
    - Test pagination resets to page 1 on search query change
    - Test pagination resets to page 1 on tag filter change
    - Test relative date is rendered on result cards
    - Test keyboard Enter/Space on result card triggers navigation
    - **Property 3: Filter reset on input change** — After any search query or tag filter toggle, paginator is on page 1
    - **Property 9: Keyboard activation equivalence** — Enter/Space on focused card produces same navigation as click
    - **Validates: Requirements 1.9, 7.3**

  - [x] 5.3 Update `frontend/src/upload-form.ts` — restructure layout, integrate drop-zone and readme-preview
    - Import `createDropZone` from `./drop-zone` and `createReadmePreview` from `./readme-preview`
    - Reorder form fields to: Drop Zone → Project Name → Tags → Submit Button → Readme (with preview toggle)
    - Replace the existing `createFileGroup` usage with `createDropZone` as the first form element
    - Wire `onFiles` callback to existing file processing logic (`filterFileList`, `handleReadmeAutofill`, autofill project name)
    - Replace the existing textarea group for readme with `createReadmePreview`, passing the shared `Marked` instance
    - On form submit: read readme value via `readmePreview.getValue()` (works regardless of current mode)
    - Position submit button after tags group (above readme), before the readme section
    - _Requirements: 2.1, 2.8, 3.1, 3.2, 3.5, 3.9_

  - [x] 5.4 Update `frontend/src/project-detail.ts` — add back navigation link
    - At the start of `renderProjectDetail()`, before any metadata fetch check, create and append the back link:
      ```typescript
      const backLink = document.createElement('a');
      backLink.href = '#/';
      backLink.className = 'back-link';
      backLink.textContent = '← Back to search';
      container.appendChild(backLink);
      ```
    - Ensure the back link renders even when metadata fetch fails (it's appended before the fetch)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 5.5 Write unit tests for project-detail.ts back navigation
    - Test back link is rendered as first child element
    - Test back link href is `#/`
    - **Property 10: Back link always renders** — The back link is in the DOM regardless of metadata fetch success or failure
    - **Validates: Requirements 5.4**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. CSS and final integration
  - [x] 7.1 Add all new CSS styles to `frontend/index.html`
    - Add Drop Zone styles (`.drop-zone`, `.drop-zone:hover`, `.drop-zone--drag-over`, `.drop-zone__text`, `.drop-zone__summary`)
    - Add Readme Preview Toggle styles (`.readme-toggle`, `.readme-toggle__btn`, `.readme-toggle__btn--active`, `.readme-preview-content`, `.readme-preview-placeholder`)
    - Add Tag Filter Dropdown styles (`.tag-filter-dropdown`, `.tag-filter-toggle`, `.tag-filter-panel`, `.tag-filter-list`, `.tag-filter-list label`)
    - Add Paginator styles (`.paginator`, `.paginator__btn`, `.paginator__btn--active`, `.paginator__btn:disabled`, `.paginator__info`, `.paginator__ellipsis`)
    - Add Result Card Date style (`.result-date`)
    - Add Result Card Focus styles (`.result-item:focus`, `.result-item:focus:not(:focus-visible)`, `.result-item:focus-visible`)
    - Add Back Link styles (`.back-link`, `.back-link:hover`)
    - All CSS as specified in the design document's CSS Additions section
    - _Requirements: 2.3, 4.5, 7.4_

  - [x] 7.2 Final build verification
    - Run `tsc` to ensure no type errors across all new and modified files
    - Run `vite build` to verify the production bundle builds successfully
    - Verify no unused imports or missing module references
    - _Requirements: All_

- [x] 8. Final checkpoint - Ensure all tests pass and build succeeds
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The tag-filter.ts rewrite preserves the same external interface, so search.ts integration can proceed without breaking changes
- All new modules use the factory function pattern consistent with existing code (tag-filter.ts, tag-selector.ts)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5", "1.6", "2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.4"] },
    { "id": 4, "tasks": ["5.1", "5.3", "5.5"] },
    { "id": 5, "tasks": ["5.2", "7.1"] },
    { "id": 6, "tasks": ["7.2"] }
  ]
}
```
