/**
 * Drop Zone component for file/folder selection via drag-and-drop or click.
 * Renders a styled interactive region that accepts files and provides visual feedback.
 */
import { t } from './i18n';

export interface DropZoneOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** Callback fired when files are selected (via drop or click) */
  onFiles: (files: FileList) => void;
}

export interface DropZoneAPI {
  /** Get current selected files (null if none) */
  getFiles(): FileList | null;
  /** Reset to empty state */
  reset(): void;
  /** Destroy and clean up DOM + event listeners */
  destroy(): void;
}

/**
 * Feature-detect drag-and-drop support.
 * Checks for draggable attribute and DataTransfer existence.
 */
function supportsDragAndDrop(): boolean {
  const div = document.createElement('div');
  return ('draggable' in div) && ('ondrop' in div) && typeof DataTransfer !== 'undefined';
}

/**
 * Creates a Drop Zone component that provides a styled drag-and-drop area
 * for folder selection, replacing the native file input as the primary file selection UI.
 */
export function createDropZone(options: DropZoneOptions): DropZoneAPI {
  const { container, onFiles } = options;

  // Internal state
  let currentFiles: FileList | null = null;
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  const hasDragDrop = supportsDragAndDrop();

  // --- Build DOM structure ---
  const zone = document.createElement('div');
  zone.className = 'drop-zone border-2 border-dashed border-border rounded-md p-8 text-center cursor-pointer transition-all duration-180 hover:border-accent hover:bg-accent-subtle';

  const content = document.createElement('div');
  content.className = 'flex flex-col items-center gap-2';

  const text = document.createElement('p');
  text.className = 'font-mono text-sm text-text-muted';

  const summary = document.createElement('p');
  summary.className = 'font-mono text-xs text-success mt-2';
  summary.hidden = true;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.hidden = true;
  fileInput.setAttribute('webkitdirectory', '');
  fileInput.setAttribute('directory', '');
  fileInput.multiple = true;

  content.appendChild(text);
  content.appendChild(summary);
  zone.appendChild(content);
  zone.appendChild(fileInput);

  // Set instructional text based on feature detection
  if (hasDragDrop) {
    text.textContent = t('dropZone.text');
  } else {
    text.textContent = t('dropZone.text');
    zone.style.cursor = 'pointer';
  }

  container.appendChild(zone);

  // --- Event handlers ---

  function handleFiles(files: FileList): void {
    currentFiles = files;
    // Update summary display
    text.hidden = true;
    summary.hidden = false;
    summary.textContent = t('dropZone.summary', { count: files.length });
    onFiles(files);
  }

  // Click handler — trigger hidden file input
  function handleClick(): void {
    fileInput.click();
  }

  function handleInputChange(): void {
    const files = fileInput.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }

  zone.addEventListener('click', handleClick);
  fileInput.addEventListener('change', handleInputChange);

  // --- Drag-and-drop handlers (only if supported) ---

  function handleDragEnter(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (hoverTimeout !== null) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    zone.classList.add('border-accent', 'bg-accent-subtle');
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('border-accent', 'bg-accent-subtle');
  }

  function handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    // Revert hover state within 150ms
    hoverTimeout = setTimeout(() => {
      zone.classList.remove('border-accent', 'bg-accent-subtle');
    }, 150);
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // Revert hover state within 150ms
    hoverTimeout = setTimeout(() => {
      zone.classList.remove('border-accent', 'bg-accent-subtle');
    }, 150);

    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleFiles(dt.files);
    }
  }

  if (hasDragDrop) {
    zone.addEventListener('dragenter', handleDragEnter);
    zone.addEventListener('dragover', handleDragOver);
    zone.addEventListener('dragleave', handleDragLeave);
    zone.addEventListener('drop', handleDrop);
  }

  // --- Public API ---

  function getFiles(): FileList | null {
    return currentFiles;
  }

  function reset(): void {
    currentFiles = null;
    fileInput.value = '';
    text.hidden = false;
    summary.hidden = true;
    summary.textContent = '';
    zone.classList.remove('border-accent', 'bg-accent-subtle');
    if (hoverTimeout !== null) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
  }

  function destroy(): void {
    // Remove event listeners
    zone.removeEventListener('click', handleClick);
    fileInput.removeEventListener('change', handleInputChange);

    if (hasDragDrop) {
      zone.removeEventListener('dragenter', handleDragEnter);
      zone.removeEventListener('dragover', handleDragOver);
      zone.removeEventListener('dragleave', handleDragLeave);
      zone.removeEventListener('drop', handleDrop);
    }

    if (hoverTimeout !== null) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }

    // Remove DOM
    container.innerHTML = '';
  }

  return {
    getFiles,
    reset,
    destroy,
  };
}
