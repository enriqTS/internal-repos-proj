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
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'text-center py-16 px-4';

    const emptyIcon = document.createElement('div');
    emptyIcon.className = 'text-text-muted opacity-40 mb-3';
    emptyIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
    emptyMsg.appendChild(emptyIcon);

    const emptyText = document.createElement('p');
    emptyText.className = 'text-text-muted text-sm';
    emptyText.textContent = t('cardGrid.noResults');
    emptyMsg.appendChild(emptyText);

    container.appendChild(emptyMsg);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';

  for (const item of items) {
    const cardEl = card({ hoverable: true, className: 'h-full justify-between' });
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

    // Top content group (name + description)
    const topGroup = document.createElement('div');
    topGroup.className = 'flex flex-col gap-1.5';

    const nameEl = document.createElement('h3');
    nameEl.className = 'font-mono text-sm font-semibold text-text line-clamp-2 leading-snug';
    nameEl.textContent = item.name;
    topGroup.appendChild(nameEl);

    const descEl = document.createElement('p');
    descEl.className = 'text-xs text-text-muted leading-relaxed line-clamp-2';
    descEl.textContent = item.description;
    topGroup.appendChild(descEl);

    cardEl.appendChild(topGroup);

    // Bottom content group (tags + date) — pushed to bottom via justify-between
    const bottomGroup = document.createElement('div');
    bottomGroup.className = 'flex flex-col gap-2 mt-3';

    if (item.tags.length > 0) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'flex flex-wrap gap-1.5 overflow-hidden max-h-[52px]';
      const visibleTags = item.tags.slice(0, 4);
      for (const tag of visibleTags) {
        tagsEl.appendChild(badge(tag));
      }
      if (item.tags.length > 4) {
        const moreEl = document.createElement('span');
        moreEl.className = 'font-mono text-xs text-text-muted opacity-70';
        moreEl.textContent = `+${item.tags.length - 4}`;
        tagsEl.appendChild(moreEl);
      }
      bottomGroup.appendChild(tagsEl);
    }

    const dateEl = document.createElement('time');
    dateEl.className = 'font-mono text-xs text-text-muted opacity-70';
    dateEl.textContent = formatRelativeDate(item.date);
    dateEl.setAttribute('datetime', item.date);
    dateEl.setAttribute('title', item.date);
    bottomGroup.appendChild(dateEl);

    cardEl.appendChild(bottomGroup);
    grid.appendChild(cardEl);
  }

  container.appendChild(grid);
}
