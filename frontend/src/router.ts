/**
 * Client-side router for the Internal Repos SPA.
 * Uses hash-based routing for S3 static hosting compatibility
 * (S3 error document returns index.html, hash fragments are client-only).
 *
 * Supported routes:
 *   #/           → Search/home view
 *   #/project/:name → Project detail view
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
