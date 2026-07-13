# Requirements Document

## Introduction

This feature adds a landing/home page to the Internal Repos application and translates the entire site to Portuguese-BR (PT-BR). The landing page serves as an entry point at the root route (`#/`), directing users to the Projects section or the Templates section with clear navigation cards. All existing UI text across the site (headings, labels, buttons, placeholders, status messages) must be localized to PT-BR, as the user base is located in Brazil.

## Glossary

- **Landing_Page**: The new home page rendered at the root hash route (`#/`), containing a title, description, and navigation cards to the Projects and Templates sections.
- **Navigation_Card**: A clickable card component on the Landing Page that links to a specific section (Projects or Templates) with a title and brief description.
- **Localization_Module**: A centralized module that stores all UI string literals in PT-BR and exports them for use across the application.
- **Router**: The existing hash-based client-side router (`router.ts`) that maps URL fragments to page handlers.
- **Site**: The complete Internal Repos frontend SPA including the header, navigation, all pages (Landing, Projects, Templates, Upload, Project Detail, Template Detail, Edit), and shared components.

## Requirements

### Requirement 1: Landing Page at Root Route

**User Story:** As a user, I want to see a landing page when I visit the root URL, so that I can understand what the application offers and navigate to the section I need.

#### Acceptance Criteria

1. WHEN the user navigates to the root route (`#/`), THE Router SHALL render the Landing_Page instead of the Projects search view.
2. THE Landing_Page SHALL display a heading that identifies the application purpose in PT-BR.
3. THE Landing_Page SHALL display an introductory paragraph explaining the two available sections (Projects and Templates) in PT-BR.
4. THE Landing_Page SHALL render two Navigation_Cards: one linking to the Projects page (`#/projects`) with title and description, and one linking to the Templates page (`#/templates`) with title and description.
5. WHEN the user clicks a Navigation_Card, THE Landing_Page SHALL navigate the user to the corresponding section route.
6. WHEN the user presses Enter or Space while a Navigation_Card has keyboard focus, THE Landing_Page SHALL navigate the user to the corresponding section route.
7. THE Landing_Page SHALL use the same design tokens (colors, fonts, spacing, border-radius, shadows) defined in the existing CSS custom properties to maintain visual consistency with the rest of the Site.

### Requirement 2: Projects Route Relocation

**User Story:** As a user, I want to access the Projects listing at a dedicated route, so that the root route can serve as a landing page.

#### Acceptance Criteria

1. WHEN the user navigates to `#/projects`, THE Router SHALL render the Projects search view (previously at `#/`).
2. THE Site SHALL update all internal links, navigation hrefs, active-nav detection logic, and programmatic redirects (e.g., post-upload and post-delete redirects) that previously pointed to `#/` for the Projects listing to point to `#/projects`.
3. THE Router SHALL retain all existing project-related sub-routes (`#/project/:name`, `#/project/:name/edit`, `#/upload`) without changes.
4. WHEN the user navigates to `#/`, THE Router SHALL no longer render the Projects search view and SHALL instead render the Landing_Page.

### Requirement 3: Site-Wide PT-BR Localization

**User Story:** As a Brazilian user, I want all UI text to be in Portuguese-BR, so that I can use the application comfortably in my native language.

#### Acceptance Criteria

1. THE Localization_Module SHALL provide all user-facing static strings in PT-BR as a centralized source of truth.
2. THE Site SHALL render all header text, navigation links, page headings, button labels, input placeholders, status messages, error messages, and empty-state messages in PT-BR, excluding dynamic user-generated content such as project names, descriptions, tags, and README bodies.
3. THE Site SHALL set the HTML `lang` attribute to `pt-BR` on the root `<html>` element.
4. WHEN a new page or component needs display text, THE Localization_Module SHALL be the single source from which that text is retrieved.
5. THE Site SHALL translate the following header and navigation elements to PT-BR: site title, "Projects" link, "Templates" link, "Upload" link.
6. THE Site SHALL translate all search-related text to PT-BR: search input placeholders, loading messages, error messages, retry buttons, and empty-state messages.
7. THE Site SHALL translate all project-detail and template-detail page text to PT-BR: back links, download labels, date labels, section headings, and action buttons (Edit, Delete).
8. THE Site SHALL translate all upload and edit form text to PT-BR: form labels, submit buttons, status messages, validation errors, and drop-zone instructions.
9. THE Site SHALL translate delete confirmation dialog text to PT-BR: dialog title, warning message, input prompt, confirm button, and cancel button.
10. IF a localization key is missing from the Localization_Module, THEN THE Site SHALL render the key identifier as-is so that the missing translation is visually detectable during testing.

### Requirement 4: Navigation Active State Update

**User Story:** As a user, I want the navigation to correctly highlight the active section, so that I know where I am in the application.

#### Acceptance Criteria

1. WHEN the user is on the Landing_Page (`#/`), THE Site SHALL not apply the active CSS class to any navigation link.
2. WHEN the user navigates to the Projects page (`#/projects`) or any project sub-route (routes matching `#/project/*` including project detail and project edit), THE Site SHALL apply the active CSS class exclusively to the "Projetos" navigation link and remove it from all other navigation links.
3. WHEN the user navigates to the Templates page (`#/templates`) or any template sub-route (routes matching `#/template/*`), THE Site SHALL apply the active CSS class exclusively to the "Templates" navigation link and remove it from all other navigation links.
4. WHEN the user navigates to a route that does not belong to the Projects or Templates sections (such as `#/upload`), THE Site SHALL not apply the active CSS class to any navigation link.
5. IF the user navigates directly to a sub-route via URL (e.g., pasting `#/project/my-project` into the address bar), THEN THE Site SHALL apply the correct active class to the corresponding section's navigation link on initial page load.

### Requirement 5: Landing Page Responsiveness

**User Story:** As a user on a mobile device, I want the landing page to display correctly, so that I can navigate the application on any screen size.

#### Acceptance Criteria

1. WHILE the viewport width is at or below 640px, THE Landing_Page SHALL stack the Navigation_Cards in a single-column vertical layout.
2. WHILE the viewport width is above 640px, THE Landing_Page SHALL display the Navigation_Cards in a multi-column grid with at least 2 columns arranged horizontally.
3. WHILE the viewport width is at or below 640px, THE Landing_Page SHALL render all text at a minimum computed font size of 14px and all interactive elements (links, buttons, Navigation_Cards) with a minimum touch-target size of 44×44 CSS pixels.
4. WHILE the viewport width is at or below 640px, THE Landing_Page SHALL ensure that no content overflows horizontally beyond the viewport, and all Navigation_Cards occupy the full available width of the content container.
