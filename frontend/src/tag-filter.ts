/**
 * Tag Filter Dropdown component for the search page.
 * Renders tags as a collapsible dropdown with checkboxes and AND-logic filtering.
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
 * Creates a tag filter dropdown component with checkboxes.
 * The toggle button shows/hides a scrollable panel of tag checkboxes.
 * Calls `onFilterChange` with the current list of checked tags on every change.
 */
export function createTagFilter(options: TagFilterOptions): TagFilterAPI {
  const { container, onFilterChange } = options;

  let activeTags: Set<string> = new Set();
  let allTags: string[] = [];
  let expanded = false;

  // DOM references
  let dropdownEl: HTMLDivElement | null = null;
  let toggleBtn: HTMLButtonElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let listEl: HTMLUListElement | null = null;

  function render(): void {
    container.innerHTML = '';

    if (allTags.length === 0) {
      return;
    }

    // Root container
    dropdownEl = document.createElement('div');
    dropdownEl.className = 'relative inline-block';

    // Toggle button
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'font-mono text-xs font-medium bg-tag-bg text-tag-text px-2 py-0.5 rounded-sm tracking-wide cursor-pointer border-none transition-all duration-180 hover:bg-accent-subtle';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.textContent = getToggleText();
    toggleBtn.addEventListener('click', handleToggleClick);
    toggleBtn.addEventListener('keydown', handleToggleKeydown);

    // Panel (hidden by default)
    panelEl = document.createElement('div');
    panelEl.className = 'absolute top-full left-0 mt-1 bg-surface border border-border rounded-md shadow-md z-50 min-w-[200px] max-h-[240px] overflow-y-auto p-2';
    panelEl.setAttribute('hidden', '');
    panelEl.addEventListener('focusout', handlePanelBlur);

    // List
    listEl = document.createElement('ul');
    listEl.className = 'flex flex-col gap-1 list-none m-0 p-0';
    listEl.setAttribute('role', 'group');

    // Render checkboxes
    for (const tag of allTags) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer text-sm font-mono text-text hover:bg-accent-subtle transition-all duration-180';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'accent-accent';
      checkbox.checked = activeTags.has(tag);
      checkbox.addEventListener('change', () => handleCheckboxChange(tag, checkbox));

      const span = document.createElement('span');
      span.className = 'font-mono text-xs tracking-wide';
      span.textContent = tag;

      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      listEl.appendChild(li);
    }

    panelEl.appendChild(listEl);
    dropdownEl.appendChild(toggleBtn);
    dropdownEl.appendChild(panelEl);
    container.appendChild(dropdownEl);

    // Sync expanded state
    if (expanded) {
      expand();
    }
  }

  function getToggleText(): string {
    const count = activeTags.size;
    if (count > 0) {
      return `Filter by tags (${count})`;
    }
    return 'Filter by tags';
  }

  function updateToggleText(): void {
    if (toggleBtn) {
      toggleBtn.textContent = getToggleText();
    }
  }

  function expand(): void {
    expanded = true;
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
    if (panelEl) {
      panelEl.removeAttribute('hidden');
    }
  }

  function collapse(): void {
    expanded = false;
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
    if (panelEl) {
      panelEl.setAttribute('hidden', '');
    }
  }

  function handleToggleClick(): void {
    if (expanded) {
      collapse();
    } else {
      expand();
    }
  }

  function handleToggleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggleClick();
    }
  }

  function handlePanelBlur(e: FocusEvent): void {
    const relatedTarget = e.relatedTarget as Node | null;
    // Keep panel open if focus moves to another element within the dropdown
    if (relatedTarget && dropdownEl && dropdownEl.contains(relatedTarget)) {
      return;
    }
    collapse();
  }

  function handleCheckboxChange(tag: string, checkbox: HTMLInputElement): void {
    if (checkbox.checked) {
      activeTags.add(tag);
    } else {
      activeTags.delete(tag);
    }
    updateToggleText();
    onFilterChange(Array.from(activeTags));
  }

  return {
    setTags(tags: string[]): void {
      allTags = [...new Set(tags)].sort((a, b) => a.localeCompare(b));
      activeTags.clear();
      expanded = false;
      render();
    },

    getActiveTags(): string[] {
      return Array.from(activeTags);
    },

    clearFilters(): void {
      activeTags.clear();
      updateToggleText();
      // Uncheck all checkboxes
      if (listEl) {
        const checkboxes = listEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
        checkboxes.forEach((cb) => {
          cb.checked = false;
        });
      }
      onFilterChange([]);
    },

    destroy(): void {
      container.innerHTML = '';
      activeTags.clear();
      allTags = [];
      expanded = false;
      dropdownEl = null;
      toggleBtn = null;
      panelEl = null;
      listEl = null;
    },
  };
}
