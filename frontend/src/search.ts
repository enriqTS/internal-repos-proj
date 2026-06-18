import Fuse, { type IFuseOptions } from 'fuse.js';
import type { ProjectIndexEntry, SearchIndex } from 'shared/types';
import { createTagFilter, type TagFilterAPI } from './tag-filter';

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
 * Displays project cards with name, description, and tags.
 * Shows a "No results found" message when results are empty.
 */
export function renderResults(results: SearchResult[], container: HTMLElement): void {
  container.innerHTML = '';

  if (results.length === 0) {
    const noResults = document.createElement('p');
    noResults.className = 'no-results';
    noResults.textContent = 'No results found';
    container.appendChild(noResults);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'results-list';

  for (const result of results) {
    const { item } = result;

    const li = document.createElement('li');
    li.className = 'result-item';

    const nameEl = document.createElement('h3');
    nameEl.className = 'result-name';
    nameEl.textContent = item.name;

    const descEl = document.createElement('p');
    descEl.className = 'result-description';
    descEl.textContent = item.description;

    const tagsEl = document.createElement('div');
    tagsEl.className = 'result-tags';
    for (const tag of item.tags) {
      const tagSpan = document.createElement('span');
      tagSpan.className = 'tag';
      tagSpan.textContent = tag;
      tagsEl.appendChild(tagSpan);
    }

    li.appendChild(nameEl);
    li.appendChild(descEl);
    li.appendChild(tagsEl);
    list.appendChild(li);
  }

  container.appendChild(list);
}

/**
 * Set up the search functionality by wiring the search input to debounced search
 * and rendering results into the results container.
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
    const filtered = filterByTags(results, activeFilterTags);
    renderResults(filtered, resultsContainer);
  };

  const debouncedSearch = debounce(performSearch, 200);

  inputElement.addEventListener('input', debouncedSearch);

  // Render initial results (all projects sorted by date)
  performSearch();
}
