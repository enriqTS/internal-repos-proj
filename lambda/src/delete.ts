import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PROJECT_NAME_REGEX, MAX_PROJECT_NAME_LENGTH } from 'shared';
import type { DeleteResponse } from 'shared';
import { regenerateIndex } from './index-generator';

const s3Client = new S3Client({});

/** Standard CORS headers included in every response. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,DELETE',
};

/**
 * Lambda handler for DELETE /projects/{name}.
 * Validates path parameter, checks project existence, deletes all project files,
 * regenerates global index, and returns confirmation.
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
    const bucket = process.env.BUCKET_NAME!;

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

    // 2. Check project existence via HeadObject on metadata.json
    const exists = await projectExists(bucket, name);
    if (!exists) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: `Project not found: ${name}` }),
      };
    }

    // 3. Delete all three objects under projects/{name}/
    const prefix = `projects/${name}/`;
    const keysToDelete = [
      `${prefix}metadata.json`,
      `${prefix}readme.md`,
      `${prefix}artifact.zip`,
    ];

    const deleteResults = await Promise.allSettled(
      keysToDelete.map((key) =>
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        )
      )
    );

    // 4. If any deletion fails, return 500 without regenerating index
    const failures = deleteResults.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({
          error: 'Partial deletion failure — some files could not be removed',
        }),
      };
    }

    // 5. Regenerate global index
    await regenerateIndex();

    // 6. Return success response
    const response: DeleteResponse = {
      message: `Project '${name}' deleted successfully`,
      name,
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
