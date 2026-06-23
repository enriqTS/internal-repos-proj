/**
 * Shared card grid renderer for projects and templates.
 * Renders a responsive grid of cards with accessibility support.
 */
import { formatRelativeDate } from './relative-date';
import { t } from './i18n';

export interface CardItem {
  name: string;
  description: string;
  tags: string[];
  date: string;
}

export interface CardGridOptions {
  container: HTMLElement;
  onCardActivate: (item: CardItem) => void;
  breakpoints?: { sm: number; md: number };
  ariaLabelPrefix?: string;
}

const STYLE_ID = 'card-grid-styles';

function injectStyles(sm: number, md: number): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.card-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  max-height: none;
}

@media (min-width: ${sm}px) {
  .card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: ${md}px) {
  .card-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.card-grid-item {
  background: var(--color-surface, #ffffff);
  border: 1px solid var(--color-border, #e2dfd9);
  border-radius: var(--radius-md, 8px);
  padding: 0.875rem 1rem;
  cursor: pointer;
  transition: all var(--transition, 180ms ease);
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  aspect-ratio: 1;
  overflow: hidden;
  min-width: 0;
}

.card-grid-item:hover {
  border-color: var(--color-border-strong, #c9c4bc);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(44, 42, 38, 0.08));
  transform: translateY(-1px);
}

.card-grid-item:focus {
  outline: 2px solid var(--color-accent, #d35c2e);
  outline-offset: 2px;
}

.card-grid-item:active {
  transform: translateY(0);
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(44, 42, 38, 0.06));
}

.card-grid-item__name {
  font-family: var(--font-mono, monospace);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text, #2c2a26);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-grid-item__description {
  font-size: 0.8rem;
  color: var(--color-text-muted, #6b6660);
  line-height: 1.4;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.card-grid-item__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  overflow: hidden;
  flex: 1;
  align-content: flex-start;
}

.card-grid-item__tag {
  font-family: var(--font-mono, monospace);
  font-size: 0.65rem;
  font-weight: 500;
  background: var(--color-tag-bg, #eae7e2);
  color: var(--color-tag-text, #4a4640);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm, 4px);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.card-grid-item__date {
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  color: var(--color-text-muted, #6b6660);
  opacity: 0.8;
  margin-top: auto;
  flex-shrink: 0;
}

.card-grid-empty {
  text-align: center;
  color: var(--color-text-muted, #6b6660);
  padding: 3rem 1rem;
  font-size: 0.9rem;
}
`;
  document.head.appendChild(style);
}

/**
 * Renders a responsive card grid into the given container.
 * If items is empty, shows a "No results found" message.
 */
export function renderCardGrid(items: CardItem[], options: CardGridOptions): void {
  const {
    container,
    onCardActivate,
    breakpoints = { sm: 640, md: 1024 },
    ariaLabelPrefix = 'View',
  } = options;

  injectStyles(breakpoints.sm, breakpoints.md);
  container.innerHTML = '';

  if (items.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'card-grid-empty';
    emptyMsg.textContent = t('cardGrid.noResults');
    container.appendChild(emptyMsg);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'card-grid';

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card-grid-item';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${ariaLabelPrefix} ${item.name}`);

    card.addEventListener('click', () => {
      onCardActivate(item);
    });

    card.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCardActivate(item);
      }
    });

    const nameEl = document.createElement('h3');
    nameEl.className = 'card-grid-item__name';
    nameEl.textContent = item.name;

    const descEl = document.createElement('p');
    descEl.className = 'card-grid-item__description';
    descEl.textContent = item.description;

    const tagsEl = document.createElement('div');
    tagsEl.className = 'card-grid-item__tags';
    for (const tag of item.tags) {
      const tagSpan = document.createElement('span');
      tagSpan.className = 'card-grid-item__tag';
      tagSpan.textContent = tag;
      tagsEl.appendChild(tagSpan);
    }

    const dateEl = document.createElement('time');
    dateEl.className = 'card-grid-item__date';
    dateEl.textContent = formatRelativeDate(item.date);
    dateEl.setAttribute('datetime', item.date);
    dateEl.setAttribute('title', item.date);

    card.appendChild(nameEl);
    card.appendChild(descEl);
    card.appendChild(tagsEl);
    card.appendChild(dateEl);
    grid.appendChild(card);
  }

  container.appendChild(grid);
}
