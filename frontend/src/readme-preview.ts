import { marked } from './shared-markdown';

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
  root.className = 'readme-preview-wrapper';

  // Toggle control (tablist)
  const toggle = document.createElement('div');
  toggle.className = 'readme-toggle';
  toggle.setAttribute('role', 'tablist');
  toggle.setAttribute('aria-label', 'Readme editor mode');

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'readme-toggle__btn';
  editBtn.setAttribute('role', 'tab');
  editBtn.setAttribute('aria-selected', 'false');
  editBtn.setAttribute('aria-controls', 'readme-edit-panel');
  editBtn.textContent = 'Edit';

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'readme-toggle__btn readme-toggle__btn--active';
  previewBtn.setAttribute('role', 'tab');
  previewBtn.setAttribute('aria-selected', 'true');
  previewBtn.setAttribute('aria-controls', 'readme-preview-panel');
  previewBtn.textContent = 'Preview';

  toggle.appendChild(editBtn);
  toggle.appendChild(previewBtn);
  root.appendChild(toggle);

  // Edit panel (textarea) — hidden by default (preview mode is default)
  const editPanel = document.createElement('div');
  editPanel.id = 'readme-edit-panel';
  editPanel.setAttribute('role', 'tabpanel');
  editPanel.hidden = true;

  const textarea = document.createElement('textarea');
  if (textareaId) {
    textarea.id = textareaId;
  }
  if (maxLength !== undefined) {
    textarea.maxLength = maxLength;
  }
  if (placeholder) {
    textarea.placeholder = placeholder;
  }
  if (rows !== undefined) {
    textarea.rows = rows;
  }
  textarea.className = 'readme-textarea';
  editPanel.appendChild(textarea);
  root.appendChild(editPanel);

  // Preview panel — visible by default
  const previewPanel = document.createElement('div');
  previewPanel.id = 'readme-preview-panel';
  previewPanel.setAttribute('role', 'tabpanel');

  const previewContent = document.createElement('div');
  previewContent.className = 'readme-preview-content';
  previewPanel.appendChild(previewContent);
  root.appendChild(previewPanel);

  // Render initial preview state (shows placeholder since textarea is empty)
  const placeholderEl = document.createElement('p');
  placeholderEl.className = 'readme-preview-placeholder';
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

    editBtn.classList.add('readme-toggle__btn--active');
    editBtn.setAttribute('aria-selected', 'true');
    previewBtn.classList.remove('readme-toggle__btn--active');
    previewBtn.setAttribute('aria-selected', 'false');

    editPanel.hidden = false;
    previewPanel.hidden = true;
  }

  async function setPreviewMode(): Promise<void> {
    currentMode = 'preview';

    previewBtn.classList.add('readme-toggle__btn--active');
    previewBtn.setAttribute('aria-selected', 'true');
    editBtn.classList.remove('readme-toggle__btn--active');
    editBtn.setAttribute('aria-selected', 'false');

    editPanel.hidden = true;
    previewPanel.hidden = false;

    const content = textarea.value;

    if (!content.trim()) {
      previewContent.innerHTML = '';
      const placeholderEl = document.createElement('p');
      placeholderEl.className = 'readme-preview-placeholder';
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
      errorEl.className = 'readme-preview-placeholder';
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
