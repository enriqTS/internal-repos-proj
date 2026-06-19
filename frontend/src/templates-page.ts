/**
 * Templates page route handler.
 * Fetches the template index, initializes Fuse.js search,
 * and renders a card grid with tag filter and paginator.
 */
import Fuse, { type IFuseOptions } from 'fuse.js';
import type { TemplateIndexEntry, TemplateIndex } from 'shared/types';
import { fetchTemplateIndex } from './api';
import { renderCardGrid, type CardItem } from './card-grid';
import { createTagFilter, type TagFilterAPI } from './tag-filter';
import { createPaginator, type PaginatorAPI } from './paginator';

const ITEMS_PER_PAGE = 8;

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
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = '';

  // Show loading state
  const loadingEl = document.createElement('p');
  loadingEl.className = 'loading';
  loadingEl.textContent = 'Loading templates…';
  container.appendChild(loadingEl);

  const result = await fetchTemplateIndex();

  // Clear loading
  container.innerHTML = '';

  if (!result.ok) {
    renderError(container, result.error);
    return;
  }

  const index = result.data;

  if (index.length === 0) {
    renderEmpty(container);
    return;
  }

  renderFullPage(container, index);
}

/**
 * Render the error state with a retry button.
 */
function renderError(container: HTMLElement, errorMessage: string): void {
  const errorEl = document.createElement('div');
  errorEl.className = 'error';

  const msgEl = document.createElement('p');
  msgEl.textContent = errorMessage;

  const retryBtn = document.createElement('button');
  retryBtn.className = 'retry-btn';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', () => {
    renderTemplatesPage({}, container);
  });

  errorEl.appendChild(msgEl);
  errorEl.appendChild(retryBtn);
  container.appendChild(errorEl);
}

/**
 * Render the empty state when no templates exist.
 */
function renderEmpty(container: HTMLElement): void {
  const heading = document.createElement('h2');
  heading.textContent = 'Project Templates';
  container.appendChild(heading);

  const emptyMsg = document.createElement('p');
  emptyMsg.className = 'no-results';
  emptyMsg.textContent = 'No templates available yet';
  container.appendChild(emptyMsg);
}

/**
 * Render the full templates page with search, tag filter, card grid, and paginator.
 */
function renderFullPage(container: HTMLElement, index: TemplateIndex): void {
  // Initialize Fuse.js
  const fuseInstance = new Fuse(index, fuseOptions);

  // Heading
  const heading = document.createElement('h2');
  heading.textContent = 'Project Templates';
  container.appendChild(heading);

  // Search input
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search templates by name, description, or tags…';
  input.className = 'search-input';
  input.setAttribute('aria-label', 'Search templates');
  container.appendChild(input);

  // Tag filter container
  const filterContainer = document.createElement('div');
  filterContainer.className = 'tag-filter-container';
  container.appendChild(filterContainer);

  // Card grid container
  const gridContainer = document.createElement('div');
  gridContainer.className = 'results-container';
  container.appendChild(gridContainer);

  // Paginator container
  const paginatorContainer = document.createElement('div');
  paginatorContainer.className = 'paginator-container';
  container.appendChild(paginatorContainer);

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
    const query = input.value.trim();

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
  input.addEventListener('input', () => {
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
