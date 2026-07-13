# Implementation Plan: Homepage & PT-BR Localization

## Overview

This plan implements a new landing page at `#/` and localizes the entire Internal Repos frontend SPA to Brazilian Portuguese (PT-BR). The work is structured as: (1) create the i18n module, (2) build the landing page, (3) update routing and navigation, (4) localize all existing pages/components, (5) add responsive styles, and (6) write tests.

## Tasks

- [x] 1. Create the i18n localization module
  - [x] 1.1 Create `src/i18n.ts` with the full PT-BR string dictionary and `t()` function
    - Define the `strings` const object with all keys from the design (header, nav, landing, search, templates, projectDetail, templateDetail, upload, edit, delete, validation, dropZone, readmePreview, cardGrid, paginator, theme)
    - Implement overloaded `t(key)` and `t(key, params)` functions with interpolation support
    - Export `I18nKey` type and the `t` function
    - Missing keys return the key string as-is; missing interpolation params leave `{placeholder}` unchanged
    - _Requirements: 3.1, 3.4, 3.10_

  - [ ]* 1.2 Write property test: Localization completeness (Property 1)
    - **Property 1: Localization completeness — all keys resolve to non-empty strings**
    - Use fast-check to generate keys from the set of all defined dictionary keys
    - Assert `t(key)` returns a non-empty string that differs from the key itself
    - **Validates: Requirements 3.1**

  - [ ]* 1.3 Write property test: Missing key fallback (Property 2)
    - **Property 2: Missing key fallback — unknown keys are returned as-is**
    - Use fast-check to generate arbitrary strings (unicode, empty, special chars), filter out valid keys
    - Assert `t(invalidKey) === invalidKey`
    - **Validates: Requirements 3.10**

- [x] 2. Create the landing page module
  - [x] 2.1 Create `src/landing-page.ts` with the `renderLandingPage` function
    - Render `<h1>` heading using `t('landing.heading')`
    - Render introductory `<p>` using `t('landing.description')`
    - Render two navigation cards as `<a>` elements: one linking to `#/projects` and one to `#/templates`
    - Each card contains a `<h2>` title and `<p>` description pulled from i18n keys
    - Cards use semantic anchor elements for native keyboard activation (Enter/Space)
    - Apply CSS classes using existing design tokens
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 2.2 Write unit tests for the landing page
    - Test that `renderLandingPage` renders heading, description, and two navigation cards with correct hrefs (`#/projects`, `#/templates`)
    - Test that card text comes from i18n module
    - Test keyboard accessibility (native anchor behavior)
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 3. Update routing and navigation active state
  - [x] 3.1 Update route table in `src/main.ts`
    - Add `#/` route pointing to `renderLandingPage`
    - Add `#/projects` route pointing to `renderSearchView`
    - Keep existing project/template/upload sub-routes unchanged
    - Import `renderLandingPage` from the new module
    - _Requirements: 1.1, 2.1, 2.3, 2.4_

  - [x] 3.2 Implement `getActiveNavSection` function and update `updateNavActive` in `src/main.ts`
    - Extract nav active logic into a pure `getActiveNavSection(path): 'projects' | 'templates' | null` function
    - Path starts with `/projects` or `/project/` → `'projects'`
    - Path starts with `/templates` or `/template/` → `'templates'`
    - All other paths (including `/`, `/upload`) → `null`
    - Update `updateNavActive` to use the new function
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 3.3 Write property test: Navigation active state classification (Property 3)
    - **Property 3: Navigation active state classification**
    - Use fast-check to generate random route path strings (valid project/template patterns, edge cases, empty strings, arbitrary paths)
    - Assert classification matches the specification rules
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [x] 3.4 Update internal redirects and links to point to `#/projects`
    - In `src/upload-form.ts`: change post-upload redirect from `#/` to `#/projects`
    - In `src/delete-dialog.ts`: change post-delete redirect from `#/` to `#/projects`
    - In `src/project-detail.ts`: change back link href from `#/` to `#/projects`
    - Update navigation links in `index.html` to include `#/projects` and update `data-nav` attributes
    - _Requirements: 2.2_

- [x] 4. Checkpoint - Ensure routing and core modules work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Localize all existing pages and components
  - [x] 5.1 Localize the header and navigation in `index.html`
    - Set `<html lang="pt-BR">` on the root element
    - Update site title to use PT-BR text (`Repos Internos`)
    - Update nav link text: "Projetos", "Templates", "Upload"
    - _Requirements: 3.2, 3.3, 3.5_

  - [x] 5.2 Localize `src/main.ts` (search view)
    - Replace hardcoded English strings with `t()` calls for heading, placeholder, loading, error, retry, and no-results text
    - _Requirements: 3.6_

  - [x] 5.3 Localize `src/templates-page.ts`
    - Replace all hardcoded strings with `t()` calls: heading, placeholder, loading, empty state
    - _Requirements: 3.6_

  - [x] 5.4 Localize `src/project-detail.ts`
    - Replace hardcoded strings with `t()` calls: back link, error messages, download labels, action buttons (Edit, Delete), repository label
    - _Requirements: 3.7_

  - [x] 5.5 Localize `src/template-detail.ts`
    - Replace hardcoded strings with `t()` calls: back link, error messages, download button, language label
    - _Requirements: 3.7_

  - [x] 5.6 Localize `src/upload-form.ts`
    - Replace hardcoded strings with `t()` calls: heading, labels, placeholders, submit button, status messages, validation errors, drop-zone text
    - _Requirements: 3.8_

  - [x] 5.7 Localize `src/edit-form.ts`
    - Replace hardcoded strings with `t()` calls: heading, labels, placeholders, submit/cancel buttons, status messages, validation errors
    - _Requirements: 3.8_

  - [x] 5.8 Localize `src/delete-dialog.ts`
    - Replace hardcoded strings with `t()` calls: title, warning, prompt (with interpolation for project name), buttons, status messages
    - _Requirements: 3.9_

  - [x] 5.9 Localize shared components (`src/card-grid.ts`, `src/paginator.ts`, `src/drop-zone.ts`, `src/readme-preview.ts`, `src/theme-manager.ts`)
    - Replace hardcoded strings with `t()` calls in each component
    - _Requirements: 3.2_

- [x] 6. Checkpoint - Verify localization across all pages
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add responsive styles for the landing page
  - [x] 7.1 Add landing page CSS to `index.html`
    - Add styles for `.landing-page`, `.landing-heading`, `.landing-description`, `.landing-cards-grid`, `.landing-card`
    - Use CSS Grid for the card layout: single-column at ≤640px, 2-column grid above 640px
    - Use `@media (max-width: 640px)` for stacking cards vertically, minimum font size 14px, touch target ≥44×44px
    - Ensure no horizontal overflow at narrow viewports; cards take full width
    - Use existing CSS custom properties for colors, fonts, radii, and shadows
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 7.2 Write unit tests for responsive behavior
    - Test that landing page card grid uses correct CSS classes for responsive layout
    - Verify touch-target sizing classes are applied
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The i18n module uses a flat key-value approach with no framework dependency, as specified in the design
- All localization strings are defined in the design document's `i18n.ts` interface section

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.2"] },
    { "id": 2, "tasks": ["2.2", "3.1", "3.3"] },
    { "id": 3, "tasks": ["3.4", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2"] }
  ]
}
```
