/**
 * Drop Zone component for file/folder selection via drag-and-drop or click.
 * Renders a styled interactive region that accepts files and provides visual feedback.
 * Supports both folder (webkitdirectory) and .zip file upload modes.
 */
import { t } from '../utils/i18n';

export type UploadMode = 'zip' | 'folder';

export interface DropZoneOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** Callback fired when files are selected (via drop or click) */
  onFiles: (files: FileList) => void;
}

export interface DropZoneAPI {
  /** Get current selected files (null if none) */
  getFiles(): FileList | null;
  /** Get the detected upload mode for the current files */
  getUploadMode(): UploadMode | null;
  /** Reset to empty state */
  reset(): void;
  /** Destroy and clean up DOM + event listeners */
  destroy(): void;
}

/**
 * Detect upload mode based on the selected/dropped files.
 * If the FileList contains exactly one file whose name ends with `.zip` (case-insensitive),
 * the detected mode is "zip"; otherwise the mode is "folder".
 */
export function detectUploadMode(files: FileList): UploadMode {
  if (files.length === 1) {
    const fileName = files[0].name;
    if (fileName.toLowerCase().endsWith('.zip')) {
      return 'zip';
    }
  }
  return 'folder';
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
 * for folder and zip file selection, replacing the native file input as the primary file selection UI.
 */
export function createDropZone(options: DropZoneOptions): DropZoneAPI {
  const { container, onFiles } = options;

  // Internal state
  let currentFiles: FileList | null = null;
  let currentMode: UploadMode | null = null;
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  const hasDragDrop = supportsDragAndDrop();

  // --- Build DOM structure ---
  const zone = document.createElement('div');
  zone.className = 'drop-zone border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer transition-all duration-180 hover:border-accent hover:bg-accent-subtle';

  const content = document.createElement('div');
  content.className = 'flex flex-col items-center gap-2';

  const text = document.createElement('p');
  text.className = 'font-mono text-sm text-text-muted';

  const summary = document.createElement('p');
  summary.className = 'font-mono text-xs text-success mt-2';
  summary.hidden = true;

  // Hidden input for folder selection (webkitdirectory)
  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.hidden = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');
  folderInput.multiple = true;

  // Hidden input for zip file selection
  const zipInput = document.createElement('input');
  zipInput.type = 'file';
  zipInput.hidden = true;
  zipInput.setAttribute('accept', '.zip');

  content.appendChild(text);
  content.appendChild(summary);
  zone.appendChild(content);
  zone.appendChild(folderInput);
  zone.appendChild(zipInput);

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
    currentMode = detectUploadMode(files);

    // Update summary display
    text.hidden = true;
    summary.hidden = false;

    if (currentMode === 'zip') {
      summary.textContent = t('dropZone.summaryZip', { name: files[0].name });
    } else {
      summary.textContent = t('dropZone.summaryFolder', { count: files.length });
    }

    onFiles(files);
  }

  // Click handler — trigger hidden file input (folder by default)
  function handleClick(): void {
    folderInput.click();
  }

  function handleFolderInputChange(): void {
    const files = folderInput.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }

  function handleZipInputChange(): void {
    const files = zipInput.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }

  zone.addEventListener('click', handleClick);
  folderInput.addEventListener('change', handleFolderInputChange);
  zipInput.addEventListener('change', handleZipInputChange);

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

  function getUploadMode(): UploadMode | null {
    return currentMode;
  }

  function reset(): void {
    currentFiles = null;
    currentMode = null;
    folderInput.value = '';
    zipInput.value = '';
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
    folderInput.removeEventListener('change', handleFolderInputChange);
    zipInput.removeEventListener('change', handleZipInputChange);

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
    getUploadMode,
    reset,
    destroy,
  };
}
