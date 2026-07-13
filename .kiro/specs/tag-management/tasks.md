# Implementation Plan: Tag Management

## Overview

This plan implements a structured tag management system replacing the free-text tag input. Work is organized into: shared types/utilities, backend tag registry module, backend validation updates, tag suggestion Lambda, frontend Tag Selector component, frontend Tag Filter component, search integration, infrastructure (Terraform), and wiring everything together.

## Tasks

- [x] 1. Shared types and utilities
  - [x] 1.1 Update shared types for structured tag input
    - Add `TagInput` interface (`{ tag: string; isNew: boolean }`) to `shared/src/types.ts`
    - Update `InitiateRequest` to accept `tags?: TagInput[]` instead of `tags?: string`
    - Add `newTags?: string[]` field to `SessionMetadata`
    - Add `SuggestTagsRequest` and `SuggestTagsResponse` interfaces
    - Export new types from `shared/src/index.ts`
    - _Requirements: 6.1, 6.4_

  - [x] 1.2 Create tag utility module in shared
    - Create `shared/src/tag-utils.ts` with `serializeTags(tags: string[]): string` and `parseTags(csv: string): string[]` functions
    - Implement `normalizeTags(tag: string): string` (lowercase, trim)
    - Add `TAG_PATTERN` regex constant (`^[a-z0-9_-]+$`) and `MAX_REGISTRY_SIZE = 500` to `shared/src/constants.ts`
    - Export from `shared/src/index.ts`
    - _Requirements: 1.3, 6.2, 6.4_

  - [ ]* 1.3 Write property test for tag serialization round-trip
    - **Property 10: Tag Serialization Round-Trip**
    - **Validates: Requirements 2.5, 6.4**

- [x] 2. Backend tag registry module
  - [x] 2.1 Create tag-registry module
    - Create `lambda/src/tag-registry.ts`
    - Implement `getTagRegistry(): Promise<string[]>` — reads `tags.json` from S3 frontend bucket, returns empty array on 404
    - Implement `addTagsToRegistry(newTags: string[]): Promise<string[]>` — fetches current registry, normalizes and deduplicates tags, sorts alphabetically, enforces 500-entry cap, writes back to S3
    - Use `S3Client` with `GetObjectCommand` and `PutObjectCommand`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 2.2 Write property test for tag registry invariant
    - **Property 1: Tag Registry Invariant**
    - **Validates: Requirements 1.2, 1.3, 1.4, 6.6**

  - [ ]* 2.3 Write unit tests for tag-registry module
    - Test `getTagRegistry` returns empty array on 404
    - Test `addTagsToRegistry` normalizes to lowercase and deduplicates
    - Test registry remains sorted after additions
    - Test 500-entry cap enforcement
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

- [x] 3. Backend validation updates
  - [x] 3.1 Extend validate module for structured tag inputs
    - Add `validateTagInputs(tags: TagInput[], registry: string[]): string | null` to `lambda/src/validate.ts`
    - Validate existing tag references exist in registry (case-insensitive)
    - Validate new tags match pattern `^[a-z0-9_-]+$`, length 1–32
    - If a new tag matches an existing entry case-insensitively, treat as reference
    - Return specific error message identifying invalid tag and reason
    - _Requirements: 6.1, 6.2, 6.5, 6.6_

  - [ ]* 3.2 Write property test for new tag validation
    - **Property 3: New Tag Validation**
    - **Validates: Requirements 2.7, 6.2**

  - [ ]* 3.3 Write property test for existing tag reference validation
    - **Property 8: Existing Tag Reference Validation**
    - **Validates: Requirements 6.1**

  - [ ]* 3.4 Write property test for validation failure atomicity
    - **Property 9: Validation Failure Atomicity**
    - **Validates: Requirements 6.5**

- [x] 4. Update initiate Lambda for structured tags
  - [x] 4.1 Update initiate handler to accept TagInput array
    - Modify `lambda/src/initiate.ts` to parse `tags` as `TagInput[]`
    - Import and call `validateTagInputs` with the tag registry
    - Serialize validated tags to comma-separated string for `SessionMetadata.tags`
    - Store new tags in `SessionMetadata.newTags`
    - Return 400 with specific error if any tag fails validation
    - _Requirements: 6.1, 6.2, 6.5_

  - [ ]* 4.2 Write unit tests for updated initiate handler
    - Test valid existing tag references pass
    - Test valid new tags pass
    - Test invalid tag format returns 400
    - Test reference to non-existent tag returns 400
    - _Requirements: 6.1, 6.2, 6.5_

- [x] 5. Update process Lambda for tag registry persistence
  - [x] 5.1 Update process handler to persist new tags
    - Modify `lambda/src/process.ts` to read `newTags` from session metadata
    - Call `addTagsToRegistry(newTags)` before writing the project
    - Wrap registry update in try/catch — on failure, proceed with upload and add warning to response
    - _Requirements: 1.2, 1.8, 6.3_

  - [ ]* 5.2 Write unit tests for process handler tag persistence
    - Test new tags are added to registry on success
    - Test registry failure doesn't block project upload
    - Test warning is included in response on registry failure
    - _Requirements: 1.8, 6.3_

- [x] 6. Checkpoint - Backend core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Tag Suggestion Lambda
  - [x] 7.1 Create suggest-tags Lambda handler
    - Create `lambda/src/suggest-tags.ts`
    - Implement `handler` function for POST /tags/suggest
    - Parse request body for `readme` field
    - Truncate README to 10,000 characters
    - Fetch current tag registry via `getTagRegistry()`
    - Invoke AWS Bedrock `InvokeModelCommand` with Kimi K2.5 model
    - Build prompt with registry tags and README content
    - Parse model response JSON, extract `tags` array
    - Filter response to only include tags present in registry (up to 10)
    - Return `{ tags: [...] }` on success
    - Return `{ tags: [] }` with 200 on model failure/timeout/invalid response
    - Include CORS headers matching existing endpoints
    - _Requirements: 4.2, 4.3, 4.4, 5.1, 5.4, 5.5, 5.6_

  - [ ]* 7.2 Write property test for suggestion response filtering
    - **Property 5: Suggestion Response Filtering**
    - **Validates: Requirements 4.3, 4.4**

  - [ ]* 7.3 Write property test for README truncation
    - **Property 7: README Truncation for Model**
    - **Validates: Requirements 5.5**

  - [ ]* 7.4 Write unit tests for suggest-tags Lambda
    - Test valid README produces suggestions
    - Test Bedrock failure returns empty array
    - Test invalid model response returns empty array
    - Test README truncation at 10,000 characters
    - _Requirements: 4.4, 4.8, 5.5, 5.6_

- [x] 8. Update Lambda build configuration
  - [x] 8.1 Add suggest-tags to esbuild entry points
    - Update `lambda/package.json` build script to include `src/suggest-tags.ts` as an entry point
    - Add `@aws-sdk/client-bedrock-runtime` as a dependency (external for Lambda bundling)
    - _Requirements: 5.1_

- [x] 9. Frontend API functions
  - [x] 9.1 Add fetchTagRegistry and suggestTags to frontend API
    - Add `fetchTagRegistry(): Promise<ApiResult<string[]>>` to `frontend/src/api.ts` — fetches `/tags.json` from CDN, returns empty array on 404, shows warning on other errors
    - Add `suggestTags(readme: string): Promise<ApiResult<string[]>>` — POST to `/tags/suggest` API endpoint with API key
    - _Requirements: 1.1, 1.5, 1.7, 4.1_

  - [ ]* 9.2 Write unit tests for new API functions
    - Test fetchTagRegistry returns tags on success
    - Test fetchTagRegistry returns empty array on 404
    - Test fetchTagRegistry returns error on non-404 failures
    - Test suggestTags sends POST with readme body
    - _Requirements: 1.1, 1.5, 1.7_

- [x] 10. Frontend Tag Selector component
  - [x] 10.1 Create Tag Selector component
    - Create `frontend/src/tag-selector.ts`
    - Implement `createTagSelector(options: TagSelectorOptions): TagSelectorAPI`
    - Render available tags as clickable items with selected/deselected state
    - Toggle tag selection on click, visually distinguish selected state
    - Enforce 10-tag maximum — disable unselected tags when limit reached, show message on attempt
    - Implement "Add new tag" button that reveals text input
    - Validate new tag: 1–32 chars, `^[a-z0-9_-]+$`, not already in registry (case-insensitive)
    - Show specific validation error on failure
    - On valid new tag: add to list, mark as selected, clear input
    - Track `hasUserInteracted` state (set true on any manual toggle/add)
    - Implement `applySuggestions(tags)` — only applies if `!hasUserInteracted()`
    - Implement `getSelectedTags()` and `getNewTags()` accessors
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [ ]* 10.2 Write property test for tag selection maximum limit
    - **Property 2: Tag Selection Maximum Limit**
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 10.3 Write property test for suggestion application respects user interaction
    - **Property 6: Suggestion Application Respects User Interaction**
    - **Validates: Requirements 4.6, 4.7**

  - [ ]* 10.4 Write unit tests for Tag Selector component
    - Test renders all available tags
    - Test toggling tag selection on click
    - Test max tag limit enforcement
    - Test "Add new tag" input visibility toggle
    - Test valid new tag addition
    - Test invalid new tag shows error
    - Test suggestions applied when no user interaction
    - Test suggestions discarded after user interaction
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 2.8, 2.9, 4.6, 4.7_

- [x] 11. Frontend Tag Filter component
  - [x] 11.1 Create Tag Filter component
    - Create `frontend/src/tag-filter.ts`
    - Implement `createTagFilter(options: TagFilterOptions): TagFilterAPI`
    - Render all unique tags extracted from the search index as filter options, sorted alphabetically
    - Toggle filter on/off on click, apply distinct CSS class to active tags
    - Call `onFilterChange` callback with active tags on every change
    - Implement `clearFilters()` and `getActiveTags()` accessors
    - If no tags exist in the index, render nothing
    - _Requirements: 3.1, 3.5, 3.6, 3.8_

  - [ ]* 11.2 Write property test for tag filter AND logic
    - **Property 4: Tag Filter AND Logic**
    - **Validates: Requirements 3.1, 3.2, 3.4**

  - [ ]* 11.3 Write unit tests for Tag Filter component
    - Test renders unique sorted tags from index
    - Test clicking tag toggles active state and CSS class
    - Test deselecting tag updates results
    - Test no filter options when index has no tags
    - _Requirements: 3.1, 3.5, 3.6, 3.8_

- [x] 12. Checkpoint - Frontend components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Wire Tag Selector into Upload Form
  - [x] 13.1 Integrate Tag Selector in upload form
    - Modify `frontend/src/upload-form.ts` to replace the free-text tags input with `createTagSelector`
    - Fetch tag registry on form load via `fetchTagRegistry()`
    - Call `setAvailableTags()` with fetched tags
    - Show warning message if registry fetch fails (non-404)
    - Wire debounced README suggestion: after 500ms of no typing and ≥50 chars, call `suggestTags()`
    - Call `applySuggestions()` on response (only if user hasn't interacted)
    - On form submit, build `TagInput[]` from `getSelectedTags()` and `getNewTags()`
    - Pass structured tags to `initiateUpload()`
    - _Requirements: 2.1, 2.5, 2.10, 4.1, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [ ]* 13.2 Write property test for suggestion trigger threshold
    - **Property 11: Suggestion Trigger Threshold**
    - **Validates: Requirements 4.1, 4.9**

  - [ ]* 13.3 Write unit tests for upload form tag integration
    - Test tag registry is fetched on load
    - Test warning shown on registry fetch error
    - Test suggestions requested after 500ms debounce with ≥50 char README
    - Test suggestions not requested for short README
    - Test form submits structured TagInput array
    - _Requirements: 2.1, 2.5, 2.10, 4.1, 4.9_

- [x] 14. Wire Tag Filter into Search Page
  - [x] 14.1 Integrate Tag Filter in search page
    - Modify `frontend/src/search.ts` to add Tag Filter component
    - Extract unique tags from the search index and pass to `setTags()`
    - Apply AND-logic filtering: when filter tags are active, filter results to show only projects containing ALL selected tags
    - Combine with text search: apply tag filter on top of Fuse.js results
    - Show "No results found" when combined filters produce zero matches
    - Ensure filter updates render within 100ms (synchronous DOM update)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7_

  - [ ]* 14.2 Write unit tests for search page tag filtering integration
    - Test tag filter renders unique tags from index
    - Test selecting filter narrows results (AND logic)
    - Test deselecting all filters shows unfiltered results
    - Test combined text search + tag filter
    - Test "No results found" message on empty combined results
    - _Requirements: 3.2, 3.3, 3.4, 3.7_

- [x] 15. Checkpoint - Integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Infrastructure - Tag Suggestion Lambda
  - [x] 16.1 Add Tag Suggestion Lambda Terraform resources
    - Add IAM role for the suggestion Lambda with `bedrock:InvokeModel` permission and `s3:GetObject` on `tags.json`
    - Add `aws_lambda_function` resource: runtime `nodejs22.x`, memory 512 MB, timeout 30s, handler `suggest-tags.handler`
    - Add environment variable for `BUCKET_NAME` (frontend bucket)
    - Add API Gateway resource `/tags/suggest` with POST method, API key required
    - Add CORS OPTIONS method for `/tags/suggest` matching existing pattern
    - Add Lambda permission for API Gateway invocation
    - Associate with existing usage plan
    - Update deployment triggers to include new resources
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

- [x] 17. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout; all implementation tasks use TypeScript
- `fast-check` is already available as a dev dependency for property-based tests
- Vitest is configured as the test runner with global mode

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "9.2"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.1", "7.1"] },
    { "id": 4, "tasks": ["4.2", "5.1", "7.2", "7.3", "7.4", "8.1"] },
    { "id": 5, "tasks": ["5.2", "10.1", "11.1"] },
    { "id": 6, "tasks": ["10.2", "10.3", "10.4", "11.2", "11.3"] },
    { "id": 7, "tasks": ["13.1", "14.1"] },
    { "id": 8, "tasks": ["13.2", "13.3", "14.2"] },
    { "id": 9, "tasks": ["16.1"] }
  ]
}
```
