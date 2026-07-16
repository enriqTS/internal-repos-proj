/**
 * Frontend entry point.
 * Wires the router with search, project detail, and upload views.
 */
import './styles.css';
import { createRouter, type Route } from './router';
import { fetchSearchIndex } from './api';
import { initializeSearch, setupSearch, search, renderResults } from './pages/search';
import { renderProjectDetail } from './pages/project-detail';
import { renderUploadForm } from './pages/upload-form';
import { renderEditForm } from './pages/edit-form';
import { createThemeManager, createThemeToggle } from './theme-manager';
import { renderTemplatesPage } from './pages/templates-page';
import { renderTemplateDetail } from './pages/template-detail';
import { renderLandingPage } from './pages/landing-page';
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
  const wrapper = createContainer('py-6');
  container.appendChild(wrapper);

  // Page header with title and action
  const headerRow = document.createElement('div');
  headerRow.className = 'flex items-center justify-between mb-5';

  const heading = document.createElement('h2');
  heading.className = 'font-body text-xl sm:text-2xl font-semibold text-text tracking-tight';
  heading.textContent = t('search.heading');
  headerRow.appendChild(heading);

  const newBtn = document.createElement('a');
  newBtn.href = '#/upload';
  newBtn.className = 'px-4 py-2 font-mono text-sm font-semibold text-on-accent bg-accent border-none rounded-md cursor-pointer transition-all duration-180 hover:bg-accent-hover hover:shadow-md active:scale-[0.98] no-underline whitespace-nowrap inline-flex items-center gap-1.5';
  newBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Novo`;
  headerRow.appendChild(newBtn);

  wrapper.appendChild(headerRow);

  // Search bar with inline icon
  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'relative';

  const searchIcon = document.createElement('div');
  searchIcon.className = 'absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none';
  searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
  searchWrapper.appendChild(searchIcon);

  const input = createInput({ type: 'text', placeholder: t('search.placeholder') });
  input.setAttribute('aria-label', t('search.placeholder'));
  input.className = 'w-full pl-10 pr-4 py-3 font-mono text-sm border border-border rounded-lg bg-surface text-text transition-all duration-180 outline-none focus:border-accent focus:ring-3 focus:ring-accent-subtle shadow-sm';
  searchWrapper.appendChild(input);

  wrapper.appendChild(searchWrapper);

  // Filter + results count row
  const controlsRow = document.createElement('div');
  controlsRow.className = 'flex items-center justify-between mt-3 gap-4';

  const filterContainer = document.createElement('div');
  controlsRow.appendChild(filterContainer);

  const resultsCountEl = document.createElement('span');
  resultsCountEl.className = 'font-mono text-xs text-text-muted whitespace-nowrap';
  controlsRow.appendChild(resultsCountEl);

  wrapper.appendChild(controlsRow);

  // Results container
  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'mt-5';
  wrapper.appendChild(resultsContainer);

  if (!searchIndexLoaded) {
    // Show loading skeleton
    resultsContainer.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${Array.from({ length: 6 }).map(() => `
          <div class="bg-surface border border-border rounded-lg p-5 animate-pulse">
            <div class="h-4 bg-border rounded w-3/4 mb-3"></div>
            <div class="h-3 bg-border rounded w-full mb-2"></div>
            <div class="h-3 bg-border rounded w-1/2 mb-4"></div>
            <div class="flex gap-1.5"><div class="h-5 bg-border rounded w-12"></div><div class="h-5 bg-border rounded w-16"></div></div>
          </div>
        `).join('')}
      </div>
    `;

    const result = await fetchSearchIndex();
    if (!result.ok) {
      resultsContainer.innerHTML = '';
      const errorEl = document.createElement('div');
      errorEl.className = 'text-center py-12 px-4';
      errorEl.innerHTML = `
        <div class="text-error opacity-60 mb-3"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <p class="text-error text-sm font-medium mb-3">${t('search.error')}</p>
        <button class="px-5 py-2 font-mono text-xs font-medium bg-surface border border-border-strong rounded-md cursor-pointer transition-all duration-180 hover:border-accent hover:text-accent">${t('search.retry')}</button>
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

  // Wire search input to the search module with results count callback
  setupSearch(input, resultsContainer, filterContainer, (count: number) => {
    if (count === 0 && input.value.trim().length > 0) {
      resultsCountEl.textContent = '';
    } else if (count > 0) {
      resultsCountEl.textContent = `${count} projeto${count !== 1 ? 's' : ''}`;
    } else {
      resultsCountEl.textContent = '';
    }
  });

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
 * Render the project detail view with File Browser initialized at a specific file path.
 * Used for deep links like #/project/{name}/files/{path}
 */
async function renderProjectFilesView(params: Record<string, string>, container: HTMLElement): Promise<void> {
  const projectName = decodeURIComponent(params.name || '');
  if (!projectName) {
    container.innerHTML = '<p class="text-center p-8 text-error font-medium">No project specified</p>';
    return;
  }

  const filePath = params.path || '';
  const projectPath = `projects/${projectName}/`;
  await renderProjectDetail(projectPath, container, filePath);
}

/**
 * Render the template detail view with File Browser initialized at a specific file path.
 * Used for deep links like #/template/{name}/files/{path}
 */
async function renderTemplateFilesView(params: Record<string, string>, container: HTMLElement): Promise<void> {
  const templateName = decodeURIComponent(params.name || '');
  if (!templateName) {
    container.innerHTML = '<p class="text-center p-8 text-error font-medium">No template specified</p>';
    return;
  }

  await renderTemplateDetail({ name: params.name }, container, params.path || '');
}

/**
 * Define application routes.
 * Note: More specific routes (e.g., /project/:name/files/:path) must come before
 * generic routes (e.g., /project/:name) to ensure correct matching.
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
    pattern: /^\/project\/(?<name>[^/]+)\/files(?:\/(?<path>.*))?$/,
    handler: renderProjectFilesView,
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
    pattern: /^\/template\/(?<name>[^/]+)\/files(?:\/(?<path>.*))?$/,
    handler: renderTemplateFilesView,
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
 * Works across both desktop and mobile navigation.
 */
export function updateNavActive(): void {
  const hash = window.location.hash.slice(1) || '/'; // remove '#', default to '/'
  const activeSection = getActiveNavSection(hash);
  const navLinks = document.querySelectorAll<HTMLAnchorElement>('a[data-nav]');

  navLinks.forEach((link) => {
    link.classList.remove('text-accent', 'font-semibold', 'bg-accent-subtle');

    const navId = link.getAttribute('data-nav');
    if (navId && navId === activeSection) {
      link.classList.add('text-accent', 'font-semibold', 'bg-accent-subtle');
    }
  });
}

/**
 * Initialize the mobile menu toggle behavior.
 * Manages open/close state, icon switching, and auto-close on navigation.
 */
function initMobileMenu(): void {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  if (!menuBtn || !mobileMenu) return;

  const hamburgerIcon = menuBtn.querySelector('.hamburger-icon');
  const closeIcon = menuBtn.querySelector('.close-icon');

  function toggleMenu(): void {
    const isOpen = !mobileMenu!.classList.contains('hidden');
    if (isOpen) {
      mobileMenu!.classList.add('hidden');
      menuBtn!.setAttribute('aria-expanded', 'false');
      menuBtn!.setAttribute('aria-label', 'Abrir menu');
      hamburgerIcon?.classList.remove('hidden');
      closeIcon?.classList.add('hidden');
    } else {
      mobileMenu!.classList.remove('hidden');
      menuBtn!.setAttribute('aria-expanded', 'true');
      menuBtn!.setAttribute('aria-label', 'Fechar menu');
      hamburgerIcon?.classList.add('hidden');
      closeIcon?.classList.remove('hidden');
    }
  }

  function closeMenu(): void {
    mobileMenu!.classList.add('hidden');
    menuBtn!.setAttribute('aria-expanded', 'false');
    menuBtn!.setAttribute('aria-label', 'Abrir menu');
    hamburgerIcon?.classList.remove('hidden');
    closeIcon?.classList.add('hidden');
  }

  menuBtn.addEventListener('click', toggleMenu);

  // Close mobile menu on navigation
  mobileMenu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName === 'A') {
      closeMenu();
    }
  });

  // Close on route change
  window.addEventListener('hashchange', closeMenu);
}

/**
 * Bootstrap the application.
 */
function init(): void {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    throw new Error('Missing #app container element');
  }

  // Initialize theme manager and inject toggle button into the desktop nav
  const themeManager = createThemeManager();
  const themeToggle = createThemeToggle(themeManager);
  const desktopNav = document.querySelector('header nav[aria-label="Main navigation"]');
  if (desktopNav) {
    desktopNav.appendChild(themeToggle);
  }
  themeManager.startListening();

  // Initialize mobile menu
  initMobileMenu();

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
