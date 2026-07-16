# Requirements Document

## Introduction

This feature adds a GitHub-style file/code viewer to the project detail and template detail pages. Users can browse the file tree and view individual file contents with syntax highlighting. The approach uses a pre-exploded files architecture: at upload time, the Lambda explodes zip contents into individual S3 objects and generates a `file-tree.json` manifest; at browse time, the frontend fetches only the lightweight manifest for tree rendering and loads individual files on demand. For templates, file expansion happens at CI/CD deploy time. The existing `artifact.zip` is preserved for the download button. highlight.js (already used for README rendering) provides syntax coloring. No client-side zip extraction is needed.

## Glossary

- **File_Browser**: The combined UI component consisting of the File_Tree and the Code_Viewer, displayed on detail pages to let users explore project or template files.
- **File_Tree**: A collapsible, hierarchical tree view representing the directory structure derived from the file-tree.json manifest.
- **Code_Viewer**: The panel that displays the contents of a selected file with syntax highlighting, line numbers, and a copy action.
- **File_Tree_Manifest**: The `file-tree.json` file stored in S3, containing a structured representation of all files and directories with metadata (path, size, type).
- **File_Expander**: The server-side logic (Lambda for projects, CI/CD script for templates) that explodes a zip into individual S3 objects and generates the File_Tree_Manifest.
- **Language_Mapper**: The module that maps file extensions and special filenames to highlight.js language identifiers for syntax highlighting.
- **Detail_Page**: Either the project detail page or the template detail page where the File_Browser is rendered.
- **Artifact_Zip**: The `artifact.zip` file stored in S3 and served via CloudFront, preserved for direct download functionality.

## Requirements

### Requirement 1: File Expansion at Upload Time (Projects)

**User Story:** As a system operator, I want project files to be individually stored in S3 at upload time, so that the frontend can fetch files on demand without client-side zip extraction.

#### Acceptance Criteria

1. WHEN the process Lambda creates a project artifact, THE File_Expander SHALL write each file from the filtered zip as an individual S3 object under `projects/{name}/files/{filePath}`.
2. WHEN the process Lambda creates a project artifact, THE File_Expander SHALL generate a File_Tree_Manifest at `projects/{name}/file-tree.json` containing the hierarchical structure of all exploded files.
3. THE File_Tree_Manifest SHALL include for each entry: the relative path, a type indicator (file or directory), and the file size in bytes for file entries.
4. THE File_Expander SHALL preserve the original file content encoding (UTF-8 for text, binary for binary files) when writing individual S3 objects.
5. THE File_Expander SHALL set appropriate `Content-Type` headers on individual S3 objects based on file extension (e.g., `text/plain` for `.txt`, `application/javascript` for `.js`, `image/png` for `.png`).
6. WHEN the process Lambda creates a project artifact, THE File_Expander SHALL continue to generate the Artifact_Zip at `projects/{name}/artifact.zip` for the download button.
7. IF the File_Expander encounters an error writing individual files, THEN THE File_Expander SHALL log the error and continue processing remaining files, recording failures in the Lambda response warning field.

### Requirement 2: File Expansion at Deploy Time (Templates)

**User Story:** As a system operator, I want template files to be individually stored in S3 at CI/CD deploy time, so that templates have the same browsing experience as projects.

#### Acceptance Criteria

1. WHEN the CI/CD pipeline deploys a template, THE deploy script SHALL explode the template files into individual S3 objects under `templates/{name}/files/{filePath}`.
2. WHEN the CI/CD pipeline deploys a template, THE deploy script SHALL generate a File_Tree_Manifest at `templates/{name}/file-tree.json` following the same schema as project manifests.
3. THE deploy script SHALL preserve the same Content-Type mapping and encoding conventions as the project File_Expander.
4. THE deploy script SHALL continue to generate the Artifact_Zip at `templates/{name}/artifact.zip` for the download button.

### Requirement 3: File Tree Manifest Loading

**User Story:** As a user, I want the file browser to load instantly when I choose to browse files, so that I can start navigating the project structure without waiting for large downloads.

#### Acceptance Criteria

1. THE Detail_Page SHALL display a "Browse Files" action that initiates manifest loading only when the user activates it.
2. WHEN the user activates the "Browse Files" action, THE File_Browser SHALL fetch the File_Tree_Manifest from the CDN URL at `{cdnUrl}/{path}file-tree.json`.
3. WHILE the File_Tree_Manifest is being fetched, THE Detail_Page SHALL display a loading indicator with a text label such as "Loading files…".
4. WHEN the File_Tree_Manifest has been fetched and parsed, THE Detail_Page SHALL replace the loading indicator with the File_Browser showing the File_Tree.
5. IF the File_Tree_Manifest cannot be fetched (network error, 404, or invalid JSON), THEN THE Detail_Page SHALL display an error message describing the failure and allow the user to retry.
6. IF the File_Tree_Manifest does not exist for a project uploaded before this feature (legacy project), THEN THE Detail_Page SHALL display a message indicating that file browsing is not available for this project.

### Requirement 4: On-Demand File Fetching

**User Story:** As a user, I want only the file I click to be loaded from the server, so that browsing is fast and does not consume unnecessary bandwidth or memory.

#### Acceptance Criteria

1. WHEN the user selects a file in the File_Tree, THE Code_Viewer SHALL fetch the file content from the CDN URL at `{cdnUrl}/{path}files/{filePath}`.
2. WHILE a file is being fetched, THE Code_Viewer SHALL display a loading indicator within the viewer panel.
3. IF a file cannot be fetched (network error or 404), THEN THE Code_Viewer SHALL display an error message and allow the user to retry.
4. WHEN a file has been fetched and displayed, THE File_Browser SHALL cache the file content in memory so that re-selecting the same file does not trigger another network request.
5. IF the selected file exceeds 500 KB in size (determined from the File_Tree_Manifest size field), THEN THE Code_Viewer SHALL display a warning and require explicit user confirmation before fetching the file.

### Requirement 5: File Tree Component

**User Story:** As a user, I want to see a hierarchical file tree representing the project structure, so that I can navigate and understand how files are organized.

#### Acceptance Criteria

1. WHEN the File_Tree_Manifest has been parsed, THE File_Tree SHALL render a hierarchical tree view representing all directories and files from the manifest.
2. THE File_Tree SHALL sort entries with directories listed before files, and items within each group sorted alphabetically in a case-insensitive manner.
3. THE File_Tree SHALL display a visual indicator (icon or symbol) distinguishing directories from files.
4. WHEN the user activates a directory node in the File_Tree, THE File_Tree SHALL toggle its expanded or collapsed state, showing or hiding its child entries.
5. WHEN the user activates a file node in the File_Tree, THE Code_Viewer SHALL fetch and display the contents of that file.
6. THE File_Tree SHALL highlight the currently selected file node to indicate which file is being viewed.
7. THE File_Tree SHALL be keyboard navigable using arrow keys for traversal, Enter or Space for activation, and maintain a visible focus indicator on the focused node.

### Requirement 6: Code Viewer with Syntax Highlighting

**User Story:** As a user, I want to view file contents with syntax highlighting and line numbers, so that I can read code comfortably without downloading the full archive.

#### Acceptance Criteria

1. WHEN a file is fetched and displayed, THE Code_Viewer SHALL apply syntax highlighting using highlight.js.
2. THE Code_Viewer SHALL display a breadcrumb path above the file content showing the full path of the currently viewed file.
3. THE Code_Viewer SHALL display line numbers alongside the file content, starting at 1.
4. THE Code_Viewer SHALL provide a "Copy" button that copies the raw file content (without line numbers or HTML markup) to the clipboard when activated.
5. WHEN the "Copy" button is activated, THE Code_Viewer SHALL provide visual feedback confirming the copy operation (e.g., button text changes to "Copied!" for 2 seconds).
6. THE Code_Viewer SHALL render file content with horizontal scrolling for lines that exceed the viewport width, preserving original line formatting without wrapping.
7. IF the selected file exceeds 500 KB in size, THEN THE Code_Viewer SHALL display the file content as plain text without syntax highlighting and SHALL show a notice indicating that highlighting was skipped for performance.

### Requirement 7: Language and Extension Mapping

**User Story:** As a user, I want files to be highlighted in the correct language based on their extension, so that syntax coloring is accurate and useful.

#### Acceptance Criteria

1. THE Language_Mapper SHALL map common file extensions to highlight.js language identifiers (e.g., `.ts` to `typescript`, `.py` to `python`, `.tf` to `hcl`, `.rs` to `rust`, `.go` to `go`, `.java` to `java`, `.json` to `json`, `.yaml`/`.yml` to `yaml`, `.md` to `markdown`, `.html` to `xml`, `.css` to `css`, `.sh` to `bash`).
2. THE Language_Mapper SHALL recognize special filenames without extensions and map them to the appropriate language (e.g., `Dockerfile` to `dockerfile`, `Makefile` to `makefile`, `.gitignore` to `bash`).
3. IF a file extension is not recognized by the Language_Mapper, THEN THE Code_Viewer SHALL use highlight.js auto-detection to determine the language.
4. IF highlight.js auto-detection returns a low-confidence result, THEN THE Code_Viewer SHALL render the content as plain text.

### Requirement 8: Binary File Handling

**User Story:** As a user, I want binary files clearly indicated and images previewed inline, so that I understand file types without confusion.

#### Acceptance Criteria

1. THE Language_Mapper SHALL maintain a list of binary file extensions (including but not limited to `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.pdf`, `.exe`, `.dll`, `.so`, `.dylib`, `.o`, `.class`, `.pyc`, `.zip`, `.tar`, `.gz`, `.jar`).
2. WHEN the user selects a binary file that is not a previewable image, THE Code_Viewer SHALL display a "Binary file — cannot preview" message instead of file content.
3. WHEN the user selects an image file (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`), THE Code_Viewer SHALL display an inline image preview using the CDN URL for that file.
4. THE Code_Viewer SHALL display the image preview with a maximum width of 100% of the viewer area and preserve the image aspect ratio.

### Requirement 9: Integration with Detail Pages

**User Story:** As a user, I want to browse files on both project and template detail pages, so that I can explore any artifact in the repository.

#### Acceptance Criteria

1. THE project detail page SHALL include the File_Browser section below the existing download section.
2. THE template detail page SHALL include the File_Browser section below the existing download button.
3. THE File_Browser SHALL construct the manifest and file URLs using the same CDN base URL and path pattern used by the existing download link on each Detail_Page.
4. WHILE the File_Browser is in its initial state (before the user activates "Browse Files"), THE Detail_Page SHALL display only the "Browse Files" action, consuming minimal vertical space.

### Requirement 10: Deep Linking to Files

**User Story:** As a user, I want to share a link that opens a specific file in the viewer, so that I can point colleagues directly to relevant code.

#### Acceptance Criteria

1. WHEN the user selects a file in the File_Tree, THE Detail_Page SHALL update the URL hash to include the file path (e.g., `#/project/{name}/file/{filePath}` or `#/template/{name}/file/{filePath}`).
2. WHEN the Detail_Page loads with a file path in the URL hash, THE File_Browser SHALL automatically fetch the File_Tree_Manifest, expand the File_Tree to reveal the target file, select it, and fetch and display its contents in the Code_Viewer.
3. IF the file path specified in the URL hash does not exist in the manifest, THEN THE File_Browser SHALL display the File_Tree with no file selected and show a notice indicating that the linked file was not found.

### Requirement 11: Responsive Layout

**User Story:** As a user, I want the file browser to work well on all screen sizes, so that I can browse code on mobile and desktop.

#### Acceptance Criteria

1. WHILE the viewport width is 768 px or wider, THE File_Browser SHALL display the File_Tree and Code_Viewer side by side.
2. WHILE the viewport width is below 768 px, THE File_Browser SHALL stack the File_Tree above the Code_Viewer, with the File_Tree collapsible via a toggle button.
3. THE Code_Viewer SHALL allow horizontal scrolling for lines that exceed the available width on all viewport sizes.
4. THE File_Tree SHALL constrain its maximum height and provide vertical scrolling when the tree content exceeds the available space.

### Requirement 12: Migration of Existing Projects

**User Story:** As a system operator, I want a one-time migration script that explodes existing project zips into individual files, so that all projects benefit from the new file browsing experience.

#### Acceptance Criteria

1. THE migration script SHALL list all existing projects in the S3 bucket under the `projects/` prefix that have an `artifact.zip` but no `file-tree.json`.
2. FOR EACH project without a File_Tree_Manifest, THE migration script SHALL download the Artifact_Zip, explode its contents into individual S3 objects under `projects/{name}/files/{filePath}`, and generate a File_Tree_Manifest at `projects/{name}/file-tree.json`.
3. THE migration script SHALL apply the same Content-Type mapping and encoding conventions as the project File_Expander.
4. THE migration script SHALL log progress indicating the project being processed and the number of files exploded.
5. IF the migration script encounters an error processing a specific project, THEN THE migration script SHALL log the error and continue processing remaining projects.
6. THE migration script SHALL be idempotent: running it multiple times SHALL not create duplicate files or corrupt existing exploded files.
