# Requirements Document

## Introduction

This feature adds a GitHub-style file/code viewer to the project detail and template detail pages. Users can browse the file tree extracted from the artifact.zip and view individual file contents with syntax highlighting, all client-side. The approach leverages JSZip (already used for upload) to extract zip contents in the browser and highlight.js (already used for README rendering) for syntax coloring. No backend changes are required.

## Glossary

- **File_Browser**: The combined UI component consisting of the File_Tree and the Code_Viewer, displayed on detail pages to let users explore project or template files.
- **File_Tree**: A collapsible, hierarchical tree view representing the directory structure extracted from the artifact zip.
- **Code_Viewer**: The panel that displays the contents of a selected file with syntax highlighting, line numbers, and a copy action.
- **Artifact_Zip**: The `artifact.zip` file stored in S3 and served via CloudFront, containing all project or template files.
- **Language_Mapper**: The module that maps file extensions and special filenames to highlight.js language identifiers for syntax highlighting.
- **Detail_Page**: Either the project detail page or the template detail page where the File_Browser is rendered.
- **Zip_Extractor**: The client-side logic using JSZip to fetch, decompress, and parse the Artifact_Zip in the browser.

## Requirements

### Requirement 1: Lazy Zip Loading

**User Story:** As a user, I want the file browser to load the zip only when I choose to browse files, so that the detail page loads quickly without unnecessary downloads.

#### Acceptance Criteria

1. THE Detail_Page SHALL display a "Browse Files" action that initiates zip loading only when the user activates it.
2. WHEN the user activates the "Browse Files" action, THE Zip_Extractor SHALL fetch the Artifact_Zip from the CDN URL at `{cdnUrl}/{path}artifact.zip`.
3. WHILE the Artifact_Zip is being fetched and extracted, THE Detail_Page SHALL display a loading indicator with a text label such as "Loading files…".
4. WHEN the Artifact_Zip has been fetched and extracted, THE Detail_Page SHALL replace the loading indicator with the File_Browser.
5. IF the Artifact_Zip exceeds 10 MB in size (determined via Content-Length header or response size), THEN THE Detail_Page SHALL display a warning message indicating the file size and require explicit user confirmation before proceeding with the download.
6. IF the Artifact_Zip cannot be fetched (network error, 404, or non-zip response), THEN THE Detail_Page SHALL display an error message describing the failure and allow the user to retry.
7. IF the Artifact_Zip is corrupted or cannot be parsed by JSZip, THEN THE Detail_Page SHALL display an error message indicating the zip is invalid.

### Requirement 2: File Tree Component

**User Story:** As a user, I want to see a hierarchical file tree representing the project structure, so that I can navigate and understand how files are organized.

#### Acceptance Criteria

1. WHEN the Artifact_Zip has been extracted, THE File_Tree SHALL render a hierarchical tree view representing all directories and files from the zip.
2. THE File_Tree SHALL sort entries with directories listed before files, and items within each group sorted alphabetically in a case-insensitive manner.
3. THE File_Tree SHALL display a visual indicator (icon or symbol) distinguishing directories from files.
4. WHEN the user activates a directory node in the File_Tree, THE File_Tree SHALL toggle its expanded or collapsed state, showing or hiding its child entries.
5. WHEN the user activates a file node in the File_Tree, THE Code_Viewer SHALL display the contents of that file.
6. THE File_Tree SHALL highlight the currently selected file node to indicate which file is being viewed.
7. THE File_Tree SHALL be keyboard navigable using arrow keys for traversal, Enter or Space for activation, and maintain a visible focus indicator on the focused node.

### Requirement 3: Code Viewer with Syntax Highlighting

**User Story:** As a user, I want to view file contents with syntax highlighting and line numbers, so that I can read code comfortably without downloading the full archive.

#### Acceptance Criteria

1. WHEN a file is selected in the File_Tree, THE Code_Viewer SHALL display the file contents with syntax highlighting applied by highlight.js.
2. THE Code_Viewer SHALL display a breadcrumb path above the file content showing the full path of the currently viewed file within the zip.
3. THE Code_Viewer SHALL display line numbers alongside the file content, starting at 1.
4. THE Code_Viewer SHALL provide a "Copy" button that copies the raw file content (without line numbers or HTML markup) to the clipboard when activated.
5. WHEN the "Copy" button is activated, THE Code_Viewer SHALL provide visual feedback confirming the copy operation (e.g., button text changes to "Copied!" for 2 seconds).
6. THE Code_Viewer SHALL render file content with horizontal scrolling for lines that exceed the viewport width, preserving original line formatting without wrapping.
7. IF the selected file exceeds 500 KB in size, THEN THE Code_Viewer SHALL display the file content as plain text without syntax highlighting and SHALL show a notice indicating that highlighting was skipped for performance.

### Requirement 4: Language and Extension Mapping

**User Story:** As a user, I want files to be highlighted in the correct language based on their extension, so that syntax coloring is accurate and useful.

#### Acceptance Criteria

1. THE Language_Mapper SHALL map common file extensions to highlight.js language identifiers (e.g., `.ts` to `typescript`, `.py` to `python`, `.tf` to `hcl`, `.rs` to `rust`, `.go` to `go`, `.java` to `java`, `.json` to `json`, `.yaml`/`.yml` to `yaml`, `.md` to `markdown`, `.html` to `xml`, `.css` to `css`, `.sh` to `bash`).
2. THE Language_Mapper SHALL recognize special filenames without extensions and map them to the appropriate language (e.g., `Dockerfile` to `dockerfile`, `Makefile` to `makefile`, `.gitignore` to `bash`).
3. IF a file extension is not recognized by the Language_Mapper, THEN THE Code_Viewer SHALL use highlight.js auto-detection to determine the language.
4. IF highlight.js auto-detection returns a low-confidence result, THEN THE Code_Viewer SHALL render the content as plain text.

### Requirement 5: Binary File Handling

**User Story:** As a user, I want binary files clearly indicated and images previewed inline, so that I understand file types without confusion.

#### Acceptance Criteria

1. THE Language_Mapper SHALL maintain a list of binary file extensions (including but not limited to `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.pdf`, `.exe`, `.dll`, `.so`, `.dylib`, `.o`, `.class`, `.pyc`, `.zip`, `.tar`, `.gz`, `.jar`).
2. WHEN the user selects a binary file that is not a previewable image, THE Code_Viewer SHALL display a "Binary file — cannot preview" message instead of file content.
3. WHEN the user selects an image file (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`), THE Code_Viewer SHALL display an inline image preview rendered from the zip data using a blob URL or base64 data URI.
4. THE Code_Viewer SHALL display the image preview with a maximum width of 100% of the viewer area and preserve the image aspect ratio.

### Requirement 6: Integration with Detail Pages

**User Story:** As a user, I want to browse files on both project and template detail pages, so that I can explore any artifact in the repository.

#### Acceptance Criteria

1. THE project detail page SHALL include the File_Browser section below the existing download section.
2. THE template detail page SHALL include the File_Browser section below the existing download button.
3. THE File_Browser SHALL construct the artifact URL using the same CDN base URL and path pattern used by the existing download link on each Detail_Page.
4. WHILE the File_Browser is in its initial state (before the user activates "Browse Files"), THE Detail_Page SHALL display only the "Browse Files" action, consuming minimal vertical space.

### Requirement 7: Deep Linking to Files

**User Story:** As a user, I want to share a link that opens a specific file in the viewer, so that I can point colleagues directly to relevant code.

#### Acceptance Criteria

1. WHEN the user selects a file in the File_Tree, THE Detail_Page SHALL update the URL hash to include the file path (e.g., `#/project/{name}/file/{filePath}` or `#/template/{name}/file/{filePath}`).
2. WHEN the Detail_Page loads with a file path in the URL hash, THE File_Browser SHALL automatically fetch the Artifact_Zip, expand the File_Tree to reveal the target file, select it, and display its contents in the Code_Viewer.
3. IF the file path specified in the URL hash does not exist in the extracted zip, THEN THE File_Browser SHALL display the File_Tree with no file selected and show a notice indicating that the linked file was not found.

### Requirement 8: Responsive Layout

**User Story:** As a user, I want the file browser to work well on all screen sizes, so that I can browse code on mobile and desktop.

#### Acceptance Criteria

1. WHILE the viewport width is 768 px or wider, THE File_Browser SHALL display the File_Tree and Code_Viewer side by side.
2. WHILE the viewport width is below 768 px, THE File_Browser SHALL stack the File_Tree above the Code_Viewer, with the File_Tree collapsible via a toggle button.
3. THE Code_Viewer SHALL allow horizontal scrolling for lines that exceed the available width on all viewport sizes.
4. THE File_Tree SHALL constrain its maximum height and provide vertical scrolling when the tree content exceeds the available space.

