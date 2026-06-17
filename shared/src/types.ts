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
  /** Comma-separated tags, max 10 tags, each max 32 chars */
  tags?: string;
  /** Optional readme content, max 50,000 chars */
  readme?: string;
}

/**
 * Response from POST /upload/initiate.
 */
export interface InitiateResponse {
  /** UUID v4 identifying the upload session */
  sessionId: string;
  /** Presigned S3 PUT URL for uploading the zip */
  uploadUrl: string;
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
}
