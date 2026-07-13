# Requirements Document

## Introduction

A comprehensive UX overhaul of the Internal Repos frontend application. This feature set addresses usability issues on the search/home page, upload page, and project detail page. The application is a static S3-deployed site using vanilla TypeScript with Vite, performing imperative DOM manipulation without a framework.

## Glossary

- **Search_Page**: The home page of the application (route `#/`) that displays a search input, tag filters, and a list of project results.
- **Paginator**: A UI component that divides a list of results into discrete pages with navigation controls (previous, next, page numbers).
- **Upload_Page**: The page at route `#/upload` containing the form for uploading a new project (name, tags, readme, files).
- **Drop_Zone**: A styled, interactive region on the upload page that accepts files via drag-and-drop or click-to-browse, replacing the native file input.
- **Readme_Preview**: A rendered HTML view of markdown content using the existing `marked` and `highlight.js` libraries, with a toggle to switch to an editable textarea.
- **Tag_Filter_Dropdown**: A collapsible dropdown component on the search page that contains scrollable tag checkboxes, hidden by default to reduce clutter.
- **Project_Detail_Page**: The page at route `#/project/:name` displaying metadata, readme, and download link for a single project.
- **Result_Card**: A single list item in the search results representing one project, displaying name, description, tags, and upload date.
- **Relative_Date**: A human-readable time string indicating how long ago a date occurred (e.g., "3 days ago", "2 weeks ago").

## Requirements

### Requirement 1: Paginated Project List

**User Story:** As a user browsing projects, I want the search results displayed in pages of 10 items, so that I can navigate results without overwhelming scrolling.

#### Acceptance Criteria

1. THE Paginator SHALL display a maximum of 10 Result_Card items per page.
2. IF the total number of search results exceeds 10, THEN THE Paginator SHALL render navigation controls including previous-page button, next-page button, and up to 7 numbered page buttons.
3. IF the total number of search results is 10 or fewer, THEN THE Paginator SHALL hide all navigation controls.
4. WHEN the user clicks a numbered page button, THE Search_Page SHALL display the corresponding page of results.
5. WHEN the user clicks the next-page button, THE Paginator SHALL advance to the next page of results.
6. WHEN the user clicks the previous-page button, THE Paginator SHALL return to the preceding page of results.
7. WHILE the user is on the first page, THE Paginator SHALL disable the previous-page button.
8. WHILE the user is on the last page, THE Paginator SHALL disable the next-page button.
9. WHEN the search query or tag filter selection changes, THE Paginator SHALL reset to page 1.
10. THE Paginator SHALL display the current page number and total page count as text (e.g., "Page 2 of 5").
11. WHEN the user navigates to a page, THE Search_Page SHALL scroll to the top of the results container.

### Requirement 2: Prominent File Upload with Drag-and-Drop

**User Story:** As a user uploading a project, I want a prominent, styled file upload area at the top of the form, so that I can easily find and interact with the file selection.

#### Acceptance Criteria

1. THE Upload_Page SHALL render the Drop_Zone as the first interactive element in the upload form, positioned above all other form fields.
2. THE Drop_Zone SHALL accept folder selection via click interaction, triggering the native directory picker (webkitdirectory).
3. WHEN a user drags files over the Drop_Zone, THE Drop_Zone SHALL display a visual hover state indicating the area is a valid drop target, and WHEN the dragged files leave the Drop_Zone without being dropped, THE Drop_Zone SHALL revert to its default visual state within 150 milliseconds.
4. WHEN a user drops a folder onto the Drop_Zone, THE Upload_Page SHALL process the dropped files identically to files selected via the click interaction.
5. WHEN files have been selected or dropped, THE Drop_Zone SHALL replace any previously displayed file information and display a confirmation summary showing the total number of files selected.
6. THE Drop_Zone SHALL display instructional text (e.g., "Drag & drop a project folder here, or click to browse") when no files are selected.
7. IF the browser does not support the drag-and-drop API, THEN THE Upload_Page SHALL fall back to a styled click-to-browse button that triggers the directory picker.
8. THE Upload_Page SHALL position the "Upload Project" submit button in the top section of the form, immediately after the Drop_Zone and project name field, so that the primary actions (file selection and submission) are visible without scrolling past the readme content area.

### Requirement 3: Markdown Preview with Edit Toggle

**User Story:** As a user writing a project README during upload, I want to preview the rendered markdown before submitting, so that I can verify formatting without leaving the page.

#### Acceptance Criteria

1. THE Readme_Preview SHALL render the content of the readme textarea as sanitized HTML using the existing `marked` and `highlight.js` libraries, with embedded HTML tags escaped to prevent script execution.
2. THE Upload_Page SHALL display a toggle control with two modes: "Preview" and "Edit", where the toggle is keyboard-operable and each mode is indicated with an accessible label.
3. WHILE the toggle is set to "Preview" mode, THE Upload_Page SHALL display the Readme_Preview and hide the editable textarea.
4. WHILE the toggle is set to "Edit" mode, THE Upload_Page SHALL display the editable textarea and hide the Readme_Preview.
5. THE Upload_Page SHALL default to "Edit" mode when initially rendered.
6. WHEN the user switches to "Preview" mode and the readme field contains content, THE Readme_Preview SHALL re-render the current textarea content as sanitized HTML.
7. WHEN the user switches to "Preview" mode and the readme field is empty, THE Readme_Preview SHALL display a placeholder message indicating no content to preview.
8. WHEN the user switches from "Preview" mode back to "Edit" mode, THE Upload_Page SHALL display the textarea with all previously entered content preserved unchanged.
9. WHEN the user submits the upload form while in "Preview" mode, THE Upload_Page SHALL submit the current textarea content as the readme value.

### Requirement 4: Collapsible Tag Filter Dropdown

**User Story:** As a user searching for projects, I want the tag filters hidden by default behind a toggle, so that the search page is less visually cluttered.

#### Acceptance Criteria

1. THE Search_Page SHALL render a toggle button labeled "Filter by tags" in place of the flat tag button list.
2. WHILE the Tag_Filter_Dropdown is collapsed (default state), THE Search_Page SHALL hide all tag filter options.
3. WHEN the user clicks the "Filter by tags" toggle button, THE Tag_Filter_Dropdown SHALL expand to reveal a scrollable list of tag checkboxes.
4. WHEN the user clicks the toggle button while the dropdown is expanded, THE Tag_Filter_Dropdown SHALL collapse and hide the tag checkboxes.
5. THE Tag_Filter_Dropdown SHALL set a maximum visible height of 300px with vertical scrolling for overflow when the tag list exceeds the visible area.
6. WHEN the user checks or unchecks a tag checkbox, THE Search_Page SHALL apply AND-logic filtering to the search results within 300 milliseconds.
7. WHILE one or more tags are actively selected, THE toggle button SHALL display a numeric count indicating the number of active filters (e.g., "Filter by tags (3)").
8. WHILE one or more tag checkboxes have focus or a check/uncheck action is in progress inside the dropdown, THE Tag_Filter_Dropdown SHALL remain expanded.
9. WHEN the user activates the toggle button via keyboard (Enter or Space key), THE Tag_Filter_Dropdown SHALL toggle between expanded and collapsed states identical to click behavior.
10. WHEN the Tag_Filter_Dropdown collapses, THE Search_Page SHALL preserve all previously selected tag filters and continue applying them to the search results.

### Requirement 5: Back Navigation from Project Detail

**User Story:** As a user viewing a project's detail page, I want a visible navigation link back to the search results, so that I can return without relying on the browser back button.

#### Acceptance Criteria

1. THE Project_Detail_Page SHALL render a "← Back to search" anchor element (`<a>`) with its `href` set to `#/` as the first child of the project detail content area, positioned before the project metadata section.
2. WHEN the user clicks the "← Back to search" link, THE application SHALL navigate to the Search_Page (route `#/`).
3. THE "← Back to search" link SHALL be the first focusable element within the project detail content area, preceding the project metadata and any action buttons in tab order.
4. IF the project metadata fails to load, THEN THE Project_Detail_Page SHALL still render the "← Back to search" link above the error message, allowing the user to navigate back to the Search_Page.

### Requirement 6: Relative Date on Result Cards

**User Story:** As a user browsing search results, I want to see when projects were uploaded in relative terms, so that I can quickly assess how recent a project is.

#### Acceptance Criteria

1. THE Result_Card SHALL display the project upload date as a Relative_Date string using the following thresholds based on the user's local date: "today" for 0 days ago, "yesterday" for 1 day ago, "N days ago" for 2–6 days, "1 week ago" for 7–13 days, "N weeks ago" for 14–29 days, "1 month ago" for 30–59 days, "N months ago" for 60–364 days, and "1 year ago" or "N years ago" for 365 days or more.
2. THE Result_Card SHALL include the project upload date in "YYYY-MM-DD" format in a `title` attribute on the date element for tooltip display on hover.
3. WHEN the upload date is today according to the user's local timezone, THE Result_Card SHALL display "today" as the Relative_Date.
4. WHEN the upload date is yesterday according to the user's local timezone, THE Result_Card SHALL display "yesterday" as the Relative_Date.
5. IF the project upload date is in the future relative to the user's local date or is not a valid date string, THEN THE Result_Card SHALL display the raw date value from Metadata without relative conversion.

### Requirement 7: Keyboard Navigation on Result Cards

**User Story:** As a keyboard user, I want to navigate and activate project result cards using the keyboard, so that the search results are accessible without a mouse.

#### Acceptance Criteria

1. THE Result_Card SHALL be focusable via keyboard tab navigation (tabindex="0").
2. THE Result_Card SHALL have an ARIA role of "link" and an accessible name derived from the project name, to communicate its interactive nature and destination to assistive technologies.
3. WHEN the user presses Enter or Space on a focused Result_Card, THE Search_Page SHALL navigate to the corresponding Project_Detail_Page within 500 milliseconds of the key press.
4. THE Result_Card SHALL display a visible focus indicator that meets a minimum contrast ratio of 3:1 against adjacent colors when focused via keyboard.
5. THE Search_Page SHALL maintain a tab order through all interactive elements in the following sequence: search input, tag filter toggle, result cards (in DOM order), pagination controls.
6. IF the user presses Enter or Space on a focused Result_Card and navigation to the Project_Detail_Page fails, THEN THE Search_Page SHALL display an error message indicating the project could not be loaded, and the user's focus SHALL remain on the Result_Card.
