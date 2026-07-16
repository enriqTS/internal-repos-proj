/**
 * Content-Type mapping module.
 * Maps file extensions to MIME types for S3 uploads and CDN serving.
 * Shared between Lambda, CI/CD scripts, and migration utilities.
 */

/** Fallback MIME type for unknown extensions */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** Map of file extensions to MIME types */
export const CONTENT_TYPE_MAP: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/plain',
  '.py': 'text/x-python',
  '.rs': 'text/plain',
  '.go': 'text/plain',
  '.java': 'text/plain',
  '.tf': 'text/plain',
  '.hcl': 'text/plain',
  '.sh': 'text/x-shellscript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

/**
 * Get the MIME content-type for a filename based on its extension.
 * Extracts the extension from the last dot position (case-insensitive).
 * Returns DEFAULT_CONTENT_TYPE if the extension is not in the map.
 */
export function getContentType(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) {
    return DEFAULT_CONTENT_TYPE;
  }
  const ext = filename.slice(lastDot).toLowerCase();
  return CONTENT_TYPE_MAP[ext] ?? DEFAULT_CONTENT_TYPE;
}
