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
    /** Required, max 50,000 chars */
    readme: string;
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
//# sourceMappingURL=types.d.ts.map