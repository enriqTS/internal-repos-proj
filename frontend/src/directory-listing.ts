/**
 * Directory Listing component — renders a flat table of the current directory's
 * immediate children with folder/file icons, names, and optional file sizes.
 * Supports keyboard navigation (roving tabindex) and ARIA accessibility.
 */
import type { FileTreeEntry } from 'shared/types';

export interface DirectoryListingOptions {
  /** Entries to display (pre-sorted) */
  entries: FileTreeEntry[];
  /** Callback when a directory is activated */
  onDirectorySelect: (path: string) => void;
  /** Callback when a file is activated */
  onFileSelect: (entry: FileTreeEntry) => void;
  /** Optional callback to trigger download for an entry (file or folder) */
  onDownload?: (entry: FileTreeEntry) => void;
}

/**
 * Format file size in human-readable form (e.g., "2.1 KB", "1.5 MB").
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Extract the basename from a path (last segment, stripping trailing slash for dirs).
 */
function basename(path: string): string {
  const cleaned = path.endsWith('/') ? path.slice(0, -1) : path;
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || cleaned;
}

/**
 * Creates the Directory Listing DOM element.
 * Returns a detached element ready to be appended to the document.
 */
export function createDirectoryListing(options: DirectoryListingOptions): HTMLElement {
  const { entries, onDirectorySelect, onFileSelect, onDownload } = options;

  const container = document.createElement('div');
  container.setAttribute('role', 'listbox');
  container.setAttribute('aria-label', 'Directory contents');
  container.className =
    'w-full border border-border rounded-md overflow-hidden max-h-[60vh] overflow-y-auto';

  let focusedIndex = 0;
  const rows: HTMLElement[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isDir = entry.type === 'directory';

    const row = document.createElement('div');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.setAttribute('tabindex', i === 0 ? '0' : '-1');
    row.dataset.index = String(i);

    row.className = [
      'flex items-center gap-3 px-4 py-2 cursor-pointer',
      'border-b border-border last:border-b-0',
      'hover:bg-surface-raised transition-colors duration-180',
      'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px] focus-visible:bg-surface-raised',
    ].join(' ');

    // Icon
    const icon = document.createElement('span');
    icon.className = 'text-base flex-shrink-0 select-none';
    icon.textContent = isDir ? '\u{1F4C1}' : '\u{1F4C4}';
    icon.setAttribute('aria-hidden', 'true');

    // Name
    const name = document.createElement('span');
    name.className = 'font-mono text-sm text-text truncate flex-1';
    name.textContent = basename(entry.path);

    // Size (only for files)
    const size = document.createElement('span');
    size.className = 'font-mono text-xs text-text-muted flex-shrink-0';
    if (!isDir && entry.size != null) {
      size.textContent = formatFileSize(entry.size);
    }

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(size);

    // Download button (only shown if onDownload callback is provided)
    if (onDownload) {
      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'flex-shrink-0 px-2 py-0.5 text-xs font-mono font-semibold text-text-muted bg-transparent border border-border rounded-sm cursor-pointer transition-all duration-180 hover:text-accent hover:border-accent';
      dlBtn.textContent = '\u2B07';
      dlBtn.setAttribute('aria-label', `Download ${basename(entry.path)}`);
      dlBtn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        onDownload(entry);
      });
      row.appendChild(dlBtn);
    }

    // Click handler
    row.addEventListener('click', () => {
      if (isDir) {
        onDirectorySelect(entry.path);
      } else {
        onFileSelect(entry);
      }
    });

    // Keydown handler for activation (Enter/Space)
    row.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isDir) {
          onDirectorySelect(entry.path);
        } else {
          onFileSelect(entry);
        }
      }
    });

    rows.push(row);
    container.appendChild(row);
  }

  // Keyboard navigation on the container (Arrow Up/Down)
  container.addEventListener('keydown', (e: KeyboardEvent) => {
    if (rows.length === 0) return;

    let newIndex = focusedIndex;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      newIndex = Math.min(focusedIndex + 1, rows.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      newIndex = Math.max(focusedIndex - 1, 0);
    } else if (e.key === 'Home') {
      e.preventDefault();
      newIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      newIndex = rows.length - 1;
    } else {
      return;
    }

    if (newIndex !== focusedIndex) {
      // Roving tabindex: move tabindex="0" to new row
      rows[focusedIndex].setAttribute('tabindex', '-1');
      rows[newIndex].setAttribute('tabindex', '0');
      rows[newIndex].focus();
      focusedIndex = newIndex;
    }
  });

  return container;
}
