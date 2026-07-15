/**
 * Shared card grid renderer for projects and templates.
 * Renders a responsive grid of cards with accessibility support.
 */
import { formatRelativeDate } from './relative-date';
import { t } from './i18n';
import { card, badge } from './ui';

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

/**
 * Renders a responsive card grid into the given container.
 * If items is empty, shows a "No results found" message.
 */
export function renderCardGrid(items: CardItem[], options: CardGridOptions): void {
  const {
    container,
    onCardActivate,
    ariaLabelPrefix = 'View',
  } = options;

  container.innerHTML = '';

  if (items.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'text-center text-text-muted py-12 px-4 text-sm';
    emptyMsg.textContent = t('cardGrid.noResults');
    container.appendChild(emptyMsg);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4';

  for (const item of items) {
    const cardEl = card({ hoverable: true });
    cardEl.setAttribute('tabindex', '0');
    cardEl.setAttribute('role', 'link');
    cardEl.setAttribute('aria-label', `${ariaLabelPrefix} ${item.name}`);

    cardEl.addEventListener('click', () => {
      onCardActivate(item);
    });

    cardEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCardActivate(item);
      }
    });

    const nameEl = document.createElement('h3');
    nameEl.className = 'font-mono text-sm font-semibold text-text line-clamp-3';
    nameEl.textContent = item.name;

    const descEl = document.createElement('p');
    descEl.className = 'text-xs text-text-muted leading-snug line-clamp-2';
    descEl.textContent = item.description;

    const tagsEl = document.createElement('div');
    tagsEl.className = 'flex flex-wrap gap-1 flex-1 content-start overflow-hidden';
    for (const tag of item.tags) {
      tagsEl.appendChild(badge(tag));
    }

    const dateEl = document.createElement('time');
    dateEl.className = 'font-mono text-xs text-text-muted opacity-80 mt-auto';
    dateEl.textContent = `${formatRelativeDate(item.date)} · ${item.date}`;
    dateEl.setAttribute('datetime', item.date);

    cardEl.appendChild(nameEl);
    cardEl.appendChild(descEl);
    cardEl.appendChild(tagsEl);
    cardEl.appendChild(dateEl);
    grid.appendChild(cardEl);
  }

  container.appendChild(grid);
}
