import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { validateMetadata } from './validate';
import { PRESIGNED_URL_EXPIRY, MAX_CLIENT_ZIP_SIZE } from 'shared';
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

    // 2. Validate metadata fields
    const validationError = validateMetadata({
      name: body.name,
      tags: body.tags,
      readme: body.readme,
    });
    if (validationError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: validationError }),
      };
    }

    const name = body.name.trim();
    const frontendBucket = process.env.BUCKET_NAME!;
    const stagingBucket = process.env.STAGING_BUCKET!;

    // 3. Check project doesn't already exist
    const exists = await projectExists(frontendBucket, name);
    if (exists) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: `Project name already taken: ${name}` }),
      };
    }

    // 4. Generate UUID v4 session ID
    const sessionId = randomUUID();

    // 5. Write session metadata to staging bucket
    const metadata: SessionMetadata = {
      sessionId,
      name,
      tags: body.tags ?? '',
      readme: body.readme ?? '',
      createdAt: new Date().toISOString(),
    };

    await s3Client.send(
      new PutObjectCommand({
        Bucket: stagingBucket,
        Key: `staging/${sessionId}/metadata.json`,
        Body: JSON.stringify(metadata),
        ContentType: 'application/json',
      })
    );

    // 6. Generate presigned PUT URL for upload.zip
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

    // 7. Return response
    const response: InitiateResponse = {
      sessionId,
      uploadUrl,
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
