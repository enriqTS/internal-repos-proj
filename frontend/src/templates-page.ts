/**
 * Templates page route handler.
 * Fetches the template index, initializes Fuse.js search,
 * and renders a card grid with tag filter and paginator.
 */
import Fuse, { type IFuseOptions } from 'fuse.js';
import type { TemplateIndexEntry, TemplateIndex } from 'shared/types';
import { fetchTemplateIndex } from './api';
import { renderCardGrid, type CardItem } from './components/card-grid';
import { createTagFilter, type TagFilterAPI } from './components/tag-filter';
import { createPaginator, type PaginatorAPI } from './components/paginator';
import { t } from './i18n';
import { container, heading, button, input as createInput } from './ui';

const ITEMS_PER_PAGE = 9;

const fuseOptions: IFuseOptions<TemplateIndexEntry> = {
  keys: ['name', 'description', 'tags'],
  threshold: 0.4,
  includeScore: true,
};

/**
 * Render the templates page into the given container.
 * This is the `#/templates` route handler.
 */
export async function renderTemplatesPage(
  _params: Record<string, string>,
  rootContainer: HTMLElement,
): Promise<void> {
  rootContainer.innerHTML = '';

  // Show loading state
  const loadingEl = document.createElement('p');
  loadingEl.className = 'text-center text-text-muted py-12 text-sm';
  loadingEl.textContent = t('templates.loading');
  rootContainer.appendChild(loadingEl);

  const result = await fetchTemplateIndex();

  // Clear loading
  rootContainer.innerHTML = '';

  if (!result.ok) {
    renderError(rootContainer, result.error);
    return;
  }

  const index = result.data;

  if (index.length === 0) {
    renderEmpty(rootContainer);
    return;
  }

  renderFullPage(rootContainer, index);
}

/**
 * Render the error state with a retry button.
 */
function renderError(rootContainer: HTMLElement, errorMessage: string): void {
  const errorEl = document.createElement('div');
  errorEl.className = 'text-center text-error py-8';

  const msgEl = document.createElement('p');
  msgEl.textContent = errorMessage;

  const retryBtn = button('Retry', 'secondary');
  retryBtn.className += ' mt-4';
  retryBtn.addEventListener('click', () => {
    renderTemplatesPage({}, rootContainer);
  });

  errorEl.appendChild(msgEl);
  errorEl.appendChild(retryBtn);
  rootContainer.appendChild(errorEl);
}

/**
 * Render the empty state when no templates exist.
 */
function renderEmpty(rootContainer: HTMLElement): void {
  const pageWrapper = container('py-8');

  const headingEl = heading(t('templates.heading'), 2);
  pageWrapper.appendChild(headingEl);

  const emptyMsg = document.createElement('p');
  emptyMsg.className = 'text-center text-text-muted py-12 text-sm';
  emptyMsg.textContent = t('templates.empty');
  pageWrapper.appendChild(emptyMsg);

  rootContainer.appendChild(pageWrapper);
}

/**
 * Render the full templates page with search, tag filter, card grid, and paginator.
 */
function renderFullPage(rootContainer: HTMLElement, index: TemplateIndex): void {
  // Initialize Fuse.js
  const fuseInstance = new Fuse(index, fuseOptions);

  // Page wrapper
  const pageWrapper = container('py-6');

  // Heading
  const headingEl = heading(t('templates.heading'), 2);
  headingEl.className = 'font-body text-xl sm:text-2xl font-semibold text-text tracking-tight mb-5';
  pageWrapper.appendChild(headingEl);

  // Search input with inline icon
  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'relative';

  const searchIcon = document.createElement('div');
  searchIcon.className = 'absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none';
  searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
  searchWrapper.appendChild(searchIcon);

  const inputEl = createInput({
    type: 'text',
    placeholder: t('templates.placeholder'),
  });
  inputEl.setAttribute('aria-label', 'Search templates');
  inputEl.className = 'w-full pl-10 pr-4 py-3 font-mono text-sm border border-border rounded-lg bg-surface text-text transition-all duration-180 outline-none focus:border-accent focus:ring-3 focus:ring-accent-subtle shadow-sm';
  searchWrapper.appendChild(inputEl);

  pageWrapper.appendChild(searchWrapper);

  // Filter + results count row
  const controlsRow = document.createElement('div');
  controlsRow.className = 'flex items-center justify-between mt-3 gap-4';

  const filterContainer = document.createElement('div');
  controlsRow.appendChild(filterContainer);

  const resultsCountEl = document.createElement('span');
  resultsCountEl.className = 'font-mono text-xs text-text-muted whitespace-nowrap';
  controlsRow.appendChild(resultsCountEl);

  pageWrapper.appendChild(controlsRow);

  // Card grid container
  const gridContainer = document.createElement('div');
  gridContainer.className = 'mt-5';
  pageWrapper.appendChild(gridContainer);

  // Paginator container
  const paginatorContainer = document.createElement('div');
  paginatorContainer.className = 'mt-6';
  pageWrapper.appendChild(paginatorContainer);

  rootContainer.appendChild(pageWrapper);

  // State
  let activeFilterTags: string[] = [];
  let filteredResults: TemplateIndexEntry[] = [];

  // Paginator
  const paginator: PaginatorAPI = createPaginator({
    container: paginatorContainer,
    pageSize: ITEMS_PER_PAGE,
    onPageChange: (_page: number) => {
      renderCurrentPage();
      gridContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  // Tag filter
  const uniqueTags = [...new Set(index.flatMap((t) => t.tags))];
  const tagFilter: TagFilterAPI = createTagFilter({
    container: filterContainer,
    onFilterChange: (tags: string[]) => {
      activeFilterTags = tags;
      performSearch();
    },
  });
  tagFilter.setTags(uniqueTags);

  // Search logic
  function performSearch(): void {
    const query = inputEl.value.trim();

    let results: TemplateIndexEntry[];

    if (!query) {
      // Empty query: all templates sorted by date descending
      results = [...index].sort((a, b) => b.date.localeCompare(a.date));
    } else {
      // Fuse.js search
      const fuseResults = fuseInstance.search(query);
      results = fuseResults.map((r) => r.item);
    }

    // Apply tag filter with AND logic
    if (activeFilterTags.length > 0) {
      results = results.filter((entry) =>
        activeFilterTags.every((tag) => entry.tags.includes(tag)),
      );
    }

    filteredResults = results;

    // Update results count
    if (filteredResults.length > 0) {
      resultsCountEl.textContent = `${filteredResults.length} template${filteredResults.length !== 1 ? 's' : ''}`;
    } else if (query.length > 0) {
      resultsCountEl.textContent = '';
    } else {
      resultsCountEl.textContent = '';
    }

    // Reset paginator to page 1
    paginator.update(filteredResults.length, 1);
    renderCurrentPage();
  }

  function renderCurrentPage(): void {
    const { start, end } = paginator.getSliceRange();
    const pageItems = filteredResults.slice(start, end);

    const cardItems: CardItem[] = pageItems.map((entry) => ({
      name: entry.name,
      description: entry.description,
      tags: entry.tags,
      date: entry.date,
    }));

    renderCardGrid(cardItems, {
      container: gridContainer,
      ariaLabelPrefix: 'View template',
      breakpoints: { sm: 768, md: 1024 },
      onCardActivate: (item: CardItem) => {
        window.location.hash = `#/template/${encodeURIComponent(item.name)}`;
      },
    });
  }

  // Debounced search (200ms)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  inputEl.addEventListener('input', () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      performSearch();
      debounceTimer = null;
    }, 200);
  });

  // Initial render (all templates sorted by date)
  performSearch();
}
