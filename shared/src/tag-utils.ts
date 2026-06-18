/**
 * Utility functions for tag serialization, parsing, and normalization.
 */

/**
 * Normalize a tag to lowercase and trimmed.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Serialize an array of tags into a comma-separated string.
 */
export function serializeTags(tags: string[]): string {
  return tags.join(',');
}

/**
 * Parse a comma-separated string into an array of tags.
 * Trims whitespace from each tag and filters out empty strings.
 */
export function parseTags(csv: string): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
