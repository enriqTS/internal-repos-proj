import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(() => Promise.resolve('https://presigned-url.example.com')),
}));

vi.mock('./tag-registry', () => ({
  getTagRegistry: vi.fn(() => Promise.resolve(['web', 'api', 'frontend', 'backend'])),
}));

import { handler } from './initiate';

function makeEvent(body: object, method = 'POST'): any {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  };
}

describe('initiate handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUCKET_NAME = 'test-frontend-bucket';
    process.env.STAGING_BUCKET = 'test-staging-bucket';
  });

  it('returns 200 with sessionId, uploadUrl, expiresAt for a valid request', async () => {
    // First call: HeadObjectCommand throws NotFound → project doesn't exist
    // Second call: PutObjectCommand for writing metadata → succeeds
    const notFoundErr = new Error('NotFound') as any;
    notFoundErr.name = 'NotFound';
    notFoundErr.$metadata = { httpStatusCode: 404 };
    mockSend.mockRejectedValueOnce(notFoundErr).mockResolvedValueOnce({});

    const result = await handler(makeEvent({
      name: 'my-project',
      tags: [{ tag: 'web', isNew: false }, { tag: 'api', isNew: false }],
      readme: 'Hello',
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessionId).toBeDefined();
    expect(body.uploadUrl).toBe('https://presigned-url.example.com');
    expect(body.mode).toBe('zip');
    expect(body.expiresAt).toBeDefined();
  });

  it('returns 400 when name is missing', async () => {
    const result = await handler(makeEvent({ tags: [{ tag: 'web', isNew: false }] }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Missing required fields: name');
  });

  it('returns 400 for invalid project name', async () => {
    const result = await handler(makeEvent({ name: 'invalid name!' }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Allowed characters');
  });

  it('returns 409 when project already exists', async () => {
    // HeadObjectCommand succeeds → project exists
    mockSend.mockResolvedValueOnce({});

    const result = await handler(makeEvent({ name: 'existing-project', tags: [{ tag: 'web', isNew: false }] }));

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('already taken');
  });

  it('returns 200 for OPTIONS preflight request', async () => {
    const result = await handler(makeEvent({}, 'OPTIONS'));

    expect(result.statusCode).toBe(200);
    expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
  });
});
