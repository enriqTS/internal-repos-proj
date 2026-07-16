/**
 * Landing page route handler.
 * Renders the home page at `#/` with navigation cards
 * directing users to Projects and Templates sections,
 * plus a quick-access section for recent projects.
 */
import { t } from '../i18n';
import { container, heading, card } from '../ui';
import { fetchSearchIndex } from '../api';
import { formatRelativeDate } from '../relative-date';

// SVG icons for nav cards
const ICON_PROJECTS = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

const ICON_TEMPLATES = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`;

const ICON_UPLOAD = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

/**
 * Render the landing page into the given container.
 * Route handler for `#/`.
 */
export async function renderLandingPage(
  _params: Record<string, string>,
  appContainer: HTMLElement,
): Promise<void> {
  appContainer.innerHTML = '';

  const wrapper = container('py-6 sm:py-10');

  // Hero section — left-aligned for a more utilitarian internal-tool feel
  const hero = document.createElement('div');
  hero.className = 'flex flex-col gap-2 mb-8';

  const h1 = heading(t('landing.heading'), 1);
  h1.className = 'font-body text-2xl sm:text-3xl font-semibold text-text tracking-tight';
  hero.appendChild(h1);

  const description = document.createElement('p');
  description.className = 'text-base sm:text-lg text-text-muted max-w-2xl leading-relaxed';
  description.textContent = t('landing.description');
  hero.appendChild(description);

  wrapper.appendChild(hero);

  // Navigation cards grid
  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5';

  grid.appendChild(
    createNavCard({
      href: '#/projects',
      title: t('landing.projects.title'),
      description: t('landing.projects.description'),
      icon: ICON_PROJECTS,
    }),
  );

  grid.appendChild(
    createNavCard({
      href: '#/templates',
      title: t('landing.templates.title'),
      description: t('landing.templates.description'),
      icon: ICON_TEMPLATES,
    }),
  );

  grid.appendChild(
    createNavCard({
      href: '#/upload',
      title: 'Upload',
      description: 'Envie um novo projeto para o repositório compartilhado.',
      icon: ICON_UPLOAD,
    }),
  );

  wrapper.appendChild(grid);

  // Recent projects section — gives immediate value on landing
  const recentSection = document.createElement('section');
  recentSection.className = 'mt-10';

  const recentHeading = document.createElement('h2');
  recentHeading.className = 'font-body text-lg font-semibold text-text mb-4';
  recentHeading.textContent = 'Adicionados recentemente';
  recentSection.appendChild(recentHeading);

  const recentList = document.createElement('div');
  recentList.className = 'flex flex-col gap-2';
  recentList.innerHTML = `<p class="text-sm text-text-muted animate-pulse">Carregando...</p>`;
  recentSection.appendChild(recentList);

  wrapper.appendChild(recentSection);
  appContainer.appendChild(wrapper);

  // Fetch recent projects asynchronously
  const result = await fetchSearchIndex();
  if (result.ok && result.data.length > 0) {
    const sorted = [...result.data].sort((a, b) => b.date.localeCompare(a.date));
    const recent = sorted.slice(0, 5);

    recentList.innerHTML = '';
    for (const project of recent) {
      const row = document.createElement('a');
      row.href = `#/project/${encodeURIComponent(project.name)}`;
      row.className = 'flex items-center justify-between gap-4 px-4 py-3 rounded-md bg-surface border border-border hover:border-border-strong hover:shadow-sm transition-all duration-180 no-underline group';

      const left = document.createElement('div');
      left.className = 'flex flex-col gap-0.5 min-w-0';

      const name = document.createElement('span');
      name.className = 'font-mono text-sm font-medium text-text truncate group-hover:text-accent transition-colors duration-180';
      name.textContent = project.name;
      left.appendChild(name);

      const desc = document.createElement('span');
      desc.className = 'text-xs text-text-muted truncate';
      desc.textContent = project.description;
      left.appendChild(desc);

      const dateEl = document.createElement('time');
      dateEl.className = 'font-mono text-xs text-text-muted whitespace-nowrap shrink-0';
      dateEl.textContent = formatRelativeDate(project.date);
      dateEl.setAttribute('datetime', project.date);

      row.appendChild(left);
      row.appendChild(dateEl);
      recentList.appendChild(row);
    }
  } else {
    recentList.innerHTML = `<p class="text-sm text-text-muted">Nenhum projeto disponível ainda.</p>`;
  }
}

/**
 * Create a navigation card as a semantic anchor element.
 * Includes an icon, title, and description for clearer visual hierarchy.
 */
function createNavCard(options: {
  href: string;
  title: string;
  description: string;
  icon: string;
}): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = options.href;
  anchor.className = 'no-underline group';

  const cardEl = card({ hoverable: true, className: 'gap-3 h-full' });

  // Icon container
  const iconWrap = document.createElement('div');
  iconWrap.className = 'w-10 h-10 rounded-md bg-accent-subtle text-accent flex items-center justify-center shrink-0 group-hover:bg-accent group-hover:text-on-accent transition-all duration-180';
  iconWrap.innerHTML = options.icon;
  cardEl.appendChild(iconWrap);

  const title = document.createElement('h2');
  title.className = 'font-mono text-sm font-semibold text-text';
  title.textContent = options.title;
  cardEl.appendChild(title);

  const desc = document.createElement('p');
  desc.className = 'text-sm text-text-muted leading-snug';
  desc.textContent = options.description;
  cardEl.appendChild(desc);

  anchor.appendChild(cardEl);
  return anchor;
}
