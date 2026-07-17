import type { ProjectMetadata } from 'shared/types';
import { fetchProjectReadme, fetchProjectMetadata } from '../utils/api';
import { showDeleteDialog } from '../components/delete-dialog';
import { createFileBrowser } from './file-browser';
import { renderArchitectureSection } from './template-detail';
import { t } from '../utils/i18n';
import { marked, renderReadmeSection, renderReadmeError } from '../utils/shared-markdown';
import { heading, badge, button } from '../utils/ui';
import { encodeFilePath } from '../utils/router';

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
 * Resolve the architecture image URL for a project.
 *
 * If metadata.architectureImage is set (e.g., 'architecture.png'), constructs
 * the URL directly and verifies via HEAD request. Returns the URL if available,
 * null otherwise.
 *
 * @param projectPath - The project path prefix, e.g. "projects/my-project/"
 * @param metadata - The project metadata object
 */
async function resolveProjectArchitectureImageUrl(
  projectPath: string,
  metadata: ProjectMetadata,
): Promise<string | null> {
  if (!metadata.architectureImage) {
    return null;
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/${projectPath}${metadata.architectureImage}`;

  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (response.ok) return url;
    return null;
  } catch {
    return null;
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
 * @param initialFilePath - Optional file path for deep link restoration (from URL hash)
 */
export async function renderProjectDetail(
  projectPath: string,
  container: HTMLElement,
  initialFilePath?: string,
): Promise<void> {
  container.innerHTML = '';

  // Back navigation link — rendered before fetch so it's always visible
  const backLink = document.createElement('a');
  backLink.href = '#/projects';
  backLink.className = 'inline-flex items-center gap-1.5 text-sm text-accent font-mono hover:text-accent-hover transition-colors duration-180 mb-5';
  backLink.textContent = t('projectDetail.back');
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
  detailWrapper.className = 'flex flex-col gap-6';

  // Render metadata section
  const metadataSection = renderMetadata(metadata);
  detailWrapper.appendChild(metadataSection);

  // Render download section (check artifact availability concurrently with readme fetch and architecture image)
  const [readmeResult, artifactAvailable, architectureImageUrl] = await Promise.all([
    fetchProjectReadme(projectPath),
    checkArtifactAvailability(projectPath),
    resolveProjectArchitectureImageUrl(projectPath, metadata),
  ]);

  const downloadSection = renderDownloadSection(projectPath, artifactAvailable, metadata.name);
  detailWrapper.appendChild(downloadSection);

  // File Browser section — shows "Browse Files" button initially (minimal vertical space)
  const fileBrowserSection = document.createElement('section');
  fileBrowserSection.className = 'file-browser-section';

  const baseUrl = getBaseUrl();
  const basePath = `${baseUrl}/${projectPath}`;
  const projectName = metadata.name;

  // Supplementary content wrapper (readme) — hidden when viewing a file
  const supplementaryContent = document.createElement('div');
  supplementaryContent.className = 'project-supplementary';

  const fileBrowser = createFileBrowser({
    container: fileBrowserSection,
    basePath,
    initialPath: initialFilePath,
    autoLoad: true,
    onNavigate: (path: string) => {
      const hash = encodeFilePath('project', projectName, path);
      window.location.hash = hash;
      // Hide supplementary content when viewing a file
      const isViewingFile = path !== '' && !path.endsWith('/');
      supplementaryContent.style.display = isViewingFile ? 'none' : '';
    },
  });
  fileBrowser.mount();

  detailWrapper.appendChild(fileBrowserSection);

  // Render architecture section into supplementary content (before readme)
  if (architectureImageUrl) {
    const architectureSection = renderArchitectureSection(architectureImageUrl, metadata.name);
    supplementaryContent.appendChild(architectureSection);
  }

  // Render readme or readme error into supplementary content
  if (!readmeResult.ok) {
    supplementaryContent.appendChild(renderReadmeError(t('projectDetail.docUnavailable')));
  } else {
    const readmeHtml = await marked.parse(readmeResult.data);
    supplementaryContent.appendChild(renderReadmeSection(readmeHtml, 'project-readme'));
  }

  detailWrapper.appendChild(supplementaryContent);

  // If initial path is a file, hide supplementary content immediately
  if (initialFilePath && initialFilePath !== '' && !initialFilePath.endsWith('/')) {
    supplementaryContent.style.display = 'none';
  }

  container.appendChild(detailWrapper);
}

/**
 * Render the metadata error message when metadata.json fails to load.
 */
function renderMetadataError(container: HTMLElement): void {
  const errorEl = document.createElement('p');
  errorEl.className = 'text-sm text-error font-mono metadata-error';
  errorEl.textContent = t('projectDetail.unavailable');
  container.appendChild(errorEl);
}

/**
 * Render the project metadata section (name, description, tags, date, actions).
 */
function renderMetadata(metadata: ProjectMetadata): HTMLElement {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-3';

  const nameEl = heading(metadata.name, 1);
  section.appendChild(nameEl);

  const descEl = document.createElement('p');
  descEl.className = 'text-base text-text-muted leading-relaxed';
  descEl.textContent = metadata.description;
  section.appendChild(descEl);

  const tagsEl = document.createElement('div');
  tagsEl.className = 'flex flex-wrap gap-2';
  for (const tag of metadata.tags) {
    const tagEl = badge(tag);
    tagsEl.appendChild(tagEl);
  }
  section.appendChild(tagsEl);

  const dateEl = document.createElement('time');
  dateEl.className = 'text-sm text-text-muted font-mono';
  dateEl.textContent = metadata.date;
  dateEl.setAttribute('datetime', metadata.date);
  section.appendChild(dateEl);

  // Repository link (if available)
  if (metadata.repositoryUrl) {
    const repoEl = document.createElement('div');
    repoEl.className = 'flex items-center gap-2 text-sm';
    const repoLabel = document.createElement('span');
    repoLabel.className = 'font-semibold text-text';
    repoLabel.textContent = t('projectDetail.repository');
    repoEl.appendChild(repoLabel);
    const repoLink = document.createElement('a');
    repoLink.href = metadata.repositoryUrl;
    repoLink.textContent = metadata.repositoryUrl;
    repoLink.target = '_blank';
    repoLink.rel = 'noopener noreferrer';
    repoLink.className = 'text-accent hover:text-accent-hover underline transition-colors duration-180 break-all';
    repoEl.appendChild(repoLink);
    section.appendChild(repoEl);
  }

  // Project actions (Edit and Delete buttons)
  const actionsEl = document.createElement('div');
  actionsEl.className = 'flex items-center gap-3 mt-2';

  const editBtn = document.createElement('a');
  editBtn.className = 'px-4 py-2 font-mono text-sm font-semibold text-accent bg-surface border border-accent rounded-md cursor-pointer transition-all duration-180 hover:bg-accent hover:text-on-accent inline-flex items-center';
  editBtn.href = `#/project/${encodeURIComponent(metadata.name)}/edit`;
  editBtn.textContent = t('projectDetail.edit');
  actionsEl.appendChild(editBtn);

  const deleteBtn = button(t('projectDetail.delete'), 'danger');
  deleteBtn.type = 'button';
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
  section.className = 'flex flex-col gap-2';

  if (available) {
    const link = document.createElement('a');
    link.className = 'inline-flex items-center gap-2 px-5 py-2.5 font-mono text-sm font-semibold text-on-accent bg-accent border-none rounded-md cursor-pointer transition-all duration-180 hover:bg-accent-hover hover:shadow-md active:scale-[0.98] no-underline';
    link.href = `${getBaseUrl()}/${projectPath}artifact.zip`;
    link.textContent = t('projectDetail.download');
    link.setAttribute('download', `${projectName}.zip`);
    link.setAttribute('aria-label', `Download ${projectName} project zip archive`);
    section.appendChild(link);
  } else {
    const disabledLink = document.createElement('span');
    disabledLink.className = 'inline-flex items-center gap-2 px-5 py-2.5 font-mono text-sm font-semibold text-text-muted bg-surface border border-border rounded-md opacity-60 cursor-not-allowed';
    disabledLink.textContent = t('projectDetail.downloadDisabled');
    disabledLink.setAttribute('aria-disabled', 'true');
    section.appendChild(disabledLink);

    const unavailableMsg = document.createElement('p');
    unavailableMsg.className = 'text-xs text-text-muted';
    unavailableMsg.textContent = t('projectDetail.artifactUnavailable');
    section.appendChild(unavailableMsg);
  }

  return section;
}
