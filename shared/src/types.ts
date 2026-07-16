/**
 * Represents a single project entry in the global search index (global-index.json).
 */
export interface ProjectIndexEntry {
  /** Project name: 1-64 chars, alphanumeric + hyphens + underscores */
  name: string;
  /** Free text description from metadata */
  description: string;
  /** 1-10 tags, each 1-32 chars */
  tags: string[];
  /** ISO date format "YYYY-MM-DD" */
  date: string;
  /** S3 prefix "projects/{name}/" */
  path: string;
}

/** The full search index is an array of project entries. */
export type SearchIndex = ProjectIndexEntry[];

/**
 * Per-project metadata stored in metadata.json.
 */
export interface ProjectMetadata {
  name: string;
  description: string;
  tags: string[];
  date: string;
  /** Optional repository URL extracted from .git/config or manually provided */
  repositoryUrl?: string;
}

/**
 * Represents a single tag input in a structured upload request.
 * Tags can be references to existing registry entries or newly created tags.
 */
export interface TagInput {
  /** The tag string (lowercase, alphanumeric + hyphens + underscores) */
  tag: string;
  /** Whether this is a new tag not yet in the registry */
  isNew: boolean;
}

/**
 * Represents the upload request validated by the Lambda handler.
 */
export interface UploadRequest {
  /** Required, max 64 chars, /^[a-zA-Z0-9_-]+$/ */
  name: string;
  /** Required, comma-separated list of tags */
  tags: string;
  /** Optional, max 50,000 chars when provided */
  readme?: string;
  /** Required, at least 1 file after filtering */
  files: FileEntry[];
}

/**
 * A single file included in an upload.
 */
export interface FileEntry {
  /** Relative path from project root */
  path: string;
  /** File content */
  content: Buffer;
}

/**
 * Request body for POST /upload/initiate.
 */
export interface InitiateRequest {
  /** Project name: 1-64 chars, /^[a-zA-Z0-9_-]+$/ */
  name: string;
  /** Structured tag inputs — each tag is either an existing reference or a new tag */
  tags?: TagInput[];
  /** Optional readme content, max 50,000 chars */
  readme?: string;
  /** Upload mode: 'create' for new projects, 'replace' for artifact replacement */
  mode?: 'create' | 'replace';
  /** Optional repository URL, extracted client-side from .git/config or provided manually */
  repositoryUrl?: string;
  /** Upload type: 'zip' for single zip upload, 'folder' for individual file uploads. Defaults to 'zip'. */
  uploadType?: 'zip' | 'folder';
  /** File paths for folder mode — required when uploadType is 'folder' */
  filePaths?: string[];
}

/**
 * Response from POST /upload/initiate.
 */
export interface InitiateResponse {
  /** UUID v4 identifying the upload session */
  sessionId: string;
  /** Presigned S3 PUT URL for uploading the zip (zip mode) */
  uploadUrl?: string;
  /** Multiple presigned URLs mapped by file path (folder mode) */
  uploadUrls?: Record<string, string>;
  /** Upload mode for the frontend to track */
  mode: 'zip' | 'folder';
  /** ISO 8601 timestamp when the presigned URL expires (15 min from creation) */
  expiresAt: string;
}

/**
 * Request body for POST /upload/finalize.
 */
export interface FinalizeRequest {
  /** UUID from the initiate response */
  sessionId: string;
}

/**
 * Response from POST /upload/finalize.
 */
export interface FinalizeResponse {
  /** Success message */
  message: string;
  /** Project path, e.g. "projects/{name}/" */
  path: string;
  /** Optional warning, e.g. ".gitignore parse failure" */
  warning?: string;
}

/**
 * Metadata stored in S3 at staging/{sessionId}/metadata.json.
 */
export interface SessionMetadata {
  /** UUID v4 identifying the upload session */
  sessionId: string;
  /** Validated project name */
  name: string;
  /** Comma-separated tags */
  tags: string;
  /** Readme content */
  readme: string;
  /** ISO 8601 timestamp of session creation */
  createdAt: string;
  /** Tags that need to be added to the registry during finalize */
  newTags?: string[];
  /** Upload mode: 'create' for new projects, 'replace' for artifact replacement */
  mode?: 'create' | 'replace';
  /** Repository URL extracted from .git/config or provided by user */
  repositoryUrl?: string;
  /** Upload type: "zip" for single zip upload, "folder" for individual file uploads */
  uploadType?: 'zip' | 'folder';
  /** File paths for folder mode — used to track staged files */
  filePaths?: string[];
}

/**
 * Request body for PATCH /projects/{name}.
 * At least one field must be provided.
 */
export interface EditRequest {
  /** New project name (optional, triggers rename). 1-64 chars, /^[a-zA-Z0-9_-]+$/ */
  name?: string;
  /** Updated tags array (optional). 1-10 items, each 1-32 chars, /^[a-z0-9_-]+$/ */
  tags?: string[];
  /** Updated readme content (optional). Max 50,000 chars */
  readme?: string;
  /** Repository URL (optional). Must be a valid HTTP(S) URL, max 2048 chars */
  repositoryUrl?: string;
}

/**
 * Response from PATCH /projects/{name}.
 */
export interface EditResponse {
  /** Success message */
  message: string;
  /** Updated project metadata */
  metadata: ProjectMetadata;
  /** Whether the project was renamed */
  renamed?: boolean;
}

/**
 * Response from DELETE /projects/{name}.
 */
export interface DeleteResponse {
  /** Confirmation message */
  message: string;
  /** Name of the deleted project */
  name: string;
}

// ─── File Tree Types ──────────────────────────────────────────────────────────

/**
 * The complete file tree manifest stored at {prefix}/file-tree.json.
 * Flat array of all entries (files and directories) for efficient lookup.
 */
export interface FileTreeManifest {
  /** Schema version for forward compatibility */
  version: 1;
  /** Total number of files (excluding directories) */
  totalFiles: number;
  /** Total size in bytes across all files */
  totalSize: number;
  /** Flat list of all entries */
  entries: FileTreeEntry[];
}

/**
 * A single entry in the file tree (either a file or directory).
 */
export interface FileTreeEntry {
  /** Relative path from project root, e.g. "src/main.ts" or "src/" for dirs */
  path: string;
  /** Entry type */
  type: 'file' | 'directory';
  /** File size in bytes (only present for type: "file") */
  size?: number;
}

// ─── Template Types ───────────────────────────────────────────────────────────

/**
 * Represents a single template entry in the template index (templates-index.json).
 */
export interface TemplateIndexEntry {
  /** Template name: 1–64 chars, pattern /^[a-zA-Z0-9_-]+$/ */
  name: string;
  /** Description: 0–200 chars */
  description: string;
  /** Tags: 0–50 items, each 1–32 chars matching /^[a-z0-9_-]+$/ */
  tags: string[];
  /** ISO 8601 date: "YYYY-MM-DD" */
  date: string;
  /** S3 path prefix: "templates/{name}/" */
  path: string;
  /** Optional architecture image filename hint to avoid trial-and-error fetching */
  architectureImage?: 'architecture.png' | 'architecture.svg';
}

/** The full template index is an array of template entries. */
export type TemplateIndex = TemplateIndexEntry[];

/**
 * Per-template metadata stored in templates/{name}/metadata.json.
 * Contains the same fields as TemplateIndexEntry (minus path) plus an optional language field.
 */
export interface TemplateMetadata {
  /** Template name: 1–64 chars, pattern /^[a-zA-Z0-9_-]+$/ */
  name: string;
  /** Description: 0–200 chars */
  description: string;
  /** Tags: 0–50 items, each 1–32 chars matching /^[a-z0-9_-]+$/ */
  tags: string[];
  /** ISO 8601 date: "YYYY-MM-DD" */
  date: string;
  /** Optional primary programming language or framework name: 0–64 chars */
  language?: string;
  /** Optional architecture image filename hint to avoid trial-and-error fetching */
  architectureImage?: 'architecture.png' | 'architecture.svg';
}

// ─── Tag Suggestion Types ────────────────────────────────────────────────────

/**
 * Request body for POST /tags/suggest.
 */
export interface SuggestTagsRequest {
  /** README content to analyze for tag suggestions */
  readme: string;
}

/**
 * Response from POST /tags/suggest.
 */
export interface SuggestTagsResponse {
  /** Array of suggested tags (all exist in the tag registry) */
  tags: string[];
  /** Array of AI-suggested new tags not yet in the registry (up to 3) */
  newTags?: string[];
}
