import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getContentType } from 'shared/content-type-map';
import type { FileEntry, FileTreeManifest, FileTreeEntry } from 'shared/types';

/**
 * Result returned by the expandFiles function.
 */
export interface FileExpanderResult {
  /** Number of files successfully written to S3 */
  filesWritten: number;
  /** Generated file tree manifest */
  manifest: FileTreeManifest;
  /** Warnings for files that failed to write */
  warnings: string[];
}

const s3Client = new S3Client({});

/**
 * Construct the S3 key for an individual file within a project or template.
 * Produces keys like `projects/{name}/files/{filePath}` or `templates/{name}/files/{filePath}`.
 *
 * @param prefix - The top-level prefix (e.g., "projects" or "templates")
 * @param name - The project or template name
 * @param filePath - The relative file path from the project root
 * @returns The full S3 key string
 */
export function constructS3Key(prefix: string, name: string, filePath: string): string {
  return `${prefix}/${name}/files/${filePath}`;
}

/**
 * Generate a FileTreeManifest from a list of file entries.
 * Iterates all file paths, deduces parent directories, and produces a flat manifest
 * with version 1, totalFiles, totalSize, and entries array.
 *
 * @param files - Array of FileEntry objects with path and content buffer
 * @returns A complete FileTreeManifest
 */
export function generateManifest(files: FileEntry[]): FileTreeManifest {
  const directories = new Set<string>();
  const fileEntries: FileTreeEntry[] = [];
  let totalSize = 0;

  for (const file of files) {
    // Add file entry
    const size = file.content.length;
    totalSize += size;
    fileEntries.push({
      path: file.path,
      type: 'file',
      size,
    });

    // Deduce parent directories from the file path
    const parts = file.path.split('/');
    // Build each parent directory path (e.g., "src/components/Button.tsx" → "src/", "src/components/")
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/') + '/';
      directories.add(dirPath);
    }
  }

  // Build directory entries
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

/**
 * Expand files to individual S3 objects and generate a manifest.
 * Writes each file to S3 with the correct Content-Type header based on file extension.
 * Catches per-file errors and records them as warnings, continuing with remaining files.
 *
 * @param files - Array of FileEntry objects to expand
 * @param projectName - The project name used in S3 key construction
 * @param bucket - The target S3 bucket name
 * @returns FileExpanderResult with count of files written, manifest, and any warnings
 */
export async function expandFiles(
  files: FileEntry[],
  projectName: string,
  bucket: string,
): Promise<FileExpanderResult> {
  const warnings: string[] = [];
  let filesWritten = 0;

  // Write each file individually to S3
  const writePromises = files.map(async (file) => {
    const key = constructS3Key('projects', projectName, file.path);
    const contentType = getContentType(file.path);

    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: file.content,
          ContentType: contentType,
        }),
      );
      filesWritten++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      warnings.push(`Failed to write ${file.path}: ${message}`);
    }
  });

  await Promise.all(writePromises);

  // Generate manifest from the full file list (includes all files regardless of write failures)
  const manifest = generateManifest(files);

  return {
    filesWritten,
    manifest,
    warnings,
  };
}
