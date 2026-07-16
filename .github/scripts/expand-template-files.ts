/**
 * CI/CD File Expansion Script
 *
 * Walks a source directory, uploads each file individually to S3
 * under `{prefix}/{name}/files/{relativePath}`, and generates + uploads
 * a `file-tree.json` manifest.
 *
 * Usage:
 *   npx tsx .github/scripts/expand-template-files.ts <name> <source-dir> [prefix]
 *
 *   prefix defaults to "templates" if not provided. Use "projects" for project expansion.
 *
 * Environment:
 *   BUCKET_NAME — Target S3 bucket name (required)
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

// ─── Content-Type Mapping (mirrors shared/src/content-type-map.ts) ───────────

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

const CONTENT_TYPE_MAP: Record<string, string> = {
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

function getContentType(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return DEFAULT_CONTENT_TYPE;
  const ext = filename.slice(lastDot).toLowerCase();
  return CONTENT_TYPE_MAP[ext] ?? DEFAULT_CONTENT_TYPE;
}

// ─── File Tree Types ─────────────────────────────────────────────────────────

interface FileTreeEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

interface FileTreeManifest {
  version: 1;
  totalFiles: number;
  totalSize: number;
  entries: FileTreeEntry[];
}

// ─── Directory Walker ────────────────────────────────────────────────────────

interface LocalFile {
  relativePath: string;
  absolutePath: string;
  size: number;
}

/**
 * Recursively walks a directory and returns all files with their relative paths.
 * Excludes common non-deployable patterns (.git, node_modules, __pycache__, etc.).
 */
async function walkDirectory(baseDir: string, currentDir: string = ''): Promise<LocalFile[]> {
  const files: LocalFile[] = [];
  const fullPath = currentDir ? join(baseDir, currentDir) : baseDir;
  const entries = await readdir(fullPath, { withFileTypes: true });

  const EXCLUDED_DIRS = new Set([
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

  for (const entry of entries) {
    const relativePath = currentDir ? `${currentDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const subFiles = await walkDirectory(baseDir, relativePath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const fileStat = await stat(join(fullPath, entry.name));
      files.push({
        relativePath,
        absolutePath: join(fullPath, entry.name),
        size: fileStat.size,
      });
    }
  }

  return files;
}

// ─── Manifest Generation ─────────────────────────────────────────────────────

function generateManifest(files: LocalFile[]): FileTreeManifest {
  const directories = new Set<string>();
  const fileEntries: FileTreeEntry[] = [];
  let totalSize = 0;

  for (const file of files) {
    totalSize += file.size;
    fileEntries.push({
      path: file.relativePath,
      type: 'file',
      size: file.size,
    });

    // Deduce parent directories
    const parts = file.relativePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/') + '/';
      directories.add(dirPath);
    }
  }

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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [name, sourceDir, prefix = 'templates'] = process.argv.slice(2);

  if (!name || !sourceDir) {
    console.error('Usage: npx tsx .github/scripts/expand-template-files.ts <name> <source-dir> [prefix]');
    console.error('  prefix defaults to "templates". Use "projects" for project expansion.');
    process.exit(1);
  }

  const bucketName = process.env.BUCKET_NAME;
  if (!bucketName) {
    console.error('Error: BUCKET_NAME environment variable is required.');
    process.exit(1);
  }

  console.log(`Expanding "${name}" from "${sourceDir}" (prefix: ${prefix})...`);

  // 1. Walk the source directory
  const files = await walkDirectory(sourceDir);
  console.log(`  Found ${files.length} files.`);

  if (files.length === 0) {
    console.warn('  No files found in source directory. Skipping expansion.');
    return;
  }

  // 2. Upload each file to S3
  const s3Client = new S3Client({});
  let uploaded = 0;
  let failed = 0;

  for (const file of files) {
    const key = `${prefix}/${name}/files/${file.relativePath}`;
    const contentType = getContentType(file.relativePath);
    const body = await readFile(file.absolutePath);

    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      uploaded++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`  Failed to upload ${file.relativePath}: ${message}`);
      failed++;
    }
  }

  console.log(`  Uploaded ${uploaded} files (${failed} failed).`);

  // 3. Generate and upload manifest
  const manifest = generateManifest(files);
  const manifestKey = `${prefix}/${name}/file-tree.json`;
  const manifestBody = JSON.stringify(manifest, null, 2);

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: manifestKey,
        Body: manifestBody,
        ContentType: 'application/json',
      }),
    );
    console.log(`  Uploaded file-tree.json (${manifest.totalFiles} files, ${manifest.totalSize} bytes total).`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`  Failed to upload file-tree.json: ${message}`);
    process.exit(1);
  }

  console.log(`  "${name}" expansion complete.`);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
