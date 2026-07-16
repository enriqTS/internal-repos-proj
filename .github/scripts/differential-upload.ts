/**
 * CI/CD Differential Upload Script
 *
 * Computes SHA-256 content hashes for template files, compares against
 * a stored manifest in S3, and uploads only files that have changed.
 * Consolidates "Package and deploy templates" + "Expand template files"
 * into a single differential pipeline.
 *
 * Usage:
 *   npx tsx .github/scripts/differential-upload.ts <name> <source-dir> [prefix]
 *
 *   prefix defaults to "templates" if not provided.
 *
 * Environment:
 *   BUCKET_NAME — Target S3 bucket name (required)
 *
 * Requirements: 1.2, 8.1, 8.6, 9.1, 9.2, 9.3
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface LocalFile {
  relativePath: string;
  absolutePath: string;
  size: number;
}

export interface HashResult {
  relativePath: string;
  hash: string;       // lowercase hex, 64 chars
  hashBase64: string; // base64 of raw digest bytes (for ChecksumSHA256)
  size: number;
}

export interface HashManifest {
  version: 1;
  generatedAt: string; // ISO-8601 UTC (e.g., "2025-01-15T10:30:00.000Z")
  files: Record<string, { hash: string; size: number }>;
}

export interface DiffResult {
  added: string[];    // relative paths present locally but not remotely
  modified: string[]; // present in both, different hash
  deleted: string[];  // present remotely but not locally
  unchanged: string[];
}

export interface FileTreeEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface FileTreeManifest {
  version: 1;
  totalFiles: number;
  totalSize: number;
  entries: FileTreeEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.hypothesis',
  '.ruff_cache',
  '.kiro',
  '.venv',
  'venv',
  'dist',
  'build',
  '.terraform',
]);

export const MANIFEST_VERSION = 1;

export const MAX_MANIFEST_SIZE = 5 * 1024 * 1024; // 5 MB

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

// ─── Content-Type Mapping (mirrors expand-template-files.ts) ─────────────────

export const CONTENT_TYPE_MAP: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/plain',
  '.py': 'text/x-python',
  '.rs': 'text/plain',
  '.go': 'text/plain',
  '.java': 'text/plain',
  '.tf': 'text/plain',
  '.hcl': 'text/plain',
  '.sh': 'text/x-shellscript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

// ─── Content-Type Resolver ───────────────────────────────────────────────────

/**
 * Resolves the Content-Type for a file based on its extension.
 * Extracts the last dot-extension, lowercases it, and looks it up in CONTENT_TYPE_MAP.
 * Returns DEFAULT_CONTENT_TYPE if no extension or extension not in map.
 *
 * Requirements: 9.1, 9.2, 9.3
 */
export function getContentType(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return DEFAULT_CONTENT_TYPE;
  const ext = filename.slice(lastDot).toLowerCase();
  return CONTENT_TYPE_MAP[ext] ?? DEFAULT_CONTENT_TYPE;
}
