# Requirements Document

## Introduction

This document specifies the requirements for reorganizing the source folder structures of both the frontend (`frontend/src/`) and backend (`lambda/src/`) packages. Currently all source files reside in flat directories, making navigation and discoverability difficult as the codebase grows. The goal is to group files into logical subfolders by concern (components, pages, utilities, handlers, etc.) without changing any runtime behavior.

## Glossary

- **Frontend_App**: The client-side SPA application located in `frontend/src/`.
- **Backend_App**: The Lambda-based backend application located in `lambda/src/`.
- **Build_System**: The tooling that compiles/bundles source files (Vite + TypeScript for frontend, esbuild for backend).
- **Test_Suite**: The collection of unit and integration tests colocated with source files.
- **Import_Path**: A relative module specifier used in TypeScript `import` statements.
- **Subfolder**: A directory within `src/` that groups files by logical concern.
- **System**: The combined frontend and backend codebase including all build tooling, test runners, and configuration files.

## Requirements

### Requirement 1: Frontend Component Grouping

**User Story:** As a developer, I want UI component files grouped into a `components/` subfolder, so that I can quickly locate reusable visual elements separate from pages and utilities.

#### Acceptance Criteria

1. WHEN the restructure is applied, THE Frontend_App SHALL contain a `src/components/` subfolder holding the following TypeScript source modules: `breadcrumb-nav.ts`, `card-grid.ts`, `code-viewer.ts`, `delete-dialog.ts`, `directory-listing.ts`, `drop-zone.ts`, `paginator.ts`, `readme-preview.ts`, `tag-filter.ts`, `tag-selector.ts`.
2. WHEN a module is moved to `src/components/`, THE Frontend_App SHALL update all import statements in dependent modules to reference the new path, so that the TypeScript compiler resolves every import without errors.
3. WHEN the restructure is applied, THE Frontend_App SHALL pass the existing build (`vite build`) and test suite with zero new failures compared to the pre-restructure state.
4. IF a test file exists that exclusively tests a moved component module, THEN THE Frontend_App SHALL co-locate that test file in `src/components/` alongside its source module.
5. WHEN the restructure is applied, THE Frontend_App SHALL NOT require changes to `tsconfig.json` path aliases or `vite.config.ts` resolve aliases beyond what is necessary to maintain existing build behavior.

### Requirement 2: Frontend Page Grouping

**User Story:** As a developer, I want page-level view files grouped into a `pages/` subfolder, so that I can distinguish full-page views from reusable components.

#### Acceptance Criteria

1. WHEN the restructure is applied, THE Frontend_App SHALL contain a `src/pages/` subfolder holding the following modules: `landing-page`, `project-detail`, `templates-page`, `template-detail`, `file-browser`, `edit-form`, `upload-form`, `search`.
2. WHEN the restructure is applied, THE Frontend_App SHALL preserve all existing route-to-page mappings defined in the router, such that each route pattern continues to resolve to the same handler function as before the restructure.
3. WHEN the restructure is applied, THE Frontend_App SHALL update all import paths referencing the moved modules so that the project compiles without errors using the existing build tool configuration.
4. IF a module listed for `pages/` has co-located test files (e.g., `search.test.ts`, `file-browser.test.ts`), THEN THE Frontend_App SHALL move those test files alongside their corresponding module into the `pages/` subfolder.
5. WHEN the restructure is applied, THE Frontend_App SHALL NOT move reusable component modules (e.g., `card-grid`, `paginator`, `breadcrumb-nav`) into the `pages/` subfolder.

### Requirement 3: Frontend Utilities Grouping

**User Story:** As a developer, I want utility and infrastructure files grouped into a `utils/` subfolder, so that shared logic is clearly separated from UI concerns.

#### Acceptance Criteria

1. WHEN the restructure is applied, THE Frontend_App SHALL contain a `utils/` subfolder holding the following modules: `api`, `i18n`, `language-mapper`, `relative-date`, `router`, `search-state`, `shared-markdown`, `theme-manager`, `ui`.
2. THE Frontend_App SHALL keep `main.ts` and `styles.css` at the `src/` root level as application entry points.
3. WHEN utility modules are moved, THE Frontend_App SHALL update all import paths in dependent modules (pages and components) to reference the new `utils/` location so that the TypeScript compiler resolves every import without errors.
4. IF a test file exists for a utility module (e.g., `language-mapper.test.ts`), THEN THE Frontend_App SHALL co-locate that test file in `src/utils/` alongside its source module.

### Requirement 4: Backend Handler Grouping

**User Story:** As a developer, I want Lambda handler files grouped into a `handlers/` subfolder, so that API entry points are clearly identifiable.

#### Acceptance Criteria

1. WHEN the restructure is applied, THE Backend_App SHALL contain a `handlers/` subfolder at `lambda/src/handlers/` holding exactly one file per Lambda entry point with the following filenames: `initiate.ts`, `process.ts`, `delete.ts`, `edit.ts`, `suggest-tags.ts`, `generate-readme.ts`.
2. WHEN the restructure is applied, THE Backend_App SHALL preserve each handler file's named export `handler` with its existing function signature (parameter type and return type unchanged).
3. WHEN the restructure is applied, THE Backend_App SHALL keep all non-handler utility modules outside of `handlers/` in the `lambda/src/utils/` subfolder.
4. WHEN the restructure is applied, THE Backend_App SHALL update all internal import paths — both within handler files and in modules that reference them — so that the project compiles without errors using the existing build configuration.
5. IF the Terraform or infrastructure configuration references Lambda handler entry points by file path, THEN THE Backend_App SHALL update those references to reflect the new `handlers/` subfolder location.

### Requirement 5: Backend Utilities Grouping

**User Story:** As a developer, I want backend utility and infrastructure files grouped into a `utils/` subfolder, so that shared internal logic is separated from handlers.

#### Acceptance Criteria

1. WHEN the restructure is applied, THE Backend_App SHALL contain a `lambda/src/utils/` subfolder holding the following modules: `ai-client`, `archiver-wrapper`, `file-expander`, `filter`, `index-generator`, `s3-writer`, `tag-registry`, `validate`.
2. WHEN utility modules are moved to `lambda/src/utils/`, THE Backend_App SHALL update all import paths in handler modules (`initiate`, `process`, `delete`, `edit`, `suggest-tags`, `generate-readme`) to reference the new `utils/` location, such that the project compiles without errors.
3. WHEN utility modules are moved to `lambda/src/utils/`, THE Backend_App SHALL co-locate each utility's associated test file (e.g., `archiver-wrapper.test.ts`, `file-expander.test.ts`, `filter.test.ts`, `index-generator.test.ts`, `s3-writer.test.ts`, `validate.test.ts`) within the same `lambda/src/utils/` subfolder.
4. WHEN the restructure is applied, THE Backend_App SHALL pass all existing unit tests without modification to test logic (only import paths may change).

### Requirement 6: Import Path Consistency

**User Story:** As a developer, I want all import paths updated to reflect the new folder structure, so that the project compiles without errors after restructuring.

#### Acceptance Criteria

1. WHEN a file is moved to a subfolder, THE Build_System SHALL resolve all Import_Paths referencing that file without errors.
2. THE Frontend_App SHALL compile successfully with `vite build` after restructuring.
3. THE Backend_App SHALL bundle successfully with the esbuild command defined in `package.json` after restructuring.
4. WHEN the restructure is applied, THE System SHALL update relative import paths within moved test files so that the test runner executes all tests with zero failures.

### Requirement 7: Test Colocation

**User Story:** As a developer, I want test files to move alongside their corresponding source files, so that tests remain colocated and discoverable.

#### Acceptance Criteria

1. WHEN a source file is moved to a different directory, THE System SHALL move the colocated test file (matching the pattern `<filename>.test.<ext>` in the same original directory) to the same destination directory.
2. WHEN a source file has no matching test file in its original directory, THE System SHALL move only the source file without error.
3. WHEN the restructure is applied, THE System SHALL update relative import paths within moved test files so that the test runner executes all tests with zero failures and no manual edits to test file contents.
4. WHEN the restructure is applied, THE System SHALL execute the project's test suite and report zero test failures.

### Requirement 8: Build Configuration Update

**User Story:** As a developer, I want build tool configurations updated to reference new entry points, so that CI/CD pipelines continue to work.

#### Acceptance Criteria

1. WHEN backend handler files are moved to `handlers/`, THE Backend_App build script in `package.json` SHALL update all esbuild entry point paths to reference the new location (e.g., `src/handlers/initiate.ts`, `src/handlers/process.ts`), and a successful `npm run build` SHALL produce output files in `dist/` with the same filenames as before the move.
2. IF the Vite configuration or `index.html` references explicit source file paths that have changed due to the reorganization, THEN THE Frontend_App SHALL update those references so that `npm run build` completes without errors and produces a working bundle in `dist/`.
3. IF the Terraform infrastructure references Lambda handler paths (the `handler` attribute in `aws_lambda_function` resources), THEN THE Build_System SHALL ensure that the handler attribute values still resolve to valid exported functions in the built `dist/` output.
4. WHEN the handler source files are moved, THE Build_System SHALL ensure that CI/CD workflow files (e.g., GitHub Actions) that invoke build or deploy commands continue to execute without path-resolution failures.
