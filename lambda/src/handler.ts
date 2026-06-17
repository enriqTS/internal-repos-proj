import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Busboy from 'busboy';
import {
  PROJECT_NAME_REGEX,
  MAX_PROJECT_NAME_LENGTH,
  MAX_TAGS_COUNT,
  MAX_TAG_LENGTH,
  MAX_README_LENGTH,
} from 'shared';
import type { FileEntry } from 'shared';

/**
 * Parsed fields from the multipart form-data request.
 */
interface ParsedFormData {
  name?: string;
  tags?: string;
  readme?: string;
  files: FileEntry[];
}

/**
 * Parse a multipart/form-data body from an API Gateway event.
 */
export function parseMultipartForm(event: APIGatewayProxyEvent): Promise<ParsedFormData> {
  return new Promise((resolve, reject) => {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Content-Type must be multipart/form-data'));
      return;
    }

    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf-8');

    const result: ParsedFormData = { files: [] };

    const busboy = Busboy({ headers: { 'content-type': contentType }, preservePath: true });

    busboy.on('field', (fieldname: string, value: string) => {
      if (fieldname === 'name') {
        result.name = value;
      } else if (fieldname === 'tags') {
        result.tags = value;
      } else if (fieldname === 'readme') {
        result.readme = value;
      }
    });

    busboy.on('file', (_fieldname: string, stream: NodeJS.ReadableStream, info: { filename: string }) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      stream.on('end', () => {
        const content = Buffer.concat(chunks);
        // Use the filename provided in the multipart metadata as the file path
        if (info.filename) {
          result.files.push({ path: info.filename, content });
        }
      });
    });

    busboy.on('finish', () => {
      resolve(result);
    });

    busboy.on('error', (err: Error) => {
      reject(err);
    });

    busboy.end(body);
  });
}

/**
 * Validate the parsed form data and return an error message if invalid, or null if valid.
 */
export function validateRequest(data: ParsedFormData): string | null {
  // Check required fields
  const missingFields: string[] = [];
  if (!data.name || data.name.trim().length === 0) {
    missingFields.push('name');
  }
  if (!data.readme || data.readme.trim().length === 0) {
    missingFields.push('readme');
  }
  if (!data.files || data.files.length === 0) {
    missingFields.push('files');
  }

  if (missingFields.length > 0) {
    return `Missing required fields: ${missingFields.join(', ')}`;
  }

  const name = data.name!.trim();

  // Validate project name format
  if (!PROJECT_NAME_REGEX.test(name)) {
    return 'Invalid project name. Allowed characters: alphanumeric, hyphens, and underscores.';
  }

  // Validate project name length
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return `Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters.`;
  }

  // Validate readme length
  if (data.readme!.length > MAX_README_LENGTH) {
    return `Readme content must be at most ${MAX_README_LENGTH} characters.`;
  }

  // Validate tags if provided
  if (data.tags && data.tags.trim().length > 0) {
    const tags = data.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);

    if (tags.length > MAX_TAGS_COUNT) {
      return `Maximum of ${MAX_TAGS_COUNT} tags allowed.`;
    }

    for (const tag of tags) {
      if (tag.length > MAX_TAG_LENGTH) {
        return `Each tag must be at most ${MAX_TAG_LENGTH} characters.`;
      }
    }
  }

  return null;
}

/**
 * Lambda handler entry point for the upload endpoint.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Parse multipart form data
    const formData = await parseMultipartForm(event);

    // Validate the request
    const validationError = validateRequest(formData);
    if (validationError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: validationError }),
      };
    }

    // At this point, validation has passed.
    // Further pipeline steps (filtering, archiving, S3 write, index regeneration)
    // will be wired in subsequent tasks.
    const name = formData.name!.trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Project uploaded successfully',
        path: `projects/${name}/`,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: message }),
    };
  }
}
