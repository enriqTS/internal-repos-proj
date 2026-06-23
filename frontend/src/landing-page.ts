/**
 * Landing page route handler.
 * Renders the home page at `#/` with navigation cards
 * directing users to Projects and Templates sections.
 */
import { t } from './i18n';

/**
 * Render the landing page into the given container.
 * Route handler for `#/`.
 */
export function renderLandingPage(
  _params: Record<string, string>,
  container: HTMLElement,
): void {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'landing-page';

  // Heading
  const heading = document.createElement('h1');
  heading.className = 'landing-heading';
  heading.textContent = t('landing.heading');
  wrapper.appendChild(heading);

  // Introductory description
  const description = document.createElement('p');
  description.className = 'landing-description';
  description.textContent = t('landing.description');
  wrapper.appendChild(description);

  // Navigation cards grid
  const grid = document.createElement('div');
  grid.className = 'landing-cards-grid';

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
  container.appendChild(wrapper);
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
  const card = document.createElement('a');
  card.href = options.href;
  card.className = 'landing-card';

  const title = document.createElement('h2');
  title.textContent = options.title;
  card.appendChild(title);

  const desc = document.createElement('p');
  desc.textContent = options.description;
  card.appendChild(desc);

  return card;
}
