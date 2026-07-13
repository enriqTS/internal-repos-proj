# Requirements Document

## Introduction

This feature adds a dedicated project templates section to the internal repository application. Templates represent generic, reusable code and Terraform configurations for commonly requested project types within the company. The feature includes a new templates page with search and tag filtering, a dedicated S3 bucket for template artifacts, and a UI overhaul that replaces the current list-based project/template display with a paginated card grid layout. Template upload functionality is explicitly out of scope — this spec covers only the structural outline and infrastructure.

## Glossary

- **Template**: A reusable code or Terraform configuration package stored in S3, represented by metadata (name, description, tags, date) similar to a project but served from a separate bucket and index.
- **Template_Index**: A JSON manifest (`templates-index.json`) listing all available templates with their metadata, analogous to `global-index.json` for projects.
- **Template_Bucket**: A dedicated S3 bucket for storing template artifacts and metadata, separate from the existing frontend/project bucket.
- **Card_Grid**: A responsive grid layout displaying projects or templates as individual cards, replacing the previous vertical list of result items.
- **Card**: A single visual unit in the Card_Grid displaying a template or project's name, description, tags, and date.
- **Templates_Page**: A dedicated frontend route (`#/templates`) for browsing and searching templates.
- **Search_Module**: The frontend component responsible for fuzzy-matching queries against index entries using Fuse.js.
- **Tag_Filter**: The dropdown component that filters results by selected tags using AND logic.
- **Paginator**: The navigation component that slices results into pages and provides page controls.
- **Router**: The client-side hash-based routing system that maps URL fragments to view handlers.

## Requirements

### Requirement 1: Template S3 Bucket

**User Story:** As a platform engineer, I want a dedicated S3 bucket for template artifacts, so that templates are stored separately from project data with appropriate access controls.

#### Acceptance Criteria

1. THE Template_Bucket SHALL be provisioned as a private S3 bucket with all four public access block settings enabled: block_public_acls, block_public_policy, ignore_public_acls, and restrict_public_buckets.
2. THE Template_Bucket SHALL use the naming convention `{bucket_name_prefix}-templates`.
3. THE Template_Bucket SHALL have a bucket policy that grants the `s3:GetObject` action on all objects (`/*`) to the `cloudfront.amazonaws.com` service principal, conditioned on the existing CloudFront_Distribution ARN via `AWS:SourceArn`, using Origin Access Control.
4. THE Template_Bucket SHALL be tagged with `Project = "internal-repos"` and `Name = "internal-repos-templates"`.
5. THE CloudFront_Distribution SHALL include an origin pointing to the Template_Bucket regional domain name, configured with an Origin Access Control resource of type S3 with signing behavior set to always and signing protocol sigv4.

### Requirement 2: CloudFront Template Origin

**User Story:** As a frontend developer, I want templates served through the existing CloudFront distribution, so that template data is accessible from the same domain as the rest of the application.

#### Acceptance Criteria

1. THE CloudFront distribution SHALL include a second origin pointing to the Template_Bucket, configured with an Origin Access Control that grants the distribution read access to the bucket.
2. THE CloudFront distribution SHALL route requests matching the path pattern `templates/*` to the Template_Bucket origin.
3. THE CloudFront distribution SHALL serve `templates-index.json` from the Template_Bucket origin with a TTL of 0 (min_ttl, default_ttl, and max_ttl all set to 0) to ensure freshness after template mutations.
4. THE CloudFront distribution SHALL serve `templates/*/metadata.json` with a TTL of 0 (min_ttl, default_ttl, and max_ttl all set to 0) to ensure freshness.
5. IF a request to a `templates/*` path results in a 403 or 404 from the Template_Bucket, THEN THE CloudFront distribution SHALL return the original error status code to the client without redirecting to the SPA index page.

### Requirement 3: Template Data Model

**User Story:** As a developer, I want a well-defined data model for templates, so that the frontend and backend share a consistent contract.

#### Acceptance Criteria

1. THE shared types module SHALL define a `TemplateIndexEntry` interface containing fields: `name` (string, 1–64 characters, matching pattern `^[a-zA-Z0-9_-]+$`), `description` (string, 0–200 characters), `tags` (string array, 0–50 items, each tag 1–32 characters matching `^[a-z0-9_-]+$`), `date` (string in ISO 8601 date format "YYYY-MM-DD"), and `path` (string with prefix `templates/{name}/`).
2. THE shared types module SHALL define a `TemplateIndex` type as an array of `TemplateIndexEntry`.
3. THE shared types module SHALL define a `TemplateMetadata` interface containing the same `name`, `description`, `tags`, and `date` fields as `TemplateIndexEntry`, plus an optional `language` field (string, 0–64 characters, representing the primary programming language or framework name).
4. THE shared types module SHALL export all three type definitions (`TemplateIndexEntry`, `TemplateIndex`, `TemplateMetadata`) so that both frontend and backend packages can import them from the shared module.

### Requirement 4: Templates Page and Routing

**User Story:** As an employee, I want a dedicated templates page accessible from the navigation, so that I can browse available project templates separately from completed projects.

#### Acceptance Criteria

1. THE Router SHALL register a new route with the pattern `#/templates` that renders the Templates_Page.
2. WHEN the `#/templates` route is matched, THE Router SHALL clear the app container and invoke the Templates_Page handler.
3. THE Templates_Page SHALL display a heading with the text "Project Templates".
4. THE Templates_Page SHALL include a search input with placeholder text "Search templates by name, description, or tags…" and an accessible label identifying its purpose.
5. THE Templates_Page SHALL include a Tag_Filter component populated with all unique tags extracted from the Template_Index entries.
6. THE Templates_Page SHALL include a Paginator component that displays at most 10 template results per page and hides navigation controls when the total number of results is 10 or fewer.
7. WHEN no templates exist in the Template_Index, THE Templates_Page SHALL display the message "No templates available yet" and SHALL hide the search input, Tag_Filter, and Paginator components.
8. IF the Template_Index fails to load, THEN THE Templates_Page SHALL display an error message indicating the failure and a retry button that re-attempts the fetch.
9. THE navigation header SHALL include a link labeled "Templates" with its href set to `#/templates`.

### Requirement 5: Template Search and Filtering

**User Story:** As an employee, I want to search and filter templates by name, description, and tags, so that I can quickly find the template relevant to my needs.

#### Acceptance Criteria

1. WHEN the Templates_Page loads, THE Search_Module SHALL initialize a separate Fuse.js instance for the Template_Index with name, description, and tags as searchable fields and a fuzzy match threshold of 0.4.
2. WHEN a user types a query into the template search input, THE Search_Module SHALL debounce the input by 200ms and then perform fuzzy matching against template name, description, and tags fields, returning results ranked by relevance score.
3. WHEN tag filters are active on the Templates_Page, THE Tag_Filter SHALL apply AND-logic filtering to template results, displaying only templates whose tags include all selected filter tags.
4. WHEN the search query is empty on the Templates_Page, THE Templates_Page SHALL display all templates sorted by date descending.
5. WHEN no templates match the search query or active tag filters, THE Templates_Page SHALL display a message indicating no results were found.
6. IF the Template_Index fails to load during Templates_Page initialization, THEN THE Templates_Page SHALL display an error message indicating that templates could not be loaded and SHALL provide a retry option.

### Requirement 6: Template Index Fetching

**User Story:** As a frontend developer, I want an API function to fetch the template index, so that the templates page can load and display template data.

#### Acceptance Criteria

1. THE API module SHALL expose a `fetchTemplateIndex` function that fetches `templates-index.json` from the CDN base URL, returning an `ApiResult<TemplateIndex>`.
2. WHEN the fetch response has an HTTP 2xx status and a JSON content-type, THE `fetchTemplateIndex` function SHALL parse the response body and return `{ ok: true, data: TemplateIndex }`.
3. WHEN `templates-index.json` does not exist (CloudFront returns HTML instead of JSON, detected by non-JSON content-type and response text not starting with `[`), THE `fetchTemplateIndex` function SHALL return `{ ok: true, data: [] }`.
4. WHEN the fetch response has a non-2xx HTTP status, THE `fetchTemplateIndex` function SHALL return `{ ok: false, error: "Failed to load template index (HTTP {status})" }`.
5. IF the fetch fails with a network error, THEN THE `fetchTemplateIndex` function SHALL return `{ ok: false, error: "Failed to load template index: {error.message}" }`.

### Requirement 7: Card Grid Layout for Projects

**User Story:** As an employee, I want projects displayed as a grid of cards instead of a list, so that I can scan and compare projects more efficiently without excessive scrolling.

#### Acceptance Criteria

1. THE search results view SHALL render project results as a Card_Grid with responsive columns: 1 column when viewport width is below 640px, 2 columns when viewport width is between 640px and 1023px, and 3 columns when viewport width is 1024px or above.
2. EACH Card in the Card_Grid SHALL display the project name, description (truncated to 2 lines with a CSS line-clamp and trailing ellipsis for overflow), tags, and relative date.
3. EACH Card SHALL be focusable via the Tab key, include a `role="link"` attribute, and include an `aria-label` identifying the project name.
4. WHEN a Card is clicked or activated via Enter or Space key, THE Router SHALL navigate to the project detail view for that project.
5. THE Card_Grid SHALL replace the existing `results-list` unordered list layout on the projects search page.
6. IF the search returns zero results while in Card_Grid layout, THEN THE search results view SHALL display a "No results found" message in place of the Card_Grid.

### Requirement 8: Card Grid Layout for Templates

**User Story:** As an employee, I want templates displayed as a grid of cards, so that the browsing experience is consistent between projects and templates.

#### Acceptance Criteria

1. THE Templates_Page SHALL render template results as a Card_Grid with responsive columns: 1 column when viewport width is below 768px, 2 columns when viewport width is 768px to 1023px, and 3 columns when viewport width is 1024px or greater.
2. EACH Card in the template Card_Grid SHALL display the template name, description (truncated to 2 visible lines via CSS line-clamp), tags, and upload date formatted as a Relative_Date consistent with the Search_Page Result_Card format.
3. EACH Card SHALL be focusable via keyboard Tab navigation (tabindex="0"), include an `aria-label` in the format "View template {name}", and display a visible focus indicator with a minimum contrast ratio of 3:1 against adjacent colors.
4. WHEN a template Card is clicked or activated via Enter or Space key press, THE Router SHALL navigate to the template detail route (`#/template/{name}`) within 500 milliseconds.
5. IF the Templates_Page receives zero template results, THEN THE Templates_Page SHALL display a message indicating no templates are available in place of the Card_Grid.

### Requirement 9: Template Detail Page

**User Story:** As an employee, I want to view template details including its description and metadata, so that I can understand what the template provides before using it.

#### Acceptance Criteria

1. THE Router SHALL register a route with the pattern `#/template/{name}` that renders a template detail view, where `{name}` is a URL-encoded template identifier extracted as a named route parameter.
2. IF the `name` route parameter is empty or missing, THEN THE template detail view SHALL display an error message indicating no template was specified.
3. THE template detail view SHALL display the template name, description, tags, and date. IF the language field is present in the template metadata, THEN THE template detail view SHALL also display the language value.
4. WHEN the template metadata cannot be loaded, THE template detail view SHALL display an error message indicating that template details are unavailable, along with a back-navigation link to `#/templates`.
5. THE template detail view SHALL include a back-navigation link that navigates to the `#/templates` route.

### Requirement 10: Navigation Structure Update

**User Story:** As an employee, I want clear navigation between projects and templates, so that I can easily switch between browsing projects and browsing templates.

#### Acceptance Criteria

1. THE navigation header SHALL display a "Projects" link (pointing to `#/`) and a "Templates" link (pointing to `#/templates`), replacing the existing "Search" link with the "Projects" link while retaining the same `#/` destination.
2. WHEN the current route matches `#/` or any route under `#/project/`, THE navigation SHALL apply a distinguishing style (such as a different text color or an active CSS class) to the "Projects" link. WHEN the current route matches `#/templates` or any route under `#/templates/`, THE navigation SHALL apply that same distinguishing style to the "Templates" link instead.
3. THE existing "Upload" navigation link SHALL remain visible in the navigation header, retain its `#/upload` destination, and continue to be keyboard-focusable.
4. WHEN the user navigates to a new route by clicking a navigation link or by changing the URL hash, THE navigation active indicator SHALL update within 1 second to reflect the new active section without requiring a full page reload.
