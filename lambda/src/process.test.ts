import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock('./filter', () => ({
  filterFiles: vi.fn(() => ({ files: [{ path: 'index.ts', content: Buffer.from('hello') }] })),
  AllFilesFilteredError: class AllFilesFilteredError extends Error { constructor() { super('No files remain after filtering'); } },
}));

vi.mock('./archiver-wrapper', () => ({
  createArtifactZip: vi.fn(() => Promise.resolve(Buffer.from('fake-zip'))),
  ArtifactTooLargeError: class ArtifactTooLargeError extends Error { constructor() { super('Artifact too large'); } },
}));

vi.mock('./s3-writer', () => ({
  writeProject: vi.fn(() => Promise.resolve()),
  ProjectExistsError: class ProjectExistsError extends Error { constructor(name: string) { super(`Project name already taken: ${name}`); } },
}));

vi.mock('./index-generator', () => ({
  regenerateIndex: vi.fn(() => Promise.resolve()),
}));

import { handler } from './process';

function makeEvent(body: object, method = 'POST'): any {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  };
}

describe('process handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUCKET_NAME = 'test-frontend-bucket';
    process.env.STAGING_BUCKET = 'test-staging-bucket';
  });

  it('returns 200 with message and path for valid finalization', async () => {
    const metadata = JSON.stringify({
      sessionId: 'abc-123',
      name: 'my-project',
      tags: 'web,api',
      readme: 'Hello world',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    // First call: GetObjectCommand for metadata.json
    // Second call: GetObjectCommand for upload.zip
    // Subsequent calls: DeleteObjectCommand for cleanup
    let callCount = 0;
    mockSend.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // metadata.json
        return {
          Body: { transformToString: () => Promise.resolve(metadata) },
        };
      }
      if (callCount === 2) {
        // upload.zip - return a minimal valid zip
        // PK header for an empty zip
        const zipBytes = new Uint8Array([
          0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]);
        return {
          Body: { transformToByteArray: () => Promise.resolve(zipBytes) },
        };
      }
      // cleanup deletes
      return Promise.resolve({});
    });

    const result = await handler(makeEvent({ sessionId: 'abc-123' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Project uploaded successfully');
    expect(body.path).toBe('projects/my-project/');
  });

  it('returns 400 when sessionId is missing', async () => {
    const result = await handler(makeEvent({}));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Missing required field: sessionId');
  });

  it('returns 404 when session metadata is not found in S3', async () => {
    mockSend.mockImplementation(() => {
      const err = new Error('NoSuchKey') as any;
      err.name = 'NoSuchKey';
      err.$metadata = { httpStatusCode: 404 };
      throw err;
    });

    const result = await handler(makeEvent({ sessionId: 'nonexistent-session' }));

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('not found');
  });

  it('returns 200 for OPTIONS preflight request', async () => {
    const result = await handler(makeEvent({}, 'OPTIONS'));

    expect(result.statusCode).toBe(200);
    expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
  });
});
