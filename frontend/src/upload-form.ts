import {
  PROJECT_NAME_REGEX,
  MAX_PROJECT_NAME_LENGTH,
  MAX_TAGS_COUNT,
  MAX_README_LENGTH,
  MAX_CLIENT_ZIP_SIZE,
  DENY_LIST,
} from 'shared/constants';
import type { TagInput } from 'shared/types';
import { initiateUpload, uploadToS3, finalizeUpload, fetchTagRegistry, suggestTags } from './api';
import { createTagSelector, type TagSelectorAPI } from './tag-selector';
import { invalidateSearchIndex } from './search-state';
import JSZip from 'jszip';

/**
 * Validation error messages returned by validateForm.
 */
export interface ValidationErrors {
  name?: string;
  readme?: string;
  files?: string;
}

/**
 * Validate the upload form fields client-side before submission.
 * Returns an object with field-specific error messages, or an empty object if valid.
 * Note: Tags validation is handled by the TagSelector component itself.
 */
export function validateForm(
  name: string,
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
 * Checks whether a relative file path matches any DENY_LIST pattern.
 * Used client-side to pre-filter files before uploading, avoiding 413 errors
 * from sending large build artifacts to the server.
 *
 * @param relativePath - Path relative to the project root (strips the top-level folder name)
 */
export function shouldExcludeFile(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const basename = segments[segments.length - 1];

  for (const pattern of DENY_LIST) {
    // Directory pattern (ends with /)
    if (pattern.endsWith('/')) {
      const dirName = pattern.slice(0, -1);
      if (segments.some((seg) => seg === dirName)) {
        return true;
      }
      continue;
    }

    // Glob pattern with wildcard
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );
      if (regex.test(basename)) {
        return true;
      }
      continue;
    }

    // Exact match against basename
    if (basename === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * Filters a FileList, returning only files whose paths don't match the DENY_LIST.
 * Strips the top-level directory name from webkitRelativePath before matching.
 */
export function filterFileList(files: FileList): File[] {
  const result: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = file.webkitRelativePath || file.name;
    // Strip the top-level folder name (e.g., "MyProject/src/foo.ts" -> "src/foo.ts")
    const parts = relativePath.split('/');
    const pathWithinProject = parts.length > 1 ? parts.slice(1).join('/') : relativePath;
    if (!shouldExcludeFile(pathWithinProject)) {
      result.push(file);
    }
  }
  return result;
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

  // Tags field — Tag Selector component
  const tagsGroupWrapper = document.createElement('div');
  tagsGroupWrapper.className = 'form-group';

  const tagsLabel = document.createElement('label');
  tagsLabel.textContent = 'Tags';
  tagsGroupWrapper.appendChild(tagsLabel);

  const tagSelectorContainer = document.createElement('div');
  tagSelectorContainer.className = 'tag-selector-container';
  tagsGroupWrapper.appendChild(tagSelectorContainer);

  const tagWarningEl = document.createElement('span');
  tagWarningEl.className = 'field-warning';
  tagWarningEl.setAttribute('aria-live', 'polite');
  tagsGroupWrapper.appendChild(tagWarningEl);

  form.appendChild(tagsGroupWrapper);

  // Create the Tag Selector component
  let tagSelector: TagSelectorAPI | null = null;
  tagSelector = createTagSelector({
    container: tagSelectorContainer,
    onChange: () => {},
    maxTags: MAX_TAGS_COUNT,
  });

  // Fetch tag registry on form load
  fetchTagRegistry().then((result) => {
    if (result.ok) {
      tagSelector!.setAvailableTags(result.data);
    } else {
      // Non-404 error — show warning in the tag selector area
      tagWarningEl.textContent = 'Existing tag suggestions unavailable';
    }
  });

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

  // --- Tag suggestion logic ---
  let suggestionTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Request tag suggestions from the Lambda if conditions are met:
   * - README content is ≥50 characters
   * - User hasn't manually interacted with the tag selector
   */
  function requestTagSuggestions(): void {
    if (suggestionTimeout !== null) {
      clearTimeout(suggestionTimeout);
    }
    const content = readmeGroup.textarea.value;
    if (content.length >= 50 && tagSelector && !tagSelector.hasUserInteracted()) {
      suggestionTimeout = setTimeout(() => {
        suggestTags(content).then((result) => {
          if (result.ok && result.data.length > 0 && tagSelector && !tagSelector.hasUserInteracted()) {
            tagSelector.applySuggestions(result.data);
          }
        });
      }, 500);
    }
  }

  // Wire up README autofill on file selection
  filesGroup.input.addEventListener('change', () => {
    const files = filesGroup.input.files;
    if (files && files.length > 0) {
      handleReadmeAutofill(files, readmeGroup.textarea, readmeNoticeContainer).then(() => {
        // After autofill completes, trigger tag suggestions
        requestTagSuggestions();
      });
    }
  });

  // Clear notices when user edits the readme textarea
  readmeGroup.textarea.addEventListener('input', () => {
    readmeNoticeContainer.innerHTML = '';
  });

  // Debounced README suggestion on manual typing
  readmeGroup.textarea.addEventListener('input', () => {
    requestTagSuggestions();
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
    const readme = readmeGroup.textarea.value;
    const files = filesGroup.input.files;

    // Client-side validation (tags handled by TagSelector component)
    const errors = validateForm(name, readme, files);
    if (Object.keys(errors).length > 0) {
      showFieldErrors(errors, nameGroup, readmeGroup, filesGroup);
      return;
    }

    // Build structured TagInput[] from tag selector
    let selectedTags = tagSelector!.getSelectedTags();
    const newTags = tagSelector!.getNewTags();

    // If no tags selected and README is available, attempt to get AI suggestions as fallback
    if (selectedTags.length === 0 && readme.length >= 50) {
      statusEl.textContent = 'Getting tag suggestions...';
      statusEl.className = 'upload-status upload-status--loading';
      const suggestResult = await suggestTags(readme);
      if (suggestResult.ok && suggestResult.data.length > 0) {
        tagSelector!.applySuggestions(suggestResult.data);
        selectedTags = tagSelector!.getSelectedTags();
      }
    }

    const tagInputs: TagInput[] = selectedTags.map((t) => ({
      tag: t,
      isNew: newTags.includes(t),
    }));

    // 1. Filter files client-side
    const filteredFiles = filterFileList(files!);
    if (filteredFiles.length === 0) {
      statusEl.textContent = 'No files remain after filtering out build artifacts and ignored patterns.';
      statusEl.className = 'upload-status upload-status--error';
      return;
    }

    // Disable submit while processing
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';

    // 2. Create zip client-side
    statusEl.textContent = 'Zipping files...';
    statusEl.className = 'upload-status upload-status--loading';
    const zip = new JSZip();
    for (const file of filteredFiles) {
      const relativePath = file.webkitRelativePath || file.name;
      const parts = relativePath.split('/');
      const pathWithinProject = parts.length > 1 ? parts.slice(1).join('/') : relativePath;
      zip.file(pathWithinProject, file);
    }
    const blob = await zip.generateAsync({ type: 'blob' });

    // 3. Check size
    if (blob.size > MAX_CLIENT_ZIP_SIZE) {
      statusEl.textContent = 'Project is too large to upload (exceeds 500 MB limit).';
      statusEl.className = 'upload-status upload-status--error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload Project';
      return;
    }

    // 4. Initiate upload with structured tags
    statusEl.textContent = 'Initiating upload...';
    const initiateResult = await initiateUpload({ name: name.trim(), tags: tagInputs, readme });
    if (!initiateResult.ok) {
      statusEl.textContent = initiateResult.error;
      statusEl.className = 'upload-status upload-status--error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload Project';
      return;
    }

    // 5. Upload to S3 with progress
    statusEl.textContent = 'Uploading... 0%';
    try {
      await uploadToS3(initiateResult.data.uploadUrl, blob, (pct) => {
        statusEl.textContent = `Uploading... ${pct}%`;
      });
    } catch (err) {
      statusEl.textContent = `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`;
      statusEl.className = 'upload-status upload-status--error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload Project';
      return;
    }

    // 6. Finalize
    statusEl.textContent = 'Processing...';
    const finalizeResult = await finalizeUpload(initiateResult.data.sessionId);
    if (!finalizeResult.ok) {
      statusEl.textContent = finalizeResult.error;
      statusEl.className = 'upload-status upload-status--error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload Project';
      return;
    }

    // 7. Success
    invalidateSearchIndex();
    statusEl.textContent = finalizeResult.data.warning
      ? `Project uploaded successfully. Warning: ${finalizeResult.data.warning}`
      : 'Project uploaded successfully!';
    statusEl.className = 'upload-status upload-status--success';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Upload Project';
    form.reset();
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
  readmeGroup: TextareaGroup,
  filesGroup: FileFieldGroup,
): void {
  if (errors.name) nameGroup.errorEl.textContent = errors.name;
  if (errors.readme) readmeGroup.errorEl.textContent = errors.readme;
  if (errors.files) filesGroup.errorEl.textContent = errors.files;
}

function clearFieldErrors(form: HTMLFormElement): void {
  const errorEls = form.querySelectorAll('.field-error');
  errorEls.forEach((el) => {
    el.textContent = '';
  });
}
