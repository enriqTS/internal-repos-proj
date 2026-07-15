# Implementation Plan

## Overview

Implementation plan for fixing six UX defects in the Internal Repos portal: incorrect template dates, hidden exact dates, truncated project names, registry-only AI tag suggestions, new-tab architecture images, and missing upload button on projects page. Follows the exploratory bugfix workflow: write bug condition tests first (expect failure), write preservation tests (expect pass), implement fixes, then verify all tests pass.

## Tasks

- [ ] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - UX Defects Exist in Unfixed Code
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each bug exists
  - **Scoped PBT Approach**: Scope properties to concrete failing cases for reproducibility
  - Test 1a: Load `templates/chatbot-rag-agentcore/metadata.json` and assert `date` field is `"2026-07-14"` (will FAIL — confirms typo `2025-07-14` exists)
  - Test 1b: Render a card-grid item and assert the visible date text contains the ISO date string (will FAIL — confirms date is hidden in title attribute only)
  - Test 1c: Check card-grid injected CSS and assert `.card-grid-item` does NOT have `aspect-ratio: 1` and `.card-grid-item__name` does NOT have `white-space: nowrap` (will FAIL — confirms truncation CSS exists)
  - Test 1d: Call `renderSearchView` for projects page and assert an upload button/link to `#/upload` exists in rendered DOM (will FAIL — confirms missing upload affordance)
  - Test 1e: Call `renderArchitectureSection` and assert no `<a target="_blank">` wraps the image (will FAIL — confirms new-tab behavior)
  - Test 1f: Call `suggestTagsFromReadme` with a README that would generate novel tags and assert `newTags` field is present in response (will FAIL — confirms registry-only filtering)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: All tests FAIL (this is correct - it proves the bugs exist)
  - Document counterexamples found to understand each root cause
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 2. Write preservation property tests (BEFORE implementing fixes)
  - **Property 2: Preservation** - Existing Behaviors Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs:
  - Observe: Templates other than `chatbot-rag-agentcore`/`chatbot-rag-mantle` display correct relative dates
  - Observe: Short project names render on a single line without wrapping
  - Observe: Tags that exist in the registry are returned correctly by `suggestTagsFromReadme`
  - Observe: Architecture image `onerror` handler removes the section from DOM
  - Observe: Direct navigation to `#/upload` renders the upload form
  - Observe: Responsive grid breakpoints (1/2/4 cols) are maintained
  - Observe: Manual tag creation via "Add new tag" input works with existing validation
  - Write property-based tests capturing observed behavior patterns:
  - Property: For all templates NOT in `["chatbot-rag-agentcore", "chatbot-rag-mantle"]`, their metadata dates are preserved unchanged
  - Property: For all project names shorter than card width, name renders on a single line
  - Property: For all tags that exist in the registry, `suggestTagsFromReadme` continues to return them
  - Property: `fetchTagRegistry()` continues to call the CDN URL without modification
  - Property: `renderSearchView` for non-projects-page routes preserves existing layout
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [ ] 3. Fix Bug 1 — Date typo in metadata files

  - [ ] 3.1 Fix the date typo in metadata.json files
    - In `templates/chatbot-rag-agentcore/metadata.json`: change `"2025-07-14"` to `"2026-07-14"`
    - In `templates/chatbot-rag-mantle/metadata.json`: change `"2025-07-14"` to `"2026-07-14"`
    - _Bug_Condition: isBugCondition(input) where input.templateName IN ["chatbot-rag-agentcore", "chatbot-rag-mantle"] AND date == "2025-07-14"_
    - _Expected_Behavior: Templates show correct relative date based on "2026-07-14"_
    - _Preservation: Other templates' dates remain unchanged_
    - _Requirements: 2.1, 3.1_

- [ ] 4. Fix Bug 2 — Show exact dates visibly in card grid

  - [ ] 4.1 Update date rendering in card-grid.ts
    - Change date `textContent` from `formatRelativeDate(item.date)` to `"${formatRelativeDate(item.date)} · ${item.date}"`
    - Remove the `title` attribute on the `<time>` element (exact date is now visible inline)
    - _Bug_Condition: isBugCondition(input) where input.type == "view_card" AND exactDateVisible == false_
    - _Expected_Behavior: Card date text contains both relative and ISO date portions_
    - _Preservation: Template detail page date display unchanged (uses separate rendering)_
    - _Requirements: 2.2, 3.2_

- [ ] 5. Fix Bug 3 — Allow long names to wrap in card grid

  - [ ] 5.1 Update card CSS in card-grid.ts
    - Remove `aspect-ratio: 1` from `.card-grid-item`
    - Remove `overflow: hidden` from `.card-grid-item`
    - Replace `.card-grid-item__name` styles: remove `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
    - Add to `.card-grid-item__name`: `display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden`
    - _Bug_Condition: isBugCondition(input) where input.projectName.length > cardWidth AND nameIsTruncated_
    - _Expected_Behavior: Name wraps to multiple lines (up to 3 with line-clamp) instead of ellipsis truncation_
    - _Preservation: Short names continue to display on a single line; responsive grid layout (1/2/4 cols) unchanged_
    - _Requirements: 2.3, 3.3, 3.7_

- [ ] 6. Fix Bug 5 — Add upload button to projects page

  - [ ] 6.1 Add upload affordance to renderSearchView in main.ts
    - Wrap existing `<h2>` heading in a flex container (`display: flex; align-items: center; justify-content: space-between`)
    - Add an upload button/link (`<a href="#/upload">`) styled similar to `.upload-submit` (accent color, mono font)
    - _Bug_Condition: isBugCondition(input) where input.type == "view_projects_page" AND noUploadButtonVisible_
    - _Expected_Behavior: Projects page renders a visible upload button that navigates to #/upload_
    - _Preservation: Direct navigation to #/upload continues to render the upload form; existing nav items unchanged_
    - _Requirements: 2.6, 3.6_

- [ ] 7. Fix Bug 4 — Lightbox for architecture images

  - [ ] 7.1 Implement showImageLightbox function in template-detail.ts
    - Create overlay div with `role="dialog"`, `aria-modal="true"`, reuse existing overlay pattern (`.delete-dialog-overlay`)
    - Add close button (×) with `aria-label="Close"`
    - Add `<img>` with `max-width: 90vw; max-height: 90vh; object-fit: contain`
    - Add click-outside-to-close on overlay background
    - Add Escape key listener to close
    - _Requirements: 2.5_

  - [ ] 7.2 Replace anchor with lightbox trigger in renderArchitectureSection
    - Remove `<a href target="_blank" rel="noopener noreferrer">` wrapper
    - Replace with clickable element that calls `showImageLightbox(imageUrl, name)`
    - Maintain `aria-label="View full-size architecture diagram for {name}"` on the trigger
    - _Bug_Condition: isBugCondition(input) where input.type == "click_architecture_image" AND opensNewTab_
    - _Expected_Behavior: Click opens in-page modal/lightbox with close mechanisms instead of new tab_
    - _Preservation: Image onerror handler continues to remove architecture section on load failure_
    - _Requirements: 2.5, 3.5_

- [ ] 8. Fix Bug 6 — AI new tag suggestions (Lambda + types + frontend)

  - [ ] 8.1 Update SuggestTagsResponse type in shared/src/types.ts
    - Add `newTags?: string[]` field to the `SuggestTagsResponse` interface
    - _Requirements: 2.4_

  - [ ] 8.2 Update suggest-tags.ts Lambda handler
    - Modify the AI prompt to allow suggesting up to 3 new tags not in registry (instruct model to return `{tags: [...], newTags: [...]}`)
    - Parse `newTags` from the AI response in addition to `tags`
    - Validate new tags against `TAG_PATTERN` and `MAX_TAG_LENGTH`
    - Cap `newTags` at 3 items
    - Return both `tags` (registry-existing) and `newTags` (new suggestions) in the response
    - _Bug_Condition: isBugCondition(input) where input.type == "suggest_tags" AND aiSuggestsNewTag AND newTagFilteredOut_
    - _Expected_Behavior: Response includes newTags field with validated new tag suggestions_
    - _Preservation: Tags that exist in registry are still returned correctly in `tags` field; addTagsToRegistry() still persists manually-created new tags_
    - _Requirements: 2.4, 2.7, 3.4, 3.9_

  - [ ] 8.3 Update tag-selector.ts to support AI-suggested new tags
    - Add method to accept new AI-suggested tags that don't exist in `availableTags`
    - Add them to `availableTags`, mark as selected, track in `newTags` set, and mark as suggested
    - _Preservation: Manual tag creation via "Add new tag" input continues working with existing validation_
    - _Requirements: 2.4, 3.8_

  - [ ] 8.4 Update upload-form.ts to handle newTags from suggestion response
    - Handle both `tags` and `newTags` from the suggestion API response
    - Apply existing tags via `tagSelector.applySuggestions(result.data.tags)`
    - Apply new tags via the new tag-selector method for AI-suggested new tags
    - _Requirements: 2.4_

  - [ ] 8.5 Remove tags.json from repo and update .gitignore
    - Delete `tags.json` from repository root
    - Add `tags.json` to `.gitignore`
    - CI/CD "Ensure tag registry exists" step remains unchanged (creates empty tags.json in S3 if missing)
    - _Preservation: fetchTagRegistry() continues fetching from CDN URL unchanged; CI/CD initialization unchanged_
    - _Requirements: 2.8, 2.9, 3.10_

- [ ] 9. Verify bug condition exploration tests now pass
  - **Property 1: Expected Behavior** - All UX Defects Resolved
  - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
  - The tests from task 1 encode the expected behavior for all 6 bugs
  - When these tests pass, it confirms the expected behavior is satisfied for each bug
  - Run all bug condition exploration tests from step 1
  - **EXPECTED OUTCOME**: All tests PASS (confirms all bugs are fixed)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 10. Verify preservation tests still pass
  - **Property 2: Preservation** - No Regressions Introduced
  - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
  - Run all preservation property tests from step 2
  - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
  - Confirm all preservation tests still pass after all fixes applied
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [ ] 11. Checkpoint - Ensure all tests pass
  - Run full test suite (frontend + lambda)
  - Ensure all exploration tests pass (bugs fixed)
  - Ensure all preservation tests pass (no regressions)
  - Ensure existing unit tests still pass
  - Ask the user if questions arise

## Notes

- This bugfix addresses 6 independent UX defects that can be fixed in parallel after the exploration/preservation tests are written.
- The exploratory bug condition tests (task 1) are designed to FAIL on the unfixed code — this is expected and confirms the bugs exist.
- The preservation tests (task 2) are designed to PASS on the unfixed code — this captures the baseline behavior that must not regress.
- After all fixes are applied, both test sets should pass, confirming correctness and no regressions.
- The AI tag suggestion feature (Bug 6) spans Lambda, shared types, and frontend — it's the most complex fix and should be done carefully.
- The `tags.json` removal (task 8.5) is safe because the tag registry is managed exclusively in S3 by the Lambda.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["7.1", "7.2"] },
    { "id": 3, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5"] },
    { "id": 4, "tasks": ["9", "10", "11"] }
  ]
}
```
