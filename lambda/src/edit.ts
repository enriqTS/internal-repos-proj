import type { ProjectMetadata, EditRequest } from 'shared';

/**
 * Result of merging metadata with an edit request.
 * Contains the updated metadata and the full readme content (if provided)
 * for writing separately to readme.md.
 */
export interface MergeResult {
  /** Updated project metadata (description is first 200 chars of readme if provided) */
  metadata: ProjectMetadata;
  /** Full readme content to write to readme.md, or undefined if readme was not updated */
  readme: string | undefined;
}

/**
 * Merges an existing ProjectMetadata with an EditRequest, producing updated metadata.
 *
 * - Fields present in the EditRequest override existing values
 * - Omitted (undefined) fields are preserved from the existing metadata
 * - When `tags` is provided, metadata.tags is replaced with the new array
 * - When `readme` is provided, metadata.description is set to the first 200 characters
 *   and the full readme is returned separately for writing to readme.md
 * - When `name` is provided, metadata.name is updated
 */
export function mergeMetadata(existing: ProjectMetadata, request: EditRequest): MergeResult {
  const merged: ProjectMetadata = { ...existing };

  if (request.name !== undefined) {
    merged.name = request.name;
  }

  if (request.tags !== undefined) {
    merged.tags = request.tags;
  }

  let readme: string | undefined;

  if (request.readme !== undefined) {
    merged.description = request.readme.slice(0, 200);
    readme = request.readme;
  }

  return { metadata: merged, readme };
}
