import { describe, it, expect } from 'vitest';
import { getDirectoryChildren, sortEntries, hasReadme } from './file-browser';
import type { FileTreeManifest, FileTreeEntry } from 'shared/types';

/**
 * Helper to build a minimal manifest from entries.
 */
function makeManifest(entries: FileTreeEntry[]): FileTreeManifest {
  const files = entries.filter((e) => e.type === 'file');
  return {
    version: 1,
    totalFiles: files.length,
    totalSize: files.reduce((sum, e) => sum + (e.size ?? 0), 0),
    entries,
  };
}

describe('getDirectoryChildren', () => {
  const manifest = makeManifest([
    { path: 'src/', type: 'directory' },
    { path: 'src/main.ts', type: 'file', size: 2048 },
    { path: 'src/utils.ts', type: 'file', size: 1024 },
    { path: 'src/components/', type: 'directory' },
    { path: 'src/components/Button.ts', type: 'file', size: 512 },
    { path: 'package.json', type: 'file', size: 256 },
    { path: 'README.md', type: 'file', size: 4096 },
    { path: 'tsconfig.json', type: 'file', size: 128 },
  ]);

  it('returns root-level children for empty dirPath', () => {
    const children = getDirectoryChildren(manifest, '');
    const paths = children.map((e) => e.path);
    expect(paths).toContain('src/');
    expect(paths).toContain('package.json');
    expect(paths).toContain('README.md');
    expect(paths).toContain('tsconfig.json');
    expect(paths).not.toContain('src/main.ts');
    expect(paths).not.toContain('src/components/');
    expect(children).toHaveLength(4);
  });

  it('returns root-level children for "/" dirPath', () => {
    const children = getDirectoryChildren(manifest, '/');
    expect(children).toHaveLength(4);
  });

  it('returns immediate children of "src/"', () => {
    const children = getDirectoryChildren(manifest, 'src/');
    const paths = children.map((e) => e.path);
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('src/utils.ts');
    expect(paths).toContain('src/components/');
    expect(paths).not.toContain('src/components/Button.ts');
    expect(children).toHaveLength(3);
  });

  it('returns immediate children of nested directory', () => {
    const children = getDirectoryChildren(manifest, 'src/components/');
    const paths = children.map((e) => e.path);
    expect(paths).toEqual(['src/components/Button.ts']);
  });

  it('returns empty array for non-existent directory', () => {
    const children = getDirectoryChildren(manifest, 'lib/');
    expect(children).toHaveLength(0);
  });

  it('returns empty array for empty manifest', () => {
    const empty = makeManifest([]);
    const children = getDirectoryChildren(empty, '');
    expect(children).toHaveLength(0);
  });
});

describe('sortEntries', () => {
  it('places directories before files', () => {
    const entries: FileTreeEntry[] = [
      { path: 'main.ts', type: 'file', size: 100 },
      { path: 'src/', type: 'directory' },
      { path: 'lib/', type: 'directory' },
      { path: 'index.ts', type: 'file', size: 50 },
    ];
    const sorted = sortEntries(entries);
    expect(sorted[0].type).toBe('directory');
    expect(sorted[1].type).toBe('directory');
    expect(sorted[2].type).toBe('file');
    expect(sorted[3].type).toBe('file');
  });

  it('sorts alphabetically within each group (case-insensitive)', () => {
    const entries: FileTreeEntry[] = [
      { path: 'Zebra/', type: 'directory' },
      { path: 'alpha/', type: 'directory' },
      { path: 'Beta/', type: 'directory' },
      { path: 'zoo.ts', type: 'file', size: 10 },
      { path: 'App.ts', type: 'file', size: 20 },
      { path: 'main.ts', type: 'file', size: 30 },
    ];
    const sorted = sortEntries(entries);
    // Directories: alpha, Beta, Zebra
    expect(sorted[0].path).toBe('alpha/');
    expect(sorted[1].path).toBe('Beta/');
    expect(sorted[2].path).toBe('Zebra/');
    // Files: App, main, zoo
    expect(sorted[3].path).toBe('App.ts');
    expect(sorted[4].path).toBe('main.ts');
    expect(sorted[5].path).toBe('zoo.ts');
  });

  it('returns empty array for empty input', () => {
    expect(sortEntries([])).toEqual([]);
  });

  it('does not mutate the original array', () => {
    const entries: FileTreeEntry[] = [
      { path: 'b.ts', type: 'file', size: 10 },
      { path: 'a.ts', type: 'file', size: 20 },
    ];
    const original = [...entries];
    sortEntries(entries);
    expect(entries).toEqual(original);
  });
});

describe('hasReadme', () => {
  it('finds README.md (case-insensitive)', () => {
    const manifest = makeManifest([
      { path: 'src/', type: 'directory' },
      { path: 'src/Readme.md', type: 'file', size: 1000 },
    ]);
    const result = hasReadme(manifest, 'src/');
    expect(result).not.toBeNull();
    expect(result!.path).toBe('src/Readme.md');
  });

  it('finds README without extension', () => {
    const manifest = makeManifest([
      { path: 'README', type: 'file', size: 500 },
    ]);
    const result = hasReadme(manifest, '');
    expect(result).not.toBeNull();
    expect(result!.path).toBe('README');
  });

  it('finds readme.md in root (lowercase)', () => {
    const manifest = makeManifest([
      { path: 'readme.md', type: 'file', size: 800 },
    ]);
    const result = hasReadme(manifest, '');
    expect(result).not.toBeNull();
  });

  it('returns null when no README exists', () => {
    const manifest = makeManifest([
      { path: 'src/', type: 'directory' },
      { path: 'src/main.ts', type: 'file', size: 200 },
    ]);
    const result = hasReadme(manifest, 'src/');
    expect(result).toBeNull();
  });

  it('does not match README in subdirectories', () => {
    const manifest = makeManifest([
      { path: 'src/', type: 'directory' },
      { path: 'src/docs/', type: 'directory' },
      { path: 'src/docs/README.md', type: 'file', size: 300 },
    ]);
    const result = hasReadme(manifest, 'src/');
    expect(result).toBeNull();
  });

  it('does not match directory entries named README', () => {
    const manifest = makeManifest([
      { path: 'README/', type: 'directory' },
    ]);
    const result = hasReadme(manifest, '');
    expect(result).toBeNull();
  });
});
