import { describe, it, expect } from 'vitest';
import { validateMetadata } from './validate';

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

  it('returns error when more than 10 tags provided', () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`).join(',');
    expect(validateMetadata({ name: 'proj', tags })).toBe(
      'Maximum of 10 tags allowed.',
    );
  });

  it('accepts exactly 10 tags', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`).join(',');
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
