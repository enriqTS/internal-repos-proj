import {
  MAX_PROJECT_NAME_LENGTH,
  MAX_README_LENGTH,
  MAX_CLIENT_ZIP_SIZE,
  DENY_LIST,
} from 'shared/constants';
import type { TagInput } from 'shared/types';
import {
  fetchProjectMetadata,
  fetchProjectReadme,
  fetchTagRegistry,
  computePatchBody,
  updateProject,
  initiateUpload,
  uploadToS3,
  finalizeUpload,
} from './api';
import { createTagSelector, type TagSelectorAPI } from './components/tag-selector';
import { filterFileList } from './upload-form';
import { invalidateSearchIndex } from './search-state';
import { t } from './i18n';
import { button, input, textarea, heading } from './ui';
import JSZip from 'jszip';

/**
 * Validation error messages for the edit form.
 */
export interface EditValidationErrors {
  readme?: string;
  files?: string;
  repositoryUrl?: string;
}

/**
 * Validate the edit form fields client-side before submission.
 * Tags are validated by TagSelector component. Name is not editable in edit form.
 * Only readme length, optional files, and repository URL are validated here.
 */
export function validateEditForm(
  readme: string,
  files: FileList | null,
  hasFiles: boolean,
  repositoryUrl?: string,
): EditValidationErrors {
  const errors: EditValidationErrors = {};

  if (readme.length > MAX_README_LENGTH) {
    errors.readme = t('validation.readmeTooLong', { max: MAX_README_LENGTH.toLocaleString() });
  }

  // If user selected a folder, it must contain at least one file
  if (hasFiles && (!files || files.length === 0)) {
    errors.files = t('validation.folderEmpty');
  }

  // Validate repository URL if provided
  if (repositoryUrl && repositoryUrl.length > 0) {
    if (repositoryUrl.length > 2048) {
      errors.repositoryUrl = t('validation.repoTooLong');
    } else {
      try {
        const parsed = new URL(repositoryUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          errors.repositoryUrl = t('validation.repoInvalidProtocol');
        }
      } catch {
        errors.repositoryUrl = t('validation.repoInvalidUrl');
      }
    }
  }

  return errors;
}

/**
 * Render the edit form into the given container element.
 * Fetches current metadata and readme, pre-fills the form,
 * and handles submission with optional artifact replacement.
 *
 * @param projectName - The project name extracted from the route
 * @param container - The DOM element to render into
 */
export async function renderEditForm(
  projectName: string,
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'max-w-2xl mx-auto px-4 py-8';

  const headingEl = heading(`${t('edit.heading')}: ${projectName}`, 2);
  wrapper.appendChild(headingEl);

  // Status message area
  const statusEl = document.createElement('div');
  statusEl.className = 'text-sm mt-2 text-text-muted';
  statusEl.setAttribute('role', 'alert');
  statusEl.setAttribute('aria-live', 'polite');
  wrapper.appendChild(statusEl);

  container.appendChild(wrapper);

  // Fetch current metadata and readme
  statusEl.textContent = t('edit.loading');
  statusEl.className = 'text-sm mt-2 text-text-muted animate-pulse';

  const projectPath = `projects/${projectName}/`;
  const [metadataResult, readmeResult] = await Promise.all([
    fetchProjectMetadata(projectPath),
    fetchProjectReadme(projectPath),
  ]);

  if (!metadataResult.ok) {
    statusEl.textContent = `${t('edit.loadError')}: ${metadataResult.error}`;
    statusEl.className = 'text-sm mt-2 text-error';
    return;
  }

  const metadata = metadataResult.data;
  const currentReadme = readmeResult.ok ? readmeResult.data : '';

  // Clear loading status
  statusEl.textContent = '';
  statusEl.className = 'text-sm mt-2 text-text-muted';

  // Build the form
  const form = document.createElement('form');
  form.className = 'flex flex-col gap-6';
  form.noValidate = true;

  // Project name (display only — not editable in edit form per design)
  const nameGroup = document.createElement('div');
  nameGroup.className = 'flex flex-col gap-2';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = t('edit.nameLabel');
  nameGroup.appendChild(nameLabel);
  const nameDisplay = input({ type: 'text' });
  nameDisplay.value = metadata.name;
  nameDisplay.disabled = true;
  nameDisplay.className += ' opacity-60 cursor-not-allowed';
  nameGroup.appendChild(nameDisplay);
  form.appendChild(nameGroup);

  // Repository URL field
  const repoGroup = document.createElement('div');
  repoGroup.className = 'flex flex-col gap-2';

  const repoLabel = document.createElement('label');
  repoLabel.htmlFor = 'edit-repository-url';
  repoLabel.textContent = t('edit.repoLabel');
  repoGroup.appendChild(repoLabel);

  const repoInput = input({
    type: 'url',
    id: 'edit-repository-url',
    placeholder: t('upload.repoPlaceholder'),
    maxLength: 2048,
  });
  repoInput.name = 'edit-repository-url';
  repoInput.value = metadata.repositoryUrl ?? '';
  repoGroup.appendChild(repoInput);

  const repoErrorEl = document.createElement('span');
  repoErrorEl.className = 'field-error text-xs text-error mt-1';
  repoErrorEl.setAttribute('aria-live', 'polite');
  repoGroup.appendChild(repoErrorEl);

  form.appendChild(repoGroup);

  // Tags field — Tag Selector component
  const tagsGroupWrapper = document.createElement('div');
  tagsGroupWrapper.className = 'flex flex-col gap-2';

  const tagsLabel = document.createElement('label');
  tagsLabel.textContent = t('upload.tagsLabel');
  tagsGroupWrapper.appendChild(tagsLabel);

  const tagSelectorContainer = document.createElement('div');
  tagSelectorContainer.className = 'mt-1';
  tagsGroupWrapper.appendChild(tagSelectorContainer);

  const tagWarningEl = document.createElement('span');
  tagWarningEl.className = 'field-warning text-xs text-text-muted mt-1';
  tagWarningEl.setAttribute('aria-live', 'polite');
  tagsGroupWrapper.appendChild(tagWarningEl);

  form.appendChild(tagsGroupWrapper);

  // Create the Tag Selector component
  let tagSelector: TagSelectorAPI = createTagSelector({
    container: tagSelectorContainer,
    onChange: () => {},
    maxTags: 0,
  });

  // Fetch tag registry and pre-select current tags
  fetchTagRegistry().then((result) => {
    if (result.ok) {
      // Merge current project tags with registry tags to ensure they appear
      const allTags = Array.from(new Set([...result.data, ...metadata.tags]));
      tagSelector.setAvailableTags(allTags);
      // Pre-select the project's current tags
      tagSelector.applySuggestions(metadata.tags);
    } else {
      // If registry fails, at least show the project's current tags
      tagSelector.setAvailableTags(metadata.tags);
      tagSelector.applySuggestions(metadata.tags);
      tagWarningEl.textContent = t('upload.tagsWarning');
    }
  });

  // Readme field (textarea)
  const readmeGroup = document.createElement('div');
  readmeGroup.className = 'flex flex-col gap-2';

  const readmeLabel = document.createElement('label');
  readmeLabel.htmlFor = 'edit-readme';
  readmeLabel.textContent = t('edit.readmeLabel');
  readmeGroup.appendChild(readmeLabel);

  const readmeTextarea = textarea({
    id: 'edit-readme',
    rows: 12,
    maxLength: MAX_README_LENGTH,
    placeholder: t('upload.readmePlaceholder'),
  });
  readmeTextarea.name = 'edit-readme';
  readmeTextarea.value = currentReadme;
  readmeGroup.appendChild(readmeTextarea);

  const readmeErrorEl = document.createElement('span');
  readmeErrorEl.className = 'field-error text-xs text-error mt-1';
  readmeErrorEl.setAttribute('aria-live', 'polite');
  readmeGroup.appendChild(readmeErrorEl);

  form.appendChild(readmeGroup);

  // Optional folder picker for artifact replacement
  const filesGroup = document.createElement('div');
  filesGroup.className = 'flex flex-col gap-2';

  const filesLabel = document.createElement('label');
  filesLabel.htmlFor = 'edit-files';
  filesLabel.textContent = t('edit.filesLabel');
  filesGroup.appendChild(filesLabel);

  const filesInput = document.createElement('input');
  filesInput.type = 'file';
  filesInput.id = 'edit-files';
  filesInput.name = 'edit-files';
  filesInput.setAttribute('webkitdirectory', '');
  filesInput.setAttribute('directory', '');
  filesInput.multiple = true;
  filesGroup.appendChild(filesInput);

  const filesErrorEl = document.createElement('span');
  filesErrorEl.className = 'field-error text-xs text-error mt-1';
  filesErrorEl.setAttribute('aria-live', 'polite');
  filesGroup.appendChild(filesErrorEl);

  form.appendChild(filesGroup);

  // Submit button
  const submitBtn = button(t('edit.submit'), 'primary');
  submitBtn.type = 'submit';
  form.appendChild(submitBtn);

  // Cancel button
  const cancelBtn = button(t('edit.cancel'), 'secondary');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => {
    window.location.hash = `#/project/${encodeURIComponent(projectName)}`;
  });
  form.appendChild(cancelBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous errors
    statusEl.textContent = '';
    statusEl.className = 'text-sm mt-2 text-text-muted';
    readmeErrorEl.textContent = '';
    filesErrorEl.textContent = '';
    repoErrorEl.textContent = '';

    const readme = readmeTextarea.value;
    const files = filesInput.files;
    const hasFiles = files !== null && files.length > 0;
    const repoUrl = repoInput.value.trim();

    // Client-side validation
    const errors = validateEditForm(readme, files, hasFiles, repoUrl);
    if (Object.keys(errors).length > 0) {
      if (errors.readme) readmeErrorEl.textContent = errors.readme;
      if (errors.files) filesErrorEl.textContent = errors.files;
      if (errors.repositoryUrl) repoErrorEl.textContent = errors.repositoryUrl;
      return;
    }

    const selectedTags = tagSelector.getSelectedTags();

    // Disable submit while processing
    submitBtn.disabled = true;
    submitBtn.textContent = t('edit.saving');

    try {
      // If new artifact is selected, run presigned upload flow first
      if (hasFiles) {
        const filteredFiles = filterFileList(files!);
        if (filteredFiles.length === 0) {
          statusEl.textContent = t('upload.noFilesAfterFilter');
          statusEl.className = 'text-sm mt-2 text-error';
          submitBtn.disabled = false;
          submitBtn.textContent = t('edit.submit');
          return;
        }

        // Create zip client-side
        statusEl.textContent = t('upload.zipping');
        statusEl.className = 'text-sm mt-2 text-text-muted animate-pulse';
        const zip = new JSZip();
        for (const file of filteredFiles) {
          const relativePath = file.webkitRelativePath || file.name;
          const parts = relativePath.split('/');
          const pathWithinProject = parts.length > 1 ? parts.slice(1).join('/') : relativePath;
          zip.file(pathWithinProject, file);
        }
        const blob = await zip.generateAsync({ type: 'blob' });

        // Check size
        if (blob.size > MAX_CLIENT_ZIP_SIZE) {
          statusEl.textContent = t('upload.tooLarge');
          statusEl.className = 'text-sm mt-2 text-error';
          submitBtn.disabled = false;
          submitBtn.textContent = t('edit.submit');
          return;
        }

        // Initiate upload with mode: 'replace'
        statusEl.textContent = t('edit.initiatingReplace');
        const initiateResult = await initiateUpload({
          name: projectName,
          tags: selectedTags.map((tag) => ({ tag, isNew: false } as TagInput)),
          readme,
          mode: 'replace',
        });

        if (!initiateResult.ok) {
          statusEl.textContent = initiateResult.error;
          statusEl.className = 'text-sm mt-2 text-error';
          submitBtn.disabled = false;
          submitBtn.textContent = t('edit.submit');
          return;
        }

        // Upload to S3 with progress
        statusEl.textContent = 'Uploading... 0%';
        try {
          await uploadToS3(initiateResult.data.uploadUrl!, blob, (pct) => {
            statusEl.textContent = `Uploading... ${pct}%`;
          });
        } catch (err) {
          statusEl.textContent = `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`;
          statusEl.className = 'text-sm mt-2 text-error';
          submitBtn.disabled = false;
          submitBtn.textContent = t('edit.submit');
          return;
        }

        // Finalize
        statusEl.textContent = t('upload.processing');
        const finalizeResult = await finalizeUpload(initiateResult.data.sessionId);
        if (!finalizeResult.ok) {
          statusEl.textContent = finalizeResult.error;
          statusEl.className = 'text-sm mt-2 text-error';
          submitBtn.disabled = false;
          submitBtn.textContent = t('edit.submit');
          return;
        }
      }

      // Now handle metadata PATCH
      const patchBody = computePatchBody(
        { name: metadata.name, tags: metadata.tags, readme: currentReadme, repositoryUrl: metadata.repositoryUrl ?? '' },
        { name: metadata.name, tags: selectedTags, readme, repositoryUrl: repoUrl },
      );

      if (patchBody) {
        statusEl.textContent = t('edit.updatingMetadata');
        statusEl.className = 'text-sm mt-2 text-text-muted animate-pulse';
        const updateResult = await updateProject(projectName, patchBody);
        if (!updateResult.ok) {
          statusEl.textContent = updateResult.error;
          statusEl.className = 'text-sm mt-2 text-error';
          submitBtn.disabled = false;
          submitBtn.textContent = t('edit.submit');
          return;
        }
      }

      // Success — show message, then navigate back
      statusEl.textContent = hasFiles
        ? t('edit.successWithArtifact')
        : t('edit.success');
      statusEl.className = 'text-sm mt-2 text-success';

      invalidateSearchIndex();

      setTimeout(() => {
        window.location.hash = `#/project/${encodeURIComponent(projectName)}`;
      }, 2000);
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : 'An unexpected error occurred';
      statusEl.className = 'text-sm mt-2 text-error';
      submitBtn.disabled = false;
      submitBtn.textContent = t('edit.submit');
    }
  });

  wrapper.appendChild(form);
}
