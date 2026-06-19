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
import { createTagSelector, type TagSelectorAPI } from './tag-selector';
import { filterFileList } from './upload-form';
import { invalidateSearchIndex } from './search-state';
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
    errors.readme = `Readme must be at most ${MAX_README_LENGTH.toLocaleString()} characters`;
  }

  // If user selected a folder, it must contain at least one file
  if (hasFiles && (!files || files.length === 0)) {
    errors.files = 'Selected folder contains no files';
  }

  // Validate repository URL if provided
  if (repositoryUrl && repositoryUrl.length > 0) {
    if (repositoryUrl.length > 2048) {
      errors.repositoryUrl = 'Repository URL must be at most 2048 characters';
    } else {
      try {
        const parsed = new URL(repositoryUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          errors.repositoryUrl = 'Repository URL must use HTTPS or HTTP';
        }
      } catch {
        errors.repositoryUrl = 'Please enter a valid URL';
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
  wrapper.className = 'upload-form-wrapper';

  const heading = document.createElement('h2');
  heading.textContent = `Edit Project: ${projectName}`;
  wrapper.appendChild(heading);

  // Status message area
  const statusEl = document.createElement('div');
  statusEl.className = 'upload-status';
  statusEl.setAttribute('role', 'alert');
  statusEl.setAttribute('aria-live', 'polite');
  wrapper.appendChild(statusEl);

  container.appendChild(wrapper);

  // Fetch current metadata and readme
  statusEl.textContent = 'Loading project data...';
  statusEl.className = 'upload-status upload-status--loading';

  const projectPath = `projects/${projectName}/`;
  const [metadataResult, readmeResult] = await Promise.all([
    fetchProjectMetadata(projectPath),
    fetchProjectReadme(projectPath),
  ]);

  if (!metadataResult.ok) {
    statusEl.textContent = `Could not load project data: ${metadataResult.error}`;
    statusEl.className = 'upload-status upload-status--error';
    return;
  }

  const metadata = metadataResult.data;
  const currentReadme = readmeResult.ok ? readmeResult.data : '';

  // Clear loading status
  statusEl.textContent = '';
  statusEl.className = 'upload-status';

  // Build the form
  const form = document.createElement('form');
  form.className = 'upload-form';
  form.noValidate = true;

  // Project name (display only — not editable in edit form per design)
  const nameGroup = document.createElement('div');
  nameGroup.className = 'form-group';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Project Name';
  nameGroup.appendChild(nameLabel);
  const nameDisplay = document.createElement('input');
  nameDisplay.type = 'text';
  nameDisplay.value = metadata.name;
  nameDisplay.disabled = true;
  nameDisplay.className = 'edit-name-display';
  nameGroup.appendChild(nameDisplay);
  form.appendChild(nameGroup);

  // Repository URL field
  const repoGroup = document.createElement('div');
  repoGroup.className = 'form-group';

  const repoLabel = document.createElement('label');
  repoLabel.htmlFor = 'edit-repository-url';
  repoLabel.textContent = 'Repository URL (optional)';
  repoGroup.appendChild(repoLabel);

  const repoInput = document.createElement('input');
  repoInput.type = 'url';
  repoInput.id = 'edit-repository-url';
  repoInput.name = 'edit-repository-url';
  repoInput.placeholder = 'https://github.com/org/repo';
  repoInput.value = metadata.repositoryUrl ?? '';
  repoInput.maxLength = 2048;
  repoGroup.appendChild(repoInput);

  const repoErrorEl = document.createElement('span');
  repoErrorEl.className = 'field-error';
  repoErrorEl.setAttribute('aria-live', 'polite');
  repoGroup.appendChild(repoErrorEl);

  form.appendChild(repoGroup);

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
      tagWarningEl.textContent = 'Existing tag suggestions unavailable';
    }
  });

  // Readme field (textarea)
  const readmeGroup = document.createElement('div');
  readmeGroup.className = 'form-group';

  const readmeLabel = document.createElement('label');
  readmeLabel.htmlFor = 'edit-readme';
  readmeLabel.textContent = 'Readme Content';
  readmeGroup.appendChild(readmeLabel);

  const readmeTextarea = document.createElement('textarea');
  readmeTextarea.id = 'edit-readme';
  readmeTextarea.name = 'edit-readme';
  readmeTextarea.maxLength = MAX_README_LENGTH;
  readmeTextarea.placeholder = '# My Project\n\nDescribe your project here...';
  readmeTextarea.rows = 12;
  readmeTextarea.value = currentReadme;
  readmeGroup.appendChild(readmeTextarea);

  const readmeErrorEl = document.createElement('span');
  readmeErrorEl.className = 'field-error';
  readmeErrorEl.setAttribute('aria-live', 'polite');
  readmeGroup.appendChild(readmeErrorEl);

  form.appendChild(readmeGroup);

  // Optional folder picker for artifact replacement
  const filesGroup = document.createElement('div');
  filesGroup.className = 'form-group';

  const filesLabel = document.createElement('label');
  filesLabel.htmlFor = 'edit-files';
  filesLabel.textContent = 'Replace Artifact (optional — select folder)';
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
  filesErrorEl.className = 'field-error';
  filesErrorEl.setAttribute('aria-live', 'polite');
  filesGroup.appendChild(filesErrorEl);

  form.appendChild(filesGroup);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'upload-submit';
  submitBtn.textContent = 'Save Changes';
  form.appendChild(submitBtn);

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'upload-submit';
  cancelBtn.style.marginLeft = '8px';
  cancelBtn.style.backgroundColor = '#6c757d';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    window.location.hash = `#/project/${encodeURIComponent(projectName)}`;
  });
  form.appendChild(cancelBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous errors
    statusEl.textContent = '';
    statusEl.className = 'upload-status';
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
    submitBtn.textContent = 'Saving...';

    try {
      // If new artifact is selected, run presigned upload flow first
      if (hasFiles) {
        const filteredFiles = filterFileList(files!);
        if (filteredFiles.length === 0) {
          statusEl.textContent = 'No files remain after filtering out build artifacts and ignored patterns.';
          statusEl.className = 'upload-status upload-status--error';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Changes';
          return;
        }

        // Create zip client-side
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

        // Check size
        if (blob.size > MAX_CLIENT_ZIP_SIZE) {
          statusEl.textContent = 'Project is too large to upload (exceeds 500 MB limit).';
          statusEl.className = 'upload-status upload-status--error';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Changes';
          return;
        }

        // Initiate upload with mode: 'replace'
        statusEl.textContent = 'Initiating artifact replacement...';
        const initiateResult = await initiateUpload({
          name: projectName,
          tags: selectedTags.map((t) => ({ tag: t, isNew: false } as TagInput)),
          readme,
          mode: 'replace',
        });

        if (!initiateResult.ok) {
          statusEl.textContent = initiateResult.error;
          statusEl.className = 'upload-status upload-status--error';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Changes';
          return;
        }

        // Upload to S3 with progress
        statusEl.textContent = 'Uploading... 0%';
        try {
          await uploadToS3(initiateResult.data.uploadUrl, blob, (pct) => {
            statusEl.textContent = `Uploading... ${pct}%`;
          });
        } catch (err) {
          statusEl.textContent = `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`;
          statusEl.className = 'upload-status upload-status--error';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Changes';
          return;
        }

        // Finalize
        statusEl.textContent = 'Processing artifact...';
        const finalizeResult = await finalizeUpload(initiateResult.data.sessionId);
        if (!finalizeResult.ok) {
          statusEl.textContent = finalizeResult.error;
          statusEl.className = 'upload-status upload-status--error';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Changes';
          return;
        }
      }

      // Now handle metadata PATCH
      const patchBody = computePatchBody(
        { name: metadata.name, tags: metadata.tags, readme: currentReadme, repositoryUrl: metadata.repositoryUrl ?? '' },
        { name: metadata.name, tags: selectedTags, readme, repositoryUrl: repoUrl },
      );

      if (patchBody) {
        statusEl.textContent = 'Updating metadata...';
        statusEl.className = 'upload-status upload-status--loading';
        const updateResult = await updateProject(projectName, patchBody);
        if (!updateResult.ok) {
          statusEl.textContent = updateResult.error;
          statusEl.className = 'upload-status upload-status--error';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Changes';
          return;
        }
      }

      // Success — show message, then navigate back
      statusEl.textContent = hasFiles
        ? 'Project updated successfully (artifact replaced)!'
        : 'Project updated successfully!';
      statusEl.className = 'upload-status upload-status--success';

      invalidateSearchIndex();

      setTimeout(() => {
        window.location.hash = `#/project/${encodeURIComponent(projectName)}`;
      }, 2000);
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : 'An unexpected error occurred';
      statusEl.className = 'upload-status upload-status--error';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Changes';
    }
  });

  wrapper.appendChild(form);
}
