import {
  PROJECT_NAME_REGEX,
  MAX_PROJECT_NAME_LENGTH,
  MAX_TAGS_COUNT,
  MAX_TAG_LENGTH,
  MAX_README_LENGTH,
} from 'shared/constants';
import { submitUpload } from './api';

/**
 * Validation error messages returned by validateForm.
 */
export interface ValidationErrors {
  name?: string;
  tags?: string;
  readme?: string;
  files?: string;
}

/**
 * Validate the upload form fields client-side before submission.
 * Returns an object with field-specific error messages, or an empty object if valid.
 */
export function validateForm(
  name: string,
  tags: string,
  readme: string,
  files: FileList | null,
): ValidationErrors {
  const errors: ValidationErrors = {};

  // Project name validation
  if (!name.trim()) {
    errors.name = 'Project name is required';
  } else if (name.length > MAX_PROJECT_NAME_LENGTH) {
    errors.name = `Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters`;
  } else if (!PROJECT_NAME_REGEX.test(name)) {
    errors.name = 'Project name may only contain alphanumeric characters, hyphens, and underscores';
  }

  // Tags validation
  if (tags.trim()) {
    const tagList = tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    if (tagList.length > MAX_TAGS_COUNT) {
      errors.tags = `Maximum ${MAX_TAGS_COUNT} tags allowed`;
    } else {
      const longTag = tagList.find((t) => t.length > MAX_TAG_LENGTH);
      if (longTag) {
        errors.tags = `Each tag must be at most ${MAX_TAG_LENGTH} characters`;
      }
    }
  }

  // Readme validation — only check length if provided
  if (readme.length > MAX_README_LENGTH) {
    errors.readme = `Readme must be at most ${MAX_README_LENGTH.toLocaleString()} characters`;
  }

  // Files validation
  if (!files || files.length === 0) {
    errors.files = 'At least one file must be selected';
  }

  return errors;
}

/**
 * Scans a FileList for a root-level README file using webkitRelativePath.
 * Root level means the file's relative path has exactly one path separator
 * (e.g., "folderName/README.md").
 *
 * Matches filenames case-insensitively: readme, readme.md, readme.txt
 * Priority order: .md > .txt > no extension; ties broken by file list order.
 *
 * @returns The highest-priority matching File, or null if none found.
 */
export function detectReadmeFile(files: FileList): File | null {
  const README_PATTERN = /^readme(\.(md|txt))?$/i;
  const PRIORITY: Record<string, number> = { '.md': 0, '.txt': 1, '': 2 };

  const candidates: Array<{ file: File; priority: number; index: number }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = file.webkitRelativePath;
    // Root level: exactly one path separator (e.g., "folderName/README.md")
    const parts = relativePath.split('/');
    if (parts.length !== 2) continue;

    const filename = parts[1];
    if (!README_PATTERN.test(filename)) continue;

    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
    const priority = PRIORITY[ext] ?? 2;
    candidates.push({ file, priority, index: i });
  }

  if (candidates.length === 0) return null;

  // Sort by priority (lower = higher priority), then by original index (stable)
  candidates.sort((a, b) => a.priority - b.priority || a.index - b.index);
  return candidates[0].file;
}

/**
 * Orchestrates README detection, reading, truncation, and UI feedback.
 * Clears previous notices, skips if textarea has content, reads the detected
 * README file, truncates if needed, and shows appropriate notices.
 */
export async function handleReadmeAutofill(
  files: FileList,
  textarea: HTMLTextAreaElement,
  noticeContainer: HTMLDivElement,
): Promise<void> {
  // Clear any previous notices
  noticeContainer.innerHTML = '';

  // Only autofill if textarea is empty/whitespace
  if (textarea.value.trim().length > 0) return;

  const readmeFile = detectReadmeFile(files);
  if (!readmeFile) return;

  let content: string;
  try {
    content = await readmeFile.text();
  } catch {
    // Cannot read file — leave textarea unchanged
    return;
  }

  let truncated = false;
  if (content.length > MAX_README_LENGTH) {
    content = content.slice(0, MAX_README_LENGTH);
    truncated = true;
  }

  textarea.value = content;

  // Show autofill notice
  const notice = document.createElement('span');
  notice.className = 'readme-autofill-notice';
  notice.textContent = `Auto-filled from ${readmeFile.name}`;
  notice.setAttribute('aria-live', 'polite');
  noticeContainer.appendChild(notice);

  // Show truncation warning if applicable
  if (truncated) {
    const warning = document.createElement('span');
    warning.className = 'readme-truncation-warning';
    warning.textContent = `Content was truncated to ${MAX_README_LENGTH.toLocaleString()} characters (maximum allowed).`;
    warning.setAttribute('role', 'alert');
    noticeContainer.appendChild(warning);
  }
}

/**
 * Render the upload form into the given container element.
 * Handles validation, submission, and response display.
 */
export function renderUploadForm(container: HTMLElement): void {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'upload-form-wrapper';

  const heading = document.createElement('h2');
  heading.textContent = 'Upload Project';
  wrapper.appendChild(heading);

  // Status message area
  const statusEl = document.createElement('div');
  statusEl.className = 'upload-status';
  statusEl.setAttribute('role', 'alert');
  statusEl.setAttribute('aria-live', 'polite');
  wrapper.appendChild(statusEl);

  const form = document.createElement('form');
  form.className = 'upload-form';
  form.noValidate = true;

  // Project name field
  const nameGroup = createFieldGroup('project-name', 'Project Name', 'text', {
    maxLength: MAX_PROJECT_NAME_LENGTH,
    placeholder: 'my-project-name',
    required: true,
  });
  form.appendChild(nameGroup.wrapper);

  // Tags field
  const tagsGroup = createFieldGroup('project-tags', 'Tags (comma-separated)', 'text', {
    placeholder: 'tag1, tag2, tag3',
  });
  form.appendChild(tagsGroup.wrapper);

  // Readme field (textarea)
  const readmeGroup = createTextareaGroup('project-readme', 'Readme Content', {
    maxLength: MAX_README_LENGTH,
    placeholder: '# My Project\n\nDescribe your project here...',
    rows: 12,
  });
  form.appendChild(readmeGroup.wrapper);

  // Notice container for autofill/truncation messages
  const readmeNoticeContainer = document.createElement('div');
  readmeNoticeContainer.className = 'readme-notice-container';
  readmeNoticeContainer.setAttribute('aria-live', 'polite');
  form.appendChild(readmeNoticeContainer);

  // Files field (webkitdirectory)
  const filesGroup = createFileGroup('project-files', 'Project Files (select folder)');
  form.appendChild(filesGroup.wrapper);

  // Wire up README autofill on file selection
  filesGroup.input.addEventListener('change', () => {
    const files = filesGroup.input.files;
    if (files && files.length > 0) {
      handleReadmeAutofill(files, readmeGroup.textarea, readmeNoticeContainer);
    }
  });

  // Clear notices when user edits the readme textarea
  readmeGroup.textarea.addEventListener('input', () => {
    readmeNoticeContainer.innerHTML = '';
  });

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'upload-submit';
  submitBtn.textContent = 'Upload Project';
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous status and field errors
    statusEl.textContent = '';
    statusEl.className = 'upload-status';
    clearFieldErrors(form);

    const name = nameGroup.input.value;
    const tags = tagsGroup.input.value;
    const readme = readmeGroup.textarea.value;
    const files = filesGroup.input.files;

    // Client-side validation
    const errors = validateForm(name, tags, readme, files);
    if (Object.keys(errors).length > 0) {
      showFieldErrors(errors, nameGroup, tagsGroup, readmeGroup, filesGroup);
      return;
    }

    // Build FormData
    const formData = new FormData();
    formData.append('name', name.trim());
    formData.append('tags', tags.trim());
    formData.append('readme', readme);

    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Use webkitRelativePath for directory structure preservation
        const relativePath = file.webkitRelativePath || file.name;
        formData.append('files', file, relativePath);
      }
    }

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';
    statusEl.textContent = 'Uploading project...';
    statusEl.className = 'upload-status upload-status--loading';

    const result = await submitUpload(formData);

    // Reset button state
    submitBtn.disabled = false;
    submitBtn.textContent = 'Upload Project';

    if (result.ok) {
      // Success: show confirmation and clear form
      statusEl.textContent = result.data.warning
        ? `Project uploaded successfully. Warning: ${result.data.warning}`
        : 'Project uploaded successfully!';
      statusEl.className = 'upload-status upload-status--success';
      form.reset();
    } else {
      // Error: show appropriate message
      statusEl.textContent = result.error;
      statusEl.className = 'upload-status upload-status--error';
    }
  });

  wrapper.appendChild(form);
  container.appendChild(wrapper);
}

// --- Helper functions for DOM creation ---

interface FieldGroup {
  wrapper: HTMLDivElement;
  input: HTMLInputElement;
  errorEl: HTMLSpanElement;
}

interface TextareaGroup {
  wrapper: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  errorEl: HTMLSpanElement;
}

interface FileFieldGroup {
  wrapper: HTMLDivElement;
  input: HTMLInputElement;
  errorEl: HTMLSpanElement;
}

function createFieldGroup(
  id: string,
  labelText: string,
  type: string,
  options: { maxLength?: number; placeholder?: string; required?: boolean } = {},
): FieldGroup {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-group';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  wrapper.appendChild(label);

  const input = document.createElement('input');
  input.type = type;
  input.id = id;
  input.name = id;
  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.required) input.required = true;
  wrapper.appendChild(input);

  const errorEl = document.createElement('span');
  errorEl.className = 'field-error';
  errorEl.setAttribute('aria-live', 'polite');
  wrapper.appendChild(errorEl);

  return { wrapper, input, errorEl };
}

function createTextareaGroup(
  id: string,
  labelText: string,
  options: { maxLength?: number; placeholder?: string; required?: boolean; rows?: number } = {},
): TextareaGroup {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-group';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  wrapper.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.id = id;
  textarea.name = id;
  if (options.maxLength) textarea.maxLength = options.maxLength;
  if (options.placeholder) textarea.placeholder = options.placeholder;
  if (options.required) textarea.required = true;
  if (options.rows) textarea.rows = options.rows;
  wrapper.appendChild(textarea);

  const errorEl = document.createElement('span');
  errorEl.className = 'field-error';
  errorEl.setAttribute('aria-live', 'polite');
  wrapper.appendChild(errorEl);

  return { wrapper, textarea, errorEl };
}

function createFileGroup(id: string, labelText: string): FileFieldGroup {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-group';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  wrapper.appendChild(label);

  const input = document.createElement('input');
  input.type = 'file';
  input.id = id;
  input.name = id;
  // webkitdirectory for folder selection
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
  input.multiple = true;
  wrapper.appendChild(input);

  const errorEl = document.createElement('span');
  errorEl.className = 'field-error';
  errorEl.setAttribute('aria-live', 'polite');
  wrapper.appendChild(errorEl);

  return { wrapper, input, errorEl };
}

function showFieldErrors(
  errors: ValidationErrors,
  nameGroup: FieldGroup,
  tagsGroup: FieldGroup,
  readmeGroup: TextareaGroup,
  filesGroup: FileFieldGroup,
): void {
  if (errors.name) nameGroup.errorEl.textContent = errors.name;
  if (errors.tags) tagsGroup.errorEl.textContent = errors.tags;
  if (errors.readme) readmeGroup.errorEl.textContent = errors.readme;
  if (errors.files) filesGroup.errorEl.textContent = errors.files;
}

function clearFieldErrors(form: HTMLFormElement): void {
  const errorEls = form.querySelectorAll('.field-error');
  errorEls.forEach((el) => {
    el.textContent = '';
  });
}
