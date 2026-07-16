import type { FileTreeManifest, FileTreeEntry } from 'shared/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileBrowserState =
  | 'IDLE'
  | 'LOADING_MANIFEST'
  | 'BROWSING'
  | 'LOADING_FILE'
  | 'VIEWING_FILE';

export interface FileBrowserOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** CDN base URL + path prefix, e.g. "https://cdn.example.com/projects/my-project/" */
  basePath: string;
  /** Optional initial path from URL hash for deep linking */
  initialPath?: string;
  /** Callback when navigation changes (for URL hash updates) */
  onNavigate?: (path: string) => void;
}

export interface FileBrowserAPI {
  /** Initialize the browser — shows "Browse Files" button */
  mount(): void;
  /** Navigate to a specific path (for deep link restoration) */
  navigateTo(path: string): void;
  /** Cleanup event listeners and DOM */
  destroy(): void;
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Filters manifest entries to the immediate children of a given directory path.
 *
 * For root directory (empty string or "/"), returns entries whose path has no
 * directory separator (files) or a single trailing slash at the first level (directories).
 *
 * For a nested directory like "src/", returns entries directly inside "src/" without
 * descending into subdirectories.
 */
export function getDirectoryChildren(
  manifest: FileTreeManifest,
  dirPath: string,
): FileTreeEntry[] {
  // Normalize: root is represented as empty string
  const prefix = dirPath === '/' ? '' : dirPath;

  return manifest.entries.filter((entry) => {
    // Entry must start with the prefix
    if (!entry.path.startsWith(prefix)) return false;

    // Get the relative part after the prefix
    const relative = entry.path.slice(prefix.length);

    // Skip the directory entry itself (empty relative)
    if (relative === '') return false;

    // For directories: relative should be "name/" (single segment with trailing slash)
    if (entry.type === 'directory') {
      // Remove trailing slash and check there's no other slash
      const withoutSlash = relative.endsWith('/') ? relative.slice(0, -1) : relative;
      return !withoutSlash.includes('/');
    }

    // For files: relative should be "name" (no slash at all)
    return !relative.includes('/');
  });
}

/**
 * Sorts file tree entries: directories first, then files.
 * Within each group, sorts alphabetically by name (case-insensitive).
 */
export function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => {
    // Directories before files
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }

    // Alphabetical within same type (case-insensitive)
    const nameA = getEntryName(a.path).toLowerCase();
    const nameB = getEntryName(b.path).toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

/**
 * Checks if a directory contains a README file (case-insensitive match for
 * "readme.md" or "readme").
 *
 * Returns the matching entry or null if no README is found.
 */
export function hasReadme(
  manifest: FileTreeManifest,
  dirPath: string,
): FileTreeEntry | null {
  const prefix = dirPath === '/' ? '' : dirPath;

  for (const entry of manifest.entries) {
    if (entry.type !== 'file') continue;
    if (!entry.path.startsWith(prefix)) continue;

    const relative = entry.path.slice(prefix.length);
    // Must be a direct child (no slash in relative path)
    if (relative.includes('/')) continue;

    const lower = relative.toLowerCase();
    if (lower === 'readme.md' || lower === 'readme') {
      return entry;
    }
  }

  return null;
}

/**
 * Extracts the name (last segment) from a file or directory path.
 * For directories (trailing slash), returns the directory name without the slash.
 */
function getEntryName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

// ─── File Browser Component ───────────────────────────────────────────────────

/**
 * Creates a File Browser component that manages the file browsing experience.
 *
 * State machine:
 * - IDLE: shows "Browse Files" button only
 * - LOADING_MANIFEST: shows loading indicator, fetching file-tree.json
 * - BROWSING: shows breadcrumb + directory listing + optional README below
 * - LOADING_FILE: shows loading in code viewer area while fetching file content
 * - VIEWING_FILE: shows breadcrumb + code viewer (replaces directory listing entirely)
 */
export function createFileBrowser(options: FileBrowserOptions): FileBrowserAPI {
  const { container, basePath, initialPath, onNavigate } = options;

  let state: FileBrowserState = 'IDLE';
  let manifest: FileTreeManifest | null = null;
  let currentPath = '';
  const fileCache = new Map<string, string>();
  let browseButton: HTMLButtonElement | null = null;

  /**
   * Transition to a new state and re-render the UI accordingly.
   */
  function setState(newState: FileBrowserState): void {
    state = newState;
    render();
  }

  /**
   * Render the UI based on the current state.
   */
  function render(): void {
    container.innerHTML = '';

    switch (state) {
      case 'IDLE':
        renderIdleState();
        break;
      case 'LOADING_MANIFEST':
        renderLoadingManifest();
        break;
      case 'BROWSING':
        renderBrowsing();
        break;
      case 'LOADING_FILE':
        renderLoadingFile();
        break;
      case 'VIEWING_FILE':
        renderViewingFile();
        break;
    }
  }

  /**
   * Render IDLE state — shows "Browse Files" button.
   */
  function renderIdleState(): void {
    browseButton = document.createElement('button');
    browseButton.type = 'button';
    browseButton.className =
      'inline-flex items-center gap-2 px-4 py-2 font-mono text-sm font-semibold text-accent bg-surface border border-accent rounded-sm cursor-pointer transition-all duration-180 hover:bg-accent hover:text-on-accent';
    browseButton.textContent = 'Browse Files';
    browseButton.addEventListener('click', handleBrowseClick);
    container.appendChild(browseButton);
  }

  /**
   * Render LOADING_MANIFEST state — loading indicator.
   */
  function renderLoadingManifest(): void {
    const loading = document.createElement('div');
    loading.className = 'flex items-center gap-2 py-4 text-sm text-text-muted font-mono';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');
    loading.textContent = 'Loading files…';
    container.appendChild(loading);
  }

  /**
   * Render BROWSING state — placeholder for sub-components (directory listing, breadcrumb).
   * Sub-components will be wired in later tasks.
   */
  function renderBrowsing(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-browser-browsing flex flex-col gap-4';
    wrapper.dataset.path = currentPath;

    // Placeholder: breadcrumb and directory listing will be injected by later tasks
    const placeholder = document.createElement('div');
    placeholder.className = 'text-sm text-text-muted font-mono';
    placeholder.textContent = `Browsing: ${currentPath || '/'}`;
    wrapper.appendChild(placeholder);

    container.appendChild(wrapper);
  }

  /**
   * Render LOADING_FILE state — loading indicator for file content.
   */
  function renderLoadingFile(): void {
    const loading = document.createElement('div');
    loading.className = 'flex items-center gap-2 py-4 text-sm text-text-muted font-mono';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');
    loading.textContent = 'Loading file…';
    container.appendChild(loading);
  }

  /**
   * Render VIEWING_FILE state — placeholder for code viewer.
   * Code viewer sub-component will be wired in later tasks.
   */
  function renderViewingFile(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-browser-viewing flex flex-col gap-4';
    wrapper.dataset.path = currentPath;

    const placeholder = document.createElement('div');
    placeholder.className = 'text-sm text-text-muted font-mono';
    placeholder.textContent = `Viewing: ${currentPath}`;
    wrapper.appendChild(placeholder);

    container.appendChild(wrapper);
  }

  /**
   * Handle "Browse Files" button click — fetch the manifest.
   */
  async function handleBrowseClick(): Promise<void> {
    await loadManifest();
  }

  /**
   * Fetch and parse the file-tree.json manifest.
   */
  async function loadManifest(): Promise<void> {
    setState('LOADING_MANIFEST');

    try {
      const url = `${basePath}file-tree.json`;
      const response = await fetch(url);

      if (response.status === 404) {
        renderLegacyMessage();
        return;
      }

      if (!response.ok) {
        renderFetchError();
        return;
      }

      const data: FileTreeManifest = await response.json();
      manifest = data;

      // Navigate to initial path or root
      if (initialPath) {
        navigateToPath(initialPath);
      } else {
        currentPath = '';
        setState('BROWSING');
        onNavigate?.('');
      }
    } catch {
      renderFetchError();
    }
  }

  /**
   * Render a message for legacy projects without file-tree.json.
   */
  function renderLegacyMessage(): void {
    state = 'IDLE';
    container.innerHTML = '';

    const msg = document.createElement('div');
    msg.className = 'py-4 px-4 text-sm text-text-muted font-mono bg-surface border border-border rounded-sm';
    msg.textContent =
      'File browsing is not available for this project. It was uploaded before the file browser feature was enabled.';
    container.appendChild(msg);
  }

  /**
   * Render an error message with a retry button for manifest fetch failures.
   */
  function renderFetchError(): void {
    state = 'IDLE';
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col gap-3 py-4';

    const errorMsg = document.createElement('p');
    errorMsg.className = 'text-sm text-error font-mono';
    errorMsg.textContent = 'Failed to load file tree. Please try again.';
    wrapper.appendChild(errorMsg);

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className =
      'inline-flex items-center gap-2 px-4 py-2 font-mono text-sm font-semibold text-accent bg-surface border border-accent rounded-sm cursor-pointer transition-all duration-180 hover:bg-accent hover:text-on-accent w-fit';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      loadManifest();
    });
    wrapper.appendChild(retryBtn);

    container.appendChild(wrapper);
  }

  /**
   * Navigate to a specific path within the manifest.
   * Determines whether the path is a directory or file and sets state accordingly.
   */
  function navigateToPath(path: string): void {
    if (!manifest) return;

    // Normalize path — remove leading slash if present
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

    // Check if the path exists in the manifest
    const entry = manifest.entries.find((e) => e.path === normalizedPath);

    if (!entry) {
      // Path not found — if it looks like a directory (ends with /), try without
      // Otherwise navigate to root with a notice
      const asDir = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/';
      const dirEntry = manifest.entries.find((e) => e.path === asDir);

      if (dirEntry) {
        currentPath = asDir;
        setState('BROWSING');
        onNavigate?.(asDir);
      } else {
        // Path not found — fall back to root
        currentPath = '';
        setState('BROWSING');
        onNavigate?.('');
      }
      return;
    }

    if (entry.type === 'directory') {
      currentPath = normalizedPath;
      setState('BROWSING');
      onNavigate?.(normalizedPath);
    } else {
      // It's a file — load it
      currentPath = normalizedPath;
      loadFileContent(normalizedPath);
    }
  }

  /**
   * Fetch file content from CDN with in-memory caching.
   */
  async function loadFileContent(filePath: string): Promise<void> {
    // Check cache first
    if (fileCache.has(filePath)) {
      setState('VIEWING_FILE');
      return;
    }

    setState('LOADING_FILE');

    try {
      const url = `${basePath}files/${filePath}`;
      const response = await fetch(url);

      if (!response.ok) {
        renderFileError();
        return;
      }

      const content = await response.text();
      fileCache.set(filePath, content);
      setState('VIEWING_FILE');
    } catch {
      renderFileError();
    }
  }

  /**
   * Render an error message when individual file fetch fails.
   */
  function renderFileError(): void {
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col gap-3 py-4';

    const errorMsg = document.createElement('p');
    errorMsg.className = 'text-sm text-error font-mono';
    errorMsg.textContent = 'Failed to load file. Please try again.';
    wrapper.appendChild(errorMsg);

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className =
      'inline-flex items-center gap-2 px-4 py-2 font-mono text-sm font-semibold text-accent bg-surface border border-accent rounded-sm cursor-pointer transition-all duration-180 hover:bg-accent hover:text-on-accent w-fit';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      loadFileContent(currentPath);
    });
    wrapper.appendChild(retryBtn);

    container.appendChild(wrapper);
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  function mount(): void {
    setState('IDLE');

    // If there's an initial path, auto-activate
    if (initialPath) {
      loadManifest();
    }
  }

  function navigateTo(path: string): void {
    if (!manifest) {
      // Manifest not loaded yet — store path and load manifest
      loadManifest();
      return;
    }
    navigateToPath(path);
  }

  function destroy(): void {
    container.innerHTML = '';
    browseButton = null;
    manifest = null;
    fileCache.clear();
    state = 'IDLE';
    currentPath = '';
  }

  return { mount, navigateTo, destroy };
}
