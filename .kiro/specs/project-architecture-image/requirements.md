# Requirements Document

## Introduction

This feature adds optional architecture image support to projects. Currently, only templates display architecture diagrams (auto-detected from a fixed folder path). For projects, users will be able to optionally upload an architecture image (PNG or SVG) during project creation/upload or when editing project information. The image will be displayed on the project detail page in the same position and style as in templates — a clickable thumbnail that opens a full-size lightbox.

## Glossary

- **Project_Detail_Page**: The frontend page rendered by `project-detail.ts` that displays a project's metadata, download link, file browser, and readme.
- **Edit_Form**: The frontend form rendered by `edit-form.ts` that allows users to modify project metadata, readme, tags, repository URL, and optionally replace the artifact.
- **Upload_Form**: The frontend flow for creating new projects via folder/zip upload, including the initiate and finalize steps.
- **Architecture_Image**: An optional PNG or SVG file depicting the project's architecture, stored at `projects/{name}/architecture.png` or `projects/{name}/architecture.svg`.
- **Lightbox**: A full-screen modal overlay that displays the architecture image at full resolution with close functionality (click outside, close button, Escape key).
- **Edit_Lambda**: The backend Lambda handler at PATCH `/projects/{name}` that processes project metadata updates.
- **Initiate_Lambda**: The backend Lambda handler at POST `/upload/initiate` that creates upload sessions with presigned URLs.
- **ProjectMetadata**: The per-project metadata object stored in `metadata.json`, containing name, description, tags, date, and optional fields.

## Requirements

### Requirement 1: Architecture Image Storage in ProjectMetadata

**User Story:** As a developer, I want the project data model to support an optional architecture image reference, so that the system can track which projects have an architecture diagram.

#### Acceptance Criteria

1. THE ProjectMetadata interface SHALL include an optional `architectureImage` field with type `'architecture.png' | 'architecture.svg'`
2. WHEN `architectureImage` is absent or undefined in ProjectMetadata, THE Project_Detail_Page SHALL render no architecture section
3. WHEN `architectureImage` is present in ProjectMetadata, THE Project_Detail_Page SHALL use the value to construct the image URL at `projects/{name}/{architectureImage}`

### Requirement 2: Architecture Image Display on Project Detail Page

**User Story:** As a user, I want to see the project's architecture diagram on its detail page, so that I can quickly understand the project's structure.

#### Acceptance Criteria

1. WHEN ProjectMetadata contains an `architectureImage` value, THE Project_Detail_Page SHALL resolve the image URL via a HEAD request to the CDN path and render an architecture section between the file browser and the readme section
2. WHEN the architecture section is rendered, THE Project_Detail_Page SHALL render the architecture image inside a clickable button that opens the Lightbox on click
3. THE Project_Detail_Page SHALL set the image alt text to "Architecture diagram for {name}"
4. THE Project_Detail_Page SHALL set the button aria-label to "View full-size architecture diagram for {name}"
5. IF the architecture image fails to load (onerror), THEN THE Project_Detail_Page SHALL remove the architecture section from the DOM without displaying an error message to the user
6. WHEN the user clicks the architecture image button, THE Lightbox SHALL display the full-size image in a dialog overlay (role="dialog", aria-modal="true") with close via close button, click outside the image, or Escape key, and SHALL return focus to the architecture image button upon closing
7. WHILE the user is viewing a file in the file browser (navigated to a non-directory path), THE Project_Detail_Page SHALL hide the architecture section along with other supplementary content

### Requirement 3: Architecture Image Upload During Project Creation

**User Story:** As a user, I want to optionally attach an architecture image when uploading a new project, so that the diagram is available from the start.

#### Acceptance Criteria

1. THE Upload_Form SHALL include an optional file input for the architecture image, accepting only `.png` and `.svg` files with a maximum file size of 5 MB
2. WHEN the user selects an architecture image file, THE Upload_Form SHALL validate that the file extension is `.png` or `.svg` and that the file size does not exceed 5 MB
3. IF the user selects a file with an unsupported extension or a file exceeding 5 MB, THEN THE Upload_Form SHALL display a validation error message indicating the constraint that was violated (accepted formats or maximum size)
4. WHEN an architecture image is provided during initiation, THE Initiate_Lambda SHALL generate a presigned URL for uploading the architecture image to `staging/{sessionId}/architecture.{ext}`
5. THE InitiateRequest interface SHALL include an optional `architectureImage` field with the filename (`architecture.png` or `architecture.svg`)
6. THE InitiateResponse interface SHALL include an optional `architectureImageUploadUrl` field containing the presigned PUT URL for the architecture image
7. WHEN the upload is finalized and an architecture image was provided, THE backend SHALL verify that the architecture image exists in the staging path before copying it to `projects/{name}/architecture.{ext}` and setting `architectureImage` in the project's metadata.json
8. IF the upload is finalized and the architecture image file is not found in the staging path, THEN THE backend SHALL proceed with finalization without the architecture image and SHALL NOT set the `architectureImage` field in metadata.json

### Requirement 4: Architecture Image Upload During Project Edit

**User Story:** As a user, I want to add or replace the architecture image when editing a project, so that I can update the diagram as the project evolves.

#### Acceptance Criteria

1. THE Edit_Form SHALL include an optional file input for the architecture image, accepting only `.png` and `.svg` files with a maximum file size of 5 MB
2. WHEN the user selects an architecture image file in the Edit_Form, THE Edit_Form SHALL validate that the file extension is `.png` or `.svg` (case-insensitive comparison)
3. IF the user selects a file with an unsupported extension in the Edit_Form, THEN THE Edit_Form SHALL display a validation error message adjacent to the file input indicating the accepted formats
4. IF the user selects a file that exceeds 5 MB, THEN THE Edit_Form SHALL display a validation error message indicating the maximum allowed size
5. THE EditRequest interface SHALL include an optional `architectureImage` field with the filename (`architecture.png` or `architecture.svg`)
6. WHEN an architecture image file is provided during edit, THE Edit_Form SHALL request a presigned PUT URL from the backend (as defined in Requirement 5) and upload the file directly to S3 using that URL before sending the PATCH request
7. IF the presigned URL upload fails (non-2xx response or network error), THEN THE Edit_Form SHALL display an error message indicating the image upload failed and SHALL NOT proceed with the metadata PATCH request
8. WHEN the Edit_Lambda receives an `architectureImage` field in the request body, THE Edit_Lambda SHALL update the `architectureImage` field in the project's metadata.json
9. IF the user provides a new architecture image that differs in format from the existing one (e.g., replacing .png with .svg), THEN THE Edit_Lambda SHALL delete the old architecture image file from S3

### Requirement 5: Architecture Image Presigned URL for Edit

**User Story:** As a developer, I want a mechanism to obtain a presigned URL for uploading the architecture image during edit, so that the frontend can upload the file directly to S3.

#### Acceptance Criteria

1. THE backend SHALL expose an authenticated endpoint that accepts the project name and the target file extension (`png` or `svg`) and returns a presigned PUT URL for architecture image uploads during project edit
2. WHEN the frontend requests an architecture image upload URL for an existing project, THE backend SHALL return a presigned URL targeting `projects/{name}/architecture.{ext}` where `{ext}` matches the extension provided in the request
3. THE presigned URL SHALL accept only `image/png` or `image/svg+xml` content types, enforced via a Content-Type condition on the presigned URL
4. THE presigned URL SHALL expire after 900 seconds (15 minutes), consistent with `PRESIGNED_URL_EXPIRY`
5. IF the specified project does not exist, THEN THE backend SHALL return an error response indicating the project was not found
6. IF the request specifies a file extension other than `png` or `svg`, THEN THE backend SHALL return a validation error response indicating the unsupported format
7. THE presigned URL SHALL enforce a maximum upload size of 10 MB via a Content-Length condition

### Requirement 6: Architecture Image Removal

**User Story:** As a user, I want to be able to remove the architecture image from a project, so that I can clean up outdated diagrams.

#### Acceptance Criteria

1. IF the project's metadata contains an `architectureImage` field, THEN THE Edit_Form SHALL display a removal control associated with the architecture image input that allows the user to clear the existing image
2. WHEN the user activates the architecture image removal control and submits the form, THE Edit_Form SHALL send a PATCH request to the Edit_Lambda with the `architectureImage` field set to `null`
3. WHEN the Edit_Lambda receives a PATCH request with `architectureImage` set to `null`, THE Edit_Lambda SHALL delete the corresponding image file from S3 at `projects/{name}/architecture.{ext}` and remove the `architectureImage` field from the project's metadata.json
4. IF the Edit_Lambda fails to delete the architecture image file from S3 (non-existent key or S3 error), THEN THE Edit_Lambda SHALL still remove the `architectureImage` field from metadata.json and return a success response
5. WHEN the Edit_Lambda successfully processes the architecture image removal, THE Edit_Form SHALL display a success status message and navigate to the project detail page within 2 seconds
6. WHEN `architectureImage` is absent from the project's metadata, THE Project_Detail_Page SHALL render no architecture section

### Requirement 7: Reuse of Template Architecture Rendering

**User Story:** As a developer, I want to reuse the existing template architecture rendering logic for projects, so that both sections are visually consistent and maintainable.

#### Acceptance Criteria

1. THE Project_Detail_Page SHALL import and call the `renderArchitectureSection` function from `template-detail.ts` (or a shared module) to render the architecture image, passing the resolved image URL and project name as arguments
2. THE Project_Detail_Page SHALL reuse the `showImageLightbox` function for displaying the full-size image when the user clicks the architecture image trigger
3. THE architecture section rendered for projects SHALL use the `template-architecture` CSS class and produce the same DOM structure (section > button > img) as the template architecture section
4. WHEN rendering the project detail page, THE Project_Detail_Page SHALL resolve the architecture image URL using the project's base path (`{cdnBaseUrl}/{projectPath}`) and attempting `architecture.svg` then `architecture.png` via HEAD requests, consistent with the template resolution logic
5. THE Project_Detail_Page SHALL render the architecture section within the supplementary content area, after the file browser section and before the readme section
6. IF the architecture image fails to load, THEN THE Project_Detail_Page SHALL remove the architecture section from the DOM
