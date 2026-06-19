/**
 * Hardcoded deny list of file/directory patterns always excluded from artifacts.
 * Uses glob-style pattern matching.
 */
export const DENY_LIST: string[] = [
  // Version control
  '.git/',
  // Infrastructure
  '.terraform/',
  // Dependencies
  'node_modules/',
  'vendor/',
  '.venv/',
  'venv/',
  // Build outputs
  'dist/',
  'build/',
  'out/',
  'target/',
  '.next/',
  '.nuxt/',
  '.output/',
  'bin/',
  'obj/',
  // Caches
  '__pycache__/',
  '.cache/',
  '.parcel-cache/',
  // Env and secrets
  '.env',
  '.env.*',
  // Compiled/temp files
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

/** Maximum client-side zip size in bytes (500 MB) */
export const MAX_CLIENT_ZIP_SIZE = 500 * 1024 * 1024;

/** Presigned URL expiration in seconds (15 minutes) */
export const PRESIGNED_URL_EXPIRY = 15 * 60;

/** Maximum artifact zip size in bytes (100 MB) */
export const MAX_ARTIFACT_SIZE = 100 * 1024 * 1024;

/**
 * Regex pattern for valid tag names.
 * Allows lowercase alphanumeric characters, hyphens, and underscores only.
 */
export const TAG_PATTERN = /^[a-z0-9_-]+$/;

/** Maximum number of entries in the tag registry */
export const MAX_REGISTRY_SIZE = 500;

/** Maximum length for a repository URL */
export const MAX_REPOSITORY_URL_LENGTH = 2048;
