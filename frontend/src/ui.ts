/**
 * UI factory helpers — returns DOM elements pre-configured with Tailwind utility classes.
 * Single source of truth for repeated component patterns across the application.
 */

/**
 * Create a card container with hover, focus, and active states.
 * @param opts.hoverable - Whether to add interactive states (default: true)
 * @param opts.className - Additional classes to append
 */
export function card(opts?: { hoverable?: boolean; className?: string }): HTMLDivElement {
  const hoverable = opts?.hoverable ?? true;
  const el = document.createElement('div');

  const base = 'bg-surface border border-border rounded-lg p-5 transition-all duration-180 flex flex-col gap-2';
  const hoverClasses = 'cursor-pointer hover:border-border-strong hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm focus:outline-2 focus:outline-accent focus:outline-offset-2';

  let classes = base;
  if (hoverable) {
    classes += ' ' + hoverClasses;
  }
  if (opts?.className) {
    classes += ' ' + opts.className;
  }

  el.className = classes;
  return el;
}

/**
 * Create a tag/badge element with mono font, small size, themed background.
 */
export function badge(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'font-mono text-xs font-medium bg-tag-bg text-tag-text px-2 py-0.5 rounded-md tracking-wide';
  el.textContent = text;
  return el;
}

/**
 * Create a button with variant-specific styling.
 * @param text - Button label
 * @param variant - Visual variant: 'primary' (default), 'secondary', or 'danger'
 */
export function button(text: string, variant?: 'primary' | 'secondary' | 'danger'): HTMLButtonElement {
  const el = document.createElement('button');
  const v = variant ?? 'primary';

  const variants: Record<string, string> = {
    primary: 'px-5 py-2.5 font-mono text-sm font-semibold text-on-accent bg-accent border-none rounded-md cursor-pointer transition-all duration-180 hover:bg-accent-hover hover:shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed',
    secondary: 'px-4 py-2 font-mono text-sm font-semibold text-accent bg-surface border border-accent rounded-md cursor-pointer transition-all duration-180 hover:bg-accent hover:text-on-accent',
    danger: 'px-4 py-2 font-mono text-sm font-semibold text-error bg-surface border border-error rounded-md cursor-pointer transition-all duration-180 hover:bg-error hover:text-on-accent',
  };

  el.className = variants[v];
  el.textContent = text;
  return el;
}

/**
 * Create a heading element with appropriate typography classes.
 * @param text - Heading text content
 * @param level - Heading level 1–6 (default: 2)
 */
export function heading(text: string, level?: 1 | 2 | 3 | 4 | 5 | 6): HTMLHeadingElement {
  const lvl = level ?? 2;
  const el = document.createElement(`h${lvl}`) as HTMLHeadingElement;

  const sizeMap: Record<number, string> = {
    1: 'text-3xl',
    2: 'text-2xl',
    3: 'text-xl',
    4: 'text-lg',
    5: 'text-base',
    6: 'text-sm',
  };

  el.className = `font-body font-semibold text-text tracking-tight ${sizeMap[lvl]}`;
  el.textContent = text;
  return el;
}

/**
 * Create a text input with border, focus ring, and font styling.
 */
export function input(opts?: {
  type?: string;
  placeholder?: string;
  id?: string;
  maxLength?: number;
}): HTMLInputElement {
  const el = document.createElement('input');
  el.className = 'w-full px-3 py-2.5 font-mono text-sm border border-border rounded-lg bg-surface text-text transition-all duration-180 outline-none focus:border-accent focus:ring-3 focus:ring-accent-subtle shadow-sm placeholder:text-text-muted placeholder:opacity-60';
  el.type = opts?.type ?? 'text';
  if (opts?.placeholder) el.placeholder = opts.placeholder;
  if (opts?.id) el.id = opts.id;
  if (opts?.maxLength !== undefined) el.maxLength = opts.maxLength;
  return el;
}

/**
 * Create a textarea with consistent styling.
 */
export function textarea(opts?: {
  placeholder?: string;
  id?: string;
  rows?: number;
  maxLength?: number;
}): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.className = 'w-full px-3 py-2.5 font-mono text-sm border border-border rounded-lg bg-surface text-text transition-all duration-180 outline-none focus:border-accent focus:ring-3 focus:ring-accent-subtle shadow-sm resize-y min-h-[180px] leading-relaxed placeholder:text-text-muted placeholder:opacity-60';
  el.rows = opts?.rows ?? 6;
  if (opts?.placeholder) el.placeholder = opts.placeholder;
  if (opts?.id) el.id = opts.id;
  if (opts?.maxLength !== undefined) el.maxLength = opts.maxLength;
  return el;
}

/**
 * Create a page-level wrapper with max-width, centering, and responsive padding.
 * @param className - Additional classes to append to the base container classes
 */
export function container(className?: string): HTMLDivElement {
  const el = document.createElement('div');
  let classes = 'max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 animate-[fadeIn_300ms_ease]';
  if (className) {
    classes += ' ' + className;
  }
  el.className = classes;
  return el;
}

/**
 * Create a fixed-position overlay suitable for modals.
 */
export function overlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fixed inset-0 bg-overlay flex items-center justify-center z-[1000] animate-[fadeIn_150ms_ease]';
  return el;
}

/**
 * Create a minimal icon-only button.
 * @param opts.ariaLabel - Accessible label for screen readers
 * @param opts.className - Additional classes to append
 */
export function iconButton(opts?: { ariaLabel?: string; className?: string }): HTMLButtonElement {
  const el = document.createElement('button');
  let classes = 'inline-flex items-center justify-center w-9 h-9 p-0 bg-transparent border-none rounded-md text-text-muted cursor-pointer transition-all duration-180 hover:text-text hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 active:scale-[0.92]';
  if (opts?.className) {
    classes += ' ' + opts.className;
  }
  el.className = classes;
  if (opts?.ariaLabel) el.ariaLabel = opts.ariaLabel;
  return el;
}
