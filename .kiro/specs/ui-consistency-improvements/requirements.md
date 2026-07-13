# Requirements Document

## Introduction

This feature addresses visual inconsistencies between the Templates and Projects detail pages. Currently, the templates page uses a different button style and spacing than the projects page, and the projects page uses a less-integrated markdown README rendering approach compared to the templates page. The goal is to unify both pages to use consistent button styling/spacing and adopt the template page's superior README rendering approach as the universal markdown rendering style across the site.

## Glossary

- **Template_Detail_Page**: The page rendered when a user navigates to a specific template (route `#/template/{name}`), showing template metadata, download button, architecture diagram, and README.
- **Project_Detail_Page**: The page rendered when a user navigates to a specific project (route `#/project/{name}`), showing project metadata, download link, and README.
- **Download_Button**: The primary action button/link used to download an artifact (template zip or project artifact.zip).
- **Readme_Renderer**: The component responsible for parsing markdown content and rendering it as styled HTML within a detail page.
- **Button_Component**: The shared UI element used for download actions, following consistent styling, spacing, and accessibility attributes across all detail pages.

## Requirements

### Requirement 1: Unified Button Styling

**User Story:** As a user, I want the download buttons on both the templates and projects detail pages to look and behave the same, so that the interface feels consistent and polished.

#### Acceptance Criteria

1. THE Button_Component SHALL use the same CSS class, padding, font-size, border-radius, and color values on both the Template_Detail_Page and the Project_Detail_Page.
2. WHEN the Download_Button is rendered on the Project_Detail_Page, THE Button_Component SHALL use the same HTML element type, CSS class name, and set of accessibility attributes as the Download_Button on the Template_Detail_Page.
3. THE Button_Component SHALL include a `download` attribute, an `aria-label` that contains the name of the resource being downloaded and the word "download", and visible text beginning with the word "Download".
4. IF the download artifact is unavailable, THEN THE Button_Component SHALL render as a non-interactive `<span>` element with `aria-disabled="true"` and a visible text message adjacent to the button stating that the artifact is not available for download.
5. WHEN the Download_Button is rendered in the enabled state, THE Button_Component SHALL render as an `<a>` element whose `href` attribute points to the artifact URL.

### Requirement 2: Consistent Button Spacing

**User Story:** As a user, I want the spacing around the download button to be consistent across templates and projects pages, so that the layout feels cohesive.

#### Acceptance Criteria

1. THE Button_Component SHALL have the same vertical margin of 16px above and 16px below on both the Template_Detail_Page and the Project_Detail_Page.
2. THE Button_Component SHALL be positioned as the next sibling element after the metadata section and before the README content section in the DOM order on both detail pages.
3. WHEN the detail page layout is rendered, THE Button_Component SHALL be left-aligned with the page content container's left edge on both detail pages.
4. THE Button_Component SHALL use the same CSS class name on both the Template_Detail_Page and the Project_Detail_Page to ensure styling is applied from a single rule.

### Requirement 3: Universal Markdown README Rendering

**User Story:** As a user, I want all README/markdown content across the site to be rendered with the same integrated, site-native styling used by the templates page, so that documentation feels like a natural part of the application.

#### Acceptance Criteria

1. THE Readme_Renderer SHALL wrap rendered markdown in a `<section>` element with a page-contextual class (e.g., `template-readme`, `project-readme`) and a nested `<div>` container with class `readme-content`.
2. THE Readme_Renderer SHALL apply typography styles to the `readme-content` container such that font-family, font-size, line-height, heading sizes (h1–h6), link colors, and code block styling produce the same computed values on the Project_Detail_Page as on the Template_Detail_Page.
3. WHEN markdown content is rendered on the Project_Detail_Page, THE Readme_Renderer SHALL use the same rendering component and CSS classes as the Template_Detail_Page.
4. THE Readme_Renderer SHALL use a single shared Marked instance exported from a common module, configured with highlight.js using the `hljs language-` prefix and automatic language detection fallback for syntax-highlighted code blocks.
5. IF markdown rendering fails or content is unavailable, THEN THE Readme_Renderer SHALL display an error message within a `<p>` element with class `error-message` indicating that documentation is unavailable, using the same element structure and class on all pages.
6. IF the markdown content is empty or contains only whitespace, THEN THE Readme_Renderer SHALL display a placeholder message within the `readme-content` container indicating no documentation is available, rather than rendering an empty section.

### Requirement 4: Shared Rendering Component Extraction

**User Story:** As a developer, I want the README rendering logic to be extracted into a reusable shared module, so that both pages use a single source of truth and future pages can adopt the same rendering.

#### Acceptance Criteria

1. THE Readme_Renderer SHALL be implemented as a shared module exporting a configured Marked instance (initialized with markedHighlight and highlight.js syntax highlighting), a function to render a readme section, and a function to render a readme error fallback.
2. WHEN the Template_Detail_Page or Project_Detail_Page needs to render markdown, THE Readme_Renderer shared module SHALL be imported and called, and neither page SHALL create its own Marked instance or duplicate the markdown rendering configuration.
3. THE Readme_Renderer shared module SHALL export the configured Marked instance so that other components (such as the readme-preview editor) can call its parse method with the same highlight.js configuration.
4. THE Readme_Renderer shared module SHALL export a function that accepts parsed HTML content as a string and returns an HTMLElement containing the rendered readme section, and a separate function that returns an HTMLElement representing a readme error fallback with a descriptive error message.
