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
import { createDropZone } from './drop-zone';
import { createReadmePreview, type ReadmePreviewAPI } from './readme-preview';
import { invalidateSearchIndex } from './search-state';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import JSZip from 'jszip';

/**
 * Sanitizes a raw folder name into a valid project name.
 * - Replaces whitespace with hyphens
 * - Replaces dots and other common separators with hyphens
 * - Removes characters not allowed by PROJECT_NAME_REGEX (keeps alphanumeric, hyphens, underscores)
 * - Collapses consecutive hyphens into one
 * - Trims leading/trailing hyphens
 * - Truncates to MAX_PROJECT_NAME_LENGTH
 */
export function sanitizeProjectName(raw: string): string {
  let sanitized = raw
    .trim()
    .normalize('NFD')             // decompose accented chars (ã → a + combining ~)
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .replace(/\s+/g, '-')         // whitespace → hyphen
    .replace(/[.@#+]+/g, '-')     // common separators → hyphen
    .replace(/[^a-zA-Z0-9_-]/g, '') // remove anything else invalid
    .replace(/-{2,}/g, '-')       // collapse multiple hyphens
    .replace(/^-+/, '')           // trim leading hyphens
    .replace(/-+$/, '');          // trim trailing hyphens

  if (sanitized.length > MAX_PROJECT_NAME_LENGTH) {
    sanitized = sanitized.slice(0, MAX_PROJECT_NAME_LENGTH).replace(/-+$/, '');
  }

  return sanitized;
}

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
 * Extract the git remote origin URL from the .git/config file in a FileList.
 * Looks for a file at the root-level .git/config path (e.g., "FolderName/.git/config").
 * Parses the INI-style format and normalizes SSH/HTTPS URLs.
 * Returns undefined if no .git/config is found or no remote origin exists.
 */
export async function extractGitRemoteFromFiles(files: FileList): Promise<string | undefined> {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = file.webkitRelativePath || file.name;
    const parts = relativePath.split('/');
    // Match "TopFolder/.git/config" (3 parts) only
    if (parts.length === 3 && parts[1] === '.git' && parts[2] === 'config') {
      try {
        const content = await file.text();
        return parseGitConfigRemoteUrl(content);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Parse a .git/config file content and extract the remote origin URL.
 * Converts SSH URLs to HTTPS and strips credentials.
 */
export function parseGitConfigRemoteUrl(content: string): string | undefined {
  const lines = content.split('\n');
  let inRemoteOrigin = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\[remote\s+"origin"\]$/i.test(trimmed)) {
      inRemoteOrigin = true;
      continue;
    }

    if (trimmed.startsWith('[') && inRemoteOrigin) {
      break;
    }

    if (inRemoteOrigin) {
      const match = trimmed.match(/^url\s*=\s*(.+)$/i);
      if (match) {
        let url = match[1].trim();
        url = normalizeGitUrl(url);
        return url || undefined;
      }
    }
  }

  return undefined;
}

/**
 * Normalize a git URL to a clean HTTPS browsable URL.
 * - Converts SSH format (git@host:user/repo.git) to https://host/user/repo
 * - Strips .git suffix
 * - Strips embedded credentials
 * - Returns empty string if the URL format is unrecognized
 */
function normalizeGitUrl(url: string): string {
  // Handle SSH format: git@github.com:user/repo.git
  const sshMatch = url.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const path = sshMatch[2].replace(/\.git$/, '');
    return `https://${host}/${path}`;
  }

  // Handle HTTPS/HTTP URLs
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      parsed.username = '';
      parsed.password = '';
      parsed.pathname = parsed.pathname.replace(/\.git$/, '');
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    // Not a valid URL
  }

  // Handle ssh:// format
  const sshProtoMatch = url.match(/^ssh:\/\/[^@]*@?([^/]+)\/(.+)$/);
  if (sshProtoMatch) {
    const host = sshProtoMatch[1];
    const path = sshProtoMatch[2].replace(/\.git$/, '');
    return `https://${host}/${path}`;
  }

  return '';
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
  readmePreview: ReadmePreviewAPI,
  noticeContainer: HTMLDivElement,
): Promise<void> {
  // Clear any previous notices
  noticeContainer.innerHTML = '';

  // Only autofill if textarea is empty/whitespace
  if (readmePreview.getValue().trim().length > 0) return;

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

  readmePreview.setValue(content);

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

  // Configure marked with highlight.js for syntax highlighting
  const markedInstance = new Marked(
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code: string, lang: string) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
    }),
  );

  const wrapper = document.createElement('div');
  wrapper.className = 'upload-form-wrapper';

  const heading = document.createElement('h2');
  heading.textContent = 'Upload Project';
  wrapper.appendChild(heading);

  const form = document.createElement('form');
  form.className = 'upload-form';
  form.noValidate = true;

  // --- 1. Drop Zone (first element) ---
  const dropZoneContainer = document.createElement('div');
  dropZoneContainer.className = 'form-group drop-zone-container';
  form.appendChild(dropZoneContainer);

  // Files error element (shown on validation failure)
  const filesErrorEl = document.createElement('span');
  filesErrorEl.className = 'field-error';
  filesErrorEl.setAttribute('aria-live', 'polite');
  dropZoneContainer.appendChild(filesErrorEl);

  // Track selected files
  let selectedFiles: FileList | null = null;

  // --- 2. Project Name field ---
  const nameGroup = createFieldGroup('project-name', 'Project Name', 'text', {
    maxLength: MAX_PROJECT_NAME_LENGTH,
    placeholder: 'my-project-name',
    required: true,
  });
  form.appendChild(nameGroup.wrapper);

  // --- 2.5. Repository URL field ---
  const repoGroup = createFieldGroup('project-repository-url', 'Repository URL (optional)', 'url', {
    maxLength: 2048,
    placeholder: 'https://github.com/org/repo',
  });
  form.appendChild(repoGroup.wrapper);

  // --- 3. Tags field — Tag Selector component ---
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

  // --- 4. Submit button ---
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'upload-submit';
  submitBtn.textContent = 'Upload Project';
  form.appendChild(submitBtn);

  // --- 5. Status message area ---
  const statusEl = document.createElement('div');
  statusEl.className = 'upload-status';
  statusEl.setAttribute('role', 'alert');
  statusEl.setAttribute('aria-live', 'polite');
  form.appendChild(statusEl);

  // --- 6. Readme (with preview toggle) ---
  const readmeGroupWrapper = document.createElement('div');
  readmeGroupWrapper.className = 'form-group';

  const readmeLabel = document.createElement('label');
  readmeLabel.textContent = 'Readme Content';
  readmeGroupWrapper.appendChild(readmeLabel);

  const readmePreviewContainer = document.createElement('div');
  readmeGroupWrapper.appendChild(readmePreviewContainer);

  const readmeErrorEl = document.createElement('span');
  readmeErrorEl.className = 'field-error';
  readmeErrorEl.setAttribute('aria-live', 'polite');
  readmeGroupWrapper.appendChild(readmeErrorEl);

  form.appendChild(readmeGroupWrapper);

  // Create the Readme Preview component
  const readmePreview: ReadmePreviewAPI = createReadmePreview({
    container: readmePreviewContainer,
    markedInstance,
    textareaId: 'project-readme',
    maxLength: MAX_README_LENGTH,
    placeholder: '# My Project\n\nDescribe your project here...',
    rows: 12,
  });

  // --- 7. Readme notice container ---
  const readmeNoticeContainer = document.createElement('div');
  readmeNoticeContainer.className = 'readme-notice-container';
  readmeNoticeContainer.setAttribute('aria-live', 'polite');
  form.appendChild(readmeNoticeContainer);

  // --- Tag suggestion logic ---
  let suggestionTimeout: ReturnType<typeof setTimeout> | null = null;
  let tagSuggestionInFlight = false;

  function updateSubmitState(): void {
    if (tagSuggestionInFlight) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Suggesting tags...';
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload Project';
    }
  }

  /**
   * Request tag suggestions from the Lambda if conditions are met:
   * - README content is ≥50 characters
   * - User hasn't manually interacted with the tag selector
   */
  function requestTagSuggestions(): void {
    if (suggestionTimeout !== null) {
      clearTimeout(suggestionTimeout);
    }
    const content = readmePreview.getValue();
    if (content.length >= 50 && tagSelector && !tagSelector.hasUserInteracted()) {
      suggestionTimeout = setTimeout(() => {
        tagSuggestionInFlight = true;
        updateSubmitState();
        suggestTags(content).then((result) => {
          if (result.ok && result.data.length > 0 && tagSelector && !tagSelector.hasUserInteracted()) {
            tagSelector.applySuggestions(result.data);
          }
        }).finally(() => {
          tagSuggestionInFlight = false;
          updateSubmitState();
        });
      }, 500);
    }
  }

  // --- Wire Drop Zone ---
  const dropZone = createDropZone({
    container: dropZoneContainer,
    onFiles: (files: FileList) => {
      selectedFiles = files;

      // Auto-fill project name from folder name if empty
      if (!nameGroup.input.value.trim() && files.length > 0 && files[0].webkitRelativePath) {
        const folderName = files[0].webkitRelativePath.split('/')[0];
        if (folderName) {
          nameGroup.input.value = sanitizeProjectName(folderName);
        }
      }

      // Auto-fill repository URL from .git/config if the field is empty
      if (!repoGroup.input.value.trim()) {
        extractGitRemoteFromFiles(files).then((url) => {
          if (url && !repoGroup.input.value.trim()) {
            repoGroup.input.value = url;
          }
        });
      }

      handleReadmeAutofill(files, readmePreview, readmeNoticeContainer).then(() => {
        // After autofill completes, trigger tag suggestions
        requestTagSuggestions();
      });
    },
  });

  // Clear notices when user edits the readme textarea
  readmePreview.getTextarea().addEventListener('input', () => {
    readmeNoticeContainer.innerHTML = '';
  });

  // Debounced README suggestion on manual typing
  readmePreview.getTextarea().addEventListener('input', () => {
    requestTagSuggestions();
  });

  // --- Form submission handler ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous status and field errors
    statusEl.textContent = '';
    statusEl.className = 'upload-status';
    clearFieldErrors(form);

    const name = nameGroup.input.value;
    const readme = readmePreview.getValue();
    const files = selectedFiles;

    // Client-side validation (tags handled by TagSelector component)
    const errors = validateForm(name, readme, files);
    if (Object.keys(errors).length > 0) {
      if (errors.name) nameGroup.errorEl.textContent = errors.name;
      if (errors.readme) readmeErrorEl.textContent = errors.readme;
      if (errors.files) filesErrorEl.textContent = errors.files;
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

    // Use the repo URL from the form field (may have been auto-filled from .git/config or entered manually)
    const repoUrl = repoGroup.input.value.trim();
    const initiateResult = await initiateUpload({ name: name.trim(), tags: tagInputs, readme, ...(repoUrl && { repositoryUrl: repoUrl }) });
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

    // 7. Success — redirect to project list
    invalidateSearchIndex();
    window.location.hash = '#/';
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

function clearFieldErrors(form: HTMLFormElement): void {
  const errorEls = form.querySelectorAll('.field-error');
  errorEls.forEach((el) => {
    el.textContent = '';
  });
}
