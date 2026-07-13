# Stale Project List Bugfix Design

## Overview

After add, edit, or delete operations, the project list on the home page shows stale data. The `global-index.json` file is correctly regenerated in S3, but two layers prevent users from seeing up-to-date results: (1) CloudFront caches the file for up to 1 hour because no `Cache-Control` header is set on the S3 object, and (2) the frontend's `searchIndexLoaded` flag in `main.ts` prevents re-fetching the index within a single-page session. The fix addresses both layers with minimal, targeted changes.

## Glossary

- **Bug_Condition (C)**: The condition that triggers staleness — a mutation operation (add/edit/delete) completes successfully but the project list is not refreshed on subsequent home page navigation
- **Property (P)**: The desired behavior — after any successful mutation, the next home page render fetches a fresh `global-index.json` and displays current data
- **Preservation**: Existing behaviors that must remain unchanged — initial page load, search functionality, project detail rendering, index aggregation logic, and caching of other static assets
- **`searchIndexLoaded`**: Boolean flag in `frontend/src/main.ts` that gates whether `fetchSearchIndex()` is called on home page render
- **`regenerateIndex()`**: Function in `lambda/src/index-generator.ts` that scans S3 metadata and writes `global-index.json`
- **`global-index.json`**: The S3 object serving as the search index for the frontend, delivered via CloudFront

## Bug Details

### Bug Condition

The bug manifests when a user performs any mutation operation (upload, edit, or delete) and then navigates back to the home page. The project list shows stale data because: (1) CloudFront serves a cached copy of `global-index.json` since no `Cache-Control` header instructs it to revalidate, and (2) the `searchIndexLoaded` flag remains `true` after the mutation, so the frontend never re-fetches.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type UserSession
  OUTPUT: boolean
  
  RETURN input.mutationPerformed IN ['upload', 'edit', 'delete']
         AND input.mutationResult == 'success'
         AND input.navigatedToHomePage == true
         AND (searchIndexLoaded == true OR cloudFrontServesStaleCache == true)
END FUNCTION
```

### Examples

- User uploads "my-project" successfully, navigates to home → home page does NOT show "my-project" in the list (expected: it should appear)
- User deletes "old-project" successfully, navigates to home → home page still shows "old-project" in the list (expected: it should be gone)
- User edits "demo-app" tags from ["python"] to ["python", "ml"], navigates to home → home page still shows old tags (expected: updated tags)
- User uploads a project, waits 61 minutes, reloads home page → project appears (CloudFront cache expired naturally — not a bug trigger, but demonstrates the caching layer)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- First-time page load in a session must fetch and display the project index normally
- Search queries using Fuse.js must continue to return fuzzy-matched results from the loaded index
- Project detail pages must continue to display metadata and readme correctly
- The index generator's S3 scanning and aggregation logic must remain unchanged
- CloudFront caching of other static assets (HTML, CSS, JS, project artifacts, `tags.json`) must continue with existing TTL policy
- Error handling and retry behavior for failed index fetches must remain unchanged

**Scope:**
All interactions that do NOT involve a successful mutation (upload/edit/delete) should be completely unaffected by this fix. This includes:
- Normal page loads without prior mutations
- Search interactions within an already-loaded index
- Navigation between project detail pages
- Failed mutation attempts (the index should not be invalidated on failures)

## Hypothesized Root Cause

Based on the bug description and code analysis, the two confirmed root causes are:

1. **Missing Cache-Control header on `global-index.json`**: In `lambda/src/index-generator.ts`, the `PutObjectCommand` for `global-index.json` (line ~113) does not set a `CacheControl` property. CloudFront's `default_ttl = 3600` (configured in `infra/main.tf`) causes it to cache the object for up to 1 hour without revalidating with the origin.

2. **Frontend in-memory flag never resets after mutations**: In `frontend/src/main.ts`, the `searchIndexLoaded` variable is set to `true` after the first successful fetch and never reset. The upload form (`upload-form.ts`), edit form (`edit-form.ts`), and delete dialog (`delete-dialog.ts`) all navigate back to the home page after success but do not reset this flag, so `renderSearchView` skips re-fetching.

## Correctness Properties

Property 1: Bug Condition - Fresh Index After Mutation

_For any_ successful mutation operation (upload, edit, or delete) followed by navigation to the home page, the system SHALL fetch a fresh copy of `global-index.json` from the origin (bypassing stale cache) and display the up-to-date project list reflecting the mutation.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Unchanged Behavior for Non-Mutation Flows

_For any_ interaction that does NOT involve a successful mutation (normal page loads, search queries, navigation to detail pages, failed mutations), the system SHALL produce exactly the same behavior as the original code, preserving initial load behavior, search functionality, and all existing caching for non-index assets.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `lambda/src/index-generator.ts`

**Function**: `regenerateIndex()`

**Specific Changes**:
1. **Add CacheControl to PutObjectCommand**: Add `CacheControl: 'no-cache, must-revalidate'` to the `PutObjectCommand` params when writing `global-index.json`. This instructs CloudFront to always revalidate with the S3 origin before serving the cached copy, ensuring clients get fresh data after regeneration.

---

**File**: `frontend/src/main.ts`

**Function**: New exported function + flag reset

**Specific Changes**:
2. **Export `invalidateSearchIndex()` function**: Create and export a function that sets `searchIndexLoaded = false`. This allows other modules to signal that the index should be re-fetched on the next home page render.

---

**File**: `frontend/src/upload-form.ts`

**Function**: Form submit handler (success path)

**Specific Changes**:
3. **Call `invalidateSearchIndex()` after successful upload**: Import the function from `main.ts` and invoke it after step 7 (success), before the form reset. This ensures the next home page navigation will re-fetch the index.

---

**File**: `frontend/src/edit-form.ts`

**Function**: Form submit handler (success path)

**Specific Changes**:
4. **Call `invalidateSearchIndex()` after successful edit**: Import the function from `main.ts` and invoke it in the success path, before the `setTimeout` that navigates back to the project detail page.

---

**File**: `frontend/src/delete-dialog.ts`

**Function**: Confirm button click handler (success path)

**Specific Changes**:
5. **Call `invalidateSearchIndex()` after successful delete**: Import the function from `main.ts` and invoke it in the `result.ok` branch, before the `setTimeout` that navigates to home.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that verify (1) the `PutObjectCommand` for `global-index.json` does not include `CacheControl`, and (2) that `searchIndexLoaded` is never reset after mutation flows. Run these tests on the UNFIXED code to observe failures and confirm the root cause.

**Test Cases**:
1. **Missing CacheControl Test**: Assert that `regenerateIndex()` calls `PutObjectCommand` with a `CacheControl` header (will fail on unfixed code — no header is set)
2. **Upload Does Not Reset Flag Test**: After a successful upload flow, assert that `searchIndexLoaded` is `false` (will fail on unfixed code — flag stays `true`)
3. **Edit Does Not Reset Flag Test**: After a successful edit flow, assert that `searchIndexLoaded` is `false` (will fail on unfixed code)
4. **Delete Does Not Reset Flag Test**: After a successful delete flow, assert that `searchIndexLoaded` is `false` (will fail on unfixed code)

**Expected Counterexamples**:
- `PutObjectCommand` is called without `CacheControl` property
- `searchIndexLoaded` remains `true` after all mutation operations
- Possible causes confirmed: missing header in Lambda, no reset mechanism in frontend

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := performMutationAndNavigateHome_fixed(input)
  ASSERT indexWasRefetched(result)
  ASSERT displayedProjectsMatchCurrentIndex(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalBehavior(input) = fixedBehavior(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-mutation interactions (page loads, searches, navigation), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Initial Load Preservation**: Verify that first-time page load still fetches and displays the index correctly after the fix
2. **Search Preservation**: Verify that Fuse.js search continues to return correct fuzzy-matched results
3. **Other Assets Caching Preservation**: Verify that `CacheControl` is NOT added to any other S3 objects (only `global-index.json`)
4. **Failed Mutation Preservation**: Verify that a failed upload/edit/delete does NOT reset `searchIndexLoaded`

### Unit Tests

- Test that `regenerateIndex()` includes `CacheControl: 'no-cache, must-revalidate'` in the PutObjectCommand for `global-index.json`
- Test that `invalidateSearchIndex()` correctly resets the flag so the next `renderSearchView` call fetches fresh data
- Test that successful upload triggers `invalidateSearchIndex()`
- Test that successful edit triggers `invalidateSearchIndex()`
- Test that successful delete triggers `invalidateSearchIndex()`
- Test that failed mutations do NOT trigger `invalidateSearchIndex()`

### Property-Based Tests

- Generate random sequences of mutation types (upload/edit/delete) and verify that after each success, the index flag is reset
- Generate random non-mutation interaction sequences and verify the flag is never inappropriately reset
- Generate random S3 object keys and verify only `global-index.json` receives the `CacheControl` header

### Integration Tests

- Test full upload flow followed by home page navigation: verify fresh index is fetched
- Test full delete flow followed by home page navigation: verify deleted project is absent
- Test full edit flow followed by home page navigation: verify updated metadata is shown
- Test that a session with no mutations still loads the index exactly once (performance preservation)
