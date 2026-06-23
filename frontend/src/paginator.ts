/**
 * Paginator component for the search page.
 * Slices a result set into pages and renders page navigation controls.
 */
import { t } from './i18n';

export interface PaginatorOptions {
  /** Container element to render into */
  container: HTMLElement;
  /** Callback fired when the user selects a page */
  onPageChange: (page: number) => void;
  /** Number of items per page (default: 10) */
  pageSize?: number;
  /** Maximum number of numbered page buttons to show (default: 7) */
  maxButtons?: number;
}

export interface PaginatorAPI {
  /** Update with new results and optionally reset to a specific page */
  update(totalItems: number, currentPage?: number): void;
  /** Get the current page (1-indexed) */
  getCurrentPage(): number;
  /** Get total number of pages */
  getTotalPages(): number;
  /** Get the start/end indices for slicing the results array */
  getSliceRange(): { start: number; end: number };
  /** Destroy and clean up DOM */
  destroy(): void;
}

/**
 * Creates a paginator component that renders navigation controls for paged results.
 * Controls include prev/next buttons, up to 7 numbered page buttons with ellipsis,
 * and a "Page X of Y" info label. Hides all controls when totalItems <= pageSize.
 */
export function createPaginator(options: PaginatorOptions): PaginatorAPI {
  const { container, onPageChange } = options;
  const pageSize = options.pageSize ?? 10;
  const maxButtons = options.maxButtons ?? 7;

  let currentPage = 1;
  let totalItems = 0;
  let totalPages = 0;

  // Root wrapper element
  const wrapper = document.createElement('div');
  wrapper.className = 'paginator';
  container.appendChild(wrapper);

  function calcTotalPages(): number {
    if (totalItems <= 0) return 0;
    return Math.ceil(totalItems / pageSize);
  }

  function getVisiblePages(): (number | '...')[] {
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    if (currentPage <= 4) {
      // Show 1–5, ellipsis, lastPage
      return [1, 2, 3, 4, 5, '...', totalPages];
    }

    if (currentPage >= totalPages - 3) {
      // Show 1, ellipsis, (totalPages-4)–totalPages
      return [
        1,
        '...',
        totalPages - 4,
        totalPages - 3,
        totalPages - 2,
        totalPages - 1,
        totalPages,
      ];
    }

    // Show 1, ellipsis, (current-1)–(current+1), ellipsis, lastPage
    return [
      1,
      '...',
      currentPage - 1,
      currentPage,
      currentPage + 1,
      '...',
      totalPages,
    ];
  }

  function render(): void {
    wrapper.innerHTML = '';

    // Hide all controls when totalItems <= pageSize
    if (totalItems <= pageSize) {
      wrapper.setAttribute('hidden', '');
      return;
    }

    wrapper.removeAttribute('hidden');

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'paginator__btn';
    prevBtn.textContent = '←';
    prevBtn.setAttribute('aria-label', t('paginator.previous'));
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
    wrapper.appendChild(prevBtn);

    // Numbered page buttons with ellipsis
    const visiblePages = getVisiblePages();
    for (const item of visiblePages) {
      if (item === '...') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'paginator__ellipsis';
        ellipsis.textContent = '…';
        ellipsis.setAttribute('aria-hidden', 'true');
        wrapper.appendChild(ellipsis);
      } else {
        const pageBtn = document.createElement('button');
        pageBtn.className = 'paginator__btn';
        if (item === currentPage) {
          pageBtn.classList.add('paginator__btn--active');
          pageBtn.setAttribute('aria-current', 'page');
        }
        pageBtn.textContent = String(item);
        pageBtn.setAttribute('aria-label', `Page ${item}`);
        pageBtn.addEventListener('click', () => goToPage(item));
        wrapper.appendChild(pageBtn);
      }
    }

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'paginator__btn';
    nextBtn.textContent = '→';
    nextBtn.setAttribute('aria-label', t('paginator.next'));
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
    wrapper.appendChild(nextBtn);

    // Page info text
    const info = document.createElement('span');
    info.className = 'paginator__info';
    info.textContent = `Page ${currentPage} of ${totalPages}`;
    wrapper.appendChild(info);
  }

  function goToPage(page: number): void {
    if (page < 1 || page > totalPages || page === currentPage) return;
    currentPage = page;
    render();
    onPageChange(currentPage);
  }

  return {
    update(items: number, page?: number): void {
      totalItems = items;
      totalPages = calcTotalPages();

      if (page !== undefined) {
        currentPage = Math.max(1, Math.min(page, totalPages || 1));
      } else if (currentPage > totalPages) {
        // If current page exceeds new total, reset to last valid page
        currentPage = Math.max(1, totalPages);
      }

      render();
    },

    getCurrentPage(): number {
      return currentPage;
    },

    getTotalPages(): number {
      return totalPages;
    },

    getSliceRange(): { start: number; end: number } {
      const start = (currentPage - 1) * pageSize;
      const end = Math.min(currentPage * pageSize, totalItems);
      return { start, end };
    },

    destroy(): void {
      wrapper.innerHTML = '';
      wrapper.remove();
      currentPage = 1;
      totalItems = 0;
      totalPages = 0;
    },
  };
}
