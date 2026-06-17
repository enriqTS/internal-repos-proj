import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchSearchIndex,
  fetchProjectReadme,
  fetchProjectMetadata,
  submitUpload,
} from './api';

// Mock import.meta.env
vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com');
vi.stubEnv('VITE_API_URL', 'https://api.example.com');
vi.stubEnv('VITE_API_KEY', 'test-api-key-123');

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSearchIndex', () => {
  it('returns search index on success', async () => {
    const mockIndex = [
      {
        name: 'project-alpha',
        description: 'A test project',
        tags: ['test'],
        date: '2024-01-15',
        path: 'projects/project-alpha/',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockIndex),
    });

    const result = await fetchSearchIndex();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(mockIndex);
    }
    expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/global-index.json');
  });

  it('returns error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await fetchSearchIndex();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Failed to load project index');
      expect(result.error).toContain('500');
    }
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchSearchIndex();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Network error');
    }
  });
});

describe('fetchProjectReadme', () => {
  it('returns readme content on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('# Hello World'),
    });

    const result = await fetchProjectReadme('projects/my-project/');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('# Hello World');
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cdn.example.com/projects/my-project/readme.md'
    );
  });

  it('returns error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await fetchProjectReadme('projects/missing/');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Failed to load project documentation');
    }
  });
});

describe('fetchProjectMetadata', () => {
  it('returns metadata on success', async () => {
    const mockMeta = {
      name: 'my-project',
      description: 'A project',
      tags: ['web', 'api'],
      date: '2024-03-01',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMeta),
    });

    const result = await fetchProjectMetadata('projects/my-project/');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(mockMeta);
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://cdn.example.com/projects/my-project/metadata.json'
    );
  });

  it('returns error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const result = await fetchProjectMetadata('projects/secret/');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Failed to load project details');
    }
  });
});

describe('submitUpload', () => {
  it('sends upload with correct headers and returns success', async () => {
    const mockResponse = {
      message: 'Project uploaded successfully',
      path: 'projects/new-project/',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const formData = new FormData();
    formData.append('name', 'new-project');
    formData.append('tags', 'test,demo');
    formData.append('readme', '# New Project');

    const result = await submitUpload(formData);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(mockResponse);
    }

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/upload', {
      method: 'POST',
      headers: { 'x-api-key': 'test-api-key-123' },
      body: formData,
    });
  });

  it('returns error message from API on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'Project name already taken' }),
    });

    const formData = new FormData();
    formData.append('name', 'existing-project');

    const result = await submitUpload(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Project name already taken');
    }
  });

  it('returns error when API URL is not configured', async () => {
    vi.stubEnv('VITE_API_URL', '');

    const formData = new FormData();
    const result = await submitUpload(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Upload endpoint is not configured');
    }

    // Restore
    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
  });

  it('returns error when API key is not configured', async () => {
    vi.stubEnv('VITE_API_KEY', '');

    const formData = new FormData();
    const result = await submitUpload(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('API key is not configured');
    }

    // Restore
    vi.stubEnv('VITE_API_KEY', 'test-api-key-123');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const formData = new FormData();
    formData.append('name', 'test');

    const result = await submitUpload(formData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Connection refused');
    }
  });
});
