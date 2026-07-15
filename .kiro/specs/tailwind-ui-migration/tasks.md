# Implementation Plan: Tailwind UI Migration

## Overview

Migrate the Internal Repos frontend from hand-written CSS to Tailwind CSS 4 utility classes, following a 4-phase approach: infrastructure setup, UI helpers module creation, component-by-component migration, and legacy style cleanup. All code is TypeScript; the existing visual identity and functionality are preserved.

## Tasks

- [ ] 1. Phase 1: Infrastructure Setup
  - [ ] 1.1 Install Tailwind CSS 4 and the Vite plugin
    - Run `npm install tailwindcss @tailwindcss/vite` in the `frontend/` directory
    - Verify packages are added to `package.json`
    - _Requirements: 1.1, 1.2_

  - [ ] 1.2 Create `frontend/src/styles.css` with Tailwind directives and theme tokens
    - Add `@import "tailwindcss"` directive
    - Add `@custom-variant dark` using `data-theme` selector
    - Add `@theme` block with all color, font, radius, shadow, and transition tokens
    - Add `:root` and `html[data-theme="dark"]` CSS custom property definitions
    - Add `@layer base` reset rules
    - Add `@keyframes fadeIn` and `@keyframes slideUp` animations
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.5, 6.1, 6.2, 7.1_

  - [ ] 1.3 Update `frontend/vite.config.ts` to register the Tailwind plugin
    - Import and register `@tailwindcss/vite` plugin
    - Keep existing alias and build configuration intact
    - _Requirements: 1.2, 1.3_

  - [ ] 1.4 Import `styles.css` from the TypeScript entry point
    - Add `import './styles.css'` to `frontend/src/main.ts`
    - Verify `vite build` compiles successfully with Tailwind processing
    - _Requirements: 1.1, 3.1_

- [ ] 2. Checkpoint - Verify infrastructure
  - Ensure `vite build` runs without errors, Tailwind processes the CSS file, and no regressions in existing behavior. Ask the user if questions arise.

- [ ] 3. Phase 2: UI Helpers Module
  - [ ] 3.1 Create `frontend/src/ui.ts` with all factory functions
    - Implement `card(opts?)` returning a styled `<div>` with hover/focus/active states
    - Implement `badge(text)` returning a mono-font tag/badge `<span>`
    - Implement `button(text, variant?)` supporting `primary`, `secondary`, `danger` variants
    - Implement `heading(text, level?)` returning `<h1>`–`<h6>` with typography classes
    - Implement `input(opts?)` returning a styled text input
    - Implement `textarea(opts?)` returning a styled textarea
    - Implement `container(className?)` returning a page-level wrapper with responsive padding
    - Implement `overlay()` returning a fixed-position modal overlay
    - Implement `iconButton(opts?)` returning a minimal icon-only button
    - Use the exact Tailwind class mappings from the design document's Class Mappings table
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 8.1, 8.2_

  - [ ]* 3.2 Write property-based tests for `ui.ts` helpers
    - **Property 1: UI helper element construction** — verify each helper returns correct tag name and base classes for all valid option combinations
    - **Property 2: Button variant class mapping** — verify button contains exactly the correct variant classes
    - **Property 3: Heading level-to-tag mapping** — verify heading tag is `H{level}` with correct text and size classes
    - **Property 4: No custom stylesheet class names** — verify no BEM-style patterns in any helper output
    - Install `fast-check` as a dev dependency
    - Write tests in `frontend/src/ui.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10**

  - [ ]* 3.3 Write unit tests for `ui.ts` helpers
    - Test each factory function with specific option combinations
    - Verify returned elements have correct attributes (id, placeholder, maxLength, ariaLabel, etc.)
    - Test edge cases: missing options, empty strings, boundary heading levels
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

- [ ] 4. Checkpoint - Verify helpers module
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Phase 3: Component Migration
  - [ ] 5.1 Migrate `card-grid.ts`
    - Replace all custom CSS class assignments with Tailwind utilities
    - Use `card()` and `badge()` helpers for card elements and tags
    - Apply responsive grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (or 4)
    - Remove the `injectStyles()` function and its call
    - Remove the dynamic `<style>` element creation
    - _Requirements: 5.1, 5.2, 5.3, 7.2, 7.3, 7.4, 10.2_

  - [ ] 5.2 Migrate `search.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `input()` helper for search input element
    - Apply Tailwind spacing and flex/grid utilities for layout
    - _Requirements: 5.2, 5.3, 5.5, 8.1, 8.3_

  - [ ] 5.3 Migrate `main.ts` (layout and header styling)
    - Replace header, navigation, and page wrapper class names with Tailwind utilities
    - Use `container()` helper for main content wrapper
    - Apply responsive header padding: reduced on mobile (`sm:` breakpoint)
    - Preserve routing logic and state management untouched
    - _Requirements: 5.2, 5.4, 7.5, 7.7, 9.1, 9.3_

  - [ ] 5.4 Migrate `upload-form.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `button()`, `input()`, `textarea()`, `heading()` helpers
    - Apply Tailwind spacing utilities for form layout
    - _Requirements: 5.2, 5.3, 5.5, 8.1_

  - [ ] 5.5 Migrate `project-detail.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `container()`, `heading()`, `badge()`, `button()`, `iconButton()` helpers
    - Apply one-off Tailwind utilities where no helper matches
    - _Requirements: 5.2, 5.3, 5.5, 8.1_

  - [ ] 5.6 Migrate `template-detail.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `container()`, `heading()`, `badge()`, `button()` helpers
    - _Requirements: 5.2, 5.3, 5.5, 8.1_

  - [ ] 5.7 Migrate `edit-form.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `button()`, `input()`, `textarea()`, `heading()`, `overlay()` helpers
    - _Requirements: 5.2, 5.3, 5.5, 8.1_

  - [ ] 5.8 Migrate `delete-dialog.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `overlay()`, `button(danger)`, `button(secondary)`, `heading()` helpers
    - _Requirements: 5.2, 5.3, 5.5, 8.1_

  - [ ] 5.9 Migrate `paginator.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `button()` or `iconButton()` helpers for pagination controls
    - Apply flex layout utilities for horizontal arrangement
    - _Requirements: 5.2, 5.3, 5.5, 8.1, 8.3_

  - [ ] 5.10 Migrate `tag-filter.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `badge()` helper for tag elements
    - Apply flex-wrap layout with gap utilities
    - _Requirements: 5.2, 5.3, 5.5, 8.1_

  - [ ] 5.11 Migrate `tag-selector.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `badge()` and `input()` helpers where applicable
    - _Requirements: 5.2, 5.3, 5.5, 8.1_

  - [ ] 5.12 Migrate `drop-zone.ts`
    - Replace custom class names with Tailwind utility classes
    - Apply border-dashed, transition, and active/hover state utilities
    - _Requirements: 5.2, 5.5, 8.1_

  - [ ] 5.13 Migrate `readme-preview.ts` and `shared-markdown.ts`
    - Replace custom class names with Tailwind utility classes
    - Apply typography and code-block styling via Tailwind
    - _Requirements: 5.2, 5.5, 8.1_

  - [ ] 5.14 Migrate `landing-page.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `container()`, `heading()`, `card()`, `button()` helpers
    - Apply responsive grid for landing page cards: single column on mobile, multi-column on larger
    - _Requirements: 5.2, 5.3, 5.5, 7.6, 8.1_

  - [ ] 5.15 Migrate `templates-page.ts`
    - Replace custom class names with Tailwind utility classes
    - Use `container()`, `heading()`, `card()`, `badge()` helpers
    - _Requirements: 5.2, 5.3, 5.5, 8.1_

  - [ ] 5.16 Migrate `theme-manager.ts`
    - Verify theme toggle logic remains untouched (only update element styling classes if needed)
    - Replace any custom class names on toggle button with Tailwind utilities or `iconButton()` helper
    - Ensure `data-theme` attribute toggling still drives dark mode
    - _Requirements: 5.2, 6.3, 6.4_

- [ ] 6. Checkpoint - Verify component migrations
  - Run all existing tests (`upload-form.test.ts`, `search.test.ts`, `main.test.ts`, `project-detail.test.ts`, `template-detail.test.ts`)
  - Run `vite build` to verify successful compilation
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Phase 4: Legacy Style Cleanup
  - [ ] 7.1 Remove the `<style>` block from `frontend/index.html`
    - Delete the entire `<style>...</style>` block containing layout and component styles
    - Preserve the inline `<script>` that sets `data-theme` before render (prevents FOIT)
    - Verify the HTML file is clean of layout/component CSS
    - _Requirements: 3.4, 10.1_

  - [ ] 7.2 Confirm `card-grid.ts` has no `injectStyles` remnants
    - Verify the `injectStyles` function is removed (done in task 5.1)
    - Verify no dynamic `<style>` element creation remains
    - _Requirements: 5.1, 10.2_

  - [ ] 7.3 Final verification — sole source of styling
    - Confirm `frontend/src/styles.css` is the only global CSS file
    - Confirm no other component files inject `<style>` elements
    - Run `vite build` and verify output contains no unused Tailwind base classes beyond what's referenced
    - _Requirements: 1.4, 10.3, 10.4_

- [ ] 8. Final checkpoint - Full regression check
  - Run all tests and `vite build`
  - Verify no `<style>` block in production `index.html`
  - Verify no `injectStyles` calls in production bundle
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design (Properties 1–4)
- Unit tests validate specific examples and edge cases
- The migration does NOT modify `api.ts`, `router.ts`, `search-state.ts`, or `relative-date.ts` (pure logic/data, no styling)
- Component files `i18n.ts` has no DOM creation and does not need migration

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["5.5", "5.6", "5.7", "5.8"] },
    { "id": 7, "tasks": ["5.9", "5.10", "5.11", "5.12"] },
    { "id": 8, "tasks": ["5.13", "5.14", "5.15", "5.16"] },
    { "id": 9, "tasks": ["7.1", "7.2"] },
    { "id": 10, "tasks": ["7.3"] }
  ]
}
```
