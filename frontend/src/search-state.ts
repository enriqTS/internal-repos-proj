/**
 * Shared search index state module.
 * This module exists to avoid circular imports between main.ts and
 * modules that need to invalidate the search index (upload-form, edit-form, delete-dialog).
 */

/** Whether the search index has been loaded in this session. */
export let searchIndexLoaded = false;

/** Mark the search index as loaded. */
export function markSearchIndexLoaded(): void {
  searchIndexLoaded = true;
}

/**
 * Reset the search index loaded flag so the next home page render
 * re-fetches the index from CloudFront.
 * Call this after successful add/edit/delete operations.
 */
export function invalidateSearchIndex(): void {
  searchIndexLoaded = false;
}
