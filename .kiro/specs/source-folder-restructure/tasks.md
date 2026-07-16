# Implementation Plan: Source Folder Restructure

## Overview

Reorganize the flat `frontend/src/` and `lambda/src/` directories into logical subfolders by concern. The restructure follows an incremental approach: move one group at a time, update all import paths, and verify the build between each step. No runtime behavior changes — only file locations and import paths are affected.

## Tasks

- [ ] 1. Restructure frontend components
  - [-] 1.1 Create `frontend/src/components/` directory and move component files
    - Create the `components/` subfolder
    - Move the following files into `frontend/src/components/`: `breadcrumb-nav.ts`, `card-grid.ts`, `code-viewer.ts`, `delete-dialog.ts`, `directory-listing.ts`, `drop-zone.ts`, `paginator.ts`, `readme-preview.ts`, `tag-filter.ts`, `tag-selector.ts`
    - Update all relative import paths inside the moved files to reflect their new location
    - Update all import statements in files that depend on the moved components (pages, utils, main.ts)
    - _Requirements: 1.1, 1.2, 1.5, 6.1_

  - [~] 1.2 Verify frontend build after component move
    - Run `tsc --noEmit` in `frontend/` to confirm all imports resolve
    - Run `npm run build` in `frontend/` to confirm Vite bundling succeeds
    - _Requirements: 1.3, 6.2_

- [ ] 2. Restructure frontend pages
  - [~] 2.1 Create `frontend/src/pages/` directory and move page files
    - Create the `pages/` subfolder
    - Move the following files into `frontend/src/pages/`: `landing-page.ts`, `project-detail.ts`, `project-detail.test.ts`, `templates-page.ts`, `template-detail.ts`, `template-detail.test.ts`, `file-browser.ts`, `file-browser.test.ts`, `edit-form.ts`, `upload-form.ts`, `upload-form.test.ts`, `search.ts`, `search.test.ts`
    - Update all relative import paths inside the moved files
    - Update all import statements in files that depend on the moved pages (main.ts, other pages referencing each other)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 7.1, 7.3_

  - [~] 2.2 Verify frontend build after page move
    - Run `tsc --noEmit` in `frontend/` to confirm all imports resolve
    - Run `npm run build` in `frontend/` to confirm Vite bundling succeeds
    - _Requirements: 2.3, 6.2_

- [ ] 3. Restructure frontend utilities
  - [~] 3.1 Create `frontend/src/utils/` directory and move utility files
    - Create the `utils/` subfolder
    - Move the following files into `frontend/src/utils/`: `api.ts`, `api.test.ts`, `i18n.ts`, `language-mapper.ts`, `language-mapper.test.ts`, `relative-date.ts`, `router.ts`, `search-state.ts`, `shared-markdown.ts`, `theme-manager.ts`, `ui.ts`
    - Keep `main.ts`, `main.test.ts`, `styles.css`, `preservation.test.ts`, and `ux-bugs-exploration.test.ts` at the `src/` root
    - Update all relative import paths inside the moved files
    - Update all import statements in pages, components, and `main.ts` that reference the moved utilities
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.1, 7.1, 7.3_

  - [~] 3.2 Verify frontend build and tests after utility move
    - Run `tsc --noEmit` in `frontend/` to confirm all imports resolve
    - Run `npm run build` in `frontend/` to confirm Vite bundling succeeds
    - _Requirements: 6.2, 6.4_

- [~] 4. Checkpoint - Verify full frontend integrity
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Restructure backend handlers
  - [~] 5.1 Create `lambda/src/handlers/` directory and move handler files
    - Create the `handlers/` subfolder
    - Move the following files into `lambda/src/handlers/`: `initiate.ts`, `initiate.test.ts`, `process.ts`, `process.test.ts`, `delete.ts`, `edit.ts`, `edit.test.ts`, `suggest-tags.ts`, `suggest-tags-preservation.test.ts`, `generate-readme.ts`
    - Update all relative import paths inside the moved handler files (they will now reference `../utils/` for utility imports)
    - _Requirements: 4.1, 4.2, 4.4, 7.1, 7.3_

  - [~] 5.2 Update `lambda/package.json` esbuild entry points
    - Change the `build` script entry points from `src/initiate.ts src/process.ts src/suggest-tags.ts src/delete.ts src/edit.ts` to `src/handlers/initiate.ts src/handlers/process.ts src/handlers/suggest-tags.ts src/handlers/delete.ts src/handlers/edit.ts`
    - _Requirements: 8.1_

  - [~] 5.3 Verify backend build after handler move
    - Run `tsc --noEmit` in `lambda/` to confirm all imports resolve
    - Run `npm run build` in `lambda/` to confirm esbuild bundling succeeds
    - Verify that `dist/` still contains `initiate.js`, `process.js`, `suggest-tags.js`, `delete.js`, `edit.js`
    - _Requirements: 4.4, 6.3, 8.1, 8.3_

- [ ] 6. Restructure backend utilities
  - [~] 6.1 Create `lambda/src/utils/` directory and move utility files
    - Create the `utils/` subfolder
    - Move the following files into `lambda/src/utils/`: `ai-client.ts`, `archiver-wrapper.ts`, `archiver-wrapper.test.ts`, `file-expander.ts`, `file-expander.test.ts`, `filter.ts`, `filter.test.ts`, `index-generator.ts`, `index-generator.test.ts`, `s3-writer.ts`, `s3-writer.test.ts`, `tag-registry.ts`, `validate.ts`, `validate.test.ts`
    - Update all relative import paths inside the moved utility files
    - Update all import statements in handler files to reference the new `../utils/` path
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 7.1, 7.3_

  - [~] 6.2 Verify backend build after utility move
    - Run `tsc --noEmit` in `lambda/` to confirm all imports resolve
    - Run `npm run build` in `lambda/` to confirm esbuild bundling succeeds
    - _Requirements: 6.3, 6.4_

- [~] 7. Final checkpoint - Full verification
  - Run the full test suite across both packages to confirm zero regressions
  - Verify `lambda/dist/` output filenames are unchanged (`initiate.js`, `process.js`, `suggest-tags.js`, `delete.js`, `edit.js`)
  - Verify Terraform handler attributes (`initiate.handler`, `process.handler`, etc.) still resolve correctly against `dist/` output
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.3, 5.4, 6.2, 6.3, 6.4, 7.4, 8.1, 8.3, 8.4_

## Notes

- No property-based tests are needed — this is a mechanical file-move operation with no new logic.
- The design confirms Terraform handler attributes reference output filenames (e.g., `initiate.handler`) not source paths, so no Terraform changes are needed.
- `main.ts`, `main.test.ts`, `styles.css`, `preservation.test.ts`, and `ux-bugs-exploration.test.ts` stay at the `frontend/src/` root level.
- Use `smart_relocate` or TypeScript-aware refactoring to automatically update import references when moving files.
- Each group move should be committed separately for easy bisection if issues arise.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["3.2"] },
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["5.2", "5.3"] },
    { "id": 8, "tasks": ["6.1"] },
    { "id": 9, "tasks": ["6.2"] }
  ]
}
```
