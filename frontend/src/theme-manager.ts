/**
 * Theme Manager module.
 * Handles theme resolution, persistence, and DOM application for the dark mode toggle.
 */
import { t } from './i18n';

export type Theme = 'light' | 'dark';

export const STORAGE_KEY = 'theme-preference';
export const VALID_THEMES: readonly Theme[] = ['light', 'dark'] as const;

// ─── Pure Functions ───

/**
 * Resolve the active theme based on stored preference and system setting.
 * Priority: valid stored value > system preference > default 'light'.
 */
export function resolveTheme(storedValue: string | null, systemPrefersDark: boolean): Theme {
  if (storedValue !== null && isValidTheme(storedValue)) {
    return storedValue;
  }
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Check whether a value is a valid Theme identifier.
 */
export function isValidTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/**
 * Return the opposite theme.
 */
export function oppositeTheme(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light';
}

/**
 * Get the aria-label for the toggle button given the current theme.
 * Describes the action (switch to the OTHER theme).
 */
export function getToggleLabel(current: Theme): string {
  return current === 'light' ? t('theme.switchToDark') : t('theme.switchToLight');
}

/**
 * Get the icon identifier for the toggle button given the current theme.
 * Sun icon when light is active, moon icon when dark is active.
 */
export function getToggleIcon(current: Theme): 'sun' | 'moon' {
  return current === 'light' ? 'sun' : 'moon';
}

// ─── SVG Icons ───

const SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="5"></circle>
  <line x1="12" y1="1" x2="12" y2="3"></line>
  <line x1="12" y1="21" x2="12" y2="23"></line>
  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
  <line x1="1" y1="12" x2="3" y2="12"></line>
  <line x1="21" y1="12" x2="23" y2="12"></line>
  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
</svg>`;

const MOON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
</svg>`;

// ─── Theme Toggle Factory ───

/**
 * Create a theme toggle button element that uses the ThemeManager
 * to switch between light and dark themes on click.
 */
export function createThemeToggle(manager: ThemeManager): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'theme-toggle';
  button.type = 'button';

  function update(): void {
    const theme = manager.getTheme();
    const icon = getToggleIcon(theme);
    button.innerHTML = icon === 'sun' ? SUN_SVG : MOON_SVG;
    button.setAttribute('aria-label', getToggleLabel(theme));
  }

  // Set initial state
  update();

  // Handle click
  button.addEventListener('click', () => {
    manager.toggle();
    update();
  });

  return button;
}

// ─── ThemeManager Interface ───

export interface ThemeManager {
  /** Get the currently active theme */
  getTheme(): Theme;

  /** Toggle between light and dark, persist, and apply */
  toggle(): Theme;

  /** Apply a specific theme, persist, and update DOM */
  setTheme(theme: Theme): void;

  /** Start listening for OS preference changes (when no stored pref) */
  startListening(): void;

  /** Stop listening for OS preference changes */
  stopListening(): void;
}

// ─── ThemeManager Factory ───

/**
 * Create a ThemeManager instance that reads/writes localStorage,
 * sets `data-theme` on `document.documentElement`, and listens for
 * OS `prefers-color-scheme` changes.
 */
export function createThemeManager(): ThemeManager {
  let current: Theme;
  let mediaQuery: MediaQueryList | null = null;
  let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

  // Resolve the initial theme from stored preference + system setting
  const storedValue = readStorage();
  const systemPrefersDark = getSystemPrefersDark();
  current = resolveTheme(storedValue, systemPrefersDark);

  // Apply immediately
  applyTheme(current);

  function readStorage(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable (private browsing, disabled, etc.)
      return null;
    }
  }

  function writeStorage(theme: Theme): void {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable — silently ignore
    }
  }

  function getSystemPrefersDark(): boolean {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  function applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function hasStoredPreference(): boolean {
    const stored = readStorage();
    return stored !== null && isValidTheme(stored);
  }

  const manager: ThemeManager = {
    getTheme(): Theme {
      return current;
    },

    toggle(): Theme {
      const next = oppositeTheme(current);
      manager.setTheme(next);
      return next;
    },

    setTheme(theme: Theme): void {
      if (!isValidTheme(theme)) return;
      current = theme;
      writeStorage(theme);
      applyTheme(theme);
    },

    startListening(): void {
      try {
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaListener = (e: MediaQueryListEvent) => {
          // Only react to OS changes when no explicit stored preference
          if (!hasStoredPreference()) {
            const resolved = e.matches ? 'dark' : 'light';
            current = resolved;
            applyTheme(resolved);
          }
        };
        mediaQuery.addEventListener('change', mediaListener);
      } catch {
        // matchMedia not supported — no-op
      }
    },

    stopListening(): void {
      if (mediaQuery && mediaListener) {
        mediaQuery.removeEventListener('change', mediaListener);
        mediaQuery = null;
        mediaListener = null;
      }
    },
  };

  return manager;
}
