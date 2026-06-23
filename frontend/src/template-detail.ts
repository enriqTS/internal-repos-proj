import type { TemplateMetadata } from 'shared/types';
import { fetchTemplateMetadata, fetchTemplateReadme } from './api';
import { formatRelativeDate } from './relative-date';
import { marked, renderReadmeSection, renderReadmeError } from './shared-markdown';

/**
 * Get the base URL for constructing CDN asset URLs.
 */
function getBaseUrl(): string {
  return import.meta.env.VITE_CDN_URL ?? '';
}

/**
 * Resolve the architecture image URL for a template.
 *
 * If metadata.architectureImage is "architecture.png" or "architecture.svg",
 * construct the direct URL and HEAD-check it; return URL if ok, null otherwise.
 *
 * If absent or any other value, try PNG first (HEAD), then SVG (HEAD);
 * return first successful URL or null.
 */
export async function resolveArchitectureImageUrl(
  name: string,
  metadata: TemplateMetadata,
): Promise<string | null> {
  const baseUrl = getBaseUrl();

  // If metadata specifies the image format, use it directly
  if (
    metadata.architectureImage === 'architecture.png' ||
    metadata.architectureImage === 'architecture.svg'
  ) {
    const url = `${baseUrl}/templates/${name}/${metadata.architectureImage}`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      return res.ok ? url : null;
    } catch {
      return null;
    }
  }

  // Fallback: try PNG first, then SVG
  const pngUrl = `${baseUrl}/templates/${name}/architecture.png`;
  try {
    const pngRes = await fetch(pngUrl, { method: 'HEAD' });
    if (pngRes.ok) return pngUrl;
  } catch {
    // continue to SVG
  }

  const svgUrl = `${baseUrl}/templates/${name}/architecture.svg`;
  try {
    const svgRes = await fetch(svgUrl, { method: 'HEAD' });
    if (svgRes.ok) return svgUrl;
  } catch {
    // no image available
  }

  return null;
}

/**
 * Render a download button (anchor element) for the template artifact.
 *
 * - href: {baseUrl}/templates/{name}/artifact.zip
 * - download attribute: {name}.zip
 * - aria-label: "Download {name} template zip archive"
 * - visible text: "Download Template"
 * - class: download-link
 */
export function renderDownloadButton(name: string): HTMLElement {
  const baseUrl = getBaseUrl();
  const link = document.createElement('a');
  link.className = 'download-link';
  link.href = `${baseUrl}/templates/${name}/artifact.zip`;
  link.setAttribute('download', `${name}.zip`);
  link.setAttribute('aria-label', `Download ${name} template zip archive`);
  link.textContent = 'Download Template';
  return link;
}

/**
 * Render the architecture image section.
 *
 * - Wraps an <img> in an <a> that opens the full-size image in a new tab
 * - img alt: "Architecture diagram for {name}"
 * - img style: max-width:100%
 * - a href: imageUrl, target: _blank, rel: noopener noreferrer
 * - a aria-label: "View full-size architecture diagram for {name}"
 * - onerror on <img>: removes entire architecture section from the DOM
 * - section class: template-architecture
 */
export function renderArchitectureSection(imageUrl: string, name: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'template-architecture';

  const anchor = document.createElement('a');
  anchor.href = imageUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.setAttribute('aria-label', `View full-size architecture diagram for ${name}`);

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = `Architecture diagram for ${name}`;
  img.style.maxWidth = '100%';
  img.onerror = () => {
    section.remove();
  };

  anchor.appendChild(img);
  section.appendChild(anchor);
  return section;
}

/**
 * Render the template detail view into the given container element.
 *
 * Fetches metadata for the template identified by `params.name`, then builds
 * the detail page with metadata display (name, description, tags, date, and
 * optional language), download button, architecture diagram, and rendered readme.
 *
 * Error handling:
 * - If name param is empty/missing: shows "No template was specified" error
 * - If metadata fails to load: shows "Template details are unavailable" + back link, NO download button
 *
 * @param params - Route params object with `name` key from the regex named group
 * @param container - The DOM element to render into
 */
export async function renderTemplateDetail(
  params: Record<string, string>,
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = '';

  const name = params.name ? decodeURIComponent(params.name) : '';

  // If name param is empty/missing, show error
  if (!name) {
    const errorEl = document.createElement('p');
    errorEl.className = 'error-message';
    errorEl.textContent = 'No template was specified';
    container.appendChild(errorEl);
    return;
  }

  // Back navigation link — rendered before fetch so it's always visible
  const backLink = document.createElement('a');
  backLink.href = '#/templates';
  backLink.className = 'back-link';
  backLink.textContent = '← Back to templates';
  container.appendChild(backLink);

  // Fetch template metadata
  const metadataResult = await fetchTemplateMetadata(name);

  if (!metadataResult.ok) {
    const errorEl = document.createElement('p');
    errorEl.className = 'error-message';
    errorEl.textContent = 'Template details are unavailable';
    container.appendChild(errorEl);
    return;
  }

  const metadata = metadataResult.data;

  // Build the detail page structure
  const detailWrapper = document.createElement('div');
  detailWrapper.className = 'template-detail';

  // 1. Render metadata section
  const section = document.createElement('section');
  section.className = 'template-metadata';

  const nameEl = document.createElement('h1');
  nameEl.className = 'template-name';
  nameEl.textContent = metadata.name;
  section.appendChild(nameEl);

  const descEl = document.createElement('p');
  descEl.className = 'template-description';
  descEl.textContent = metadata.description;
  section.appendChild(descEl);

  const tagsEl = document.createElement('div');
  tagsEl.className = 'template-tags';
  for (const tag of metadata.tags) {
    const tagSpan = document.createElement('span');
    tagSpan.className = 'tag';
    tagSpan.textContent = tag;
    tagsEl.appendChild(tagSpan);
  }
  section.appendChild(tagsEl);

  const dateEl = document.createElement('time');
  dateEl.className = 'template-date';
  dateEl.textContent = formatRelativeDate(metadata.date);
  dateEl.setAttribute('datetime', metadata.date);
  section.appendChild(dateEl);

  // Display language if present
  if (metadata.language) {
    const langEl = document.createElement('p');
    langEl.className = 'template-language';
    langEl.textContent = `Language: ${metadata.language}`;
    section.appendChild(langEl);
  }

  detailWrapper.appendChild(section);

  // 2. Download button
  const downloadButton = renderDownloadButton(name);
  detailWrapper.appendChild(downloadButton);

  // 3. Fetch readme and resolve architecture image in parallel for performance
  const [architectureImageUrl, readmeResult] = await Promise.all([
    resolveArchitectureImageUrl(name, metadata),
    fetchTemplateReadme(name),
  ]);

  // 4. Architecture diagram (if image resolved)
  if (architectureImageUrl) {
    const architectureSection = renderArchitectureSection(architectureImageUrl, name);
    detailWrapper.appendChild(architectureSection);
  }

  // 5. Readme section
  if (readmeResult.ok) {
    const readmeHtml = await marked.parse(readmeResult.data);
    const readmeSection = renderReadmeSection(readmeHtml, 'template-readme');
    detailWrapper.appendChild(readmeSection);
  } else {
    const readmeErrorEl = renderReadmeError('Template documentation is unavailable');
    const readmeWrapper = document.createElement('section');
    readmeWrapper.className = 'template-readme';
    readmeWrapper.appendChild(readmeErrorEl);
    detailWrapper.appendChild(readmeWrapper);
  }

  container.appendChild(detailWrapper);
}
