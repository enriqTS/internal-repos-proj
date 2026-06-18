import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchSearchIndex,
  fetchProjectReadme,
  fetchProjectMetadata,
  initiateUpload,
  finalizeUpload,
  uploadToS3,
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
      text: () => Promise.resolve(JSON.stringify(mockIndex)),
      headers: new Headers({ 'content-type': 'application/json' }),
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

describe('initiateUpload', () => {
  it('sends JSON POST with correct headers and returns session data', async () => {
    const mockResponse = {
      sessionId: 'abc-123',
      uploadUrl: 'https://s3.example.com/presigned',
      expiresAt: '2024-01-01T00:15:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await initiateUpload({ name: 'new-project', tags: [{ tag: 'test', isNew: false }, { tag: 'demo', isNew: false }], readme: '# Hello' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(mockResponse);
    }

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/upload/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-api-key-123',
      },
      body: JSON.stringify({ name: 'new-project', tags: [{ tag: 'test', isNew: false }, { tag: 'demo', isNew: false }], readme: '# Hello' }),
    });
  });

  it('returns error message from API on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Invalid project name' }),
    });

    const result = await initiateUpload({ name: '!!invalid!!' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Invalid project name');
    }
  });

  it('returns error when API URL is not configured', async () => {
    vi.stubEnv('VITE_API_URL', '');

    const result = await initiateUpload({ name: 'test' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Upload endpoint is not configured');
    }

    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
  });

  it('returns error when API key is not configured', async () => {
    vi.stubEnv('VITE_API_KEY', '');

    const result = await initiateUpload({ name: 'test' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('API key is not configured');
    }

    vi.stubEnv('VITE_API_KEY', 'test-api-key-123');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await initiateUpload({ name: 'test' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Connection refused');
    }
  });
});

describe('finalizeUpload', () => {
  it('sends JSON POST with sessionId and returns finalize response', async () => {
    const mockResponse = {
      message: 'Project uploaded successfully',
      path: 'projects/new-project/',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await finalizeUpload('abc-123');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(mockResponse);
    }

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/upload/finalize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-api-key-123',
      },
      body: JSON.stringify({ sessionId: 'abc-123' }),
    });
  });

  it('returns error message from API on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Session not found' }),
    });

    const result = await finalizeUpload('nonexistent');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Session not found');
    }
  });

  it('returns error when API URL is not configured', async () => {
    vi.stubEnv('VITE_API_URL', '');

    const result = await finalizeUpload('abc-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Upload endpoint is not configured');
    }

    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Timeout'));

    const result = await finalizeUpload('abc-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Timeout');
    }
  });
});

describe('uploadToS3', () => {
  let mockXhr: any;

  beforeEach(() => {
    mockXhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      upload: { addEventListener: vi.fn() },
      addEventListener: vi.fn(),
      status: 200,
    };
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => mockXhr));
  });

  it('sends PUT request with correct content type', async () => {
    mockXhr.send.mockImplementation(() => {
      const loadHandler = mockXhr.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'load'
      )?.[1];
      loadHandler?.();
    });

    const blob = new Blob(['test'], { type: 'application/zip' });
    await uploadToS3('https://s3.example.com/presigned', blob);

    expect(mockXhr.open).toHaveBeenCalledWith('PUT', 'https://s3.example.com/presigned');
    expect(mockXhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(mockXhr.send).toHaveBeenCalledWith(blob);
  });

  it('reports progress via onProgress callback', async () => {
    const onProgress = vi.fn();

    mockXhr.send.mockImplementation(() => {
      // Simulate progress event
      const progressHandler = mockXhr.upload.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'progress'
      )?.[1];
      progressHandler?.({ lengthComputable: true, loaded: 50, total: 100 });

      // Then resolve
      const loadHandler = mockXhr.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'load'
      )?.[1];
      loadHandler?.();
    });

    const blob = new Blob(['test'], { type: 'application/zip' });
    await uploadToS3('https://s3.example.com/presigned', blob, onProgress);

    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it('rejects on HTTP error status', async () => {
    mockXhr.status = 403;
    mockXhr.send.mockImplementation(() => {
      const loadHandler = mockXhr.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'load'
      )?.[1];
      loadHandler?.();
    });

    const blob = new Blob(['test'], { type: 'application/zip' });
    await expect(uploadToS3('https://s3.example.com/presigned', blob)).rejects.toThrow(
      'S3 upload failed (HTTP 403)'
    );
  });

  it('rejects on network error', async () => {
    mockXhr.send.mockImplementation(() => {
      const errorHandler = mockXhr.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'error'
      )?.[1];
      errorHandler?.();
    });

    const blob = new Blob(['test'], { type: 'application/zip' });
    await expect(uploadToS3('https://s3.example.com/presigned', blob)).rejects.toThrow(
      'S3 upload failed: network error'
    );
  });
});


import { updateProject, deleteProject, computePatchBody } from './api';

describe('updateProject', () => {
  it('sends PATCH request with correct headers and body', async () => {
    const mockResponse = {
      message: 'Project updated successfully',
      metadata: { name: 'my-project', description: '', tags: ['web'], date: '2024-01-01' },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await updateProject('my-project', { tags: ['web', 'api'] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(mockResponse);
    }

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/projects/my-project', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-api-key-123',
      },
      body: JSON.stringify({ tags: ['web', 'api'] }),
    });
  });

  it('returns error message from API on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Project not found: missing' }),
    });

    const result = await updateProject('missing', { readme: 'updated' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Project not found: missing');
    }
  });

  it('returns error when API URL is not configured', async () => {
    vi.stubEnv('VITE_API_URL', '');

    const result = await updateProject('test', { tags: ['a'] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('API endpoint is not configured');
    }

    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
  });

  it('returns error when API key is not configured', async () => {
    vi.stubEnv('VITE_API_KEY', '');

    const result = await updateProject('test', { tags: ['a'] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('API key is not configured');
    }

    vi.stubEnv('VITE_API_KEY', 'test-api-key-123');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await updateProject('test', { readme: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Network error');
    }
  });

  it('encodes project name in URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'ok', metadata: {} }),
    });

    await updateProject('my project', { tags: ['test'] });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/projects/my%20project',
      expect.any(Object)
    );
  });
});

describe('deleteProject', () => {
  it('sends DELETE request with correct headers', async () => {
    const mockResponse = {
      message: 'Project deleted successfully',
      name: 'old-project',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await deleteProject('old-project');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(mockResponse);
    }

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/projects/old-project', {
      method: 'DELETE',
      headers: {
        'x-api-key': 'test-api-key-123',
      },
    });
  });

  it('returns error message from API on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Project not found: ghost' }),
    });

    const result = await deleteProject('ghost');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Project not found: ghost');
    }
  });

  it('returns error when API URL is not configured', async () => {
    vi.stubEnv('VITE_API_URL', '');

    const result = await deleteProject('test');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('API endpoint is not configured');
    }

    vi.stubEnv('VITE_API_URL', 'https://api.example.com');
  });

  it('returns error when API key is not configured', async () => {
    vi.stubEnv('VITE_API_KEY', '');

    const result = await deleteProject('test');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('API key is not configured');
    }

    vi.stubEnv('VITE_API_KEY', 'test-api-key-123');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Timeout'));

    const result = await deleteProject('test');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Timeout');
    }
  });
});

describe('computePatchBody', () => {
  const original = {
    name: 'my-project',
    tags: ['web', 'api'],
    readme: '# My Project',
  };

  it('returns null when nothing changed', () => {
    const edited = { ...original };
    expect(computePatchBody(original, edited)).toBeNull();
  });

  it('detects name change', () => {
    const edited = { ...original, name: 'new-name' };
    expect(computePatchBody(original, edited)).toEqual({ name: 'new-name' });
  });

  it('detects tags change', () => {
    const edited = { ...original, tags: ['web', 'api', 'new'] };
    expect(computePatchBody(original, edited)).toEqual({ tags: ['web', 'api', 'new'] });
  });

  it('detects readme change', () => {
    const edited = { ...original, readme: '# Updated' };
    expect(computePatchBody(original, edited)).toEqual({ readme: '# Updated' });
  });

  it('returns multiple changed fields', () => {
    const edited = { name: 'new-name', tags: ['solo'], readme: '# New' };
    const result = computePatchBody(original, edited);
    expect(result).toEqual({ name: 'new-name', tags: ['solo'], readme: '# New' });
  });

  it('treats same tags in different order as unchanged', () => {
    const edited = { ...original, tags: ['api', 'web'] };
    expect(computePatchBody(original, edited)).toBeNull();
  });

  it('detects tag removal', () => {
    const edited = { ...original, tags: ['web'] };
    expect(computePatchBody(original, edited)).toEqual({ tags: ['web'] });
  });

  it('detects tag addition', () => {
    const edited = { ...original, tags: ['web', 'api', 'devops'] };
    expect(computePatchBody(original, edited)).toEqual({ tags: ['web', 'api', 'devops'] });
  });
});
