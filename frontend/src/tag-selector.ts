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
 * Creates a Tag Selector component that renders available tags as clickable
 * buttons with selection toggling, new tag creation, and AI suggestion support.
 */
export function createTagSelector(options: TagSelectorOptions): TagSelectorAPI {
  const { container, onChange, maxTags } = options;

  // Internal state
  let availableTags: string[] = [];
  let selectedTags: Set<string> = new Set();
  let newTags: Set<string> = new Set();
  let userInteracted = false;
  let suggestedTags: Set<string> = new Set();

  // DOM elements
  const root = document.createElement('div');
  root.className = 'tag-selector';

  const tagListEl = document.createElement('div');
  tagListEl.className = 'tag-selector-list';
  root.appendChild(tagListEl);

  const limitMsg = document.createElement('p');
  limitMsg.className = 'tag-selector-limit-msg';
  limitMsg.textContent = `Maximum of ${maxTags} tags reached`;
  limitMsg.hidden = true;
  root.appendChild(limitMsg);

  // "Add new tag" section
  const addSection = document.createElement('div');
  addSection.className = 'tag-selector-add';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tag-selector-add-btn';
  addBtn.textContent = 'Add new tag';
  addSection.appendChild(addBtn);

  const addInputWrapper = document.createElement('div');
  addInputWrapper.className = 'tag-selector-add-input-wrapper';
  addInputWrapper.hidden = true;

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'tag-selector-add-input';
  addInput.placeholder = 'Enter new tag...';
  addInput.maxLength = MAX_TAG_LENGTH;
  addInputWrapper.appendChild(addInput);

  const addSubmitBtn = document.createElement('button');
  addSubmitBtn.type = 'button';
  addSubmitBtn.className = 'tag-selector-add-submit';
  addSubmitBtn.textContent = 'Add';
  addInputWrapper.appendChild(addSubmitBtn);

  const errorEl = document.createElement('span');
  errorEl.className = 'tag-selector-error';
  addInputWrapper.appendChild(errorEl);

  addSection.appendChild(addInputWrapper);
  root.appendChild(addSection);

  container.appendChild(root);

  // --- Event handlers ---

  addBtn.addEventListener('click', () => {
    addInputWrapper.hidden = !addInputWrapper.hidden;
    if (!addInputWrapper.hidden) {
      addInput.focus();
    }
    errorEl.textContent = '';
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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-selector-item';
      btn.textContent = tag;

      const isSelected = selectedTags.has(tag);
      const isSuggested = suggestedTags.has(tag);

      if (isSelected) {
        btn.classList.add('tag-selector-item--selected');
      }
      if (isSuggested) {
        btn.classList.add('tag-selector-item--suggested');
      }

      btn.setAttribute('aria-pressed', String(isSelected));

      // Disable unselected tags when at limit
      if (atLimit && !isSelected) {
        btn.disabled = true;
      }

      btn.addEventListener('click', () => {
        handleTagToggle(tag);
      });

      tagListEl.appendChild(btn);
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
