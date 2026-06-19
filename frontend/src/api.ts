import type { SearchIndex, ProjectMetadata, InitiateRequest, InitiateResponse, FinalizeResponse, SuggestTagsResponse, EditResponse, DeleteResponse, TemplateIndex, TemplateMetadata } from 'shared/types';

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

/**
 * Fetch the tag registry (tags.json) from CDN.
 * Returns the parsed tag list on success, an empty array on 404 (registry not yet created),
 * or an error message on other failures.
 *
 * Note: CloudFront may return index.html (HTML with 200 status) for missing S3 keys
 * due to custom error responses. We detect non-JSON responses and treat them as empty.
 */
export async function fetchTagRegistry(): Promise<ApiResult<string[]>> {
  try {
    const response = await fetch(`${getBaseUrl()}/tags.json`);

    if (response.status === 404) {
      return { ok: true, data: [] };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `Failed to load tag registry (HTTP ${response.status})`,
      };
    }

    const text = await response.text();

    // CloudFront may serve index.html for missing S3 keys (custom error response).
    // Detect non-JSON responses and treat as empty registry.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json') && !text.trimStart().startsWith('[')) {
      return { ok: true, data: [] };
    }

    const data: string[] = JSON.parse(text);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? `Failed to load tag registry: ${err.message}`
        : 'Failed to load tag registry: unknown error',
    };
  }
}

/**
 * Request AI tag suggestions based on README content.
 * POST to /tags/suggest with the readme text; returns suggested tags from the registry.
 */
export async function suggestTags(readme: string): Promise<ApiResult<string[]>> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  if (!apiUrl) return { ok: false, error: 'API endpoint is not configured' };
  if (!apiKey) return { ok: false, error: 'API key is not configured' };

  try {
    const response = await fetch(`${apiUrl}/tags/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ readme }),
    });

    const body: SuggestTagsResponse = await response.json();

    if (!response.ok) {
      return { ok: false, error: (body as any).error ?? `Tag suggestion failed (HTTP ${response.status})` };
    }

    return { ok: true, data: body.tags };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? `Tag suggestion failed: ${err.message}`
        : 'Tag suggestion failed: unknown error',
    };
  }
}


/**
 * Update project metadata via PATCH /projects/{name}.
 * Only sends the fields that need updating.
 */
export async function updateProject(
  name: string,
  updates: { name?: string; tags?: string[]; readme?: string }
): Promise<ApiResult<EditResponse>> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  if (!apiUrl) return { ok: false, error: 'API endpoint is not configured' };
  if (!apiKey) return { ok: false, error: 'API key is not configured' };

  try {
    const response = await fetch(`${apiUrl}/projects/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(updates),
    });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, error: body.error ?? `Project update failed (HTTP ${response.status})` };
    }
    return { ok: true, data: body as EditResponse };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Project update failed: ${err.message}` : 'Project update failed' };
  }
}

/**
 * Delete a project via DELETE /projects/{name}.
 */
export async function deleteProject(name: string): Promise<ApiResult<DeleteResponse>> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  if (!apiUrl) return { ok: false, error: 'API endpoint is not configured' };
  if (!apiKey) return { ok: false, error: 'API key is not configured' };

  try {
    const response = await fetch(`${apiUrl}/projects/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey,
      },
    });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, error: body.error ?? `Project deletion failed (HTTP ${response.status})` };
    }
    return { ok: true, data: body as DeleteResponse };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Project deletion failed: ${err.message}` : 'Project deletion failed' };
  }
}

/**
 * Compute a minimal PATCH body by comparing original metadata with edited form values.
 * Only includes fields that actually differ from the original.
 *
 * @param original - The current project metadata and readme
 * @param edited - The edited form values
 * @returns Object containing only the modified fields, or null if nothing changed
 */
export function computePatchBody(
  original: { name: string; tags: string[]; readme: string; repositoryUrl?: string },
  edited: { name: string; tags: string[]; readme: string; repositoryUrl?: string }
): { name?: string; tags?: string[]; readme?: string; repositoryUrl?: string } | null {
  const patch: { name?: string; tags?: string[]; readme?: string; repositoryUrl?: string } = {};

  if (edited.name !== original.name) {
    patch.name = edited.name;
  }

  // Compare tags as sorted arrays to detect content changes regardless of order
  const originalTagsSorted = [...original.tags].sort();
  const editedTagsSorted = [...edited.tags].sort();
  if (
    originalTagsSorted.length !== editedTagsSorted.length ||
    originalTagsSorted.some((tag, i) => tag !== editedTagsSorted[i])
  ) {
    patch.tags = edited.tags;
  }

  if (edited.readme !== original.readme) {
    patch.readme = edited.readme;
  }

  // Compare repositoryUrl (treat undefined and '' as equivalent for "no URL")
  const originalRepo = original.repositoryUrl ?? '';
  const editedRepo = edited.repositoryUrl ?? '';
  if (editedRepo !== originalRepo) {
    patch.repositoryUrl = editedRepo;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}


/**
 * Fetch the template index (templates-index.json) from CloudFront.
 * Returns the parsed TemplateIndex on success, or an error message on failure.
 *
 * When no templates exist yet, the file may not be present in S3. CloudFront's
 * custom error response returns index.html (HTML) with a 200 status in that case.
 * We detect non-JSON responses and treat them as an empty index rather than
 * surfacing a confusing parse error.
 */
export async function fetchTemplateIndex(): Promise<ApiResult<TemplateIndex>> {
  try {
    const response = await fetch(`${getBaseUrl()}/templates-index.json`);

    if (!response.ok) {
      return {
        ok: false,
        error: `Failed to load template index (HTTP ${response.status})`,
      };
    }

    const text = await response.text();

    // If the response isn't JSON (e.g. CloudFront served index.html for a missing
    // S3 key), treat it as an empty index instead of throwing a parse error.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json') && !text.trimStart().startsWith('[')) {
      return { ok: true, data: [] };
    }

    const data: TemplateIndex = JSON.parse(text);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? `Failed to load template index: ${err.message}`
        : 'Failed to load template index: unknown error',
    };
  }
}

/**
 * Fetch a template's metadata.json by template name.
 * @param name - The template name, e.g. "basic-lambda"
 */
export async function fetchTemplateMetadata(name: string): Promise<ApiResult<TemplateMetadata>> {
  try {
    const url = `${getBaseUrl()}/templates/${name}/metadata.json`;
    const response = await fetch(url);

    if (!response.ok) {
      return {
        ok: false,
        error: `Failed to load template details (HTTP ${response.status})`,
      };
    }

    const data: TemplateMetadata = await response.json();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error
        ? `Failed to load template details: ${err.message}`
        : 'Failed to load template details: unknown error',
    };
  }
}
