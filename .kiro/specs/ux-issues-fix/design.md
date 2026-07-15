# UX Issues Fix — Bugfix Design

## Overview

This design addresses five UX defects in the Internal Repos portal: incorrect template dates due to metadata typos, dates only visible on hover, truncated project names in cards, AI tag suggestions limited to existing registry tags, and architecture images opening in new tabs instead of an in-page lightbox. Additionally, a missing upload affordance on the projects page is resolved. The fix strategy is targeted and minimal — each bug has a clearly scoped implementation with preservation of all unrelated behavior.

## Glossary

- **Bug_Condition (C)**: The set of conditions that trigger any of the five UX defects
- **Property (P)**: The desired correct behavior for each defect case
- **Preservation**: Existing behaviors (mouse clicks, responsive grid, manual tag creation, nav routing, detail-page dates) that must remain unchanged
- **`card-grid.ts`**: The shared card grid renderer in `frontend/src/card-grid.ts` responsible for rendering project/template cards
- **`suggest-tags.ts`**: The Lambda handler in `lambda/src/suggest-tags.ts` that invokes Bedrock to suggest tags from a README
- **`template-detail.ts`**: The template detail view in `frontend/src/template-detail.ts` that renders architecture diagrams
- **`main.ts`**: The frontend entry point in `frontend/src/main.ts` that wires routes and renders views
- **`tag-selector.ts`**: The tag selector component in `frontend/src/tag-selector.ts` used in the upload form
- **Tag Registry**: The `tags.json` file stored in S3, managed by the Lambda via `addTagsToRegistry()`

## Bug Details

### Bug Condition

The bugs manifest across five independent conditions:

1. **Date typo**: Templates `chatbot-rag-agentcore` and `chatbot-rag-mantle` show "1 year ago" because their `metadata.json` files contain `"2025-07-14"` instead of `"2026-07-14"`.
2. **Hidden exact dates**: All card-grid cards show only a relative date (e.g. "2 weeks ago") with the ISO date only in a `title` attribute requiring hover.
3. **Truncated names**: Long project names are truncated with ellipsis due to `white-space: nowrap` + `aspect-ratio: 1` on cards.
4. **Registry-only tag suggestions**: The AI prompt instructs "Only suggest tags from the available tags list" and the response is filtered to registry-only, preventing new tag discovery.
5. **New-tab architecture images**: Clicking an architecture diagram opens `target="_blank"` instead of an in-page lightbox.
6. **Missing upload button**: The projects page (`#/projects`) has no upload affordance — users must navigate to `#/upload` via nav.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type UserInteraction
  OUTPUT: boolean
  
  RETURN (input.type == "view_card" AND input.templateName IN ["chatbot-rag-agentcore", "chatbot-rag-mantle"])
         OR (input.type == "view_card" AND input.wantsExactDate AND NOT exactDateVisible)
         OR (input.type == "view_card" AND input.projectName.length > cardWidth AND nameIsTruncated)
         OR (input.type == "suggest_tags" AND aiSuggestsNewTag AND newTagFilteredOut)
         OR (input.type == "click_architecture_image" AND opensNewTab)
         OR (input.type == "view_projects_page" AND noUploadButtonVisible)
END FUNCTION
```

### Examples

- **Date typo**: User views `chatbot-rag-agentcore` card → sees "1 year ago" instead of correct relative date (template was created 2 weeks ago)
- **Hidden date**: User views any project card → sees "2 weeks ago" but cannot see "2026-07-01" without hovering
- **Truncated name**: User views card for "chatbot-rag-scalability-improvements" → sees "chatbot-rag-sca..." and cannot distinguish it from similarly named projects
- **Registry-only tags**: AI would suggest "bedrock-agentcore" for a relevant project but it's not in registry → suggestion is silently discarded
- **New-tab image**: User clicks architecture diagram → browser opens a new tab with the raw image, losing context
- **No upload button**: User is on `#/projects` → no visible way to upload without navigating to a different page

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Mouse clicks on card items must continue to navigate to project/template detail
- Responsive grid layout (1/2/4 columns) must remain unchanged
- Template detail page date display (`<time>` element with `datetime` attribute) must remain unchanged
- Short project names must continue to display on a single line without wrapping
- AI suggestion for tags that DO exist in registry must continue to work identically
- Architecture image `onerror` handler must continue to remove the section on load failure
- Direct navigation to `#/upload` must continue to render the upload form
- Manual tag creation via tag-selector "Add new tag" input must continue working
- Lambda `addTagsToRegistry()` must continue to persist manually-created new tags
- Frontend `fetchTagRegistry()` must continue fetching from CDN URL unchanged
- Tag filter, pagination, keyboard navigation must all remain unchanged

**Scope:**
All inputs that do NOT involve the five bug conditions should be completely unaffected by this fix. This includes:
- All non-date, non-name, non-tag-suggestion, non-image-click, non-projects-page interactions
- Template detail page metadata rendering
- Search functionality, project detail views, edit form, delete dialog

## Hypothesized Root Cause

Based on the bug analysis, the root causes are:

1. **Date Typo**: Human error in `templates/chatbot-rag-agentcore/metadata.json` and `templates/chatbot-rag-mantle/metadata.json` — year `2025` should be `2026`

2. **Hidden Exact Dates**: In `card-grid.ts`, the date element uses `formatRelativeDate(item.date)` as `textContent` and puts the ISO date only in the `title` attribute — not visible without hover interaction

3. **Truncated Names**: In `card-grid.ts` injected styles:
   - `.card-grid-item` has `aspect-ratio: 1` forcing square cards that constrain height
   - `.card-grid-item` has `overflow: hidden` clipping content
   - `.card-grid-item__name` uses `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` preventing multi-line names

4. **Registry-Only Tag Suggestions**: In `suggest-tags.ts`:
   - The prompt explicitly says "Only suggest tags from the available tags list"
   - The response filter `registryLower.has(tag)` removes any AI-suggested tag not in registry
   - `SuggestTagsResponse` type only has a `tags` field (no `newTags`)

5. **New-Tab Architecture Images**: In `template-detail.ts`, `renderArchitectureSection()` wraps the image in `<a href target="_blank" rel="noopener noreferrer">` — standard link behavior opens a new tab

6. **Missing Upload Button**: In `main.ts`, `renderSearchView()` only renders heading + search input + filter + results — no upload affordance is present

## Correctness Properties

Property 1: Bug Condition - Dates Display Correctly

_For any_ template card where the template name is `chatbot-rag-agentcore` or `chatbot-rag-mantle`, the system SHALL display the correct relative date based on the fixed metadata date `2026-07-14`, AND for all card-grid cards, the visible date text SHALL include both the relative date and the ISO date (e.g. "2 weeks ago · 2026-07-01").

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition - Names Wrap Instead of Truncating

_For any_ card-grid card where the project/template name exceeds the card width, the name element SHALL wrap to multiple lines (up to 3 lines with line-clamp) instead of truncating with ellipsis, and the card SHALL NOT enforce a square aspect ratio.

**Validates: Requirements 2.3**

Property 3: Bug Condition - AI Suggests New Tags

_For any_ invocation of the tag suggestion system where the AI identifies relevant tags not in the registry, the system SHALL return those tags in a separate `newTags` field (up to 3), validated against the tag pattern and length constraints.

**Validates: Requirements 2.4, 2.7**

Property 4: Bug Condition - Architecture Image Opens Lightbox

_For any_ click on an architecture diagram image in the template detail page, the system SHALL display the image in an in-page modal/lightbox overlay with close-on-click-outside, Escape key, close button, `role="dialog"`, and `aria-modal="true"`, instead of opening a new tab.

**Validates: Requirements 2.5**

Property 5: Bug Condition - Upload Button Present on Projects Page

_For any_ render of the projects page (`#/projects`), the system SHALL display an upload button that navigates to `#/upload`, positioned alongside the page heading.

**Validates: Requirements 2.6**

Property 6: Preservation - Existing Behaviors Unchanged

_For any_ input where none of the five bug conditions hold (non-affected templates, short names, registry-existing tag suggestions, non-image clicks, non-projects-page views), the fixed code SHALL produce exactly the same behavior as the original code, preserving responsive grid layout, navigation, search, tag filtering, pagination, and all existing component behaviors.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

**Bug 1 — Date Typo Fix**

**File**: `templates/chatbot-rag-agentcore/metadata.json`
**Change**: Replace `"2025-07-14"` with `"2026-07-14"` in the `date` field

**File**: `templates/chatbot-rag-mantle/metadata.json`
**Change**: Replace `"2025-07-14"` with `"2026-07-14"` in the `date` field

---

**Bug 2 — Visible Exact Dates**

**File**: `frontend/src/card-grid.ts`
**Function**: `renderCardGrid`

**Specific Changes**:
1. Change the date `textContent` from `formatRelativeDate(item.date)` to a combined format: `"${formatRelativeDate(item.date)} · ${item.date}"`
2. Remove the `title` attribute on the `<time>` element since the exact date is now visible inline

---

**Bug 3 — Name Wrapping**

**File**: `frontend/src/card-grid.ts`
**Function**: `injectStyles`

**Specific Changes**:
1. Remove `aspect-ratio: 1` from `.card-grid-item`
2. Remove `overflow: hidden` from `.card-grid-item`
3. Replace `.card-grid-item__name` styles:
   - Remove: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
   - Add: `display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden`

---

**Bug 4 — AI New Tag Suggestions**

**File**: `lambda/src/suggest-tags.ts`
**Functions**: `handler`, `suggestTagsFromReadme`

**Specific Changes**:
1. Modify the AI prompt to allow suggesting up to 3 new tags not in registry: instruct the model to return `{tags: [...], newTags: [...]}`
2. Parse `newTags` from the AI response (in addition to `tags`)
3. Validate new tags against the tag pattern (`TAG_PATTERN`) and max length (`MAX_TAG_LENGTH`)
4. Cap `newTags` at 3 items
5. Return both `tags` (registry-existing) and `newTags` (new suggestions) in the response

**File**: `shared/src/types.ts`
**Type**: `SuggestTagsResponse`

**Specific Changes**:
1. Add `newTags?: string[]` field to the `SuggestTagsResponse` interface

**File**: `frontend/src/upload-form.ts`
**Function**: `requestTagSuggestions`

**Specific Changes**:
1. Handle both `tags` and `newTags` from the suggestion response
2. Apply existing tags via `tagSelector.applySuggestions(result.data.tags)`
3. Apply new tags via a new method or by programmatically adding them to the selector

**File**: `frontend/src/tag-selector.ts`
**Function**: New method `applyNewSuggestions` or extend `applySuggestions`

**Specific Changes**:
1. Add ability to accept new AI-suggested tags that don't exist in the available tags list
2. Add them to `availableTags`, mark as selected, track in `newTags` set, and mark as suggested

**File**: `.gitignore`
**Change**: Add `tags.json` entry

**File**: `tags.json` (repo root)
**Change**: Delete from repository

---

**Bug 5 — Lightbox for Architecture Images**

**File**: `frontend/src/template-detail.ts`
**Function**: `renderArchitectureSection`

**Specific Changes**:
1. Replace the `<a target="_blank">` wrapper with a `<button>` or clickable wrapper that calls `showImageLightbox(imageUrl, name)`
2. Implement `showImageLightbox(imageUrl: string, altText: string)` function:
   - Create overlay div with `role="dialog"`, `aria-modal="true"`, class `delete-dialog-overlay` (reuse existing overlay pattern)
   - Add close button (×) with `aria-label="Close"`
   - Add `<img>` with `max-width: 90vw; max-height: 90vh; object-fit: contain`
   - Add click-outside-to-close on overlay
   - Add Escape key listener to close
   - Maintain existing `aria-label` for the trigger: "View full-size architecture diagram for {name}"

---

**Bug 6 — Upload Button on Projects Page**

**File**: `frontend/src/main.ts`
**Function**: `renderSearchView`

**Specific Changes**:
1. Wrap the existing `<h2>` heading in a flex container div (e.g. `display: flex; align-items: center; justify-content: space-between`)
2. Add an upload button (`<a>` styled as button or `<button>`) linking to `#/upload`
3. Style the button similar to existing `.upload-submit` (accent color, mono font)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write unit tests that exercise each bug condition on the unfixed codebase. Run tests to observe failures and confirm root causes.

**Test Cases**:
1. **Date Typo Test**: Load metadata for `chatbot-rag-agentcore`, verify `date` field is `2025-07-14` (will confirm typo exists)
2. **Hidden Date Test**: Render a card grid item, assert that the visible text does NOT include the ISO date (will confirm the bug)
3. **Truncated Name Test**: Render a card with a long name, assert that the CSS includes `white-space: nowrap` and `aspect-ratio: 1` (will confirm truncation)
4. **Registry-Only Tags Test**: Call `suggestTagsFromReadme` with a README that would generate novel tags, assert that novel tags are NOT returned (will confirm the bug)
5. **New-Tab Image Test**: Call `renderArchitectureSection`, assert that the rendered anchor has `target="_blank"` (will confirm the bug)
6. **Missing Upload Button Test**: Call `renderSearchView`, assert no upload button in the rendered DOM (will confirm the bug)

**Expected Counterexamples**:
- Metadata files contain wrong year (2025 instead of 2026)
- Card date text only contains relative string, not ISO date
- Card name CSS enforces single-line truncation
- AI suggestions with novel tags return empty/filtered results
- Architecture section uses `<a target="_blank">`
- Projects page has no upload affordance

### Fix Checking

**Goal**: Verify that for all inputs where the bug conditions hold, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

Specifically:
- For date typos: verify metadata now has `2026-07-14` and `formatRelativeDate` produces correct output
- For visible dates: verify card date text contains both relative and ISO portions
- For name wrapping: verify CSS no longer enforces single-line + square aspect ratio
- For new tags: verify AI response includes `newTags` field with valid new suggestions
- For lightbox: verify click opens a modal overlay instead of navigating
- For upload button: verify projects page renders a clickable upload affordance

### Preservation Checking

**Goal**: Verify that for all inputs where the bug conditions do NOT hold, the fixed functions produce the same result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-bug inputs (short names, existing tags, mouse clicks), then write property-based tests to verify behavior is preserved after fix.

**Test Cases**:
1. **Other Template Dates Preservation**: Verify templates other than the two typo'd ones continue showing correct relative dates
2. **Short Name Preservation**: Verify short project names still render on a single line
3. **Existing Tag Suggestions Preservation**: Verify tags that exist in registry are still suggested correctly
4. **Image Error Preservation**: Verify `onerror` on architecture images still removes the section
5. **Direct Upload Navigation Preservation**: Verify `#/upload` route still renders the upload form
6. **Grid Layout Preservation**: Verify responsive breakpoints (1/2/4 cols) remain unchanged
7. **Manual Tag Creation Preservation**: Verify manually-created new tags still work via tag-selector
8. **Tag Registry Persistence Preservation**: Verify Lambda still persists new tags via `addTagsToRegistry()`

### Unit Tests

- Test `formatRelativeDate` with corrected date produces expected relative string
- Test card grid renders date in combined format ("relative · ISO")
- Test card grid CSS does not include `aspect-ratio: 1` or `white-space: nowrap` on name
- Test `suggestTagsFromReadme` returns `newTags` array for novel tags
- Test new tag validation rejects invalid patterns/lengths
- Test `showImageLightbox` creates modal overlay with correct ARIA attributes
- Test `renderSearchView` includes an upload button linking to `#/upload`
- Test upload button has correct styling class

### Property-Based Tests

- Generate random ISO dates and verify combined format always includes both relative and ISO portions
- Generate random project names of varying lengths and verify card rendering never truncates (CSS property check)
- Generate random tag arrays (mix of registry and novel) and verify `suggestTags` handler correctly partitions into `tags` and `newTags`
- Generate random non-bug interactions and verify all existing behaviors are preserved

### Integration Tests

- Test full flow: load projects page → verify upload button visible → click → navigates to upload form
- Test full flow: render template detail with architecture image → click image → lightbox opens → press Escape → lightbox closes
- Test full flow: upload a project with AI suggestions that include new tags → verify new tags appear in tag selector → submit → verify tags persisted to registry
- Test full flow: render card grid with mixed short/long names → verify all names readable, grid layout correct
