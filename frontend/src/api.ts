import type { SearchIndex, ProjectMetadata } from 'shared/types';

/**
 * Typed API response wrapper.
 * On success, `data` is present and `error` is undefined.
 * On failure, `error` is present and `data` is undefined.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Upload response returned on successful project upload.
 */
export interface UploadResponse {
  message: string;
  path: string;
  warning?: string;
}

/**
 * Base URL for CloudFront-served static assets (search index, readmes, artifacts).
 * Defaults to the current origin so relative fetches work in production.
 */
function getBaseUrl(): string {
  return import.meta.env.VITE_CDN_URL ?? '';
}

/**
 * Base URL for the API Gateway upload endpoint.
 */
function getApiUrl(): string {
  return import.meta.env.VITE_API_URL ?? '';
}

/**
 * API key injected at build time for authenticated upload requests.
 */
function getApiKey(): string {
  return import.meta.env.VITE_API_KEY ?? '';
}

/**
 * Fetch the global search index (global-index.json) from CloudFront.
 * Returns the parsed SearchIndex on success, or an error message on failure.
 */
export async function fetchSearchIndex(): Promise<ApiResult<SearchIndex>> {
  try {
    const response = await fetch(`${getBaseUrl()}/global-index.json`);

    if (!response.ok) {
      return {
        ok: false,
        error: `Failed to load project index (HTTP ${response.status})`,
      };
    }

    const data: SearchIndex = await response.json();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? `Failed to load project index: ${err.message}`
        : 'Failed to load project index: unknown error',
    };
  }
}

/**
 * Fetch a project's readme.md content by project path.
 * @param projectPath - The project path prefix, e.g. "projects/my-project/"
 */
export async function fetchProjectReadme(projectPath: string): Promise<ApiResult<string>> {
  try {
    const url = `${getBaseUrl()}/${projectPath}readme.md`;
    const response = await fetch(url);

    if (!response.ok) {
      return {
        ok: false,
        error: `Failed to load project documentation (HTTP ${response.status})`,
      };
    }

    const text = await response.text();
    return { ok: true, data: text };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? `Failed to load project documentation: ${err.message}`
        : 'Failed to load project documentation: unknown error',
    };
  }
}

/**
 * Fetch a project's metadata.json by project path.
 * @param projectPath - The project path prefix, e.g. "projects/my-project/"
 */
export async function fetchProjectMetadata(projectPath: string): Promise<ApiResult<ProjectMetadata>> {
  try {
    const url = `${getBaseUrl()}/${projectPath}metadata.json`;
    const response = await fetch(url);

    if (!response.ok) {
      return {
        ok: false,
        error: `Failed to load project details (HTTP ${response.status})`,
      };
    }

    const data: ProjectMetadata = await response.json();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? `Failed to load project details: ${err.message}`
        : 'Failed to load project details: unknown error',
    };
  }
}

/**
 * Submit a project upload via multipart/form-data to the API Gateway endpoint.
 * Includes the x-api-key header from build-time environment configuration.
 *
 * @param formData - FormData containing name, tags, readme, and files fields
 */
export async function submitUpload(formData: FormData): Promise<ApiResult<UploadResponse>> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();

  if (!apiUrl) {
    return { ok: false, error: 'Upload endpoint is not configured' };
  }

  if (!apiKey) {
    return { ok: false, error: 'API key is not configured' };
  }

  try {
    const response = await fetch(`${apiUrl}/upload`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
      },
      body: formData,
    });

    const body = await response.json();

    if (!response.ok) {
      const errorMessage = body.error ?? `Upload failed (HTTP ${response.status})`;
      return { ok: false, error: errorMessage };
    }

    return { ok: true, data: body as UploadResponse };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? `Upload failed: ${err.message}`
        : 'Upload failed: unknown error',
    };
  }
}
