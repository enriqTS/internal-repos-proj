/**
 * Frontend entry point.
 * Wires the router with search, project detail, and upload views.
 */
import { createRouter, type Route } from './router';
import { fetchSearchIndex } from './api';
import { initializeSearch, setupSearch, search, renderResults } from './search';
import { renderProjectDetail } from './project-detail';
import { renderUploadForm } from './upload-form';
import { renderEditForm } from './edit-form';

import { searchIndexLoaded, markSearchIndexLoaded, invalidateSearchIndex } from './search-state';

// Re-export for backward compatibility with modules that import from './main'
export { invalidateSearchIndex };

/**
 * Render the search/home view.
 * Fetches the search index (if not already loaded), initialises Fuse.js,
 * and renders the search input + results list.
 */

async function renderSearchView(_params: Record<string, string>, container: HTMLElement): Promise<void> {
  // Create search UI structure
  const heading = document.createElement('h2');
  heading.textContent = 'Search Projects';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search by name, description, or tags…';
  input.className = 'search-input';
  input.setAttribute('aria-label', 'Search projects');

  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'results-container';

  const filterContainer = document.createElement('div');
  filterContainer.className = 'tag-filter-container';

  container.appendChild(heading);
  container.appendChild(input);
  container.appendChild(filterContainer);
  container.appendChild(resultsContainer);

  if (!searchIndexLoaded) {
    // Show loading state
    resultsContainer.innerHTML = '<p class="loading">Loading projects…</p>';

    const result = await fetchSearchIndex();
    if (!result.ok) {
      resultsContainer.innerHTML = '';
      const errorEl = document.createElement('div');
      errorEl.className = 'error';
      errorEl.innerHTML = `
        <p>${result.error}</p>
        <button class="retry-btn">Retry</button>
      `;
      resultsContainer.appendChild(errorEl);

      const retryBtn = errorEl.querySelector('.retry-btn') as HTMLButtonElement;
      retryBtn.addEventListener('click', () => {
        invalidateSearchIndex();
        renderSearchView(_params, container);
      });
      return;
    }

    initializeSearch(result.data);
    markSearchIndexLoaded();
  }

  // Wire search input to the search module
  setupSearch(input, resultsContainer, filterContainer);

  // Make result items navigable to project detail
  resultsContainer.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.result-item') as HTMLElement | null;
    if (target) {
      const nameEl = target.querySelector('.result-name');
      if (nameEl && nameEl.textContent) {
        window.location.hash = `#/project/${encodeURIComponent(nameEl.textContent)}`;
      }
    }
  });
}

/**
 * Render the project detail view.
 * Extracts the project name from route params and delegates to the project-detail module.
 */
async function renderDetailView(params: Record<string, string>, container: HTMLElement): Promise<void> {
  const projectName = decodeURIComponent(params.name || '');
  if (!projectName) {
    container.innerHTML = '<p class="error">No project specified</p>';
    return;
  }

  const projectPath = `projects/${projectName}/`;
  await renderProjectDetail(projectPath, container);
}

/**
 * Render the upload form view.
 */
function renderUploadView(_params: Record<string, string>, container: HTMLElement): void {
  renderUploadForm(container);
}

/**
 * Render the edit form view.
 * Extracts the project name from route params and delegates to the edit-form module.
 */
async function renderEditView(params: Record<string, string>, container: HTMLElement): Promise<void> {
  const projectName = decodeURIComponent(params.name || '');
  if (!projectName) {
    container.innerHTML = '<p class="error">No project specified</p>';
    return;
  }
  await renderEditForm(projectName, container);
}

/**
 * Define application routes.
 */
const routes: Route[] = [
  {
    pattern: /^\/$/,
    handler: renderSearchView,
  },
  {
    pattern: /^\/project\/(?<name>[^/]+)\/edit$/,
    handler: renderEditView,
  },
  {
    pattern: /^\/project\/(?<name>[^/]+)$/,
    handler: renderDetailView,
  },
  {
    pattern: /^\/upload$/,
    handler: renderUploadView,
  },
];

/**
 * Bootstrap the application.
 */
function init(): void {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    throw new Error('Missing #app container element');
  }

  const router = createRouter(routes, appContainer);
  router.start();
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
