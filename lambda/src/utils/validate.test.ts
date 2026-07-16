import { describe, it, expect } from 'vitest';
import { validateMetadata, validateEditRequest } from './validate';

describe('validateMetadata', () => {
  it('returns null for valid metadata', () => {
    expect(validateMetadata({ name: 'my-project', tags: 'web,api', readme: 'Hello' })).toBeNull();
  });

  it('returns null when tags and readme are omitted', () => {
    expect(validateMetadata({ name: 'project_1' })).toBeNull();
  });

  it('returns error when name is missing', () => {
    expect(validateMetadata({})).toBe('Missing required fields: name');
  });

  it('returns error when name is empty string', () => {
    expect(validateMetadata({ name: '' })).toBe('Missing required fields: name');
  });

  it('returns error when name is whitespace only', () => {
    expect(validateMetadata({ name: '   ' })).toBe('Missing required fields: name');
  });

  it('returns error for invalid name characters', () => {
    expect(validateMetadata({ name: 'my project!' })).toBe(
      'Invalid project name. Allowed characters: alphanumeric, hyphens, and underscores.',
    );
  });

  it('returns error when name exceeds 64 characters', () => {
    const longName = 'a'.repeat(65);
    expect(validateMetadata({ name: longName })).toBe(
      'Project name must be at most 64 characters.',
    );
  });

  it('accepts name at exactly 64 characters', () => {
    const name = 'a'.repeat(64);
    expect(validateMetadata({ name })).toBeNull();
  });

  it('returns error when readme exceeds 50,000 characters', () => {
    const readme = 'x'.repeat(50_001);
    expect(validateMetadata({ name: 'proj', readme })).toBe(
      'Readme content must be at most 50000 characters.',
    );
  });

  it('accepts readme at exactly 50,000 characters', () => {
    const readme = 'x'.repeat(50_000);
    expect(validateMetadata({ name: 'proj', readme })).toBeNull();
  });

  it('returns error when more than 50 tags provided', () => {
    const tags = Array.from({ length: 51 }, (_, i) => `tag${i}`).join(',');
    expect(validateMetadata({ name: 'proj', tags })).toBe(
      'Maximum of 50 tags allowed.',
    );
  });

  it('accepts exactly 50 tags', () => {
    const tags = Array.from({ length: 50 }, (_, i) => `tag${i}`).join(',');
    expect(validateMetadata({ name: 'proj', tags })).toBeNull();
  });

  it('returns error when a tag exceeds 32 characters', () => {
    const longTag = 'a'.repeat(33);
    expect(validateMetadata({ name: 'proj', tags: longTag })).toBe(
      'Each tag must be at most 32 characters.',
    );
  });

  it('accepts tag at exactly 32 characters', () => {
    const tag = 'a'.repeat(32);
    expect(validateMetadata({ name: 'proj', tags: tag })).toBeNull();
  });

  it('ignores empty tags from splitting', () => {
    // "a,,b" splits to ["a", "", "b"] but empty strings are filtered out
    expect(validateMetadata({ name: 'proj', tags: 'a,,b' })).toBeNull();
  });

  it('trims whitespace from name before validation', () => {
    expect(validateMetadata({ name: '  valid-name  ' })).toBeNull();
  });
});

describe('validateEditRequest', () => {
  it('returns null for valid request with name only', () => {
    expect(validateEditRequest({ name: 'new-name' })).toBeNull();
  });

  it('returns null for valid request with tags only', () => {
    expect(validateEditRequest({ tags: ['web', 'api'] })).toBeNull();
  });

  it('returns null for valid request with readme only', () => {
    expect(validateEditRequest({ readme: 'Updated readme content' })).toBeNull();
  });

  it('returns null for valid request with all fields', () => {
    expect(validateEditRequest({ name: 'proj_1', tags: ['a', 'b'], readme: 'hi' })).toBeNull();
  });

  it('returns error when no fields are provided', () => {
    expect(validateEditRequest({})).toBe('At least one field (name, tags, readme, repositoryUrl) must be provided');
  });

  it('returns error when name is empty string', () => {
    expect(validateEditRequest({ name: '' })).toBe('Project name must be at least 1 character.');
  });

  it('returns error when name exceeds 64 characters', () => {
    expect(validateEditRequest({ name: 'a'.repeat(65) })).toBe(
      'Project name must be at most 64 characters.',
    );
  });

  it('accepts name at exactly 64 characters', () => {
    expect(validateEditRequest({ name: 'a'.repeat(64) })).toBeNull();
  });

  it('returns error for invalid name characters', () => {
    expect(validateEditRequest({ name: 'has spaces!' })).toBe(
      'Invalid project name. Allowed characters: alphanumeric, hyphens, and underscores.',
    );
  });

  it('returns error when more than 50 tags', () => {
    const tags = Array.from({ length: 51 }, (_, i) => `tag${i}`);
    expect(validateEditRequest({ tags })).toBe('Maximum of 50 tags allowed.');
  });

  it('accepts exactly 50 tags', () => {
    const tags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expect(validateEditRequest({ tags })).toBeNull();
  });

  it('returns error when a tag is empty', () => {
    expect(validateEditRequest({ tags: ['valid', ''] })).toBe(
      'Each tag must be at least 1 character.',
    );
  });

  it('returns error when a tag exceeds 32 characters', () => {
    expect(validateEditRequest({ tags: ['a'.repeat(33)] })).toBe(
      'Each tag must be at most 32 characters.',
    );
  });

  it('accepts tag at exactly 32 characters', () => {
    expect(validateEditRequest({ tags: ['a'.repeat(32)] })).toBeNull();
  });

  it('returns error for tag with invalid characters (uppercase)', () => {
    expect(validateEditRequest({ tags: ['InvalidTag'] })).toBe(
      'Tags must contain only lowercase alphanumeric characters, hyphens, and underscores.',
    );
  });

  it('returns error for tag with spaces', () => {
    expect(validateEditRequest({ tags: ['has space'] })).toBe(
      'Tags must contain only lowercase alphanumeric characters, hyphens, and underscores.',
    );
  });

  it('returns error when readme exceeds 50,000 characters', () => {
    expect(validateEditRequest({ readme: 'x'.repeat(50_001) })).toBe(
      'Readme content must be at most 50000 characters.',
    );
  });

  it('accepts readme at exactly 50,000 characters', () => {
    expect(validateEditRequest({ readme: 'x'.repeat(50_000) })).toBeNull();
  });

  it('accepts empty tags array (no tags)', () => {
    expect(validateEditRequest({ tags: [] })).toBeNull();
  });

  it('accepts tags with hyphens and underscores', () => {
    expect(validateEditRequest({ tags: ['my-tag', 'my_tag'] })).toBeNull();
  });
});
