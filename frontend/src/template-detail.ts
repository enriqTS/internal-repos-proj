import type { TemplateMetadata } from 'shared/types';
import { fetchTemplateMetadata, fetchTemplateReadme } from './api';
import { createFileBrowser } from './file-browser';
import { t } from './i18n';
import { formatRelativeDate } from './relative-date';
import { encodeFilePath } from './router';
import { marked, renderReadmeSection, renderReadmeError } from './shared-markdown';
import { container, heading, badge, button } from './ui';

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
 * If absent or any other value, try SVG first (HEAD), then PNG (HEAD);
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
      if (res.ok && isImageContentType(res)) return url;
      return null;
    } catch {
      return null;
    }
  }

  // Fallback: try SVG first, then PNG
  const svgUrl = `${baseUrl}/templates/${name}/architecture.svg`;
  try {
    const svgRes = await fetch(svgUrl, { method: 'HEAD' });
    if (svgRes.ok && isImageContentType(svgRes)) return svgUrl;
  } catch {
    // continue to PNG
  }

  const pngUrl = `${baseUrl}/templates/${name}/architecture.png`;
  try {
    const pngRes = await fetch(pngUrl, { method: 'HEAD' });
    if (pngRes.ok && isImageContentType(pngRes)) return pngUrl;
  } catch {
    // no image available
  }

  return null;
}

/**
 * Check if the response has an image content-type header.
 * Returns true if no content-type is present (optimistic) or if it starts with "image/".
 */
function isImageContentType(res: Response): boolean {
  const ct = res.headers.get('content-type');
  return !ct || ct.startsWith('image/');
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
  link.className = 'download-link px-5 py-2.5 font-mono text-sm font-semibold text-on-accent bg-accent border-none rounded-sm cursor-pointer transition-all duration-180 hover:bg-accent-hover hover:shadow-md active:scale-[0.98] inline-block no-underline text-center';
  link.href = `${baseUrl}/templates/${name}/artifact.zip`;
  link.setAttribute('download', `${name}.zip`);
  link.setAttribute('aria-label', `Download ${name} template zip archive`);
  link.textContent = t('templateDetail.download');
  return link;
}

/**
 * Show an image in a lightbox modal overlay.
 *
 * Creates an overlay with role="dialog", aria-modal="true".
 * Supports close via:
 * - Close button (×)
 * - Click outside the image (on overlay background)
 * - Escape key
 */
export function showImageLightbox(imageUrl: string, altText: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-overlay flex items-center justify-center z-[1000] animate-[fadeIn_150ms_ease]';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'absolute top-4 right-4 inline-flex items-center justify-center w-9 h-9 p-0 bg-transparent border-none rounded-sm text-on-accent cursor-pointer transition-all duration-180 hover:opacity-80 text-2xl';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = altText;
  img.className = 'max-w-[90vw] max-h-[90vh] object-contain';

  overlay.appendChild(closeBtn);
  overlay.appendChild(img);
  document.body.appendChild(overlay);

  // Close handlers
  function close(): void {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  }

  closeBtn.addEventListener('click', close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      close();
    }
  }
  document.addEventListener('keydown', onKeyDown);
}

/**
 * Render the architecture image section.
 *
 * - Wraps an <img> in a clickable element that opens a lightbox
 * - img alt: "Architecture diagram for {name}"
 * - trigger aria-label: "View full-size architecture diagram for {name}"
 * - onerror on <img>: removes entire architecture section from the DOM
 * - section class: template-architecture
 */
export function renderArchitectureSection(imageUrl: string, name: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'template-architecture mt-6';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'block w-full border-none bg-transparent p-0 cursor-pointer rounded-md overflow-hidden hover:shadow-md transition-all duration-180';
  trigger.setAttribute('aria-label', `View full-size architecture diagram for ${name}`);
  trigger.addEventListener('click', () => {
    showImageLightbox(imageUrl, `Architecture diagram for ${name}`);
  });

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = `Architecture diagram for ${name}`;
  img.className = 'w-full rounded-md';
  img.onerror = () => {
    section.remove();
  };

  trigger.appendChild(img);
  section.appendChild(trigger);
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
 * @param initialFilePath - Optional file path for deep link restoration (from URL hash)
 */
export async function renderTemplateDetail(
  params: Record<string, string>,
  containerEl: HTMLElement,
  initialFilePath?: string,
): Promise<void> {
  containerEl.innerHTML = '';

  const name = params.name ? decodeURIComponent(params.name) : '';

  // If name param is empty/missing, show error
  if (!name) {
    const errorEl = document.createElement('p');
    errorEl.className = 'error-message text-error text-center py-8';
    errorEl.textContent = t('templateDetail.noTemplate');
    containerEl.appendChild(errorEl);
    return;
  }

  // Page wrapper using container helper
  const wrapper = container('py-8');

  // Back navigation link — rendered before fetch so it's always visible
  const backLink = document.createElement('a');
  backLink.href = '#/templates';
  backLink.className = 'inline-flex items-center gap-1 text-accent font-mono text-sm no-underline hover:underline mb-6';
  backLink.textContent = t('templateDetail.back');
  wrapper.appendChild(backLink);

  // Fetch template metadata
  const metadataResult = await fetchTemplateMetadata(name);

  if (!metadataResult.ok) {
    const errorEl = document.createElement('p');
    errorEl.className = 'error-message text-error text-center py-4';
    errorEl.textContent = t('templateDetail.unavailable');
    wrapper.appendChild(errorEl);
    containerEl.appendChild(wrapper);
    return;
  }

  const metadata = metadataResult.data;

  // Build the detail page structure
  const detailWrapper = document.createElement('div');
  detailWrapper.className = 'template-detail flex flex-col gap-6';

  // 1. Render metadata section
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-3';

  const nameEl = heading(metadata.name, 1);
  nameEl.classList.add('template-name');
  section.appendChild(nameEl);

  const descEl = document.createElement('p');
  descEl.className = 'template-description text-text-muted text-base leading-relaxed';
  descEl.textContent = metadata.description;
  section.appendChild(descEl);

  const tagsEl = document.createElement('div');
  tagsEl.className = 'flex flex-wrap gap-2';
  for (const tag of metadata.tags) {
    const tagEl = badge(tag);
    tagEl.classList.add('tag');
    tagsEl.appendChild(tagEl);
  }
  section.appendChild(tagsEl);

  const dateEl = document.createElement('time');
  dateEl.className = 'text-sm text-text-muted font-mono';
  dateEl.textContent = formatRelativeDate(metadata.date);
  dateEl.setAttribute('datetime', metadata.date);
  section.appendChild(dateEl);

  // Display language if present
  if (metadata.language) {
    const langEl = document.createElement('p');
    langEl.className = 'text-sm text-text-muted';
    langEl.textContent = `${t('templateDetail.language')}: ${metadata.language}`;
    section.appendChild(langEl);
  }

  detailWrapper.appendChild(section);

  // 2. Download button
  const downloadButton = renderDownloadButton(name);
  detailWrapper.appendChild(downloadButton);

  // 2.5 File Browser section — shows "Browse Files" button initially (minimal vertical space)
  const fileBrowserSection = document.createElement('section');
  fileBrowserSection.className = 'file-browser-section';

  const cdnBaseUrl = getBaseUrl();
  const basePath = `${cdnBaseUrl}/templates/${name}/`;

  // Supplementary content wrapper (architecture + readme) — hidden when viewing a file
  const supplementaryContent = document.createElement('div');
  supplementaryContent.className = 'template-supplementary';

  const fileBrowser = createFileBrowser({
    container: fileBrowserSection,
    basePath,
    initialPath: initialFilePath,
    autoLoad: true,
    onNavigate: (path: string) => {
      const hash = encodeFilePath('template', name, path);
      window.location.hash = hash;
      // Hide supplementary content when viewing a file
      const isViewingFile = path !== '' && !path.endsWith('/');
      supplementaryContent.style.display = isViewingFile ? 'none' : '';
    },
  });
  fileBrowser.mount();

  detailWrapper.appendChild(fileBrowserSection);

  // 3. Fetch readme and resolve architecture image in parallel for performance
  const [architectureImageUrl, readmeResult] = await Promise.all([
    resolveArchitectureImageUrl(name, metadata),
    fetchTemplateReadme(name),
  ]);

  // 4. Architecture diagram (if image resolved)
  if (architectureImageUrl) {
    const architectureSection = renderArchitectureSection(architectureImageUrl, name);
    supplementaryContent.appendChild(architectureSection);
  }

  // 5. Readme section
  if (readmeResult.ok) {
    const readmeHtml = await marked.parse(readmeResult.data);
    const readmeSection = renderReadmeSection(readmeHtml, 'template-readme');
    supplementaryContent.appendChild(readmeSection);
  } else {
    const readmeErrorEl = renderReadmeError(t('templateDetail.docUnavailable'));
    const readmeWrapper = document.createElement('section');
    readmeWrapper.className = 'template-readme';
    readmeWrapper.appendChild(readmeErrorEl);
    supplementaryContent.appendChild(readmeWrapper);
  }

  detailWrapper.appendChild(supplementaryContent);

  // If initial path is a file, hide supplementary content immediately
  if (initialFilePath && initialFilePath !== '' && !initialFilePath.endsWith('/')) {
    supplementaryContent.style.display = 'none';
  }

  wrapper.appendChild(detailWrapper);
  containerEl.appendChild(wrapper);
}
