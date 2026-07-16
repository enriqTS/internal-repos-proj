import { marked } from '../utils/shared-markdown';
import { t } from '../utils/i18n';
import { textarea as createTextarea } from '../utils/ui';

/**
 * Options for creating a ReadmePreview component.
 */
export interface ReadmePreviewOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** Text area config */
  textareaId?: string;
  maxLength?: number;
  placeholder?: string;
  rows?: number;
}

/**
 * Public API returned by createReadmePreview.
 */
export interface ReadmePreviewAPI {
  /** Get the current textarea value (works in both modes) */
  getValue(): string;
  /** Set the textarea value programmatically (e.g., autofill) */
  setValue(content: string): void;
  /** Get the underlying textarea element (for event listeners) */
  getTextarea(): HTMLTextAreaElement;
  /** Switch to edit mode */
  setEditMode(): void;
  /** Switch to preview mode */
  setPreviewMode(): void;
  /** Get current mode */
  getMode(): 'edit' | 'preview';
  /** Destroy and clean up */
  destroy(): void;
}

/**
 * Escape HTML entities in a string to prevent XSS when rendering markdown.
 */
function escapeHtml(html: string): string {
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Creates a Readme Preview component that wraps a textarea with an
 * Edit/Preview toggle for rendering markdown content.
 */
export function createReadmePreview(options: ReadmePreviewOptions): ReadmePreviewAPI {
  const { container, textareaId, maxLength, placeholder, rows } = options;

  let currentMode: 'edit' | 'preview' = 'preview';

  // --- Build DOM structure ---

  const root = document.createElement('div');
  root.className = 'flex flex-col gap-2';

  // Toggle control (tablist)
  const toggle = document.createElement('div');
  toggle.className = 'flex gap-1 mb-1';
  toggle.setAttribute('role', 'tablist');
  toggle.setAttribute('aria-label', 'Readme editor mode');

  const tabBase = 'font-mono text-xs px-3 py-1.5 border-none cursor-pointer transition-all duration-180 rounded-sm';
  const tabActive = 'bg-accent text-on-accent';
  const tabInactive = 'bg-transparent text-text-muted hover:text-text';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = `${tabBase} ${tabInactive}`;
  editBtn.setAttribute('role', 'tab');
  editBtn.setAttribute('aria-selected', 'false');
  editBtn.setAttribute('aria-controls', 'readme-edit-panel');
  editBtn.textContent = t('readmePreview.write');

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = `${tabBase} ${tabActive}`;
  previewBtn.setAttribute('role', 'tab');
  previewBtn.setAttribute('aria-selected', 'true');
  previewBtn.setAttribute('aria-controls', 'readme-preview-panel');
  previewBtn.textContent = t('readmePreview.preview');

  toggle.appendChild(editBtn);
  toggle.appendChild(previewBtn);
  root.appendChild(toggle);

  // Edit panel (textarea) — hidden by default (preview mode is default)
  const editPanel = document.createElement('div');
  editPanel.id = 'readme-edit-panel';
  editPanel.setAttribute('role', 'tabpanel');
  editPanel.hidden = true;

  const textarea = createTextarea({
    id: textareaId,
    maxLength,
    placeholder,
    rows,
  });
  editPanel.appendChild(textarea);
  root.appendChild(editPanel);

  // Preview panel — visible by default
  const previewPanel = document.createElement('div');
  previewPanel.id = 'readme-preview-panel';
  previewPanel.setAttribute('role', 'tabpanel');

  const previewContent = document.createElement('div');
  previewContent.className = 'readme-preview-content prose-like leading-relaxed text-sm text-text';
  previewPanel.appendChild(previewContent);
  root.appendChild(previewPanel);

  // Render initial preview state (shows placeholder since textarea is empty)
  const placeholderEl = document.createElement('p');
  placeholderEl.className = 'text-sm text-text-muted italic py-4 text-center';
  placeholderEl.textContent = 'Nothing to preview';
  previewContent.appendChild(placeholderEl);

  container.appendChild(root);

  // --- Event handlers ---

  editBtn.addEventListener('click', () => {
    setEditMode();
  });

  previewBtn.addEventListener('click', () => {
    setPreviewMode();
  });

  // --- Mode switching ---

  function setEditMode(): void {
    currentMode = 'edit';

    editBtn.className = `${tabBase} ${tabActive}`;
    editBtn.setAttribute('aria-selected', 'true');
    previewBtn.className = `${tabBase} ${tabInactive}`;
    previewBtn.setAttribute('aria-selected', 'false');

    editPanel.hidden = false;
    previewPanel.hidden = true;
  }

  async function setPreviewMode(): Promise<void> {
    currentMode = 'preview';

    previewBtn.className = `${tabBase} ${tabActive}`;
    previewBtn.setAttribute('aria-selected', 'true');
    editBtn.className = `${tabBase} ${tabInactive}`;
    editBtn.setAttribute('aria-selected', 'false');

    editPanel.hidden = true;
    previewPanel.hidden = false;

    const content = textarea.value;

    if (!content.trim()) {
      previewContent.innerHTML = '';
      const placeholderEl = document.createElement('p');
      placeholderEl.className = 'text-sm text-text-muted italic py-4 text-center';
      placeholderEl.textContent = 'Nothing to preview';
      previewContent.appendChild(placeholderEl);
      return;
    }

    try {
      // Escape HTML in the raw markdown to prevent XSS
      const escapedContent = escapeHtml(content);
      const rendered = await marked.parse(escapedContent);
      previewContent.innerHTML = rendered;
    } catch {
      previewContent.innerHTML = '';
      const errorEl = document.createElement('p');
      errorEl.className = 'text-sm text-text-muted italic py-4 text-center';
      errorEl.textContent = 'Error rendering preview';
      previewContent.appendChild(errorEl);
    }
  }

  // --- Public API ---

  function getValue(): string {
    return textarea.value;
  }

  function setValue(content: string): void {
    textarea.value = content;
    // If in preview mode, re-render the preview with new content
    if (currentMode === 'preview') {
      setPreviewMode();
    }
  }

  function getTextarea(): HTMLTextAreaElement {
    return textarea;
  }

  function getMode(): 'edit' | 'preview' {
    return currentMode;
  }

  function destroy(): void {
    container.removeChild(root);
  }

  return {
    getValue,
    setValue,
    getTextarea,
    setEditMode,
    setPreviewMode,
    getMode,
    destroy,
  };
}
