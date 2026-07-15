import { TAG_PATTERN, MAX_TAG_LENGTH } from 'shared/constants';
import { input, button } from './ui';

/**
 * Options for creating a TagSelector component.
 */
export interface TagSelectorOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** Callback fired whenever the selected tags change */
  onChange: (selectedTags: string[]) => void;
  /** Maximum number of tags that can be selected (0 = unlimited) */
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
  /** Apply AI-suggested new tags that don't exist in availableTags */
  applyNewSuggestions(tags: string[]): void;
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
  let isRendering = false;

  // DOM elements
  const root = document.createElement('div');
  root.className = 'relative inline-block';

  // Toggle button (collapsible)
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'font-mono text-xs font-medium bg-tag-bg text-tag-text px-2 py-0.5 rounded-sm tracking-wide cursor-pointer border-none transition-all duration-180 hover:bg-accent-subtle';
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.textContent = 'Select tags';
  root.appendChild(toggleBtn);

  // Dropdown panel
  const panelEl = document.createElement('div');
  panelEl.className = 'absolute top-full left-0 mt-1 bg-surface border border-border rounded-md shadow-md z-50 min-w-[200px] max-h-[240px] overflow-y-auto p-2';
  panelEl.setAttribute('hidden', '');
  root.appendChild(panelEl);

  const tagListEl = document.createElement('ul');
  tagListEl.className = 'flex flex-col gap-1 list-none m-0 p-0';
  tagListEl.setAttribute('role', 'group');
  panelEl.appendChild(tagListEl);

  const limitMsg = document.createElement('p');
  limitMsg.className = 'text-xs text-text-muted mt-1 px-1';
  limitMsg.textContent = `Maximum of ${maxTags} tags reached`;
  limitMsg.hidden = true;
  panelEl.appendChild(limitMsg);

  // "Add new tag" section (inside the panel)
  const addSection = document.createElement('div');
  addSection.className = 'mt-2 border-t border-border pt-2';

  const addInputWrapper = document.createElement('div');
  addInputWrapper.className = 'flex items-center gap-1';

  const addInput = input({ placeholder: 'New tag...', maxLength: MAX_TAG_LENGTH });
  addInput.className = 'flex-1 px-2 py-1 font-mono text-xs border border-border rounded-sm bg-surface text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle';
  addInputWrapper.appendChild(addInput);

  const addSubmitBtn = button('Add', 'secondary');
  addSubmitBtn.type = 'button';
  addSubmitBtn.className = 'px-2 py-1 font-mono text-xs font-semibold text-accent bg-surface border border-accent rounded-sm cursor-pointer transition-all duration-180 hover:bg-accent hover:text-on-accent';
  addInputWrapper.appendChild(addSubmitBtn);

  addSection.appendChild(addInputWrapper);

  const errorEl = document.createElement('span');
  errorEl.className = 'text-xs text-error mt-1 block';
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
    // Don't auto-collapse if toggle was clicked or during re-render
    setTimeout(() => {
      if (!root.contains(document.activeElement) && !isRendering) {
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
    isRendering = true;
    tagListEl.innerHTML = '';

    const atLimit = maxTags > 0 && selectedTags.size >= maxTags;
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
        span.className = 'italic';
      }

      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      tagListEl.appendChild(li);
    }

    updateToggleText();
    isRendering = false;
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
      if (maxTags > 0 && selectedTags.size >= maxTags) {
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
      if (availableTags.includes(tag) && (maxTags === 0 || selectedTags.size < maxTags)) {
        selectedTags.add(tag);
        suggestedTags.add(tag);
      }
    }

    render();
    onChange(getSelectedTags());
  }

  function applyNewSuggestions(tags: string[]): void {
    if (userInteracted) {
      return;
    }

    for (const tag of tags) {
      // Skip if already in availableTags
      if (availableTags.includes(tag)) {
        continue;
      }

      // Respect maxTags limit
      if (maxTags > 0 && selectedTags.size >= maxTags) {
        break;
      }

      // Add to availableTags, mark as selected, track as new, mark as suggested
      availableTags.push(tag);
      selectedTags.add(tag);
      newTags.add(tag);
      suggestedTags.add(tag);
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
    applyNewSuggestions,
    getSelectedTags,
    getNewTags,
    hasUserInteracted: hasUserInteractedFn,
    destroy,
  };
}
