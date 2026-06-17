/**
 * Hardcoded deny list of file/directory patterns always excluded from artifacts.
 * Uses glob-style pattern matching.
 */
export declare const DENY_LIST: string[];
/**
 * Regex pattern for valid project names.
 * Allows alphanumeric characters, hyphens, and underscores only.
 */
export declare const PROJECT_NAME_REGEX: RegExp;
/** Maximum length for a project name */
export declare const MAX_PROJECT_NAME_LENGTH = 64;
/** Maximum number of tags per project */
export declare const MAX_TAGS_COUNT = 10;
/** Maximum length for a single tag */
export declare const MAX_TAG_LENGTH = 32;
/** Maximum length for readme content in characters */
export declare const MAX_README_LENGTH = 50000;
/** Maximum total upload payload size in bytes (10 MB) */
export declare const MAX_UPLOAD_SIZE: number;
/** Maximum artifact zip size in bytes (100 MB) */
export declare const MAX_ARTIFACT_SIZE: number;
//# sourceMappingURL=constants.d.ts.map