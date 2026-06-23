import type { ProjectMetadata } from 'shared/types';
import { fetchProjectReadme, fetchProjectMetadata } from './api';
import { showDeleteDialog } from './delete-dialog';
import { marked, renderReadmeSection, renderReadmeError } from './shared-markdown';

/**
 * Get the base URL for constructing artifact download links.
 */
function getBaseUrl(): string {
  return import.meta.env.VITE_CDN_URL ?? '';
}

/**
 * Check whether the artifact.zip is available for a project via a HEAD request.
 */
async function checkArtifactAvailability(projectPath: string): Promise<boolean> {
  try {
    const url = `${getBaseUrl()}/${projectPath}artifact.zip`;
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Render the project detail view into the given container element.
 *
 * Fetches metadata and readme for the project at `projectPath`, then builds
 * the detail page with metadata display, rendered markdown documentation,
 * and a download link for the artifact.
 *
 * Error handling:
 * - If metadata fails to load: shows error message, hides project details
 * - If readme fails to load: shows documentation error, still displays metadata
 * - If artifact is unavailable: disables download link with message
 *
 * @param projectPath - The project path prefix, e.g. "projects/my-project/"
 * @param container - The DOM element to render into
 */
export async function renderProjectDetail(
  projectPath: string,
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = '';

  // Back navigation link — rendered before fetch so it's always visible
  const backLink = document.createElement('a');
  backLink.href = '#/projects';
  backLink.className = 'back-link';
  backLink.textContent = '← Back to search';
  container.appendChild(backLink);

  // Fetch metadata first — if it fails, we can't show project details
  const metadataResult = await fetchProjectMetadata(projectPath);

  if (!metadataResult.ok) {
    renderMetadataError(container);
    return;
  }

  const metadata = metadataResult.data;

  // Build the detail page structure
  const detailWrapper = document.createElement('div');
  detailWrapper.className = 'project-detail';

  // Render metadata section
  const metadataSection = renderMetadata(metadata);
  detailWrapper.appendChild(metadataSection);

  // Render download section (check artifact availability concurrently with readme fetch)
  const [readmeResult, artifactAvailable] = await Promise.all([
    fetchProjectReadme(projectPath),
    checkArtifactAvailability(projectPath),
  ]);

  const downloadSection = renderDownloadSection(projectPath, artifactAvailable, metadata.name);
  detailWrapper.appendChild(downloadSection);

  // Render readme or readme error
  if (!readmeResult.ok) {
    detailWrapper.appendChild(renderReadmeError('Documentation is unavailable'));
  } else {
    const readmeHtml = await marked.parse(readmeResult.data);
    detailWrapper.appendChild(renderReadmeSection(readmeHtml, 'project-readme'));
  }
  container.appendChild(detailWrapper);
}

/**
 * Render the metadata error message when metadata.json fails to load.
 */
function renderMetadataError(container: HTMLElement): void {
  const errorEl = document.createElement('p');
  errorEl.className = 'error-message metadata-error';
  errorEl.textContent = 'Project details are unavailable';
  container.appendChild(errorEl);
}

/**
 * Render the project metadata section (name, description, tags, date, actions).
 */
function renderMetadata(metadata: ProjectMetadata): HTMLElement {
  const section = document.createElement('section');
  section.className = 'project-metadata';

  const nameEl = document.createElement('h1');
  nameEl.className = 'project-name';
  nameEl.textContent = metadata.name;
  section.appendChild(nameEl);

  const descEl = document.createElement('p');
  descEl.className = 'project-description';
  descEl.textContent = metadata.description;
  section.appendChild(descEl);

  const tagsEl = document.createElement('div');
  tagsEl.className = 'project-tags';
  for (const tag of metadata.tags) {
    const tagSpan = document.createElement('span');
    tagSpan.className = 'tag';
    tagSpan.textContent = tag;
    tagsEl.appendChild(tagSpan);
  }
  section.appendChild(tagsEl);

  const dateEl = document.createElement('time');
  dateEl.className = 'project-date';
  dateEl.textContent = metadata.date;
  dateEl.setAttribute('datetime', metadata.date);
  section.appendChild(dateEl);

  // Repository link (if available)
  if (metadata.repositoryUrl) {
    const repoEl = document.createElement('div');
    repoEl.className = 'project-repository';
    const repoLabel = document.createElement('span');
    repoLabel.className = 'repository-label';
    repoLabel.textContent = 'Repository: ';
    repoEl.appendChild(repoLabel);
    const repoLink = document.createElement('a');
    repoLink.href = metadata.repositoryUrl;
    repoLink.textContent = metadata.repositoryUrl;
    repoLink.target = '_blank';
    repoLink.rel = 'noopener noreferrer';
    repoLink.className = 'repository-link';
    repoEl.appendChild(repoLink);
    section.appendChild(repoEl);
  }

  // Project actions (Edit and Delete buttons)
  const actionsEl = document.createElement('div');
  actionsEl.className = 'project-actions';

  const editBtn = document.createElement('a');
  editBtn.className = 'project-edit-btn';
  editBtn.href = `#/project/${encodeURIComponent(metadata.name)}/edit`;
  editBtn.textContent = 'Edit';
  actionsEl.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'project-delete-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    showDeleteDialog(metadata.name);
  });
  actionsEl.appendChild(deleteBtn);

  section.appendChild(actionsEl);

  return section;
}

/**
 * Render the download section with a link to artifact.zip.
 * If the artifact is unavailable, the link is disabled with a message.
 *
 * @param projectPath - The project path prefix, e.g. "projects/my-project/"
 * @param available - Whether the artifact.zip is available for download
 * @param projectName - The project name used for accessibility attributes and download filename
 */
function renderDownloadSection(projectPath: string, available: boolean, projectName: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'project-download';

  if (available) {
    const link = document.createElement('a');
    link.className = 'download-link';
    link.href = `${getBaseUrl()}/${projectPath}artifact.zip`;
    link.textContent = 'Download artifact.zip';
    link.setAttribute('download', `${projectName}.zip`);
    link.setAttribute('aria-label', `Download ${projectName} project zip archive`);
    section.appendChild(link);
  } else {
    const disabledLink = document.createElement('span');
    disabledLink.className = 'download-link disabled';
    disabledLink.textContent = 'Download artifact.zip';
    disabledLink.setAttribute('aria-disabled', 'true');
    section.appendChild(disabledLink);

    const unavailableMsg = document.createElement('p');
    unavailableMsg.className = 'artifact-unavailable';
    unavailableMsg.textContent = 'Artifact is not available for download';
    section.appendChild(unavailableMsg);
  }

  return section;
}
