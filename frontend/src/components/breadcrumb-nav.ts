/**
 * Breadcrumb Navigation component.
 * Renders a horizontal nav bar showing the current path as clickable segments.
 * Each segment navigates to that directory level via an onNavigate callback.
 */

export interface BreadcrumbSegment {
  label: string;
  /** Full directory path this segment navigates to (e.g., "" for root, "src/", "src/components/") */
  path: string;
}

export interface BreadcrumbNavOptions {
  /** Current path segments, e.g. ["src", "components"] */
  segments: string[];
  /** Callback when a segment is activated (receives target directory path) */
  onNavigate: (path: string) => void;
  /** Label for root segment (default: "root") */
  rootLabel?: string;
}

/**
 * Generates breadcrumb segments from a path string.
 * Input: a path like "src/components/" or "src/main.ts"
 * Output: array of segments, first is always root, then each directory component.
 * For file paths, includes the file as the last segment (non-clickable).
 */
export function generateBreadcrumbs(path: string, rootLabel = 'root'): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [{ label: rootLabel, path: '' }];

  if (!path) return segments;

  const parts = path.split('/').filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const accumulated = parts.slice(0, i + 1).join('/');
    const isLast = i === parts.length - 1;
    // If the original path ends with "/" it's all directories.
    // If it doesn't end with "/", the last part is a file.
    const isFile = isLast && !path.endsWith('/');
    segments.push({
      label: parts[i],
      path: isFile ? accumulated : accumulated + '/',
    });
  }

  return segments;
}

/**
 * Creates a breadcrumb navigation element.
 * Renders a <nav> with an <ol> of clickable segments separated by "/" dividers.
 * The last segment is non-interactive (aria-current="page").
 */
export function createBreadcrumbNav(options: BreadcrumbNavOptions): HTMLElement {
  const { segments: pathSegments, onNavigate, rootLabel } = options;

  // Build the full path from segments to generate breadcrumbs
  const fullPath = pathSegments.length > 0 ? pathSegments.join('/') + '/' : '';
  const breadcrumbs = generateBreadcrumbs(fullPath, rootLabel ?? 'root');

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Breadcrumb');
  nav.className = 'flex flex-wrap items-center gap-1 text-sm font-mono';

  const ol = document.createElement('ol');
  ol.className = 'flex flex-wrap items-center gap-1 list-none p-0 m-0';

  for (let i = 0; i < breadcrumbs.length; i++) {
    const segment = breadcrumbs[i];
    const isLast = i === breadcrumbs.length - 1;

    const li = document.createElement('li');
    li.className = 'flex items-center gap-1';

    if (isLast) {
      // Last segment: non-interactive span with aria-current
      const span = document.createElement('span');
      span.setAttribute('aria-current', 'page');
      span.className = 'text-text font-semibold px-1.5 py-0.5';
      span.textContent = segment.label;
      li.appendChild(span);
    } else {
      // Clickable button for navigation
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'text-accent bg-transparent border-none px-1.5 py-0.5 rounded-sm cursor-pointer ' +
        'transition-all duration-180 hover:bg-accent-subtle hover:text-accent-hover ' +
        'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
      btn.textContent = segment.label;

      const targetPath = segment.path;
      btn.addEventListener('click', () => onNavigate(targetPath));
      btn.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNavigate(targetPath);
        }
      });

      li.appendChild(btn);

      // Add separator after non-last segments
      const separator = document.createElement('span');
      separator.setAttribute('aria-hidden', 'true');
      separator.className = 'text-text-muted select-none';
      separator.textContent = '/';
      li.appendChild(separator);
    }

    ol.appendChild(li);
  }

  nav.appendChild(ol);
  return nav;
}
