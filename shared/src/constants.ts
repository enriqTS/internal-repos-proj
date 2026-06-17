/**
 * Hardcoded deny list of file/directory patterns always excluded from artifacts.
 * Uses glob-style pattern matching.
 */
export const DENY_LIST: string[] = [
  '.git/',
  '.terraform/',
  'node_modules/',
  '__pycache__/',
  '.env',
  '.env.*',
  '*.pyc',
  '.DS_Store',
];

/**
 * Regex pattern for valid project names.
 * Allows alphanumeric characters, hyphens, and underscores only.
 */
export const PROJECT_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Maximum length for a project name */
export const MAX_PROJECT_NAME_LENGTH = 64;

/** Maximum number of tags per project */
export const MAX_TAGS_COUNT = 10;

/** Maximum length for a single tag */
export const MAX_TAG_LENGTH = 32;

/** Maximum length for readme content in characters */
export const MAX_README_LENGTH = 50_000;

/** Maximum total upload payload size in bytes (10 MB) */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/** Maximum artifact zip size in bytes (100 MB) */
export const MAX_ARTIFACT_SIZE = 100 * 1024 * 1024;
