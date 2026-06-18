import {
  PROJECT_NAME_REGEX,
  MAX_PROJECT_NAME_LENGTH,
  MAX_TAGS_COUNT,
  MAX_TAG_LENGTH,
  MAX_README_LENGTH,
  TAG_PATTERN,
  TagInput,
} from 'shared';

/**
 * Validate project metadata fields (name, tags, readme).
 * Returns an error message string if invalid, or null if valid.
 */
export function validateMetadata(data: { name?: string; tags?: string; readme?: string }): string | null {
  // Check required name field
  if (!data.name || data.name.trim().length === 0) {
    return 'Missing required fields: name';
  }

  const name = data.name.trim();

  // Validate project name format
  if (!PROJECT_NAME_REGEX.test(name)) {
    return 'Invalid project name. Allowed characters: alphanumeric, hyphens, and underscores.';
  }

  // Validate project name length
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return `Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters.`;
  }

  // Validate readme length only if provided
  if (data.readme && data.readme.length > MAX_README_LENGTH) {
    return `Readme content must be at most ${MAX_README_LENGTH} characters.`;
  }

  // Validate tags if provided
  if (data.tags && data.tags.trim().length > 0) {
    const tags = data.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);

    if (tags.length > MAX_TAGS_COUNT) {
      return `Maximum of ${MAX_TAGS_COUNT} tags allowed.`;
    }

    for (const tag of tags) {
      if (tag.length > MAX_TAG_LENGTH) {
        return `Each tag must be at most ${MAX_TAG_LENGTH} characters.`;
      }
    }
  }

  return null;
}

/**
 * Validate structured tag inputs against the tag registry.
 * Returns an error message string if invalid, or null if all tags are valid.
 */
export function validateTagInputs(tags: TagInput[], registry: string[]): string | null {
  const registryLower = registry.map((t) => t.toLowerCase());

  for (const { tag, isNew } of tags) {
    const tagLower = tag.toLowerCase();

    if (isNew) {
      // If the new tag matches an existing registry entry case-insensitively,
      // treat it as a reference to the existing tag (not an error)
      if (registryLower.includes(tagLower)) {
        continue;
      }

      // Validate length: 1–32 characters
      if (tag.length === 0) {
        return `Tag '' is invalid: must be at least 1 character.`;
      }
      if (tag.length > MAX_TAG_LENGTH) {
        return `Tag '${tag}' is invalid: must be at most ${MAX_TAG_LENGTH} characters.`;
      }

      // Validate pattern
      if (!TAG_PATTERN.test(tag)) {
        return `Tag '${tag}' contains invalid characters. Only lowercase alphanumeric, hyphens, and underscores are allowed.`;
      }
    } else {
      // Existing tag reference must exist in the registry (case-insensitive)
      if (!registryLower.includes(tagLower)) {
        return `Tag '${tag}' does not exist in the registry.`;
      }
    }
  }

  return null;
}
