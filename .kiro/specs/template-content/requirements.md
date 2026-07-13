# Requirements Document

## Introduction

This feature defines the content model, display behavior, and download mechanism for project templates in the internal repository application. Building on the existing template infrastructure (S3 bucket, CloudFront routing, templates page with search/filter/pagination), this spec covers what each template actually contains and how users interact with that content. Each template packages application code together with its deployment Terraform, uses environment variables via tfvars for dynamic values, displays an architecture diagram and markdown description, and provides a single-click zip download. Templates share the same tag taxonomy as projects. Template creation is out of scope for the frontend — content is managed externally and uploaded directly to S3.

## Glossary

- **Template_Content**: The complete set of files that compose a template — application code, Terraform infrastructure code, and supporting files (README, architecture diagram, metadata).
- **Template_Artifact**: A zip archive stored in S3 at `templates/{name}/artifact.zip` containing the full downloadable project scaffold including application code and Terraform configuration.
- **Architecture_Diagram**: A draw.io-exported image (PNG or SVG) stored at `templates/{name}/architecture.{ext}` that visually represents the infrastructure and services the template deploys.
- **Template_Description**: A markdown file stored at `templates/{name}/readme.md` that explains what the template deploys, how to configure it, and how to use it.
- **Template_Detail_Page**: The frontend view at `#/template/{name}` that renders the architecture diagram, description, metadata, and download button for a single template.
- **Template_Folder**: The S3 prefix `templates/{name}/` in the templates bucket that contains all files for a single template (metadata.json, readme.md, architecture image, and artifact.zip).
- **Tfvars_File**: A Terraform variable definitions file (`.tfvars`) within a template that holds environment-specific values (resource names, regions, account IDs) as variables rather than hardcoded strings.
- **Tag_Registry**: The shared `tags.json` file listing all available tags, used by both projects and templates for consistent categorization.
- **Template_Index**: The `templates-index.json` manifest listing all templates with their metadata, served from the templates S3 bucket.
- **Download_URL**: The CloudFront URL pointing to `templates/{name}/artifact.zip` that the frontend uses to initiate a browser download.

## Requirements

### Requirement 1: Template Folder Structure

**User Story:** As a platform engineer, I want a consistent folder structure for each template in S3, so that the frontend can reliably locate and display template content.

#### Acceptance Criteria

1. THE Template_Folder SHALL use the S3 key prefix `templates/{name}/` where `{name}` matches the template's name field from the TemplateIndexEntry interface (1–64 characters, pattern `/^[a-zA-Z0-9_-]+$/`).
2. THE Template_Folder SHALL contain a `metadata.json` file that is valid JSON conforming to the TemplateMetadata interface with required fields: name (1–64 chars, `/^[a-zA-Z0-9_-]+$/`), description (0–200 chars), tags (0–50 items, each 1–32 chars matching `/^[a-z0-9_-]+$/`), date (ISO 8601 "YYYY-MM-DD"), and optional language (0–64 chars).
3. THE Template_Folder SHALL contain a `readme.md` file with a markdown description of the template's purpose, deployed services, configuration instructions, and usage guidance, not exceeding 50,000 characters in length.
4. THE Template_Folder SHALL contain exactly one architecture image file named either `architecture.png` or `architecture.svg`, not exceeding 5 MB in size.
5. THE Template_Folder SHALL contain an `artifact.zip` file that is a valid zip archive of the complete template project including application code and Terraform configuration, not exceeding 100 MB in size.
6. IF the Template_Folder is missing any of the required files (`metadata.json`, `readme.md`, `architecture.png` or `architecture.svg`, `artifact.zip`), THEN THE System SHALL treat the template as invalid and exclude it from the TemplateIndex.

### Requirement 2: Template Artifact Content

**User Story:** As a developer downloading a template, I want the zip to contain both application code and Terraform infrastructure, so that I have everything needed to deploy the project from a single download.

#### Acceptance Criteria

1. THE Template_Artifact SHALL contain a root-level directory structure with at minimum an application code directory and an `infra/` directory containing Terraform configuration files (`.tf` extension).
2. THE Template_Artifact SHALL include Terraform files that define the infrastructure required to deploy the application code contained in the same artifact, with at minimum a `main.tf` and `variables.tf` in the `infra/` directory.
3. THE Template_Artifact SHALL use Terraform variables for all resource names, regions, account identifiers, and other deployment-specific values, with default values sourced from `.tfvars` files in the `infra/` directory.
4. THE Template_Artifact SHALL include a `terraform.tfvars.example` file in the `infra/` directory documenting all required variables with placeholder values and comments explaining each variable's purpose.
5. THE Template_Artifact SHALL include a top-level `README.md` file explaining the template's purpose, prerequisites, configuration steps, and deployment instructions.

### Requirement 3: Template Description Display

**User Story:** As an employee browsing templates, I want to read a detailed description of what a template does before downloading it, so that I can evaluate whether it fits my needs.

#### Acceptance Criteria

1. WHEN the Template_Detail_Page loads, THE Template_Detail_Page SHALL fetch the template's `readme.md` file from `templates/{name}/readme.md` via the CDN base URL.
2. WHEN the readme.md is successfully fetched, THE Template_Detail_Page SHALL render the markdown content as HTML using the same markdown rendering library (marked) and syntax highlighting (highlight.js) already used for project README display.
3. IF the readme.md fetch fails with a network error or non-2xx HTTP status, THEN THE Template_Detail_Page SHALL display a fallback message "Template documentation is unavailable" in place of the rendered markdown.
4. THE rendered markdown content SHALL be displayed within a container with the CSS class `readme-content`, applying the same styles used for project README rendering, ensuring consistent typography and code block formatting.

### Requirement 4: Architecture Diagram Display

**User Story:** As an employee evaluating a template, I want to see a visual architecture diagram, so that I can understand the infrastructure and services the template deploys at a glance.

#### Acceptance Criteria

1. WHEN the Template_Detail_Page loads, THE Template_Detail_Page SHALL attempt to fetch the architecture image by first trying `templates/{name}/architecture.png` and then `templates/{name}/architecture.svg` if the PNG request returns a non-2xx status or a network error occurs.
2. WHEN the architecture image is successfully located, THE Template_Detail_Page SHALL render the image within the detail view above the description section, constrained to a maximum width of 100% of the content area and with an alt attribute of "Architecture diagram for {name}".
3. IF both architecture image fetches fail (both PNG and SVG return non-2xx status or produce network errors), THEN THE Template_Detail_Page SHALL omit the architecture image section entirely without displaying an error message or placeholder.
4. WHEN the architecture image is rendered, THE Template_Detail_Page SHALL wrap it in an anchor element that opens the full-resolution image URL in a new browser tab, with a descriptive accessible label of "View full-size architecture diagram for {name}" and keyboard-activatable via standard link behavior.
5. IF the architecture image element fires a load error after the source URL is set (e.g., corrupted or unreachable content despite an initial 2xx response), THEN THE Template_Detail_Page SHALL remove the architecture image section without displaying an error message.

### Requirement 5: Template Download

**User Story:** As a developer, I want a download button on the template detail page, so that I can obtain the complete template artifact as a single zip file.

#### Acceptance Criteria

1. WHEN template metadata loads successfully, THE Template_Detail_Page SHALL display a download button with the label "Download Template" positioned below the template metadata section and above the description content.
2. WHEN the download button is activated, THE Template_Detail_Page SHALL initiate a browser download of the file at `templates/{name}/artifact.zip` served through the CDN base URL.
3. THE download button SHALL use an HTML anchor element with the `download` attribute set to `{name}.zip` and the `href` attribute pointing to the CDN URL for `templates/{name}/artifact.zip`.
4. THE download button SHALL be keyboard-accessible (focusable via Tab, activatable via Enter or Space) and include an aria-label of "Download {name} template zip archive".
5. IF template metadata fails to load, THEN THE Template_Detail_Page SHALL NOT render the download button.

### Requirement 6: Template Tag Integration

**User Story:** As an employee, I want templates to use the same tag system as projects, so that I can discover templates using familiar tag-based filtering.

#### Acceptance Criteria

1. THE Template_Index entries SHALL store tags that belong to the shared Tag_Registry (`tags.json`), ensuring that any tag assigned to a template is also present in the Tag_Registry.
2. WHEN the Templates_Page loads successfully, THE Tag_Filter component SHALL be populated with all unique tags present across Template_Index entries sorted alphabetically, drawing from the shared tag namespace.
3. WHEN a user selects one or more tags in the Tag_Filter on the Templates_Page, THE Tag_Filter SHALL apply AND-logic filtering, displaying only templates whose `tags` array contains every selected filter tag.
4. IF the user's tag selection results in zero matching templates, THEN THE Templates_Page SHALL display a "no results" message indicating that no templates match the current filter criteria.
5. THE template metadata.json `tags` field SHALL conform to the same validation rules as project tags: a maximum of 50 tags, each 1–32 lowercase characters matching the pattern `^[a-z0-9_-]+$`.
6. WHEN a new template is uploaded with tags, THE System SHALL add any previously unregistered tags to the shared Tag_Registry (`tags.json`) so that future filtering includes those tags.

### Requirement 7: Template Metadata Extension

**User Story:** As a platform engineer, I want template metadata to include an architecture image reference, so that the frontend knows which image format to display without trial-and-error fetching.

#### Acceptance Criteria

1. THE TemplateMetadata interface SHALL include an optional `architectureImage` field of type string that accepts only the values `architecture.png` or `architecture.svg`.
2. WHEN the `architectureImage` field is present in the template metadata, THE Template_Detail_Page SHALL construct the image URL using the template's base path and the specified filename, and render the architecture image without attempting other formats.
3. WHEN the `architectureImage` field is absent from the template metadata, THE Template_Detail_Page SHALL fall back to the sequential fetch strategy (try PNG first, then SVG).
4. THE TemplateIndexEntry interface SHALL include an optional `architectureImage` field accepting the same values (`architecture.png` or `architecture.svg`) as the TemplateMetadata field.
5. IF the `architectureImage` field is present but the image fetch fails (non-2xx response), THEN THE Template_Detail_Page SHALL hide the architecture image section rather than displaying a broken image.
6. IF the `architectureImage` field contains a value other than `architecture.png` or `architecture.svg`, THEN THE system SHALL treat it as absent and fall back to the sequential fetch strategy.

### Requirement 8: Template Detail Page Layout

**User Story:** As an employee, I want the template detail page to present information in a logical order, so that I can quickly understand and access the template content.

#### Acceptance Criteria

1. THE Template_Detail_Page SHALL render content in the following order from top to bottom: back-navigation link (linking to `#/templates`), template name heading rendered as an `h1` element, metadata section (tags, date, language), download button, architecture diagram, and rendered readme description.
2. THE metadata section SHALL display tags as span elements with the CSS class `tag`, matching the same element type and class name used for tag display on project detail pages and card grid cards.
3. THE metadata section SHALL display the template date as a relative date (e.g., "3 months ago") using the `formatRelativeDate` function, and SHALL set the `datetime` attribute on the time element to the original ISO 8601 date string.
4. IF the template metadata includes a language field with a non-empty value, THEN THE metadata section SHALL display the language value as a labeled text element in the format "Language: {value}".
5. IF the template metadata does not include a language field or the field is empty, THEN THE metadata section SHALL omit the language element entirely without rendering a placeholder or empty label.

### Requirement 9: Template Content Management Boundary

**User Story:** As a platform engineer, I want clear boundaries around template content management, so that the team understands where templates are created and maintained.

#### Acceptance Criteria

1. THE frontend application SHALL NOT provide any user interface for creating, editing, or deleting templates.
2. THE Template_Detail_Page SHALL display template content in read-only mode, showing metadata (name, description, tags, date, and optional language), an architecture diagram image if present in the template's S3 prefix, and a download link to the template archive file, with no controls that mutate template data.
3. THE templates S3 bucket SHALL be populated through external processes (CI/CD pipeline, manual upload, or administrative tooling) outside the scope of this application's frontend and API.
4. WHEN a template is added, updated, or removed in S3 through external processes, THE templates-index.json manifest SHALL be regenerated to contain one entry per template currently present in the bucket, with no stale entries for removed templates.
5. IF the templates-index.json manifest does not exist or is not valid JSON, THEN THE frontend application SHALL treat the template catalog as empty and display a message indicating no templates are available.
