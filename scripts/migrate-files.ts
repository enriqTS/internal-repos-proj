/**
 * One-time migration script: Explode existing project artifact.zip files into
 * individual S3 objects and generate file-tree.json manifests.
 *
 * This script finds all projects that have an artifact.zip but no file-tree.json,
 * downloads the zip, extracts it into individual files under projects/{name}/files/,
 * and generates the file-tree.json manifest.
 *
 * Usage:
 *   npx tsx scripts/migrate-files.ts
 *   npx tsx scripts/migrate-files.ts --dry-run
 *
 * Environment variables:
 *   BUCKET_NAME  — S3 bucket name (required)
 *   AWS_REGION   — AWS region (defaults to us-east-1)
 *
 * The script is idempotent: it checks for file-tree.json existence before processing.
 * If an individual project fails, the error is logged and processing continues.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import JSZip from 'jszip';

// ─── Content-Type mapping (inlined to avoid workspace dependency issues) ──────

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

// ─── Manifest generation (inlined from lambda/src/file-expander.ts) ───────────

interface FileEntry {
  path: string;
  content: Buffer;
}

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

function generateManifest(files: FileEntry[]): FileTreeManifest {
  const directories = new Set<string>();
  const fileEntries: FileTreeEntry[] = [];
  let totalSize = 0;

  for (const file of files) {
    const size = file.content.length;
    totalSize += size;
    fileEntries.push({ path: file.path, type: 'file', size });

    const parts = file.path.split('/');
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

// ─── S3 helpers ───────────────────────────────────────────────────────────────

const BUCKET_NAME = process.env.BUCKET_NAME;
if (!BUCKET_NAME) {
  console.error('Error: BUCKET_NAME environment variable is required.');
  process.exit(1);
}

const region = process.env.AWS_REGION ?? 'us-east-1';
const s3Client = new S3Client({ region });

const dryRun = process.argv.includes('--dry-run');

/**
 * Check if an S3 object exists.
 */
async function objectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    return true;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && err.name === 'NotFound') {
      return false;
    }
    // Also handle $metadata.httpStatusCode for older SDK behaviors
    if (
      err &&
      typeof err === 'object' &&
      '$metadata' in err &&
      (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404
    ) {
      return false;
    }
    throw err;
  }
}

/**
 * Download an S3 object as a Buffer.
 */
async function downloadObject(key: string): Promise<Buffer> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
  );
  const stream = response.Body;
  if (!stream) throw new Error(`Empty response body for key: ${key}`);
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Upload an object to S3.
 */
async function uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

// ─── Main migration logic ─────────────────────────────────────────────────────

/**
 * List all project prefixes under projects/.
 * Returns an array of project names (e.g., ["my-project", "another-project"]).
 */
async function listProjectNames(): Promise<string[]> {
  const names: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: 'projects/',
        Delimiter: '/',
        ContinuationToken: continuationToken,
      }),
    );

    for (const prefix of response.CommonPrefixes ?? []) {
      if (prefix.Prefix) {
        // Extract name from "projects/{name}/"
        const parts = prefix.Prefix.split('/');
        const name = parts[1];
        if (name) names.push(name);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return names;
}

/**
 * Migrate a single project: download artifact.zip, explode files, generate manifest.
 */
async function migrateProject(name: string): Promise<void> {
  const prefix = `projects/${name}`;
  const manifestKey = `${prefix}/file-tree.json`;
  const artifactKey = `${prefix}/artifact.zip`;

  // Idempotent: skip if manifest already exists
  if (await objectExists(manifestKey)) {
    console.log(`  ⏭ ${name}: file-tree.json already exists, skipping`);
    return;
  }

  // Check artifact exists
  if (!(await objectExists(artifactKey))) {
    console.log(`  ⏭ ${name}: no artifact.zip found, skipping`);
    return;
  }

  if (dryRun) {
    console.log(`  📋 ${name}: needs migration (dry-run, no changes made)`);
    return;
  }

  // Download and extract zip
  console.log(`  ⬇ ${name}: downloading artifact.zip...`);
  const zipBuffer = await downloadObject(artifactKey);
  const zip = await JSZip.loadAsync(zipBuffer);

  // Extract files from zip
  const files: FileEntry[] = [];
  const zipEntries = Object.entries(zip.files);

  for (const [relativePath, zipEntry] of zipEntries) {
    // Skip directories
    if (zipEntry.dir) continue;
    // Skip empty paths or paths that start with __MACOSX (macOS zip artifacts)
    if (!relativePath || relativePath.startsWith('__MACOSX/')) continue;

    const content = await zipEntry.async('nodebuffer');
    files.push({ path: relativePath, content });
  }

  if (files.length === 0) {
    console.log(`  ⚠ ${name}: artifact.zip contains no files, skipping`);
    return;
  }

  // Upload individual files
  console.log(`  ⬆ ${name}: uploading ${files.length} files...`);
  let uploadedCount = 0;

  for (const file of files) {
    const fileKey = `${prefix}/files/${file.path}`;

    // Idempotent: check if file already exists
    if (await objectExists(fileKey)) {
      uploadedCount++;
      continue;
    }

    const contentType = getContentType(file.path);
    await uploadObject(fileKey, file.content, contentType);
    uploadedCount++;
  }

  // Generate and upload manifest
  const manifest = generateManifest(files);
  const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');
  await uploadObject(manifestKey, manifestBody, 'application/json');

  console.log(`  ✓ ${name}: ${uploadedCount} files expanded, manifest generated`);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log(`\n🔄 File Migration Script`);
  console.log(`   Bucket: ${BUCKET_NAME}`);
  console.log(`   Region: ${region}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  const projectNames = await listProjectNames();
  console.log(`Found ${projectNames.length} project(s) to check.\n`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of projectNames) {
    try {
      const manifestKey = `projects/${name}/file-tree.json`;
      const hadManifest = await objectExists(manifestKey);

      await migrateProject(name);

      if (hadManifest) {
        skipped++;
      } else {
        migrated++;
      }
    } catch (err: unknown) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${name}: ERROR — ${message}`);
      // Continue with remaining projects
    }
  }

  console.log(`\n─── Summary ───`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Total:    ${projectNames.length}\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
