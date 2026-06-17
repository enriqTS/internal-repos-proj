import { describe, it, expect } from 'vitest';
import { validateRequest, parseMultipartForm, handler } from './handler';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { FileEntry } from 'shared';

/**
 * Helper to create a minimal multipart/form-data body for testing.
 */
function buildMultipartBody(
  fields: Record<string, string>,
  files: Array<{ fieldname: string; filename: string; content: Buffer }> = [],
  boundary = '----TestBoundary'
): { body: string; contentType: string } {
  let bodyParts: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    bodyParts.push(`--${boundary}`);
    bodyParts.push(`Content-Disposition: form-data; name="${key}"`);
    bodyParts.push('');
    bodyParts.push(value);
  }

  for (const file of files) {
    bodyParts.push(`--${boundary}`);
    bodyParts.push(
      `Content-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"`
    );
    bodyParts.push('Content-Type: application/octet-stream');
    bodyParts.push('');
    bodyParts.push(file.content.toString('binary'));
  }

  bodyParts.push(`--${boundary}--`);

  const body = bodyParts.join('\r\n');
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function makeEvent(
  body: string,
  contentType: string,
  isBase64Encoded = false
): APIGatewayProxyEvent {
  return {
    body,
    isBase64Encoded,
    headers: { 'content-type': contentType },
    httpMethod: 'POST',
    path: '/upload',
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  };
}

describe('validateRequest', () => {
  it('should return error for missing name', () => {
    const result = validateRequest({
      readme: 'Hello',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBe('Missing required fields: name');
  });

  it('should accept missing readme (optional field)', () => {
    const result = validateRequest({
      name: 'my-project',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBeNull();
  });

  it('should accept undefined readme explicitly', () => {
    const result = validateRequest({
      name: 'my-project',
      readme: undefined,
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBeNull();
  });

  it('should accept whitespace-only readme', () => {
    const result = validateRequest({
      name: 'my-project',
      readme: '   \t\n  ',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBeNull();
  });

  it('should return error for missing files', () => {
    const result = validateRequest({
      name: 'my-project',
      readme: 'Hello',
      files: [],
    });
    expect(result).toBe('Missing required fields: files');
  });

  it('should return error listing multiple missing fields', () => {
    const result = validateRequest({ files: [] });
    expect(result).toBe('Missing required fields: name, files');
  });

  it('should return error for invalid project name characters', () => {
    const result = validateRequest({
      name: 'my project!',
      readme: 'Hello',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBe(
      'Invalid project name. Allowed characters: alphanumeric, hyphens, and underscores.'
    );
  });

  it('should return error for project name exceeding 64 characters', () => {
    const result = validateRequest({
      name: 'a'.repeat(65),
      readme: 'Hello',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBe('Project name must be at most 64 characters.');
  });

  it('should return error for readme exceeding 50,000 characters', () => {
    const result = validateRequest({
      name: 'my-project',
      readme: 'a'.repeat(50_001),
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBe('Readme content must be at most 50000 characters.');
  });

  it('should return error for more than 10 tags', () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`).join(',');
    const result = validateRequest({
      name: 'my-project',
      tags,
      readme: 'Hello',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBe('Maximum of 10 tags allowed.');
  });

  it('should return error for tag exceeding 32 characters', () => {
    const result = validateRequest({
      name: 'my-project',
      tags: 'a'.repeat(33),
      readme: 'Hello',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBe('Each tag must be at most 32 characters.');
  });

  it('should return null for valid request', () => {
    const result = validateRequest({
      name: 'my-project_123',
      tags: 'tag1, tag2, tag3',
      readme: 'This is a readme',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBeNull();
  });

  it('should return null for valid request with no tags', () => {
    const result = validateRequest({
      name: 'my-project',
      readme: 'Hello',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBeNull();
  });

  it('should accept project name at exactly 64 characters', () => {
    const result = validateRequest({
      name: 'a'.repeat(64),
      readme: 'Hello',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBeNull();
  });

  it('should accept exactly 10 tags', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`).join(',');
    const result = validateRequest({
      name: 'my-project',
      tags,
      readme: 'Hello',
      files: [{ path: 'file.txt', content: Buffer.from('hi') }],
    });
    expect(result).toBeNull();
  });
});

describe('parseMultipartForm', () => {
  it('should parse fields and files from multipart body', async () => {
    const { body, contentType } = buildMultipartBody(
      { name: 'test-project', tags: 'a,b', readme: 'Hello world' },
      [{ fieldname: 'files', filename: 'src/index.ts', content: Buffer.from('console.log("hi")') }]
    );

    const event = makeEvent(body, contentType);
    const result = await parseMultipartForm(event);

    expect(result.name).toBe('test-project');
    expect(result.tags).toBe('a,b');
    expect(result.readme).toBe('Hello world');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('src/index.ts');
    expect(result.files[0].content.toString()).toBe('console.log("hi")');
  });

  it('should handle base64-encoded body', async () => {
    const { body, contentType } = buildMultipartBody(
      { name: 'encoded-project', readme: 'Readme content' },
      [{ fieldname: 'files', filename: 'main.ts', content: Buffer.from('code') }]
    );

    const base64Body = Buffer.from(body).toString('base64');
    const event = makeEvent(base64Body, contentType, true);
    const result = await parseMultipartForm(event);

    expect(result.name).toBe('encoded-project');
    expect(result.readme).toBe('Readme content');
    expect(result.files).toHaveLength(1);
  });

  it('should reject non-multipart content type', async () => {
    const event = makeEvent('{}', 'application/json');
    await expect(parseMultipartForm(event)).rejects.toThrow(
      'Content-Type must be multipart/form-data'
    );
  });
});

describe('handler', () => {
  it('should return 400 for missing required fields', async () => {
    const { body, contentType } = buildMultipartBody({ name: 'test' }, []);
    const event = makeEvent(body, contentType);

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.error).toContain('Missing required fields');
    expect(responseBody.error).toContain('files');
  });

  it('should return 400 for invalid project name', async () => {
    const { body, contentType } = buildMultipartBody(
      { name: 'invalid name!', readme: 'Hello' },
      [{ fieldname: 'files', filename: 'file.txt', content: Buffer.from('data') }]
    );
    const event = makeEvent(body, contentType);

    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.error).toContain('Allowed characters');
  });

  it('should return 200 for a valid upload request', async () => {
    const { body, contentType } = buildMultipartBody(
      { name: 'valid-project', tags: 'tag1,tag2', readme: 'My readme' },
      [{ fieldname: 'files', filename: 'src/main.ts', content: Buffer.from('hello') }]
    );
    const event = makeEvent(body, contentType);

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.message).toBe('Project uploaded successfully');
    expect(responseBody.path).toBe('projects/valid-project/');
  });

  it('should return 500 for non-multipart content type', async () => {
    const event = makeEvent('{}', 'application/json');

    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.error).toContain('multipart/form-data');
  });
});
