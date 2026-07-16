# Requirements Document

## Introduction

This feature adds a GitHub/GitLab-style file browser and code viewer to the project detail and template detail pages. Users navigate directories via a flat listing (one directory level at a time) and view individual file contents with syntax highlighting. The approach uses a pre-exploded files architecture with a dual-path upload pipeline: the frontend accepts both folder uploads (individual files staged directly to S3, no client-side zipping) and `.zip` file uploads (staged as-is). In both cases, the Lambda produces the same output — individual S3 objects under `files/`, a `file-tree.json` manifest, and an `artifact.zip` for the download button. At browse time, the frontend fetches only the lightweight manifest for directory rendering and loads individual files on demand. For templates, file expansion happens at CI/CD deploy time. highlight.js (already used for README rendering) provides syntax coloring. No client-side zip extraction is needed.

The UI follows the GitHub repository browsing pattern: breadcrumb navigation at the top, a flat directory listing showing only the current folder's contents, clicking a folder navigates into it, and clicking a file replaces the listing with a full-page code view. If a directory contains a README.md, it is rendered below the listing.

## Glossary

- **File_Browser**: The combined UI component consisting of the Breadcrumb_Nav, the Directory_Listing, the optional README preview, and the Code_Viewer, displayed on detail pages to let users explore project or template files.
- **Directory_Listing**: A flat table/list UI component showing the contents of the current directory only (folders first, then files, each group sorted alphabetically). Each row displays an icon (folder or file), the entry name, and optionally the file size.
- **Breadcrumb_Nav**: A horizontal navigation bar showing the current path as clickable segments (e.g., `root / src / components /`). Each segment navigates to that directory level.
- **Code_Viewer**: The full-page view that replaces the Directory_Listing when a file is selected, displaying the file contents with syntax highlighting, line numbers, and a copy action. Includes the Breadcrumb_Nav for navigation back to the parent directory.
- **File_Tree_Manifest**: The `file-tree.json` file stored in S3, containing a structured representation of all files and directories with metadata (path, size, type).
- **File_Expander**: The server-side logic (Lambda for projects, CI/CD script for templates) that processes staged uploads (either individual files or a zip), explodes them into individual S3 objects, generates the File_Tree_Manifest, and produces the Artifact_Zip.
- **Drop_Zone**: The frontend UI component that accepts both folder drops/selections (via webkitdirectory) and `.zip` file drops/selections, auto-detecting the upload mode.
- **Language_Mapper**: The module that maps file extensions and special filenames to highlight.js language identifiers for syntax highlighting.
- **Detail_Page**: Either the project detail page or the template detail page where the File_Browser is rendered.
- **Artifact_Zip**: The `artifact.zip` file stored in S3 and served via CloudFront, preserved for direct download functionality. For folder uploads, the Lambda generates this server-side; for zip uploads, the original zip is used.
- **Per_Folder_README**: The behavior where, if the currently viewed directory contains a file named `README.md` or `README`, that file is fetched and rendered as markdown below the Directory_Listing.

## Requirements

### Requirement 1: Dual-Path Upload and File Expansion at Upload Time (Projects)

**User Story:** As a system operator, I want the upload pipeline to accept both folder uploads (individual files) and zip uploads, storing project files individually in S3 and producing a consistent output structure, so that the frontend can fetch files on demand without client-side zip extraction.

#### Acceptance Criteria

##### Input Detection

1. WHEN the process Lambda receives a finalize request, THE File_Expander SHALL inspect the staging area to determine whether the upload is a zip upload (single `upload.zip` object present) or a folder upload (multiple individual file objects present under `staging/{sessionId}/files/`).
2. THE File_Expander SHALL use the upload mode indicator stored in the session metadata (`mode: "zip"` or `mode: "folder"`) to differentiate between the two input paths.

##### Folder Upload Path (Individual Files)

3. WHEN the upload mode is "folder", THE File_Expander SHALL read each individual file from `staging/{sessionId}/files/{filePath}` in the staging bucket.
4. WHEN the upload mode is "folder", THE File_Expander SHALL apply server-side filtering to the staged files using the same deny-list rules as the zip path.
5. WHEN the upload mode is "folder", THE File_Expander SHALL write each filtered file as an individual S3 object under `projects/{name}/files/{filePath}` in the frontend bucket.
6. WHEN the upload mode is "folder", THE File_Expander SHALL generate the Artifact_Zip at `projects/{name}/artifact.zip` from the filtered files for the download button.

##### Zip Upload Path

7. WHEN the upload mode is "zip", THE File_Expander SHALL download the staged zip from `staging/{sessionId}/upload.zip`, extract its contents, and apply server-side filtering.
8. WHEN the upload mode is "zip", THE File_Expander SHALL write each filtered file from the extracted zip as an individual S3 object under `projects/{name}/files/{filePath}`.
9. WHEN the upload mode is "zip", THE File_Expander SHALL store the original uploaded zip (or a re-generated zip from filtered files) as the Artifact_Zip at `projects/{name}/artifact.zip` for the download button.

##### Common Output (Both Paths)

10. WHEN the process Lambda completes file expansion (regardless of upload mode), THE File_Expander SHALL generate a File_Tree_Manifest at `projects/{name}/file-tree.json` containing the hierarchical structure of all exploded files.
11. THE File_Tree_Manifest SHALL include for each entry: the relative path, a type indicator (file or directory), and the file size in bytes for file entries.
12. THE File_Expander SHALL preserve the original file content encoding (UTF-8 for text, binary for binary files) when writing individual S3 objects.
13. THE File_Expander SHALL set appropriate `Content-Type` headers on individual S3 objects based on file extension (e.g., `text/plain` for `.txt`, `application/javascript` for `.js`, `image/png` for `.png`).
14. IF the File_Expander encounters an error writing individual files, THEN THE File_Expander SHALL log the error and continue processing remaining files, recording failures in the Lambda response warning field.

##### Frontend Drop Zone (Dual-Mode Acceptance)

15. THE Drop_Zone SHALL accept both folder drops (via `webkitdirectory` directory selection) and single `.zip` file drops or selections.
16. WHEN the user drops or selects a folder, THE Drop_Zone SHALL detect the folder upload mode and stage each individual file to `staging/{sessionId}/files/{filePath}` via presigned URLs (no client-side zipping).
17. WHEN the user drops or selects a `.zip` file, THE Drop_Zone SHALL detect the zip upload mode and stage the zip directly to `staging/{sessionId}/upload.zip` via a presigned URL (no client-side extraction or re-zipping).
18. THE Drop_Zone SHALL auto-detect the upload mode based on the input: if the dropped or selected item is a single file with a `.zip` extension, it is treated as zip mode; otherwise it is treated as folder mode.

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
4. WHEN the File_Tree_Manifest has been fetched and parsed, THE Detail_Page SHALL replace the loading indicator with the File_Browser showing the Directory_Listing of the root directory.
5. IF the File_Tree_Manifest cannot be fetched (network error, 404, or invalid JSON), THEN THE Detail_Page SHALL display an error message describing the failure and allow the user to retry.
6. IF the File_Tree_Manifest does not exist for a project uploaded before this feature (legacy project), THEN THE Detail_Page SHALL display a message indicating that file browsing is not available for this project.

### Requirement 4: On-Demand File Fetching

**User Story:** As a user, I want only the file I click to be loaded from the server, so that browsing is fast and does not consume unnecessary bandwidth or memory.

#### Acceptance Criteria

1. WHEN the user selects a file in the Directory_Listing, THE Code_Viewer SHALL fetch the file content from the CDN URL at `{cdnUrl}/{path}files/{filePath}`.
2. WHILE a file is being fetched, THE Code_Viewer SHALL display a loading indicator within the viewer area.
3. IF a file cannot be fetched (network error or 404), THEN THE Code_Viewer SHALL display an error message and allow the user to retry.
4. WHEN a file has been fetched and displayed, THE File_Browser SHALL cache the file content in memory so that re-selecting the same file does not trigger another network request.
5. IF the selected file exceeds 500 KB in size (determined from the File_Tree_Manifest size field), THEN THE Code_Viewer SHALL display a warning and require explicit user confirmation before fetching the file.

### Requirement 5: Directory Listing Component

**User Story:** As a user, I want to see a flat listing of the current directory's contents (like GitHub's repo view), so that I can navigate folders and select files one level at a time.

#### Acceptance Criteria

1. WHEN the File_Tree_Manifest has been parsed and a directory is the current view, THE Directory_Listing SHALL render a flat list showing only the immediate children of that directory.
2. THE Directory_Listing SHALL sort entries with directories listed before files, and items within each group sorted alphabetically in a case-insensitive manner.
3. THE Directory_Listing SHALL display a visual indicator (icon or symbol) distinguishing directories from files for each row.
4. THE Directory_Listing SHALL display the entry name for each row, and optionally the file size for file entries.
5. WHEN the user activates a directory row in the Directory_Listing, THE File_Browser SHALL navigate into that directory, replacing the listing with the contents of the selected directory and updating the Breadcrumb_Nav.
6. WHEN the user activates a file row in the Directory_Listing, THE File_Browser SHALL replace the Directory_Listing entirely with the Code_Viewer displaying that file's contents.
7. THE Directory_Listing SHALL be keyboard navigable using arrow keys for traversal, Enter or Space for activation, and maintain a visible focus indicator on the focused row.

### Requirement 6: Breadcrumb Navigation

**User Story:** As a user, I want a breadcrumb bar showing my current path in the file tree, so that I can quickly navigate back to any parent directory.

#### Acceptance Criteria

1. THE Breadcrumb_Nav SHALL display the current path as a series of clickable segments (e.g., `root / src / components /`), where each segment represents a directory level.
2. WHEN the user activates a breadcrumb segment, THE File_Browser SHALL navigate to that directory, updating the Directory_Listing to show the contents of the selected directory.
3. THE Breadcrumb_Nav SHALL always include a root segment that navigates back to the top-level directory of the project or template.
4. WHILE viewing a file in the Code_Viewer, THE Breadcrumb_Nav SHALL remain visible and show the full path to the file, with all directory segments clickable to navigate back.
5. THE Breadcrumb_Nav SHALL be keyboard accessible, with each segment focusable and activatable via Enter or Space.

### Requirement 7: Per-Folder README Rendering

**User Story:** As a user, I want to see the README of the current directory rendered below the file listing (like GitHub), so that I can read documentation in context without navigating away.

#### Acceptance Criteria

1. WHEN the Directory_Listing is displayed for a directory that contains a file named `README.md` or `README` (case-insensitive match), THE File_Browser SHALL fetch that README file from the CDN and render it as markdown below the Directory_Listing.
2. WHILE the README file is being fetched, THE File_Browser SHALL display a loading indicator below the Directory_Listing.
3. IF the current directory does not contain a README file, THEN THE File_Browser SHALL display nothing below the Directory_Listing.
4. IF the README file cannot be fetched (network error or 404), THEN THE File_Browser SHALL hide the README section without displaying an error.
5. THE rendered README SHALL use the same markdown rendering pipeline (marked library) and styling as the existing README sections on detail pages.

### Requirement 8: Code Viewer with Syntax Highlighting

**User Story:** As a user, I want to view file contents with syntax highlighting and line numbers, so that I can read code comfortably without downloading the full archive.

#### Acceptance Criteria

1. WHEN a file is fetched and displayed, THE Code_Viewer SHALL replace the Directory_Listing entirely, showing the file content as a full-page view.
2. THE Code_Viewer SHALL apply syntax highlighting using highlight.js.
3. THE Code_Viewer SHALL display line numbers alongside the file content, starting at 1.
4. THE Code_Viewer SHALL provide a "Copy" button that copies the raw file content (without line numbers or HTML markup) to the clipboard when activated.
5. WHEN the "Copy" button is activated, THE Code_Viewer SHALL provide visual feedback confirming the copy operation (e.g., button text changes to "Copied!" for 2 seconds).
6. THE Code_Viewer SHALL render file content with horizontal scrolling for lines that exceed the viewport width, preserving original line formatting without wrapping.
7. IF the selected file exceeds 500 KB in size, THEN THE Code_Viewer SHALL display the file content as plain text without syntax highlighting and SHALL show a notice indicating that highlighting was skipped for performance.

### Requirement 9: Language and Extension Mapping

**User Story:** As a user, I want files to be highlighted in the correct language based on their extension, so that syntax coloring is accurate and useful.

#### Acceptance Criteria

1. THE Language_Mapper SHALL map common file extensions to highlight.js language identifiers (e.g., `.ts` to `typescript`, `.py` to `python`, `.tf` to `hcl`, `.rs` to `rust`, `.go` to `go`, `.java` to `java`, `.json` to `json`, `.yaml`/`.yml` to `yaml`, `.md` to `markdown`, `.html` to `xml`, `.css` to `css`, `.sh` to `bash`).
2. THE Language_Mapper SHALL recognize special filenames without extensions and map them to the appropriate language (e.g., `Dockerfile` to `dockerfile`, `Makefile` to `makefile`, `.gitignore` to `bash`).
3. IF a file extension is not recognized by the Language_Mapper, THEN THE Code_Viewer SHALL use highlight.js auto-detection to determine the language.
4. IF highlight.js auto-detection returns a low-confidence result, THEN THE Code_Viewer SHALL render the content as plain text.

### Requirement 10: Binary File Handling

**User Story:** As a user, I want binary files clearly indicated and images previewed inline, so that I understand file types without confusion.

#### Acceptance Criteria

1. THE Language_Mapper SHALL maintain a list of binary file extensions (including but not limited to `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.pdf`, `.exe`, `.dll`, `.so`, `.dylib`, `.o`, `.class`, `.pyc`, `.zip`, `.tar`, `.gz`, `.jar`).
2. WHEN the user selects a binary file that is not a previewable image, THE Code_Viewer SHALL display a "Binary file — cannot preview" message instead of file content.
3. WHEN the user selects an image file (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`), THE Code_Viewer SHALL display an inline image preview using the CDN URL for that file.
4. THE Code_Viewer SHALL display the image preview with a maximum width of 100% of the viewer area and preserve the image aspect ratio.

### Requirement 11: Integration with Detail Pages

**User Story:** As a user, I want to browse files on both project and template detail pages, so that I can explore any artifact in the repository.

#### Acceptance Criteria

1. THE project detail page SHALL include the File_Browser section below the existing download section.
2. THE template detail page SHALL include the File_Browser section below the existing download button.
3. THE File_Browser SHALL construct the manifest and file URLs using the same CDN base URL and path pattern used by the existing download link on each Detail_Page.
4. WHILE the File_Browser is in its initial state (before the user activates "Browse Files"), THE Detail_Page SHALL display only the "Browse Files" action, consuming minimal vertical space.

### Requirement 12: Deep Linking to Files and Directories

**User Story:** As a user, I want to share a link that opens a specific file or directory in the viewer, so that I can point colleagues directly to relevant code.

#### Acceptance Criteria

1. WHEN the user navigates into a directory, THE Detail_Page SHALL update the URL hash to encode the current path (e.g., `#/project/{name}/files/src/components/` for directories).
2. WHEN the user selects a file, THE Detail_Page SHALL update the URL hash to encode the file path (e.g., `#/project/{name}/files/src/main.ts` for files, or `#/template/{name}/files/src/main.ts` for templates).
3. WHEN the Detail_Page loads with a directory path in the URL hash, THE File_Browser SHALL automatically fetch the File_Tree_Manifest and display the Directory_Listing for that directory with the Breadcrumb_Nav reflecting the path.
4. WHEN the Detail_Page loads with a file path in the URL hash, THE File_Browser SHALL automatically fetch the File_Tree_Manifest, navigate to the file's parent directory context, and fetch and display the file contents in the Code_Viewer.
5. IF the path specified in the URL hash does not exist in the manifest, THEN THE File_Browser SHALL display the root Directory_Listing and show a notice indicating that the linked path was not found.

### Requirement 13: Responsive Layout

**User Story:** As a user, I want the file browser to adapt naturally to different monitor resolutions and aspect ratios, so that I can browse code comfortably on any display.

#### Acceptance Criteria

1. THE File_Browser SHALL use a single-column layout that naturally adapts to different viewport widths and aspect ratios (16:9, 21:9, ultrawide).
2. THE Directory_Listing SHALL occupy the full available width of the content area.
3. THE Code_Viewer SHALL allow horizontal scrolling for lines that exceed the available width on all viewport sizes.
4. THE Directory_Listing SHALL constrain its maximum height and provide vertical scrolling when the directory content exceeds the available space.
5. THE Breadcrumb_Nav SHALL wrap gracefully when the path is too long for the available width.

### Requirement 14: Migration of Existing Projects

**User Story:** As a system operator, I want a one-time migration script that explodes existing project zips into individual files, so that all projects benefit from the new file browsing experience.

#### Acceptance Criteria

1. THE migration script SHALL list all existing projects in the S3 bucket under the `projects/` prefix that have an `artifact.zip` but no `file-tree.json`.
2. FOR EACH project without a File_Tree_Manifest, THE migration script SHALL download the Artifact_Zip, explode its contents into individual S3 objects under `projects/{name}/files/{filePath}`, and generate a File_Tree_Manifest at `projects/{name}/file-tree.json`.
3. THE migration script SHALL apply the same Content-Type mapping and encoding conventions as the project File_Expander.
4. THE migration script SHALL log progress indicating the project being processed and the number of files exploded.
5. IF the migration script encounters an error processing a specific project, THEN THE migration script SHALL log the error and continue processing remaining projects.
6. THE migration script SHALL be idempotent: running it multiple times SHALL not create duplicate files or corrupt existing exploded files.
