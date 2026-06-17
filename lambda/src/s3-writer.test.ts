import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProjectMetadata } from 'shared';

// Use vi.hoisted so the mock fn is available when vi.mock factory runs
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn(() => ({ send: mockSend })),
    PutObjectCommand: vi.fn((input) => ({ _type: 'PutObject', ...input })),
    HeadObjectCommand: vi.fn((input) => ({ _type: 'HeadObject', ...input })),
  };
});

import { writeProject, ProjectExistsError } from './s3-writer';

const sampleMetadata: ProjectMetadata = {
  name: 'test-project',
  description: 'A test project',
  tags: ['test', 'demo'],
  date: '2024-03-15',
};

describe('s3-writer', () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env.BUCKET_NAME = 'my-test-bucket';
  });

  afterEach(() => {
    delete process.env.BUCKET_NAME;
  });

  describe('writeProject', () => {
    it('should write all three files when project does not exist', async () => {
      // HeadObject throws NotFound (project doesn't exist)
      const notFoundError = new Error('NotFound');
      notFoundError.name = 'NotFound';
      mockSend.mockImplementation((command: any) => {
        if (command._type === 'HeadObject') {
          return Promise.reject(notFoundError);
        }
        return Promise.resolve({});
      });

      await writeProject({
        name: 'test-project',
        readme: '# Test Project',
        metadata: sampleMetadata,
        artifact: Buffer.from('fake-zip-content'),
      });

      // HeadObject call + 3 PutObject calls
      expect(mockSend).toHaveBeenCalledTimes(4);

      // Verify HeadObject was called with the correct key
      const headCall = mockSend.mock.calls[0][0];
      expect(headCall._type).toBe('HeadObject');
      expect(headCall.Bucket).toBe('my-test-bucket');
      expect(headCall.Key).toBe('projects/test-project/metadata.json');

      // Verify PutObject calls (order not guaranteed due to Promise.all)
      const putCalls = mockSend.mock.calls.slice(1).map((c) => c[0]);
      const keys = putCalls.map((c: any) => c.Key);
      expect(keys).toContain('projects/test-project/readme.md');
      expect(keys).toContain('projects/test-project/metadata.json');
      expect(keys).toContain('projects/test-project/artifact.zip');

      // Verify content types
      const readmeCall = putCalls.find((c: any) => c.Key === 'projects/test-project/readme.md');
      expect(readmeCall.ContentType).toBe('text/markdown');
      expect(readmeCall.Body).toBe('# Test Project');

      const metaCall = putCalls.find((c: any) => c.Key === 'projects/test-project/metadata.json');
      expect(metaCall.ContentType).toBe('application/json');
      expect(metaCall.Body).toBe(JSON.stringify(sampleMetadata));

      const artifactCall = putCalls.find((c: any) => c.Key === 'projects/test-project/artifact.zip');
      expect(artifactCall.ContentType).toBe('application/zip');
      expect(Buffer.isBuffer(artifactCall.Body)).toBe(true);
    });

    it('should throw ProjectExistsError when project already exists', async () => {
      // HeadObject succeeds (project exists)
      mockSend.mockResolvedValueOnce({});

      await expect(
        writeProject({
          name: 'existing-project',
          readme: '# Existing',
          metadata: sampleMetadata,
          artifact: Buffer.from('zip'),
        })
      ).rejects.toThrow(ProjectExistsError);

      await expect(
        writeProject({
          name: 'existing-project',
          readme: '# Existing',
          metadata: sampleMetadata,
          artifact: Buffer.from('zip'),
        })
      ).rejects.toThrow('Project name already taken: existing-project');
    });

    it('should throw error when BUCKET_NAME is not set', async () => {
      delete process.env.BUCKET_NAME;

      await expect(
        writeProject({
          name: 'test-project',
          readme: '# Test',
          metadata: sampleMetadata,
          artifact: Buffer.from('zip'),
        })
      ).rejects.toThrow('BUCKET_NAME environment variable is not set');
    });

    it('should propagate unexpected S3 errors from HeadObject', async () => {
      const accessDenied = new Error('Access Denied');
      accessDenied.name = 'AccessDenied';
      mockSend.mockRejectedValueOnce(accessDenied);

      await expect(
        writeProject({
          name: 'test-project',
          readme: '# Test',
          metadata: sampleMetadata,
          artifact: Buffer.from('zip'),
        })
      ).rejects.toThrow('Access Denied');
    });

    it('should handle NotFound via $metadata.httpStatusCode 404', async () => {
      const notFoundError = new Error('Not Found');
      (notFoundError as any).$metadata = { httpStatusCode: 404 };
      mockSend.mockImplementation((command: any) => {
        if (command._type === 'HeadObject') {
          return Promise.reject(notFoundError);
        }
        return Promise.resolve({});
      });

      await writeProject({
        name: 'new-project',
        readme: '# New',
        metadata: sampleMetadata,
        artifact: Buffer.from('zip-data'),
      });

      // Should succeed (HeadObject + 3 PutObjects)
      expect(mockSend).toHaveBeenCalledTimes(4);
    });
  });

  describe('ProjectExistsError', () => {
    it('should have correct name and message', () => {
      const error = new ProjectExistsError('my-project');
      expect(error.name).toBe('ProjectExistsError');
      expect(error.message).toBe('Project name already taken: my-project');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
