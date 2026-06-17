import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { ProjectIndexEntry, ProjectMetadata, SearchIndex } from 'shared';

const s3Client = new S3Client({});

/**
 * Validates that a parsed object has the required metadata fields:
 * name, description, tags, and date.
 */
function isValidMetadata(obj: unknown): obj is ProjectMetadata {
  if (obj === null || typeof obj !== 'object') {
    return false;
  }
  const record = obj as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.description === 'string' &&
    Array.isArray(record.tags) &&
    typeof record.date === 'string'
  );
}

/**
 * Lists all projects/star/metadata.json keys in the bucket using ListObjectsV2.
 * Handles pagination via ContinuationToken.
 */
async function listMetadataKeys(bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'projects/',
        ContinuationToken: continuationToken,
      })
    );

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.Key.match(/^projects\/[^/]+\/metadata\.json$/)) {
          keys.push(obj.Key);
        }
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Fetches and parses a metadata.json file from S3.
 * Returns null if the file cannot be read or is malformed.
 */
async function fetchMetadata(
  bucket: string,
  key: string
): Promise<ProjectMetadata | null> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    const body = await response.Body?.transformToString();
    if (!body) {
      return null;
    }

    const parsed = JSON.parse(body);
    if (!isValidMetadata(parsed)) {
      return null;
    }

    return parsed;
  } catch (_err) {
    // Skip unreadable or malformed metadata
    return null;
  }
}

/**
 * Extracts the project path prefix from a metadata.json key.
 * e.g., "projects/my-project/metadata.json" -> "projects/my-project/"
 */
function extractPath(key: string): string {
  return key.replace('metadata.json', '');
}

/**
 * Regenerates the global search index by scanning all projects in S3.
 *
 * 1. Lists all projects metadata.json keys
 * 2. Fetches and validates each metadata.json
 * 3. Skips malformed entries (invalid JSON or missing required fields)
 * 4. Builds a SearchIndex array
 * 5. Writes global-index.json to the bucket root
 * 6. Throws an error if writing the index fails (old index is preserved)
 */
export async function regenerateIndex(): Promise<SearchIndex> {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) {
    throw new Error('BUCKET_NAME environment variable is not set');
  }

  // Step 1: List all metadata.json keys
  const metadataKeys = await listMetadataKeys(bucket);

  // Step 2 & 3: Fetch and validate each metadata, skipping malformed ones
  const entries: ProjectIndexEntry[] = [];
  for (const key of metadataKeys) {
    const metadata = await fetchMetadata(bucket, key);
    if (metadata) {
      entries.push({
        name: metadata.name,
        description: metadata.description,
        tags: metadata.tags,
        date: metadata.date,
        path: extractPath(key),
      });
    }
  }

  // Step 4: Write global-index.json to bucket root
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: 'global-index.json',
        Body: JSON.stringify(entries),
        ContentType: 'application/json',
      })
    );
  } catch (err) {
    throw new Error(
      'Index generation failed: unable to write global-index.json to S3'
    );
  }

  return entries;
}
