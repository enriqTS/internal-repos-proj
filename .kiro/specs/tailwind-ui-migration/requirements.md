# Requirements Document

## Introduction

Migrate the Internal Repos frontend from ~700 lines of hand-written CSS (currently in a `<style>` block in `index.html` and an injected `<style>` in `card-grid.ts`) to Tailwind CSS 4 utility classes, complemented by a thin `ui.ts` helpers file for repeated component patterns. The visual design identity (colors, fonts, general look) is preserved; the goals are better responsiveness, consistent spacing, reliable layouts, and improved maintainability.

## Glossary

- **Build_Pipeline**: The Vite-based build system that compiles TypeScript and processes CSS for the frontend application.
- **UI_Helpers**: The `frontend/src/ui.ts` module containing factory functions that return DOM elements pre-configured with Tailwind utility classes.
- **Theme_System**: The mechanism for switching between light and dark color schemes, currently driven by `html[data-theme="dark"]` with CSS custom property overrides.
- **Component_File**: Any TypeScript source file in `frontend/src/` that creates DOM elements and assigns CSS classes (e.g., `card-grid.ts`, `upload-form.ts`).
- **Style_Source**: The CSS content that was previously in `index.html` `<style>` block and `card-grid.ts` injected styles, to be replaced by Tailwind utilities.
- **Tailwind_Config**: The Tailwind CSS 4 configuration that maps existing design tokens (CSS custom properties) to Tailwind theme values.
- **Breakpoint**: A viewport width threshold at which the layout adapts (currently only 640px; target adds tablet at ~768px and desktop at ~1024px).

## Requirements

### Requirement 1: Tailwind CSS 4 Installation and Vite Integration

**User Story:** As a developer, I want Tailwind CSS 4 installed and integrated with the Vite build pipeline, so that I can use utility classes in the application without additional build configuration.

#### Acceptance Criteria

1. WHEN the Build_Pipeline runs `vite build` or `vite dev`, THE Build_Pipeline SHALL process Tailwind CSS directives and produce utility classes in the output CSS.
2. THE Build_Pipeline SHALL use the `@tailwindcss/vite` plugin registered in `vite.config.ts` for Tailwind processing.
3. WHEN a Component_File uses a Tailwind utility class on a DOM element, THE Build_Pipeline SHALL include that class in the production CSS bundle.
4. THE Build_Pipeline SHALL produce a CSS bundle that contains no unused Tailwind base classes beyond those referenced in source files.

### Requirement 2: Design Token Mapping via Tailwind Configuration

**User Story:** As a developer, I want existing CSS custom properties mapped to Tailwind theme tokens, so that I can reference project colors, fonts, radii, and shadows using Tailwind's utility syntax.

#### Acceptance Criteria

1. THE Tailwind_Config SHALL define color tokens that map to the existing CSS custom properties (`--color-bg`, `--color-surface`, `--color-accent`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-tag-bg`, `--color-tag-text`, `--color-error`, `--color-success`, `--color-code-bg`, `--color-on-accent`, `--color-overlay`, `--color-accent-subtle`, `--color-surface-raised`, `--color-border-strong`, `--color-accent-hover`, `--color-error-hover`, `--color-header-bg`).
2. THE Tailwind_Config SHALL define font-family tokens for `mono` (mapping to `--font-mono`) and `body` (mapping to `--font-body`).
3. THE Tailwind_Config SHALL define border-radius tokens for `sm` (4px), `md` (8px), and `lg` (12px) matching the existing `--radius-*` values.
4. THE Tailwind_Config SHALL define box-shadow tokens for `sm`, `md`, and `lg` matching the existing `--shadow-*` values.
5. THE Tailwind_Config SHALL define a transition-duration token matching the existing `--transition` value (180ms).

### Requirement 3: Dedicated CSS Entry File with Tailwind Directives

**User Story:** As a developer, I want CSS moved out of `index.html` into a dedicated file imported by Vite, so that Tailwind directives have a proper home and the HTML file is clean.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL import a CSS file (e.g., `frontend/src/styles.css`) from the TypeScript entry point or the HTML file.
2. THE Style_Source SHALL contain Tailwind's base, components, and utilities layer directives (`@import "tailwindcss"`).
3. THE Style_Source SHALL define the CSS custom property declarations for both light and dark themes (the `:root` and `html[data-theme="dark"]` blocks).
4. WHEN the migration is complete, THE `index.html` file SHALL NOT contain a `<style>` block with layout or component styles.
5. THE Style_Source SHALL include the `@keyframes fadeIn` animation used by several components.

### Requirement 4: UI Helpers Module

**User Story:** As a developer, I want a `ui.ts` module with factory functions for repeated UI patterns, so that I can build DOM elements with consistent Tailwind classes without duplicating long class strings across component files.

#### Acceptance Criteria

1. THE UI_Helpers module SHALL export a `card` function that returns a styled card container element with hover, focus, and active states applied via Tailwind classes.
2. THE UI_Helpers module SHALL export a `badge` function that returns a tag/badge element with mono font, small size, and themed background via Tailwind classes.
3. THE UI_Helpers module SHALL export a `button` function accepting a variant parameter (`primary`, `secondary`, `danger`) that returns a button element with the corresponding Tailwind classes.
4. THE UI_Helpers module SHALL export a `heading` function accepting text and level (1-6) that returns a heading element with appropriate Tailwind typography classes.
5. THE UI_Helpers module SHALL export an `input` function that returns a text input element with border, focus ring, and font styling via Tailwind classes.
6. THE UI_Helpers module SHALL export a `textarea` function that returns a textarea element with consistent styling via Tailwind classes.
7. THE UI_Helpers module SHALL export a `container` function that returns a page-level wrapper element with max-width, centering, and responsive padding via Tailwind classes.
8. THE UI_Helpers module SHALL export an `overlay` function that returns a fixed-position overlay element suitable for modals via Tailwind classes.
9. THE UI_Helpers module SHALL export an `iconButton` function that returns a minimal button element (no background, icon-sized) for icon-only interactions.
10. WHEN a UI_Helpers function is called, THE returned element SHALL have all visual styling applied via Tailwind utility classes (no custom CSS class names requiring a separate stylesheet).

### Requirement 5: Component File Migration

**User Story:** As a developer, I want all component files migrated from custom CSS class names to Tailwind utility classes (directly or via UI_Helpers), so that the application no longer depends on the monolithic style block.

#### Acceptance Criteria

1. WHEN the migration is complete, THE `card-grid.ts` file SHALL NOT inject a `<style>` element into the document head.
2. WHEN the migration is complete, THE Component_Files SHALL assign Tailwind utility classes to elements via `el.className` or `el.classList` instead of custom BEM-style class names that require a separate stylesheet.
3. THE Component_Files SHALL use UI_Helpers factory functions for repeated patterns (cards, badges, buttons, inputs, overlays) instead of duplicating Tailwind class strings.
4. WHEN the migration is complete, THE application SHALL render with the same visual appearance (colors, fonts, spacing proportions, general layout) as before the migration.
5. IF a Component_File needs a one-off style that has no UI_Helpers equivalent, THEN THE Component_File SHALL apply Tailwind utility classes directly on the element.

### Requirement 6: Dark Mode Support via Tailwind

**User Story:** As a developer, I want dark mode to work through Tailwind's dark variant using the existing `data-theme` attribute, so that dark mode continues working without maintaining a parallel set of CSS variable overrides.

#### Acceptance Criteria

1. THE Tailwind_Config SHALL configure the dark mode strategy to use the `[data-theme="dark"]` selector on the `html` element.
2. WHEN `html[data-theme="dark"]` is set, THE Theme_System SHALL apply dark color values through CSS custom properties referenced by Tailwind's theme tokens.
3. WHEN a component requires a dark-mode-specific override beyond token changes, THE Component_File SHALL use Tailwind's `dark:` variant prefix on the element.
4. THE Theme_System SHALL continue supporting the existing toggle mechanism (`createThemeManager` / `createThemeToggle`) without changes to the toggle logic or localStorage persistence.

### Requirement 7: Responsive Design Improvements

**User Story:** As a developer, I want improved responsive behavior with additional breakpoints and better grid/flex layouts, so that the application works well on phones, tablets, and desktops.

#### Acceptance Criteria

1. THE Tailwind_Config SHALL define at minimum three breakpoints: `sm` (640px), `md` (768px), and `lg` (1024px).
2. WHEN the viewport is below the `sm` breakpoint, THE card grid SHALL display one column.
3. WHEN the viewport is between `sm` and `lg` breakpoints, THE card grid SHALL display two columns.
4. WHEN the viewport is at or above `lg` breakpoint, THE card grid SHALL display three or four columns.
5. WHEN the viewport is below `sm` breakpoint, THE header navigation SHALL reduce padding and font sizes for compact display.
6. WHEN the viewport is below `sm` breakpoint, THE landing page cards grid SHALL stack to a single column.
7. THE main content container SHALL adapt its horizontal padding across breakpoints (tighter on mobile, wider on desktop).

### Requirement 8: Layout and Spacing Consistency

**User Story:** As a developer, I want all spacing to use Tailwind's spacing scale instead of ad-hoc rem values, so that spacing is predictable and consistent across the application.

#### Acceptance Criteria

1. THE Component_Files SHALL use Tailwind spacing utilities (`p-*`, `m-*`, `gap-*`, `space-*`) instead of inline style pixel or rem values for padding, margin, and gaps.
2. THE UI_Helpers factory functions SHALL use Tailwind's spacing scale values for internal padding and gaps.
3. WHEN elements need centering, THE Component_Files SHALL use Tailwind flex/grid utilities (`flex`, `items-center`, `justify-center`, `mx-auto`) instead of custom margin/transform tricks.

### Requirement 9: No Functional Changes

**User Story:** As a developer, I want the migration to preserve all existing functionality, so that routing, API calls, state management, and component behavior remain unchanged.

#### Acceptance Criteria

1. THE migration SHALL NOT modify the application routing logic in `router.ts` or `main.ts` route definitions.
2. THE migration SHALL NOT modify API call functions in `api.ts`.
3. THE migration SHALL NOT modify application state management (search index, theme persistence, search state).
4. THE migration SHALL NOT introduce any JavaScript framework or library (React, Vue, Svelte, Lit, etc.).
5. THE migration SHALL NOT change the DOM structure semantics (elements that are `<button>`, `<a>`, `<input>`, `<form>` remain the same element types with the same roles and ARIA attributes).

### Requirement 10: Removal of Legacy Styles

**User Story:** As a developer, I want all hand-written CSS removed from `index.html` and injected styles removed from component files, so that there is a single source of styling truth via Tailwind.

#### Acceptance Criteria

1. WHEN the migration is complete, THE `index.html` `<style>` block SHALL be removed entirely (the inline theme-resolution script may remain).
2. WHEN the migration is complete, THE `card-grid.ts` SHALL NOT contain a `injectStyles` function or any dynamic `<style>` element creation.
3. WHEN the migration is complete, THE Style_Source file SHALL be the sole location for global CSS (Tailwind directives, custom property definitions, keyframe animations, and minimal base resets).
4. IF any component still requires a small amount of custom CSS not expressible via Tailwind utilities, THEN THE Style_Source file SHALL contain that custom CSS using Tailwind's `@layer` directive.
