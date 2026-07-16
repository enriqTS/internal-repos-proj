import archiver from 'archiver';
import { MAX_ARTIFACT_SIZE } from 'shared/constants';
import type { FileEntry } from 'shared/types';

/**
 * Error thrown when the resulting artifact zip exceeds the maximum allowed size.
 */
export class ArtifactTooLargeError extends Error {
  constructor() {
    super(`Artifact zip exceeds the maximum allowed size of ${MAX_ARTIFACT_SIZE} bytes`);
    this.name = 'ArtifactTooLargeError';
  }
}

/**
 * Creates a zip archive from the given file entries, preserving directory structure.
 *
 * @param files - Array of FileEntry objects (already filtered) with relative paths and content buffers
 * @returns A Buffer containing the zip archive
 * @throws ArtifactTooLargeError if the resulting zip exceeds MAX_ARTIFACT_SIZE (100 MB)
 */
export async function createArtifactZip(files: FileEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_ARTIFACT_SIZE) {
        archive.abort();
        reject(new ArtifactTooLargeError());
        return;
      }
      chunks.push(chunk);
    });

    archive.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length > MAX_ARTIFACT_SIZE) {
        reject(new ArtifactTooLargeError());
        return;
      }
      resolve(buffer);
    });

    archive.on('error', (err: Error) => {
      reject(err);
    });

    // Add each file to the archive preserving its relative path
    for (const file of files) {
      archive.append(file.content, { name: file.path });
    }

    archive.finalize();
  });
}
