import { describe, it, expect } from 'vitest';
import { mergeMetadata } from './edit';
import type { ProjectMetadata, EditRequest } from 'shared';

describe('mergeMetadata', () => {
  const baseMetadata: ProjectMetadata = {
    name: 'my-project',
    description: 'Original description',
    tags: ['typescript', 'aws'],
    date: '2024-01-15',
  };

  it('preserves all fields when request has no fields', () => {
    const request: EditRequest = {};
    // Note: validateEditRequest would reject this, but mergeMetadata is a pure merge
    const result = mergeMetadata(baseMetadata, request);
    expect(result.metadata).toEqual(baseMetadata);
    expect(result.readme).toBeUndefined();
  });

  it('updates name when provided, preserves other fields', () => {
    const request: EditRequest = { name: 'new-name' };
    const result = mergeMetadata(baseMetadata, request);
    expect(result.metadata.name).toBe('new-name');
    expect(result.metadata.description).toBe('Original description');
    expect(result.metadata.tags).toEqual(['typescript', 'aws']);
    expect(result.metadata.date).toBe('2024-01-15');
    expect(result.readme).toBeUndefined();
  });

  it('updates tags when provided, preserves other fields', () => {
    const request: EditRequest = { tags: ['react', 'frontend', 'ui'] };
    const result = mergeMetadata(baseMetadata, request);
    expect(result.metadata.tags).toEqual(['react', 'frontend', 'ui']);
    expect(result.metadata.name).toBe('my-project');
    expect(result.metadata.description).toBe('Original description');
    expect(result.metadata.date).toBe('2024-01-15');
    expect(result.readme).toBeUndefined();
  });

  it('updates description to first 200 chars of readme and returns full readme', () => {
    const longReadme = 'A'.repeat(300);
    const request: EditRequest = { readme: longReadme };
    const result = mergeMetadata(baseMetadata, request);
    expect(result.metadata.description).toBe('A'.repeat(200));
    expect(result.readme).toBe(longReadme);
    expect(result.metadata.name).toBe('my-project');
    expect(result.metadata.tags).toEqual(['typescript', 'aws']);
  });

  it('uses full readme as description when readme is shorter than 200 chars', () => {
    const shortReadme = 'Short readme content';
    const request: EditRequest = { readme: shortReadme };
    const result = mergeMetadata(baseMetadata, request);
    expect(result.metadata.description).toBe(shortReadme);
    expect(result.readme).toBe(shortReadme);
  });

  it('updates multiple fields at once', () => {
    const request: EditRequest = {
      name: 'renamed-project',
      tags: ['new-tag'],
      readme: 'New readme content',
    };
    const result = mergeMetadata(baseMetadata, request);
    expect(result.metadata.name).toBe('renamed-project');
    expect(result.metadata.tags).toEqual(['new-tag']);
    expect(result.metadata.description).toBe('New readme content');
    expect(result.readme).toBe('New readme content');
    // date is always preserved
    expect(result.metadata.date).toBe('2024-01-15');
  });

  it('does not mutate the original metadata object', () => {
    const original = { ...baseMetadata, tags: [...baseMetadata.tags] };
    const request: EditRequest = { name: 'changed', tags: ['x'] };
    mergeMetadata(baseMetadata, request);
    expect(baseMetadata).toEqual(original);
  });

  it('handles empty tags array', () => {
    const request: EditRequest = { tags: [] };
    const result = mergeMetadata(baseMetadata, request);
    expect(result.metadata.tags).toEqual([]);
  });

  it('handles empty string readme', () => {
    const request: EditRequest = { readme: '' };
    const result = mergeMetadata(baseMetadata, request);
    expect(result.metadata.description).toBe('');
    expect(result.readme).toBe('');
  });
});
