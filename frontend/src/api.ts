import type { SearchIndex, ProjectMetadata, InitiateRequest, InitiateResponse, FinalizeResponse } from 'shared/types';

/**
 * Typed API response wrapper.
 * On success, `data` is present and `error` is undefined.
 * On failure, `error` is present and `data` is undefined.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
 *
 * When no projects exist yet, the file may not be present in S3. CloudFront's
 * custom error response returns index.html (HTML) with a 200 status in that case.
 * We detect non-JSON responses and treat them as an empty index rather than
 * surfacing a confusing parse error.
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

    const text = await response.text();

    // If the response isn't JSON (e.g. CloudFront served index.html for a missing
    // S3 key), treat it as an empty index instead of throwing a parse error.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json') && !text.trimStart().startsWith('[')) {
      return { ok: true, data: [] };
    }

    const data: SearchIndex = JSON.parse(text);
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
 * Initiate a presigned upload session.
 * POST JSON to /upload/initiate with project metadata.
 * Returns a session ID and presigned S3 URL on success.
 */
export async function initiateUpload(params: InitiateRequest): Promise<ApiResult<InitiateResponse>> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  if (!apiUrl) return { ok: false, error: 'Upload endpoint is not configured' };
  if (!apiKey) return { ok: false, error: 'API key is not configured' };

  try {
    const response = await fetch(`${apiUrl}/upload/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(params),
    });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, error: body.error ?? `Upload initiation failed (HTTP ${response.status})` };
    }
    return { ok: true, data: body as InitiateResponse };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Upload initiation failed: ${err.message}` : 'Upload initiation failed' };
  }
}

/**
 * Finalize a presigned upload session after the zip has been uploaded to S3.
 * POST JSON to /upload/finalize with the session ID.
 */
export async function finalizeUpload(sessionId: string): Promise<ApiResult<FinalizeResponse>> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  if (!apiUrl) return { ok: false, error: 'Upload endpoint is not configured' };
  if (!apiKey) return { ok: false, error: 'API key is not configured' };

  try {
    const response = await fetch(`${apiUrl}/upload/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ sessionId }),
    });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, error: body.error ?? `Upload finalization failed (HTTP ${response.status})` };
    }
    return { ok: true, data: body as FinalizeResponse };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Upload finalization failed: ${err.message}` : 'Upload finalization failed' };
  }
}

/**
 * Upload a blob directly to S3 using a presigned PUT URL.
 * Uses XMLHttpRequest to support upload progress tracking.
 *
 * @param url - Presigned S3 PUT URL
 * @param blob - The zip file blob to upload
 * @param onProgress - Optional callback receiving upload percentage (0-100)
 */
export function uploadToS3(url: string, blob: Blob, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/zip');

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed (HTTP ${xhr.status})`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('S3 upload failed: network error'));
    });

    xhr.send(blob);
  });
}
