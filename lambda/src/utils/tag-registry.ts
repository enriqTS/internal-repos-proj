import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { normalizeTag, MAX_REGISTRY_SIZE } from 'shared';

const s3Client = new S3Client({});
const TAG_REGISTRY_KEY = 'tags.json';

/**
 * Fetch the current tag registry from S3.
 * Returns an empty array if the registry file does not exist (NoSuchKey).
 */
export async function getTagRegistry(): Promise<string[]> {
  const bucket = process.env.BUCKET_NAME!;

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: TAG_REGISTRY_KEY,
      })
    );

    const body = await response.Body!.transformToString();
    const tags: string[] = JSON.parse(body);
    return tags;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'NoSuchKey') {
      return [];
    }
    throw err;
  }
}

/**
 * Add new tags to the registry and persist.
 * Normalizes, deduplicates, sorts alphabetically, and enforces the 500-entry cap.
 * Returns the updated tag list.
 */
export async function addTagsToRegistry(newTags: string[]): Promise<string[]> {
  const bucket = process.env.BUCKET_NAME!;

  // Fetch current registry
  const currentTags = await getTagRegistry();

  // Build a set from existing tags for deduplication
  const tagSet = new Set(currentTags.map((t) => normalizeTag(t)));

  // Add new tags (normalized and deduplicated)
  for (const tag of newTags) {
    const normalized = normalizeTag(tag);
    if (normalized.length > 0) {
      tagSet.add(normalized);
    }
  }

  // Sort alphabetically and enforce max size
  const updatedTags = Array.from(tagSet).sort().slice(0, MAX_REGISTRY_SIZE);

  // Write back to S3
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: TAG_REGISTRY_KEY,
      Body: JSON.stringify(updatedTags),
      ContentType: 'application/json',
    })
  );

  return updatedTags;
}
