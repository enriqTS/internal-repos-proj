import { TAG_PATTERN, MAX_TAG_LENGTH } from 'shared/constants';

/**
 * Options for creating a TagSelector component.
 */
export interface TagSelectorOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** Callback fired whenever the selected tags change */
  onChange: (selectedTags: string[]) => void;
  /** Maximum number of tags that can be selected */
  maxTags: number;
}

/**
 * Public API returned by createTagSelector.
 */
export interface TagSelectorAPI {
  /** Set the available tags from the registry */
  setAvailableTags(tags: string[]): void;
  /** Apply AI-suggested tags (only if user hasn't interacted) */
  applySuggestions(tags: string[]): void;
  /** Get currently selected tags */
  getSelectedTags(): string[];
  /** Get newly created tags (not from registry) */
  getNewTags(): string[];
  /** Check if user has manually interacted with the selector */
  hasUserInteracted(): boolean;
  /** Destroy/cleanup the component */
  destroy(): void;
}

/**
 * Creates a Tag Selector component that renders available tags as a collapsible
 * dropdown with checkboxes, new tag creation, and AI suggestion support.
 */
export function createTagSelector(options: TagSelectorOptions): TagSelectorAPI {
  const { container, onChange, maxTags } = options;

  // Internal state
  let availableTags: string[] = [];
  let selectedTags: Set<string> = new Set();
  let newTags: Set<string> = new Set();
  let userInteracted = false;
  let suggestedTags: Set<string> = new Set();
  let expanded = false;

  // DOM elements
  const root = document.createElement('div');
  root.className = 'tag-selector';

  // Toggle button (collapsible)
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tag-filter-toggle';
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.textContent = 'Select tags';
  root.appendChild(toggleBtn);

  // Dropdown panel
  const panelEl = document.createElement('div');
  panelEl.className = 'tag-filter-panel';
  panelEl.setAttribute('hidden', '');
  root.appendChild(panelEl);

  const tagListEl = document.createElement('ul');
  tagListEl.className = 'tag-filter-list';
  tagListEl.setAttribute('role', 'group');
  panelEl.appendChild(tagListEl);

  const limitMsg = document.createElement('p');
  limitMsg.className = 'tag-selector-limit-msg';
  limitMsg.textContent = `Maximum of ${maxTags} tags reached`;
  limitMsg.hidden = true;
  panelEl.appendChild(limitMsg);

  // "Add new tag" section (inside the panel)
  const addSection = document.createElement('div');
  addSection.className = 'tag-selector-add';
  addSection.style.marginTop = '0.5rem';
  addSection.style.borderTop = '1px solid var(--color-border)';
  addSection.style.paddingTop = '0.5rem';

  const addInputWrapper = document.createElement('div');
  addInputWrapper.className = 'tag-selector-add-input-wrapper';

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'tag-selector-add-input';
  addInput.placeholder = 'New tag...';
  addInput.maxLength = MAX_TAG_LENGTH;
  addInputWrapper.appendChild(addInput);

  const addSubmitBtn = document.createElement('button');
  addSubmitBtn.type = 'button';
  addSubmitBtn.className = 'tag-selector-add-submit';
  addSubmitBtn.textContent = 'Add';
  addInputWrapper.appendChild(addSubmitBtn);

  addSection.appendChild(addInputWrapper);

  const errorEl = document.createElement('span');
  errorEl.className = 'tag-selector-error';
  addSection.appendChild(errorEl);

  panelEl.appendChild(addSection);

  root.appendChild(panelEl);
  container.appendChild(root);

  // --- Toggle expand/collapse ---

  function expand(): void {
    expanded = true;
    toggleBtn.setAttribute('aria-expanded', 'true');
    panelEl.removeAttribute('hidden');
  }

  function collapse(): void {
    expanded = false;
    toggleBtn.setAttribute('aria-expanded', 'false');
    panelEl.setAttribute('hidden', '');
  }

  toggleBtn.addEventListener('click', () => {
    if (expanded) {
      collapse();
    } else {
      expand();
    }
  });

  // Keep panel open while focus is inside
  panelEl.addEventListener('focusout', (e: FocusEvent) => {
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && root.contains(relatedTarget)) {
      return;
    }
    // Don't auto-collapse if toggle was clicked
    setTimeout(() => {
      if (!root.contains(document.activeElement)) {
        collapse();
      }
    }, 150);
  });

  addSubmitBtn.addEventListener('click', () => {
    submitNewTag();
  });

  addInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitNewTag();
    }
  });

  // --- Internal functions ---

  function submitNewTag(): void {
    const value = addInput.value.trim().toLowerCase();
    errorEl.textContent = '';

    const validationError = validateNewTag(value);
    if (validationError) {
      errorEl.textContent = validationError;
      return;
    }

    // Valid new tag: add to available, mark as selected, track as new
    availableTags.push(value);
    newTags.add(value);
    selectedTags.add(value);
    userInteracted = true;

    addInput.value = '';
    render();
    onChange(getSelectedTags());
  }

  function validateNewTag(value: string): string | null {
    if (value.length === 0) {
      return 'Tag is too short';
    }
    if (value.length > MAX_TAG_LENGTH) {
      return 'Tag must be at most 32 characters';
    }
    if (!TAG_PATTERN.test(value)) {
      return 'Tag contains invalid characters (use lowercase letters, numbers, hyphens, underscores)';
    }
    // Check case-insensitive duplicate against available + selected tags
    const allTags = availableTags.map((t) => t.toLowerCase());
    if (allTags.includes(value.toLowerCase())) {
      return 'Tag already exists';
    }
    return null;
  }

  function render(): void {
    tagListEl.innerHTML = '';

    const atLimit = selectedTags.size >= maxTags;
    limitMsg.hidden = !atLimit;

    for (const tag of availableTags) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedTags.has(tag);

      if (atLimit && !selectedTags.has(tag)) {
        checkbox.disabled = true;
      }

      checkbox.addEventListener('change', () => {
        handleTagToggle(tag);
      });

      const span = document.createElement('span');
      span.textContent = tag;
      if (suggestedTags.has(tag)) {
        span.style.fontStyle = 'italic';
      }

      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      tagListEl.appendChild(li);
    }

    updateToggleText();
  }

  function updateToggleText(): void {
    const count = selectedTags.size;
    if (count > 0) {
      toggleBtn.textContent = `Select tags (${count})`;
    } else {
      toggleBtn.textContent = 'Select tags';
    }
  }

  function handleTagToggle(tag: string): void {
    if (selectedTags.has(tag)) {
      selectedTags.delete(tag);
      // Remove suggested indicator when manually toggled
      suggestedTags.delete(tag);
    } else {
      if (selectedTags.size >= maxTags) {
        // Limit reached — do nothing
        return;
      }
      selectedTags.add(tag);
    }

    userInteracted = true;
    render();
    onChange(getSelectedTags());
  }

  function getSelectedTags(): string[] {
    return Array.from(selectedTags);
  }

  function getNewTags(): string[] {
    return Array.from(newTags);
  }

  // --- Public API ---

  function setAvailableTags(tags: string[]): void {
    availableTags = [...tags];
    selectedTags = new Set();
    suggestedTags = new Set();
    render();
  }

  function applySuggestions(tags: string[]): void {
    if (userInteracted) {
      return;
    }

    // Apply suggestions: select the given tags and mark them as suggested
    for (const tag of tags) {
      if (availableTags.includes(tag) && selectedTags.size < maxTags) {
        selectedTags.add(tag);
        suggestedTags.add(tag);
      }
    }

    render();
    onChange(getSelectedTags());
  }

  function hasUserInteractedFn(): boolean {
    return userInteracted;
  }

  function destroy(): void {
    container.innerHTML = '';
  }

  // Initial render
  render();

  return {
    setAvailableTags,
    applySuggestions,
    getSelectedTags,
    getNewTags,
    hasUserInteracted: hasUserInteractedFn,
    destroy,
  };
}
