import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend, mockGenerateReadme, mockSuggestTagsFromReadme, mockAddTagsToRegistry } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGenerateReadme: vi.fn(),
  mockSuggestTagsFromReadme: vi.fn(),
  mockAddTagsToRegistry: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
}));

vi.mock('./filter', () => ({
  filterFiles: vi.fn(() => ({ files: [{ path: 'index.ts', content: Buffer.from('hello') }] })),
  AllFilesFilteredError: class AllFilesFilteredError extends Error { constructor() { super('No files remain after filtering'); } },
}));

vi.mock('./archiver-wrapper', () => ({
  createArtifactZip: vi.fn(() => Promise.resolve(Buffer.from('fake-zip'))),
  ArtifactTooLargeError: class ArtifactTooLargeError extends Error { constructor() { super('Artifact too large'); } },
}));

vi.mock('./file-expander', () => ({
  expandFiles: vi.fn(() => Promise.resolve({
    filesWritten: 1,
    manifest: { version: 1, totalFiles: 1, totalSize: 5, entries: [{ path: 'index.ts', type: 'file', size: 5 }] },
    warnings: [],
  })),
}));

vi.mock('./s3-writer', () => ({
  writeProject: vi.fn(() => Promise.resolve()),
  ProjectExistsError: class ProjectExistsError extends Error { constructor(name: string) { super(`Project name already taken: ${name}`); } },
}));

vi.mock('./index-generator', () => ({
  regenerateIndex: vi.fn(() => Promise.resolve()),
}));

vi.mock('./generate-readme', () => ({
  generateReadme: mockGenerateReadme,
}));

vi.mock('./suggest-tags', () => ({
  suggestTagsFromReadme: mockSuggestTagsFromReadme,
}));

vi.mock('./tag-registry', () => ({
  addTagsToRegistry: mockAddTagsToRegistry,
  getTagRegistry: vi.fn(() => Promise.resolve(['react', 'typescript', 'node'])),
}));

import { handler } from './process';
import { writeProject } from './s3-writer';

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


describe('process handler - auto-tag integration', () => {
  /** Helper to set up S3 mock for a given session metadata */
  function setupS3Mock(metadata: object) {
    let callCount = 0;
    mockSend.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // metadata.json
        return {
          Body: { transformToString: () => Promise.resolve(JSON.stringify(metadata)) },
        };
      }
      if (callCount === 2) {
        // upload.zip - minimal valid zip
        const zipBytes = new Uint8Array([
          0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]);
        return {
          Body: { transformToByteArray: () => Promise.resolve(zipBytes) },
        };
      }
      // cleanup deletes / PutObject commands
      return Promise.resolve({});
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUCKET_NAME = 'test-frontend-bucket';
    process.env.STAGING_BUCKET = 'test-staging-bucket';
    mockGenerateReadme.mockResolvedValue({ readme: '' });
    mockSuggestTagsFromReadme.mockResolvedValue({ tags: [], newTags: [] });
    mockAddTagsToRegistry.mockResolvedValue([]);
  });

  it('auto-tags project when no readme and no tags in create mode', async () => {
    const metadata = {
      sessionId: 'session-1',
      name: 'my-project',
      tags: '',
      readme: '',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    setupS3Mock(metadata);

    // README generation produces a valid readme
    mockGenerateReadme.mockResolvedValue({ readme: '# My Project\nA cool project' });
    // Tag suggestion returns auto-tags
    mockSuggestTagsFromReadme.mockResolvedValue({ tags: ['react', 'typescript'], newTags: [] });

    const result = await handler(makeEvent({ sessionId: 'session-1' }));

    expect(result.statusCode).toBe(200);
    // suggestTagsFromReadme should be called with the generated readme
    expect(mockSuggestTagsFromReadme).toHaveBeenCalledWith('# My Project\nA cool project');
    // writeProject should have been called with auto-tags in metadata
    expect(writeProject).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tags: ['react', 'typescript'],
        }),
      })
    );
  });

  it('skips auto-tagging when user provides tags', async () => {
    const metadata = {
      sessionId: 'session-2',
      name: 'tagged-project',
      tags: 'python, flask',
      readme: '',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    setupS3Mock(metadata);

    mockGenerateReadme.mockResolvedValue({ readme: '# Tagged Project\nSome readme' });

    const result = await handler(makeEvent({ sessionId: 'session-2' }));

    expect(result.statusCode).toBe(200);
    // suggestTagsFromReadme should NOT be called because user provided tags
    expect(mockSuggestTagsFromReadme).not.toHaveBeenCalled();
    // writeProject should have user-provided tags
    expect(writeProject).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tags: ['python', 'flask'],
        }),
      })
    );
  });

  it('skips auto-tagging in replace mode regardless of tags/readme', async () => {
    const metadata = {
      sessionId: 'session-3',
      name: 'replace-project',
      tags: '',
      readme: '',
      mode: 'replace',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    setupS3Mock(metadata);

    const result = await handler(makeEvent({ sessionId: 'session-3' }));

    expect(result.statusCode).toBe(200);
    // In replace mode, neither generateReadme nor suggestTagsFromReadme should be called
    expect(mockGenerateReadme).not.toHaveBeenCalled();
    expect(mockSuggestTagsFromReadme).not.toHaveBeenCalled();
  });

  it('skips auto-tagging when README generation fails (fallback text)', async () => {
    const metadata = {
      sessionId: 'session-4',
      name: 'fallback-project',
      tags: '',
      readme: '',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    setupS3Mock(metadata);

    // README generation fails: returns empty string which becomes 'No description provided'
    mockGenerateReadme.mockResolvedValue({
      readme: '',
      warning: 'README generation failed: AbortError: The operation was aborted',
    });

    const result = await handler(makeEvent({ sessionId: 'session-4' }));

    expect(result.statusCode).toBe(200);
    // Auto-tagging should be skipped because readmeContent is "No description provided"
    expect(mockSuggestTagsFromReadme).not.toHaveBeenCalled();
    // writeProject should have empty tags
    expect(writeProject).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tags: [],
        }),
      })
    );
  });

  it('does NOT call addTagsToRegistry with auto-suggested tags', async () => {
    const metadata = {
      sessionId: 'session-5',
      name: 'no-registry-update',
      tags: '',
      readme: '',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    setupS3Mock(metadata);

    mockGenerateReadme.mockResolvedValue({ readme: '# Project\nSome content' });
    mockSuggestTagsFromReadme.mockResolvedValue(['react', 'node']);

    const result = await handler(makeEvent({ sessionId: 'session-5' }));

    expect(result.statusCode).toBe(200);
    // addTagsToRegistry should NOT be called since there are no newTags in metadata
    // and auto-suggested tags should never be added to the registry
    expect(mockAddTagsToRegistry).not.toHaveBeenCalled();
  });

  it('handles both README gen and tag suggestion failure with fallback content and both warnings', async () => {
    const metadata = {
      sessionId: 'session-6',
      name: 'double-fail',
      tags: '',
      readme: '',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    setupS3Mock(metadata);

    // README generation returns a warning but produces some readme content
    // The readme is non-empty so auto-tagging will be attempted
    mockGenerateReadme.mockResolvedValue({
      readme: '# Fallback Content',
      warning: 'README generation failed: timeout',
    });
    // Tag suggestion throws (defensive catch in process.ts)
    mockSuggestTagsFromReadme.mockRejectedValue(new Error('AI model timeout'));

    const result = await handler(makeEvent({ sessionId: 'session-6' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    // Both warnings should be present in the response
    expect(body.warning).toContain('README generation failed: timeout');
    expect(body.warning).toContain('Automatic tag suggestion was unsuccessful');
    // Project still created successfully with empty tags
    expect(writeProject).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tags: [],
        }),
      })
    );
  });
});
