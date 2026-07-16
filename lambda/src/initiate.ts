import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { validateMetadata, validateTagInputs } from './validate';
import { getTagRegistry } from './tag-registry';
import { PRESIGNED_URL_EXPIRY, MAX_CLIENT_ZIP_SIZE, MAX_TAGS_COUNT, serializeTags } from 'shared';
import type { InitiateRequest, InitiateResponse, SessionMetadata } from 'shared';

const s3Client = new S3Client({});

/** Standard CORS headers included in every response. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

/**
 * Lambda handler for POST /upload/initiate.
 * Validates metadata, checks for duplicate projects, generates presigned URL.
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
    // 1. Parse JSON body
    const body: InitiateRequest = JSON.parse(event.body || '{}');

    // 2. Validate metadata fields (name, readme)
    const validationError = validateMetadata({
      name: body.name,
      readme: body.readme,
    });
    if (validationError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: validationError }),
      };
    }

    // 3. Validate tags count
    const tags = body.tags ?? [];
    if (tags.length > MAX_TAGS_COUNT) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: `Maximum of ${MAX_TAGS_COUNT} tags allowed.` }),
      };
    }

    // 4. Fetch tag registry and validate tag inputs
    const registry = await getTagRegistry();
    const tagValidationError = validateTagInputs(tags, registry);
    if (tagValidationError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: tagValidationError }),
      };
    }

    const name = body.name.trim();
    const mode = (body as any).mode === 'replace' ? 'replace' : 'create';
    const frontendBucket = process.env.BUCKET_NAME!;
    const stagingBucket = process.env.STAGING_BUCKET!;

    // 5. Check project existence based on mode
    const exists = await projectExists(frontendBucket, name);
    if (mode === 'replace') {
      // In replace mode, the project MUST exist
      if (!exists) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: `Project not found: ${name}` }),
        };
      }
    } else {
      // In create mode, the project must NOT exist
      if (exists) {
        return {
          statusCode: 409,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: `Project name already taken: ${name}` }),
        };
      }
    }

    // 6. Generate UUID v4 session ID
    const sessionId = randomUUID();

    // 7. Serialize tags and extract new tags
    const serializedTags = serializeTags(tags.map((t) => t.tag));
    const newTags = tags.filter((t) => t.isNew).map((t) => t.tag);

    // 8. Write session metadata to staging bucket
    const metadata: SessionMetadata = {
      sessionId,
      name,
      tags: serializedTags,
      readme: body.readme ?? '',
      createdAt: new Date().toISOString(),
      ...(newTags.length > 0 && { newTags }),
      ...(mode === 'replace' && { mode: 'replace' as const }),
      ...(body.repositoryUrl && { repositoryUrl: body.repositoryUrl }),
    };

    await s3Client.send(
      new PutObjectCommand({
        Bucket: stagingBucket,
        Key: `staging/${sessionId}/metadata.json`,
        Body: JSON.stringify(metadata),
        ContentType: 'application/json',
      })
    );

    // 9. Generate presigned PUT URL for upload.zip
    const putCommand = new PutObjectCommand({
      Bucket: stagingBucket,
      Key: `staging/${sessionId}/upload.zip`,
      ContentType: 'application/zip',
    });

    const uploadUrl = await getSignedUrl(s3Client, putCommand, {
      expiresIn: PRESIGNED_URL_EXPIRY,
      signableHeaders: new Set(['content-length']),
      unhoistableHeaders: new Set(['content-length']),
    });

    const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRY * 1000).toISOString();

    // 10. Return response
    const response: InitiateResponse = {
      sessionId,
      uploadUrl,
      mode: 'zip',
      expiresAt,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify(response),
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
    if (
      err instanceof Error &&
      (err.name === 'NotFound' || (err as any).$metadata?.httpStatusCode === 404)
    ) {
      return false;
    }
    throw err;
  }
}
