/**
 * Tag Filter component for the search page.
 * Renders tags as clickable filter buttons with AND-logic filtering.
 */

export interface TagFilterOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** Callback fired when active filter tags change */
  onFilterChange: (activeTags: string[]) => void;
}

export interface TagFilterAPI {
  /** Set the full list of filterable tags (extracted from search index) */
  setTags(tags: string[]): void;
  /** Get the currently active filter tags */
  getActiveTags(): string[];
  /** Clear all active filters */
  clearFilters(): void;
  /** Destroy/cleanup the component */
  destroy(): void;
}

/**
 * Creates a tag filter component that renders tags as clickable filter buttons.
 * Active tags receive the `tag-filter--active` CSS class and `aria-pressed="true"`.
 * Calls `onFilterChange` with the current list of active tags on every change.
 */
export function createTagFilter(options: TagFilterOptions): TagFilterAPI {
  const { container, onFilterChange } = options;

  let activeTags: Set<string> = new Set();
  let allTags: string[] = [];
  let buttons: Map<string, HTMLButtonElement> = new Map();

  function render(): void {
    container.innerHTML = '';
    buttons.clear();

    if (allTags.length === 0) {
      return;
    }

    for (const tag of allTags) {
      const button = document.createElement('button');
      button.className = 'tag-filter-item';
      button.textContent = tag;
      button.setAttribute('aria-pressed', activeTags.has(tag) ? 'true' : 'false');

      if (activeTags.has(tag)) {
        button.classList.add('tag-filter--active');
      }

      button.addEventListener('click', () => handleTagClick(tag));
      buttons.set(tag, button);
      container.appendChild(button);
    }
  }

  function handleTagClick(tag: string): void {
    if (activeTags.has(tag)) {
      activeTags.delete(tag);
    } else {
      activeTags.add(tag);
    }

    updateButtonState(tag);
    onFilterChange(Array.from(activeTags));
  }

  function updateButtonState(tag: string): void {
    const button = buttons.get(tag);
    if (!button) return;

    const isActive = activeTags.has(tag);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');

    if (isActive) {
      button.classList.add('tag-filter--active');
    } else {
      button.classList.remove('tag-filter--active');
    }
  }

  return {
    setTags(tags: string[]): void {
      allTags = [...new Set(tags)].sort((a, b) => a.localeCompare(b));
      activeTags.clear();
      render();
    },

    getActiveTags(): string[] {
      return Array.from(activeTags);
    },

    clearFilters(): void {
      activeTags.clear();
      render();
      onFilterChange([]);
    },

    destroy(): void {
      container.innerHTML = '';
      buttons.clear();
      activeTags.clear();
      allTags = [];
    },
  };
}
