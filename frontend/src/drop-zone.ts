/**
 * Drop Zone component for file/folder selection via drag-and-drop or click.
 * Renders a styled interactive region that accepts files and provides visual feedback.
 */

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
  zone.className = 'drop-zone';

  const content = document.createElement('div');
  content.className = 'drop-zone__content';

  const text = document.createElement('p');
  text.className = 'drop-zone__text';

  const summary = document.createElement('p');
  summary.className = 'drop-zone__summary';
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
    text.textContent = 'Drag & drop a project folder here, or click to browse';
  } else {
    text.textContent = 'Click to browse for a project folder';
    zone.style.cursor = 'pointer';
  }

  container.appendChild(zone);

  // --- Event handlers ---

  function handleFiles(files: FileList): void {
    currentFiles = files;
    // Update summary display
    text.hidden = true;
    summary.hidden = false;
    summary.textContent = `${files.length} file${files.length !== 1 ? 's' : ''} selected`;
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
    zone.classList.add('drop-zone--drag-over');
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('drop-zone--drag-over');
  }

  function handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    // Revert hover state within 150ms
    hoverTimeout = setTimeout(() => {
      zone.classList.remove('drop-zone--drag-over');
    }, 150);
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // Revert hover state within 150ms
    hoverTimeout = setTimeout(() => {
      zone.classList.remove('drop-zone--drag-over');
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
    zone.classList.remove('drop-zone--drag-over');
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
