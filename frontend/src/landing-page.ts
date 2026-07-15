/**
 * Landing page route handler.
 * Renders the home page at `#/` with navigation cards
 * directing users to Projects and Templates sections.
 */
import { t } from './i18n';
import { container, heading, card } from './ui';

/**
 * Render the landing page into the given container.
 * Route handler for `#/`.
 */
export function renderLandingPage(
  _params: Record<string, string>,
  appContainer: HTMLElement,
): void {
  appContainer.innerHTML = '';

  const wrapper = container('py-8');

  // Hero section
  const hero = document.createElement('div');
  hero.className = 'text-center flex flex-col items-center gap-4';

  // Heading
  const h1 = heading(t('landing.heading'), 1);
  hero.appendChild(h1);

  // Introductory description
  const description = document.createElement('p');
  description.className = 'text-lg text-text-muted max-w-xl';
  description.textContent = t('landing.description');
  hero.appendChild(description);

  wrapper.appendChild(hero);

  // Navigation cards grid — responsive: single column on mobile, multi-column on larger
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-8';

  // Projects card
  grid.appendChild(
    createNavCard({
      href: '#/projects',
      title: t('landing.projects.title'),
      description: t('landing.projects.description'),
    }),
  );

  // Templates card
  grid.appendChild(
    createNavCard({
      href: '#/templates',
      title: t('landing.templates.title'),
      description: t('landing.templates.description'),
    }),
  );

  wrapper.appendChild(grid);
  appContainer.appendChild(wrapper);
}

/**
 * Create a navigation card as a semantic anchor element.
 * Native anchor behavior provides keyboard activation (Enter/Space).
 */
function createNavCard(options: {
  href: string;
  title: string;
  description: string;
}): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = options.href;
  anchor.className = 'no-underline';

  const cardEl = card({ hoverable: true });

  const title = document.createElement('h2');
  title.className = 'font-mono text-sm font-semibold text-text';
  title.textContent = options.title;
  cardEl.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'text-sm text-text-muted';
  desc.textContent = options.description;
  cardEl.appendChild(desc);

  anchor.appendChild(cardEl);
  return anchor;
}
