import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import type { ProjectMetadata } from 'shared/types';
import { fetchProjectReadme, fetchProjectMetadata } from './api';

/**
 * Configure marked with highlight.js for syntax highlighting in code blocks.
 */
const marked = new Marked(
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

  const downloadSection = renderDownloadSection(projectPath, artifactAvailable);
  detailWrapper.appendChild(downloadSection);

  // Render readme or readme error
  const readmeSection = document.createElement('section');
  readmeSection.className = 'project-readme';

  if (!readmeResult.ok) {
    const readmeError = document.createElement('p');
    readmeError.className = 'error-message readme-error';
    readmeError.textContent = 'Documentation is unavailable';
    readmeSection.appendChild(readmeError);
  } else {
    const readmeHtml = await marked.parse(readmeResult.data);
    const readmeContent = document.createElement('div');
    readmeContent.className = 'readme-content';
    readmeContent.innerHTML = readmeHtml;
    readmeSection.appendChild(readmeContent);
  }

  detailWrapper.appendChild(readmeSection);
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
 * Render the project metadata section (name, description, tags, date).
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

  return section;
}

/**
 * Render the download section with a link to artifact.zip.
 * If the artifact is unavailable, the link is disabled with a message.
 */
function renderDownloadSection(projectPath: string, available: boolean): HTMLElement {
  const section = document.createElement('section');
  section.className = 'project-download';

  if (available) {
    const link = document.createElement('a');
    link.className = 'download-link';
    link.href = `${getBaseUrl()}/${projectPath}artifact.zip`;
    link.textContent = 'Download artifact.zip';
    link.setAttribute('download', '');
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
