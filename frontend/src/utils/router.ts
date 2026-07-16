/**
 * Client-side router for the Internal Repos SPA.
 * Uses hash-based routing for S3 static hosting compatibility
 * (S3 error document returns index.html, hash fragments are client-only).
 *
 * Supported routes:
 *   #/           → Search/home view
 *   #/project/:name → Project detail view
 *   #/project/:name/files/:path? → Project file browsing
 *   #/template/:name/files/:path? → Template file browsing
 *   #/upload     → Upload form view
 */

export interface Route {
  pattern: RegExp;
  handler: (params: Record<string, string>, container: HTMLElement) => void | Promise<void>;
}

export interface Router {
  navigate: (path: string) => void;
  start: () => void;
  destroy: () => void;
}

/**
 * Parse the current hash fragment into a path string.
 * Strips the leading `#` and normalises empty hash to `/`.
 */
function getCurrentPath(): string {
  const hash = window.location.hash.slice(1); // remove '#'
  return hash || '/';
}

/**
 * Create a client-side hash router.
 *
 * @param routes - Array of route definitions with pattern and handler
 * @param container - The DOM element to render views into
 * @param notFound - Optional handler for unmatched routes
 */
export function createRouter(
  routes: Route[],
  container: HTMLElement,
  notFound?: (container: HTMLElement) => void,
): Router {
  function matchRoute(path: string): void {
    for (const route of routes) {
      const match = path.match(route.pattern);
      if (match) {
        // Extract named groups or positional captures into params
        const params: Record<string, string> = {};
        if (match.groups) {
          Object.assign(params, match.groups);
        }
        // Clear container before rendering new view
        container.innerHTML = '';
        route.handler(params, container);
        return;
      }
    }

    // No route matched
    container.innerHTML = '';
    if (notFound) {
      notFound(container);
    } else {
      container.innerHTML = '<p class="not-found">Page not found</p>';
    }
  }

  function onHashChange(): void {
    const path = getCurrentPath();
    matchRoute(path);
  }

  function navigate(path: string): void {
    window.location.hash = `#${path}`;
  }

  function start(): void {
    window.addEventListener('hashchange', onHashChange);
    // Handle initial route
    onHashChange();
  }

  function destroy(): void {
    window.removeEventListener('hashchange', onHashChange);
  }

  return { navigate, start, destroy };
}


// ─── Deep Linking Helpers ─────────────────────────────────────────────────────

/**
 * Encode a file/directory path into a URL hash fragment for deep linking.
 *
 * @param type - 'project' or 'template'
 * @param name - The project or template name
 * @param path - The file or directory path within the manifest (e.g. "src/main.ts" or "src/")
 * @returns A hash string like "#/project/my-project/files/src/main.ts"
 */
export function encodeFilePath(type: 'project' | 'template', name: string, path: string): string {
  const encodedName = encodeURIComponent(name);
  // Don't encode slashes in the path — they're structural
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `#/${type}/${encodedName}/files/${encodedPath}`;
}

/**
 * Decode a URL hash fragment back into its constituent parts.
 *
 * @param hash - The full hash string (e.g. "#/project/my-project/files/src/main.ts")
 * @returns Parsed components or null if the hash doesn't match a file browsing route
 */
export function decodeFilePath(hash: string): { type: 'project' | 'template'; name: string; path: string } | null {
  // Strip leading '#' if present
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;

  const match = raw.match(/^\/(project|template)\/([^/]+)\/files(?:\/(.*))?$/);
  if (!match) return null;

  const type = match[1] as 'project' | 'template';
  const name = decodeURIComponent(match[2]);
  const pathSegments = match[3] || '';
  const path = pathSegments
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/');

  return { type, name, path };
}
