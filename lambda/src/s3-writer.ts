import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { ProjectMetadata } from 'shared';

/**
 * Custom error thrown when a project with the same name already exists in S3.
 */
export class ProjectExistsError extends Error {
  constructor(name: string) {
    super(`Project name already taken: ${name}`);
    this.name = 'ProjectExistsError';
  }
}

/** Parameters for writing a project to S3. */
export interface WriteProjectParams {
  name: string;
  readme: string;
  metadata: ProjectMetadata;
  artifact: Buffer;
}

const s3Client = new S3Client({});

/**
 * Check if a project already exists in S3 by attempting a HeadObject
 * on the project's metadata.json file.
 */
async function projectExists(bucket: string, name: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: `projects/${name}/metadata.json`,
      })
    );
    return true;
  } catch (err: unknown) {
    // NotFound (404) means the project doesn't exist
    if (
      err instanceof Error &&
      (err.name === 'NotFound' || (err as any).$metadata?.httpStatusCode === 404)
    ) {
      return false;
    }
    // Re-throw unexpected errors
    throw err;
  }
}

/**
 * Write a project's files (readme.md, metadata.json, artifact.zip) to S3.
 * Throws ProjectExistsError if a project with the same name already exists.
 */
export async function writeProject(params: WriteProjectParams): Promise<void> {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) {
    throw new Error('BUCKET_NAME environment variable is not set');
  }

  const { name, readme, metadata, artifact } = params;
  const prefix = `projects/${name}/`;

  // Check if project already exists
  const exists = await projectExists(bucket, name);
  if (exists) {
    throw new ProjectExistsError(name);
  }

  // Write all three files to S3
  await Promise.all([
    s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}readme.md`,
        Body: readme,
        ContentType: 'text/markdown',
      })
    ),
    s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}metadata.json`,
        Body: JSON.stringify(metadata),
        ContentType: 'application/json',
        CacheControl: 'max-age=0, no-cache, must-revalidate',
      })
    ),
    s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}artifact.zip`,
        Body: artifact,
        ContentType: 'application/zip',
      })
    ),
  ]);
}
