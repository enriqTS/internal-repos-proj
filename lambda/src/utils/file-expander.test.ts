import { describe, it, expect, vi, beforeEach } from 'vitest';
import { constructS3Key, generateManifest, expandFiles } from './file-expander';
import type { FileEntry } from 'shared/types';

// Mock @aws-sdk/client-s3
vi.mock('@aws-sdk/client-s3', () => {
  const mockSend = vi.fn().mockResolvedValue({});
  return {
    S3Client: vi.fn(() => ({ send: mockSend })),
    PutObjectCommand: vi.fn((input) => input),
  };
});

describe('constructS3Key', () => {
  it('builds correct key for projects prefix', () => {
    expect(constructS3Key('projects', 'my-project', 'src/main.ts'))
      .toBe('projects/my-project/files/src/main.ts');
  });

  it('builds correct key for templates prefix', () => {
    expect(constructS3Key('templates', 'my-template', 'index.html'))
      .toBe('templates/my-template/files/index.html');
  });

  it('handles nested file paths', () => {
    expect(constructS3Key('projects', 'app', 'src/components/Button.tsx'))
      .toBe('projects/app/files/src/components/Button.tsx');
  });

  it('handles root-level files', () => {
    expect(constructS3Key('projects', 'app', 'package.json'))
      .toBe('projects/app/files/package.json');
  });
});

describe('generateManifest', () => {
  it('generates manifest with correct version and counts', () => {
    const files: FileEntry[] = [
      { path: 'src/main.ts', content: Buffer.from('const x = 1;') },
      { path: 'package.json', content: Buffer.from('{}') },
    ];

    const manifest = generateManifest(files);

    expect(manifest.version).toBe(1);
    expect(manifest.totalFiles).toBe(2);
    expect(manifest.totalSize).toBe(12 + 2); // 'const x = 1;' = 12, '{}' = 2
  });

  it('deduces parent directories from file paths', () => {
    const files: FileEntry[] = [
      { path: 'src/components/Button.tsx', content: Buffer.from('export {}') },
      { path: 'src/main.ts', content: Buffer.from('import {}') },
    ];

    const manifest = generateManifest(files);

    const dirPaths = manifest.entries
      .filter((e) => e.type === 'directory')
      .map((e) => e.path);

    expect(dirPaths).toContain('src/');
    expect(dirPaths).toContain('src/components/');
  });

  it('does not duplicate directories', () => {
    const files: FileEntry[] = [
      { path: 'src/a.ts', content: Buffer.from('a') },
      { path: 'src/b.ts', content: Buffer.from('b') },
      { path: 'src/sub/c.ts', content: Buffer.from('c') },
    ];

    const manifest = generateManifest(files);

    const dirPaths = manifest.entries
      .filter((e) => e.type === 'directory')
      .map((e) => e.path);

    // 'src/' should appear only once
    expect(dirPaths.filter((p) => p === 'src/').length).toBe(1);
    expect(dirPaths).toContain('src/sub/');
  });

  it('produces correct file entries with sizes', () => {
    const content = Buffer.from('hello world');
    const files: FileEntry[] = [
      { path: 'readme.md', content },
    ];

    const manifest = generateManifest(files);

    const fileEntries = manifest.entries.filter((e) => e.type === 'file');
    expect(fileEntries).toHaveLength(1);
    expect(fileEntries[0]).toEqual({
      path: 'readme.md',
      type: 'file',
      size: content.length,
    });
  });

  it('produces no directory entries for root-level-only files', () => {
    const files: FileEntry[] = [
      { path: 'file1.txt', content: Buffer.from('a') },
      { path: 'file2.txt', content: Buffer.from('b') },
    ];

    const manifest = generateManifest(files);

    const dirEntries = manifest.entries.filter((e) => e.type === 'directory');
    expect(dirEntries).toHaveLength(0);
  });

  it('handles empty file list', () => {
    const manifest = generateManifest([]);

    expect(manifest.version).toBe(1);
    expect(manifest.totalFiles).toBe(0);
    expect(manifest.totalSize).toBe(0);
    expect(manifest.entries).toHaveLength(0);
  });
});

describe('expandFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct filesWritten count and manifest', async () => {
    const files: FileEntry[] = [
      { path: 'src/main.ts', content: Buffer.from('const x = 1;') },
      { path: 'package.json', content: Buffer.from('{}') },
    ];

    const result = await expandFiles(files, 'my-project', 'test-bucket');

    expect(result.filesWritten).toBe(2);
    expect(result.manifest.totalFiles).toBe(2);
    expect(result.manifest.version).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('records warnings when file writes fail', async () => {
    // Override the mock to fail for one file
    const { S3Client } = await import('@aws-sdk/client-s3');
    const mockSend = vi.fn()
      .mockRejectedValueOnce(new Error('Access Denied'))
      .mockResolvedValue({});

    vi.mocked(S3Client).mockImplementation(() => ({ send: mockSend }) as any);

    // Re-import to get new instance
    vi.resetModules();
    const { expandFiles: expandFilesFresh } = await import('./file-expander');

    const files: FileEntry[] = [
      { path: 'fail.txt', content: Buffer.from('fail') },
      { path: 'success.txt', content: Buffer.from('ok') },
    ];

    const result = await expandFilesFresh(files, 'proj', 'bucket');

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('fail.txt');
    expect(result.warnings[0]).toContain('Access Denied');
  });

  it('generates manifest regardless of write failures', async () => {
    const files: FileEntry[] = [
      { path: 'src/main.ts', content: Buffer.from('code') },
    ];

    const result = await expandFiles(files, 'proj', 'bucket');

    // Manifest should include the file entry even if write failed
    expect(result.manifest.entries.some((e) => e.path === 'src/main.ts')).toBe(true);
    expect(result.manifest.entries.some((e) => e.path === 'src/' && e.type === 'directory')).toBe(true);
  });
});
