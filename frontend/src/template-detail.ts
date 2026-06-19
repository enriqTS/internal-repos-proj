import { fetchTemplateMetadata } from './api';
import { formatRelativeDate } from './relative-date';

/**
 * Render the template detail view into the given container element.
 *
 * Fetches metadata for the template identified by `params.name`, then builds
 * the detail page with metadata display (name, description, tags, date, and
 * optional language).
 *
 * Error handling:
 * - If name param is empty/missing: shows "No template was specified" error
 * - If metadata fails to load: shows "Template details are unavailable" + back link
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

  // Render metadata section
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
  container.appendChild(detailWrapper);
}
