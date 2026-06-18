import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// Use vi.hoisted so the mock fn is available when vi.mock factory runs
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn(() => ({ send: mockSend })),
    ListObjectsV2Command: vi.fn((input) => ({ _type: 'ListObjectsV2', ...input })),
    GetObjectCommand: vi.fn((input) => ({ _type: 'GetObject', ...input })),
    PutObjectCommand: vi.fn((input) => ({ _type: 'PutObject', ...input })),
  };
});

import { regenerateIndex } from './index-generator';

describe('index-generator', () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env.BUCKET_NAME = 'my-test-bucket';
  });

  afterEach(() => {
    delete process.env.BUCKET_NAME;
  });

  it('should throw error when BUCKET_NAME is not set', async () => {
    delete process.env.BUCKET_NAME;
    await expect(regenerateIndex()).rejects.toThrow(
      'BUCKET_NAME environment variable is not set'
    );
  });

  it('should return empty array when no projects exist', async () => {
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({ Contents: [], IsTruncated: false });
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await regenerateIndex();
    expect(result).toEqual([]);

    // Verify global-index.json was written with empty array
    const putCall = mockSend.mock.calls.find((c) => c[0]._type === 'PutObject');
    expect(putCall).toBeDefined();
    expect(putCall![0].Key).toBe('global-index.json');
    expect(putCall![0].Body).toBe('[]');
  });

  it('should build index from valid metadata files', async () => {
    const validMetadata = {
      name: 'project-alpha',
      description: 'Alpha project',
      tags: ['alpha', 'test'],
      date: '2024-01-15',
    };

    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [
            { Key: 'projects/project-alpha/metadata.json' },
            { Key: 'projects/project-alpha/readme.md' }, // should be ignored
          ],
          IsTruncated: false,
        });
      }
      if (command._type === 'GetObject') {
        return Promise.resolve({
          Body: {
            transformToString: () => Promise.resolve(JSON.stringify(validMetadata)),
          },
        });
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await regenerateIndex();
    expect(result).toEqual([
      {
        name: 'project-alpha',
        description: 'Alpha project',
        tags: ['alpha', 'test'],
        date: '2024-01-15',
        path: 'projects/project-alpha/',
      },
    ]);
  });

  it('should skip malformed JSON metadata', async () => {
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [{ Key: 'projects/bad-json/metadata.json' }],
          IsTruncated: false,
        });
      }
      if (command._type === 'GetObject') {
        return Promise.resolve({
          Body: {
            transformToString: () => Promise.resolve('not valid json {{{'),
          },
        });
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await regenerateIndex();
    expect(result).toEqual([]);
  });

  it('should skip metadata missing required fields', async () => {
    const incompleteMetadata = {
      name: 'missing-fields',
      // missing description, tags, date
    };

    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [{ Key: 'projects/missing-fields/metadata.json' }],
          IsTruncated: false,
        });
      }
      if (command._type === 'GetObject') {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              Promise.resolve(JSON.stringify(incompleteMetadata)),
          },
        });
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await regenerateIndex();
    expect(result).toEqual([]);
  });

  it('should skip unreadable metadata (GetObject fails)', async () => {
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [{ Key: 'projects/unreadable/metadata.json' }],
          IsTruncated: false,
        });
      }
      if (command._type === 'GetObject') {
        return Promise.reject(new Error('Access Denied'));
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await regenerateIndex();
    expect(result).toEqual([]);
  });

  it('should handle multiple projects with mixed valid and invalid metadata', async () => {
    const validMeta1 = {
      name: 'project-one',
      description: 'First project',
      tags: ['one'],
      date: '2024-01-01',
    };
    const validMeta2 = {
      name: 'project-three',
      description: 'Third project',
      tags: ['three'],
      date: '2024-03-01',
    };

    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [
            { Key: 'projects/project-one/metadata.json' },
            { Key: 'projects/project-two/metadata.json' },
            { Key: 'projects/project-three/metadata.json' },
          ],
          IsTruncated: false,
        });
      }
      if (command._type === 'GetObject') {
        const key = command.Key;
        if (key === 'projects/project-one/metadata.json') {
          return Promise.resolve({
            Body: {
              transformToString: () => Promise.resolve(JSON.stringify(validMeta1)),
            },
          });
        }
        if (key === 'projects/project-two/metadata.json') {
          // Invalid: missing description
          return Promise.resolve({
            Body: {
              transformToString: () =>
                Promise.resolve(JSON.stringify({ name: 'project-two', tags: [], date: '2024-02-01' })),
            },
          });
        }
        if (key === 'projects/project-three/metadata.json') {
          return Promise.resolve({
            Body: {
              transformToString: () => Promise.resolve(JSON.stringify(validMeta2)),
            },
          });
        }
        return Promise.reject(new Error('Not found'));
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await regenerateIndex();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('project-one');
    expect(result[1].name).toBe('project-three');
  });

  it('should handle paginated results from ListObjectsV2', async () => {
    const validMeta = {
      name: 'paginated-project',
      description: 'Found on page 2',
      tags: ['page2'],
      date: '2024-06-01',
    };

    let listCallCount = 0;
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        listCallCount++;
        if (listCallCount === 1) {
          return Promise.resolve({
            Contents: [],
            IsTruncated: true,
            NextContinuationToken: 'token-123',
          });
        }
        return Promise.resolve({
          Contents: [{ Key: 'projects/paginated-project/metadata.json' }],
          IsTruncated: false,
        });
      }
      if (command._type === 'GetObject') {
        return Promise.resolve({
          Body: {
            transformToString: () => Promise.resolve(JSON.stringify(validMeta)),
          },
        });
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await regenerateIndex();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('paginated-project');

    // Verify continuation token was used
    const listCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'ListObjectsV2');
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1][0].ContinuationToken).toBe('token-123');
  });

  it('should throw error when writing global-index.json fails', async () => {
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({ Contents: [], IsTruncated: false });
      }
      if (command._type === 'PutObject') {
        return Promise.reject(new Error('S3 write failure'));
      }
      return Promise.resolve({});
    });

    await expect(regenerateIndex()).rejects.toThrow(
      'Index generation failed: unable to write global-index.json to S3'
    );
  });

  it('should write correct content type and body for global-index.json', async () => {
    const validMeta = {
      name: 'content-check',
      description: 'Checking content',
      tags: ['check'],
      date: '2024-05-20',
    };

    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [{ Key: 'projects/content-check/metadata.json' }],
          IsTruncated: false,
        });
      }
      if (command._type === 'GetObject') {
        return Promise.resolve({
          Body: {
            transformToString: () => Promise.resolve(JSON.stringify(validMeta)),
          },
        });
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    await regenerateIndex();

    const putCall = mockSend.mock.calls.find((c) => c[0]._type === 'PutObject');
    expect(putCall).toBeDefined();
    expect(putCall![0].Bucket).toBe('my-test-bucket');
    expect(putCall![0].Key).toBe('global-index.json');
    expect(putCall![0].ContentType).toBe('application/json');

    const writtenBody = JSON.parse(putCall![0].Body);
    expect(writtenBody).toEqual([
      {
        name: 'content-check',
        description: 'Checking content',
        tags: ['check'],
        date: '2024-05-20',
        path: 'projects/content-check/',
      },
    ]);
  });

  it('should only match metadata.json at the direct project level', async () => {
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [
            { Key: 'projects/valid-proj/metadata.json' }, // valid
            { Key: 'projects/nested/subdir/metadata.json' }, // nested, should be ignored
            { Key: 'projects/metadata.json' }, // no project name, should be ignored
          ],
          IsTruncated: false,
        });
      }
      if (command._type === 'GetObject') {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              Promise.resolve(
                JSON.stringify({
                  name: 'valid-proj',
                  description: 'Valid',
                  tags: ['test'],
                  date: '2024-04-01',
                })
              ),
          },
        });
      }
      if (command._type === 'PutObject') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await regenerateIndex();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('valid-proj');
  });
});


/**
 * Bug Condition Exploration Test - Stale Index After Mutation
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.4**
 *
 * This test asserts that regenerateIndex() writes `global-index.json` with
 * `CacheControl: 'no-cache, must-revalidate'` so CloudFront revalidates on each request.
 *
 * EXPECTED TO FAIL on unfixed code — failure proves the bug exists:
 * the PutObjectCommand is called WITHOUT a CacheControl header.
 */
describe('Bug Condition: CacheControl header on global-index.json', () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env.BUCKET_NAME = 'my-test-bucket';
  });

  afterEach(() => {
    delete process.env.BUCKET_NAME;
  });

  it('regenerateIndex() MUST include CacheControl on PutObjectCommand for global-index.json', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-z0-9-]+$/.test(s)),
            description: fc.string({ minLength: 1, maxLength: 100 }),
            tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
            date: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }).map(d => d.toISOString().split('T')[0]),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        async (projects) => {
          mockSend.mockReset();

          const metadataKeys = projects.map(p => `projects/${p.name}/metadata.json`);

          mockSend.mockImplementation((command: any) => {
            if (command._type === 'ListObjectsV2') {
              return Promise.resolve({
                Contents: metadataKeys.map(Key => ({ Key })),
                IsTruncated: false,
              });
            }
            if (command._type === 'GetObject') {
              const key = command.Key as string;
              const project = projects.find(p => `projects/${p.name}/metadata.json` === key);
              if (project) {
                return Promise.resolve({
                  Body: {
                    transformToString: () => Promise.resolve(JSON.stringify(project)),
                  },
                });
              }
              return Promise.reject(new Error('Not found'));
            }
            if (command._type === 'PutObject') {
              return Promise.resolve({});
            }
            return Promise.resolve({});
          });

          await regenerateIndex();

          // Find the PutObjectCommand call for global-index.json
          const putCall = mockSend.mock.calls.find(
            (c) => c[0]._type === 'PutObject' && c[0].Key === 'global-index.json'
          );
          expect(putCall).toBeDefined();
          expect(putCall![0].CacheControl).toBe('no-cache, must-revalidate');
        },
      ),
      { numRuns: 20 },
    );
  });
});
