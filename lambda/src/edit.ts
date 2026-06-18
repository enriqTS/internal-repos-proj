import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { ProjectMetadata, EditRequest } from 'shared';
import { PROJECT_NAME_REGEX, MAX_PROJECT_NAME_LENGTH } from 'shared';
import { validateEditRequest } from './validate';

const s3Client = new S3Client({});

/** Standard CORS headers included in every response. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,PATCH',
};

/**
 * Result of merging metadata with an edit request.
 * Contains the updated metadata and the full readme content (if provided)
 * for writing separately to readme.md.
 */
export interface MergeResult {
  /** Updated project metadata (description is first 200 chars of readme if provided) */
  metadata: ProjectMetadata;
  /** Full readme content to write to readme.md, or undefined if readme was not updated */
  readme: string | undefined;
}

/**
 * Merges an existing ProjectMetadata with an EditRequest, producing updated metadata.
 *
 * - Fields present in the EditRequest override existing values
 * - Omitted (undefined) fields are preserved from the existing metadata
 * - When `tags` is provided, metadata.tags is replaced with the new array
 * - When `readme` is provided, metadata.description is set to the first 200 characters
 *   and the full readme is returned separately for writing to readme.md
 * - When `name` is provided, metadata.name is updated
 */
export function mergeMetadata(existing: ProjectMetadata, request: EditRequest): MergeResult {
  const merged: ProjectMetadata = { ...existing };

  if (request.name !== undefined) {
    merged.name = request.name;
  }

  if (request.tags !== undefined) {
    merged.tags = request.tags;
  }

  let readme: string | undefined;

  if (request.readme !== undefined) {
    merged.description = request.readme.slice(0, 200);
    readme = request.readme;
  }

  return { metadata: merged, readme };
}

/**
 * Lambda handler for PATCH /projects/{name}.
 * Validates path parameter, parses request body, and applies edits to a project.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Handle preflight OPTIONS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS },
      body: '',
    };
  }

  try {
    // 1. Parse and validate path parameter {name}
    const name = event.pathParameters?.name;
    if (!name) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Invalid project name format' }),
      };
    }

    if (name.length > MAX_PROJECT_NAME_LENGTH || !PROJECT_NAME_REGEX.test(name)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Invalid project name format' }),
      };
    }

    // 2. Parse JSON request body as EditRequest
    const body: EditRequest = JSON.parse(event.body || '{}');

    // 3. Validate edit request fields
    const validationError = validateEditRequest(body);
    if (validationError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: validationError }),
      };
    }

    // 4. Check project existence via HeadObject on metadata.json
    const bucket = process.env.BUCKET_NAME!;
    const exists = await projectExists(bucket, name);
    if (!exists) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: `Project not found: ${name}` }),
      };
    }

    // 5. Fetch existing metadata.json
    const existingMetadata = await fetchMetadata(bucket, name);

    // 6. Merge existing metadata with edit request
    const { metadata: mergedMetadata, readme } = mergeMetadata(existingMetadata, body);

    // TODO: Steps below will be implemented in subsequent tasks (2.4–2.5)
    // - Handle rename flow (if name differs from path param)
    // - Write updated metadata.json and readme.md to S3
    // - Update tag registry with new tags
    // - Regenerate global-index.json

    return {
      statusCode: 501,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: 'Not yet implemented' }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: message }),
    };
  }
}

/**
 * Check if a project exists in S3 by attempting a HeadObject
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
    if (
      err instanceof Error &&
      (err.name === 'NotFound' || (err as any).$metadata?.httpStatusCode === 404)
    ) {
      return false;
    }
    throw err;
  }
}

/**
 * Fetch and parse the existing metadata.json for a project from S3.
 * Throws if the file cannot be read or parsed.
 */
async function fetchMetadata(bucket: string, name: string): Promise<ProjectMetadata> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: `projects/${name}/metadata.json`,
    })
  );

  const body = await response.Body?.transformToString();
  if (!body) {
    throw new Error(`Failed to read metadata for project: ${name}`);
  }

  return JSON.parse(body) as ProjectMetadata;
}
