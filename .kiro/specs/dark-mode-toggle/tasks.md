# Implementation Plan: Dark Mode Toggle

## Overview

This plan implements a client-side dark mode toggle for the Internal Repos static page. The approach follows the design architecture: an inline head script for FOIT prevention, a `theme-manager.ts` module with pure logic functions, CSS custom property overrides for the dark palette, and a toggle button rendered in the header nav. Property-based tests use `fast-check` to validate correctness properties.

## Tasks

- [x] 1. Implement theme resolution logic and ThemeManager module
  - [x] 1.1 Create `frontend/src/theme-manager.ts` with pure logic functions and ThemeManager
    - Export `Theme` type (`'light' | 'dark'`), `STORAGE_KEY`, and `VALID_THEMES` constants
    - Implement pure functions: `resolveTheme(storedValue, systemPrefersDark)`, `isValidTheme(value)`, `oppositeTheme(current)`, `getToggleLabel(current)`, `getToggleIcon(current)`
    - Implement `createThemeManager()` factory that returns a `ThemeManager` object with `getTheme()`, `toggle()`, `setTheme()`, `startListening()`, `stopListening()` methods
    - ThemeManager reads/writes `localStorage`, sets `data-theme` attribute on `document.documentElement`, and listens for `prefers-color-scheme` changes
    - Handle `localStorage` unavailability gracefully (try/catch)
    - _Requirements: 1.2, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3_

  - [ ]* 1.2 Write property-based tests for theme resolution pure functions
    - **Property 1: Toggle involution** — verify `oppositeTheme(oppositeTheme(t)) === t` for all valid themes
    - **Validates: Requirements 1.2**
    - **Property 3: Theme persistence round-trip** — verify `resolveTheme(theme, anySystemPref) === theme` for valid stored values
    - **Validates: Requirements 3.1, 3.2**
    - **Property 4: Invalid preferences trigger fallback** — verify arbitrary non-theme strings are ignored and fallback to system pref or default
    - **Validates: Requirements 3.3**
    - **Property 5: Theme resolution priority** — verify stored valid > OS pref > default light for all combinations
    - **Validates: Requirements 4.1, 4.2, 3.5**

  - [ ]* 1.3 Write unit tests for ThemeManager (Vitest + jsdom)
    - Test that `toggle()` switches theme and persists to localStorage
    - Test that `setTheme()` updates DOM `data-theme` attribute
    - Test that system preference listener fires on media query change (when no stored pref)
    - Test graceful handling when localStorage throws
    - _Requirements: 1.2, 3.1, 3.4, 4.3_

- [x] 2. Add dark palette CSS and inline head script
  - [x] 2.1 Add the `html[data-theme="dark"]` CSS custom property overrides to `frontend/index.html`
    - Add dark palette variable block overriding all `:root` color variables
    - Add dark header background override (`rgba(36, 36, 40, 0.92)`)
    - Ensure all interactive element states (hover, focus, active, disabled) remain visually distinguishable
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Add the inline synchronous theme resolution script in the `<head>` of `frontend/index.html`
    - Script reads `localStorage` for `theme-preference` key
    - Validates stored value against `['light', 'dark']`
    - Falls back to `window.matchMedia('(prefers-color-scheme: dark)')` if no valid stored value
    - Sets `data-theme` attribute on `<html>` element before body renders
    - Wrapped in try/catch for localStorage unavailability
    - _Requirements: 5.1, 5.2, 5.3, 3.2, 4.1_

  - [ ]* 2.3 Write property-based test for WCAG AA contrast ratios
    - **Property 6: Dark palette WCAG AA contrast** — enumerate all text/background color pairs from dark palette, compute contrast ratio, verify ≥ 4.5:1 for normal text and ≥ 3:1 for large text/UI
    - **Validates: Requirements 2.2**

- [x] 3. Implement theme toggle button UI
  - [x] 3.1 Create `createThemeToggle(manager)` function in `frontend/src/theme-manager.ts` (or a separate `theme-toggle.ts`)
    - Render a `<button>` with inline SVG icons (sun for light, moon for dark)
    - Set initial `aria-label` based on current theme (e.g., "Switch to dark theme")
    - Handle click events to call `manager.toggle()` and update icon + aria-label
    - Ensure button is keyboard-accessible (focusable, activates on Enter/Space)
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

  - [x] 3.2 Integrate the toggle button into the page header
    - In `frontend/src/main.ts` (or from `index.html` nav), inject the toggle button into the `<nav>` element
    - Initialize `ThemeManager` on app boot, pass to `createThemeToggle()`
    - Call `manager.startListening()` to react to OS preference changes
    - _Requirements: 1.1, 4.3_

  - [ ]* 3.3 Write property-based test for UI indicator correctness
    - **Property 2: UI indicators match theme state** — verify `getToggleIcon(theme)` and `getToggleLabel(theme)` return correct values for all valid themes
    - **Validates: Requirements 1.3, 1.5**

  - [ ]* 3.4 Write unit tests for toggle button rendering and interaction
    - Test button renders with correct initial icon and aria-label
    - Test keyboard activation (Enter, Space) triggers toggle
    - Test icon and aria-label update after toggle
    - _Requirements: 1.3, 1.4, 1.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Final integration and styling polish
  - [x] 5.1 Add toggle button styles to `frontend/index.html`
    - Style the theme toggle button to match the existing nav aesthetic
    - Add hover, focus, and active states
    - Ensure the button is visually consistent in both light and dark themes
    - _Requirements: 1.1, 2.3_

  - [x] 5.2 Verify no hardcoded light-theme colors remain
    - Audit all CSS in `index.html` for hardcoded color values that bypass custom properties
    - Ensure dialog overlays, shadows, and semi-transparent backgrounds adapt to dark theme
    - _Requirements: 2.5_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The inline head script and `theme-manager.ts` share the same resolution logic but the head script is a minimal standalone copy for FOIT prevention
- `fast-check` is already available in the project for property-based tests
- All code is TypeScript, tested with Vitest

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "5.2"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "5.1"] }
  ]
}
```
