/**
 * Frontend entry point.
 * Wires the router with search, project detail, and upload views.
 */
import './styles.css';
import { createRouter, type Route } from './router';
import { fetchSearchIndex } from './api';
import { initializeSearch, setupSearch, search, renderResults } from './search';
import { renderProjectDetail } from './project-detail';
import { renderUploadForm } from './upload-form';
import { renderEditForm } from './edit-form';
import { createThemeManager, createThemeToggle } from './theme-manager';
import { renderTemplatesPage } from './templates-page';
import { renderTemplateDetail } from './template-detail';
import { renderLandingPage } from './landing-page';
import { t } from './i18n';
import { container as createContainer, input as createInput } from './ui';

import { searchIndexLoaded, markSearchIndexLoaded, invalidateSearchIndex } from './search-state';

// Re-export for backward compatibility with modules that import from './main'
export { invalidateSearchIndex };

/**
 * Render the search/home view.
 * Fetches the search index (if not already loaded), initialises Fuse.js,
 * and renders the search input + results list.
 */

async function renderSearchView(_params: Record<string, string>, container: HTMLElement): Promise<void> {
  // Wrap content in a responsive container
  const wrapper = createContainer();
  container.appendChild(wrapper);

  // Create search UI structure
  const headingRow = document.createElement('div');
  headingRow.className = 'flex items-center justify-between';

  const heading = document.createElement('h2');
  heading.className = 'font-body text-2xl font-semibold text-text tracking-tight';
  heading.textContent = t('search.heading');

  const uploadBtn = document.createElement('a');
  uploadBtn.href = '#/upload';
  uploadBtn.className = 'px-5 py-2.5 font-mono text-sm font-semibold text-on-accent bg-accent border-none rounded-sm cursor-pointer transition-all duration-180 hover:bg-accent-hover hover:shadow-md active:scale-[0.98] no-underline';
  uploadBtn.textContent = t('upload.heading');

  headingRow.appendChild(heading);
  headingRow.appendChild(uploadBtn);

  const input = createInput({ type: 'text', placeholder: t('search.placeholder') });
  input.setAttribute('aria-label', t('search.placeholder'));

  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'mt-6';

  const filterContainer = document.createElement('div');
  filterContainer.className = 'mt-3';

  wrapper.appendChild(headingRow);
  wrapper.appendChild(input);
  wrapper.appendChild(filterContainer);
  wrapper.appendChild(resultsContainer);

  if (!searchIndexLoaded) {
    // Show loading state
    resultsContainer.innerHTML = `<p class="text-center text-text-muted py-12 text-sm">${t('search.loading')}</p>`;

    const result = await fetchSearchIndex();
    if (!result.ok) {
      resultsContainer.innerHTML = '';
      const errorEl = document.createElement('div');
      errorEl.className = 'text-center p-8 text-error';
      errorEl.innerHTML = `
        <p>${t('search.error')}</p>
        <button class="mt-3 px-5 py-2 font-mono text-xs font-medium bg-surface border border-border-strong rounded-sm cursor-pointer transition-all duration-180 hover:border-accent hover:text-accent">${t('search.retry')}</button>
      `;
      resultsContainer.appendChild(errorEl);

      const retryBtn = errorEl.querySelector('button') as HTMLButtonElement;
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
    container.innerHTML = '<p class="text-center p-8 text-error font-medium">No project specified</p>';
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
    container.innerHTML = '<p class="text-center p-8 text-error font-medium">No project specified</p>';
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
    handler: renderLandingPage,
  },
  {
    pattern: /^\/projects$/,
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
    pattern: /^\/templates$/,
    handler: renderTemplatesPage,
  },
  {
    pattern: /^\/template\/(?<name>[^/]+)$/,
    handler: renderTemplateDetail,
  },
  {
    pattern: /^\/upload$/,
    handler: renderUploadView,
  },
];

/**
 * Determine the active navigation section for a given route path.
 * Returns 'projects' if the path matches the projects section,
 * 'templates' if it matches the templates section, or null otherwise.
 */
export function getActiveNavSection(path: string): 'projects' | 'templates' | null {
  if (path.startsWith('/projects') || path.startsWith('/project/')) {
    return 'projects';
  }
  if (path.startsWith('/templates') || path.startsWith('/template/')) {
    return 'templates';
  }
  return null;
}

/**
 * Update the active navigation link based on the current hash.
 * Applies active styling classes to the correct nav link and removes them from others.
 */
export function updateNavActive(): void {
  const hash = window.location.hash.slice(1) || '/'; // remove '#', default to '/'
  const activeSection = getActiveNavSection(hash);
  const navLinks = document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main navigation"] a[data-nav]');

  navLinks.forEach((link) => {
    link.classList.remove('text-accent', 'font-semibold');

    const navId = link.getAttribute('data-nav');
    if (navId && navId === activeSection) {
      link.classList.add('text-accent', 'font-semibold');
    }
  });
}

/**
 * Bootstrap the application.
 */
function init(): void {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    throw new Error('Missing #app container element');
  }

  // Initialize theme manager and inject toggle button into the nav
  const themeManager = createThemeManager();
  const themeToggle = createThemeToggle(themeManager);
  const nav = document.querySelector('header nav');
  if (nav) {
    nav.appendChild(themeToggle);
  }
  themeManager.startListening();

  // Set initial active nav state and listen for route changes
  updateNavActive();
  window.addEventListener('hashchange', updateNavActive);

  const router = createRouter(routes, appContainer);
  router.start();
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
