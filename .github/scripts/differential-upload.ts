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

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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

// ─── Directory Walker ────────────────────────────────────────────────────────

/**
 * Recursively walks a directory and returns all files with their relative paths.
 * Excludes directories listed in EXCLUDED_DIRS.
 * Always uses forward-slash separators in relativePath regardless of OS.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5
 */
export async function walkDirectory(baseDir: string): Promise<LocalFile[]> {
  const files: LocalFile[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name), relativePath);
      } else if (entry.isFile()) {
        const fileStat = await stat(join(dir, entry.name));
        files.push({
          relativePath,
          absolutePath: join(dir, entry.name),
          size: fileStat.size,
        });
      }
    }
  }

  await walk(baseDir, '');
  return files;
}

// ─── Hash Computation ────────────────────────────────────────────────────────

/**
 * Computes SHA-256 hashes for an array of local files.
 * Processes files sequentially for deterministic output ordering.
 * Returns both hex (for manifest) and base64 (for S3 ChecksumSHA256) representations.
 *
 * Requirements: 1.1, 1.5, 1.6
 */
export async function computeFileHashes(files: LocalFile[]): Promise<HashResult[]> {
  const results: HashResult[] = [];

  for (const file of files) {
    const content = await readFile(file.absolutePath);
    const hash = createHash('sha256');
    hash.update(content);
    const digest = hash.digest();

    results.push({
      relativePath: file.relativePath,
      hash: digest.toString('hex'),
      hashBase64: digest.toString('base64'),
      size: file.size,
    });
  }

  return results;
}

// ─── Diff Engine ─────────────────────────────────────────────────────────────

/**
 * Computes the differential between a local manifest and a remote manifest.
 * Pure function — compares `files` maps by hash value.
 *
 * If `remote` is null (first deploy), all local files are classified as "added".
 *
 * Requirements: 3.1, 3.4, 3.6
 */
export function computeDiff(local: HashManifest, remote: HashManifest | null): DiffResult {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  // If no remote manifest, all local files are new additions
  if (remote === null) {
    for (const path of Object.keys(local.files)) {
      added.push(path);
    }
    return { added, modified, deleted, unchanged };
  }

  // Classify local files against remote
  for (const path of Object.keys(local.files)) {
    if (!(path in remote.files)) {
      added.push(path);
    } else if (local.files[path].hash !== remote.files[path].hash) {
      modified.push(path);
    } else {
      unchanged.push(path);
    }
  }

  // Find deleted files (present remotely but not locally)
  for (const path of Object.keys(remote.files)) {
    if (!(path in local.files)) {
      deleted.push(path);
    }
  }

  return { added, modified, deleted, unchanged };
}

// ─── Manifest Management ─────────────────────────────────────────────────────

/**
 * Validates a parsed JSON object as a valid HashManifest.
 * Returns the object cast as HashManifest if valid, or null if invalid.
 * On unknown/invalid version, logs a warning.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */
export function validateManifest(parsed: unknown): HashManifest | null {
  if (parsed === null || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;

  // Check version field
  if (!('version' in obj)) return null;
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version)) {
    console.warn(`[manifest] Invalid version type: expected integer, got ${typeof obj.version} (${obj.version})`);
    return null;
  }
  if (obj.version !== 1) {
    console.warn(`[manifest] Unrecognized manifest version: ${obj.version}. Triggering full upload.`);
    return null;
  }

  // Check generatedAt field
  if (!('generatedAt' in obj) || typeof obj.generatedAt !== 'string') return null;

  // Check files field
  if (!('files' in obj) || obj.files === null || typeof obj.files !== 'object') return null;

  return parsed as HashManifest;
}

/**
 * Fetches the remote hash manifest from S3.
 * Returns null if the manifest does not exist (404/NoSuchKey).
 * Throws on transient errors (5xx, network timeout, access denied).
 *
 * Requirements: 2.2, 2.3, 2.4
 */
export async function fetchRemoteManifest(
  s3: S3Client,
  bucket: string,
  key: string
): Promise<HashManifest | null> {
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const bodyStr = await response.Body?.transformToString('utf-8');
    if (!bodyStr) {
      console.warn('[manifest] Empty response body from S3. Triggering full upload.');
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      console.warn('[manifest] Failed to parse remote manifest as JSON. Triggering full upload.');
      return null;
    }

    return validateManifest(parsed);
  } catch (err: unknown) {
    const error = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };

    // 404 / NoSuchKey → manifest does not exist yet
    if (
      error.name === 'NoSuchKey' ||
      error.Code === 'NotFound' ||
      error.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }

    // All other errors (5xx, network timeout, access denied) → throw
    throw err;
  }
}

/**
 * Uploads the hash manifest to S3. Validates serialized size before upload.
 * Throws if the manifest exceeds MAX_MANIFEST_SIZE (5 MB).
 *
 * Requirements: 2.1, 2.5, 8.7
 */
export async function uploadManifest(
  s3: S3Client,
  bucket: string,
  key: string,
  manifest: HashManifest
): Promise<void> {
  const body = JSON.stringify(manifest, null, 2);

  if (body.length > MAX_MANIFEST_SIZE) {
    throw new Error(
      `Manifest size (${body.length} bytes) exceeds maximum allowed size (${MAX_MANIFEST_SIZE} bytes)`
    );
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ChecksumAlgorithm: 'SHA256',
    })
  );
}

// ─── File Tree Generation ────────────────────────────────────────────────────

/**
 * Generates a file-tree.json manifest from a list of local files.
 * Produces the same schema as `expand-template-files.ts` generateManifest():
 * includes directory entries deduced from file paths, plus file entries with sizes.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export function generateFileTree(files: LocalFile[]): FileTreeManifest {
  let totalSize = 0;
  const directories = new Set<string>();
  const fileEntries: FileTreeEntry[] = [];

  for (const file of files) {
    totalSize += file.size;
    fileEntries.push({
      path: file.relativePath,
      type: 'file',
      size: file.size,
    });

    // Deduce parent directories from the relative path
    const parts = file.relativePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/') + '/';
      directories.add(dirPath);
    }
  }

  // Build sorted directory entries
  const dirEntries: FileTreeEntry[] = Array.from(directories)
    .sort()
    .map((path) => ({ path, type: 'directory' as const }));

  return {
    version: 1,
    totalFiles: files.length,
    totalSize,
    entries: [...dirEntries, ...fileEntries],
  };
}

// ─── S3 Upload Engine ────────────────────────────────────────────────────────

export interface UploadOptions {
  bucket: string;
  key: string;
  body: Buffer | string;
  contentType: string;
  checksumSHA256: string; // base64-encoded
}

/**
 * Uploads a file to S3 with ChecksumSHA256 integrity verification.
 * Retries up to 2 additional times on checksum mismatch errors.
 * On other errors, throws immediately (no retry).
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */
export async function uploadWithChecksum(s3: S3Client, options: UploadOptions): Promise<void> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: options.key,
          Body: options.body,
          ContentType: options.contentType,
          ChecksumSHA256: options.checksumSHA256,
          ChecksumAlgorithm: 'SHA256',
        })
      );
      return; // Success
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string };
      const errorName = error.name ?? '';
      const errorMessage = error.message ?? '';

      // Check if this is a checksum mismatch error
      const isChecksumError =
        errorName.includes('BadDigest') ||
        errorName.includes('checksum') ||
        errorName.includes('Checksum') ||
        errorMessage.includes('BadDigest') ||
        errorMessage.includes('checksum') ||
        errorMessage.includes('Checksum');

      if (!isChecksumError) {
        // Not a checksum error — throw immediately, no retry
        throw err;
      }

      if (attempt < maxRetries) {
        console.warn(
          `[upload] Checksum mismatch on attempt ${attempt + 1} for key "${options.key}". Retrying...`
        );
      } else {
        // Exhausted retries — throw the error
        throw err;
      }
    }
  }
}

/**
 * Deletes an object from S3.
 * Lets errors propagate to the caller.
 *
 * Requirements: 3.3
 */
export async function deleteS3Object(s3: S3Client, bucket: string, key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}
