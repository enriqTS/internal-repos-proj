import Fuse, { type IFuseOptions } from 'fuse.js';
import type { ProjectIndexEntry, SearchIndex } from 'shared/types';
import { createTagFilter, type TagFilterAPI } from './tag-filter';
import { createPaginator, type PaginatorAPI } from './paginator';
import { renderCardGrid, type CardItem } from './card-grid';

/**
 * Fuse.js configuration for fuzzy searching project entries.
 */
const fuseOptions: IFuseOptions<ProjectIndexEntry> = {
  keys: ['name', 'description', 'tags'],
  threshold: 0.4,
  includeScore: true,
};

/** Search result type returned by the search function. */
export interface SearchResult {
  item: ProjectIndexEntry;
  score?: number;
}

let fuseInstance: Fuse<ProjectIndexEntry> | null = null;
let indexData: SearchIndex = [];

/**
 * Initialize the search module with a search index.
 * Creates the Fuse.js instance and stores the index data for empty-query fallback.
 */
export function initializeSearch(index: SearchIndex): void {
  indexData = index;
  fuseInstance = new Fuse(index, fuseOptions);
}

/**
 * Perform a search against the initialized index.
 * - If query is empty or fewer than 1 character, returns all projects sorted by date descending.
 * - Otherwise, returns Fuse.js results ranked by relevance score (most relevant first).
 */
export function search(query: string): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 1) {
    return getAllProjectsSortedByDate();
  }

  if (!fuseInstance) {
    return [];
  }

  const results = fuseInstance.search(trimmed);
  return results.map((result) => ({
    item: result.item,
    score: result.score,
  }));
}

/**
 * Returns all projects from the index sorted by date descending (newest first).
 */
function getAllProjectsSortedByDate(): SearchResult[] {
  return [...indexData]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((item) => ({ item }));
}

/**
 * Filter search results by active tags using AND logic.
 * Returns only results whose tags include ALL of the active filter tags.
 */
export function filterByTags(results: SearchResult[], activeTags: string[]): SearchResult[] {
  if (activeTags.length === 0) {
    return results;
  }
  return results.filter((result) =>
    activeTags.every((tag) => result.item.tags.includes(tag)),
  );
}

/**
 * Creates a debounced version of a function.
 * The function will only execute after the specified delay has passed
 * since the last invocation.
 *
 * @param fn - The function to debounce
 * @param delayMs - Delay in milliseconds (default: 200ms)
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number = 200,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  };
}

/**
 * Render search results into the given container element.
 * Uses the shared card grid component to display project cards with
 * name, description, tags, relative date, and keyboard navigation support.
 * Shows a "No results found" message when results are empty.
 */
export function renderResults(results: SearchResult[], container: HTMLElement): void {
  const items: CardItem[] = results.map((result) => ({
    name: result.item.name,
    description: result.item.description,
    tags: result.item.tags,
    date: result.item.date,
  }));

  renderCardGrid(items, {
    container,
    ariaLabelPrefix: 'View project',
    breakpoints: { sm: 640, md: 1024 },
    onCardActivate: (item: CardItem) => {
      window.location.hash = `#/project/${encodeURIComponent(item.name)}`;
    },
  });
}

/**
 * Set up the search functionality by wiring the search input to debounced search
 * and rendering results into the results container. Integrates pagination, tag filtering,
 * relative dates, and keyboard navigation.
 *
 * @param inputElement - The search input element
 * @param resultsContainer - The container element for rendering results
 * @param filterContainer - Optional container element for the tag filter component
 */
export function setupSearch(
  inputElement: HTMLInputElement,
  resultsContainer: HTMLElement,
  filterContainer?: HTMLElement,
): void {
  let activeFilterTags: string[] = [];
  let tagFilter: TagFilterAPI | null = null;
  let filteredResults: SearchResult[] = [];

  // Create a container for the paginator and append it after the results
  const paginatorContainer = document.createElement('div');
  paginatorContainer.className = 'paginator-container';
  resultsContainer.insertAdjacentElement('afterend', paginatorContainer);

  const paginator: PaginatorAPI = createPaginator({
    container: paginatorContainer,
    pageSize: 8,
    onPageChange: (_page: number) => {
      // Re-render results for the new page
      const { start, end } = paginator.getSliceRange();
      const pageResults = filteredResults.slice(start, end);
      renderResults(pageResults, resultsContainer);

      // Scroll to top of results container
      resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  if (filterContainer) {
    tagFilter = createTagFilter({
      container: filterContainer,
      onFilterChange: (tags: string[]) => {
        activeFilterTags = tags;
        performSearch();
      },
    });

    // Extract unique tags from the index and pass to the tag filter
    const uniqueTags = [...new Set(indexData.flatMap((p) => p.tags))];
    tagFilter.setTags(uniqueTags);
  }

  const performSearch = () => {
    const query = inputElement.value.trim();
    const results = search(query);
    filteredResults = filterByTags(results, activeFilterTags);

    // Reset paginator to page 1 on query/filter change
    paginator.update(filteredResults.length, 1);

    // Slice results for the current page
    const { start, end } = paginator.getSliceRange();
    const pageResults = filteredResults.slice(start, end);
    renderResults(pageResults, resultsContainer);
  };

  const debouncedSearch = debounce(performSearch, 200);

  inputElement.addEventListener('input', debouncedSearch);

  // Render initial results (all projects sorted by date)
  performSearch();
}
