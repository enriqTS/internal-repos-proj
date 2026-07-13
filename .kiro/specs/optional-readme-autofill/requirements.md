# Requirements Document

## Introduction

This feature modifies the project upload flow to make the README field optional and to auto-populate it when the uploaded folder contains a README file. Currently, the README textarea is a required field in both the frontend form validation and the backend Lambda handler. This change improves UX by reducing friction for uploads that already include a README file in the project folder, while still allowing users to manually provide or override README content.

## Glossary

- **Upload_Form**: The frontend form component (`upload-form.ts`) that collects project name, tags, readme content, and project files for submission.
- **Lambda_Handler**: The serverless backend function (`handler.ts`) that receives, validates, and processes upload requests.
- **README_File**: A file named `README.md`, `README.txt`, `README`, `readme.md`, `readme.txt`, or `readme` (case-insensitive match on the base name "readme") located at the root level of the uploaded folder.
- **Autofill**: The automatic population of the README textarea with the content of a detected README_File from the selected folder.
- **Shared_Types**: The shared TypeScript type definitions (`shared/src/types.ts`) used by both frontend and backend.

## Requirements

### Requirement 1: Make README Field Optional in Frontend Validation

**User Story:** As a user uploading a project, I want the README field to be optional, so that I can upload projects without manually writing README content when a README file is already included in the folder.

#### Acceptance Criteria

1. WHEN the Upload_Form is submitted with an empty README textarea (empty string or whitespace-only) and files are selected, THE Upload_Form SHALL accept the submission without displaying a validation error for the README field.
2. WHEN the Upload_Form is submitted with README content that exceeds 50,000 characters, THE Upload_Form SHALL display a validation error for the README field indicating the maximum allowed length has been exceeded.
3. THE Upload_Form SHALL render the README textarea without the "required" HTML attribute and without a visual required indicator (e.g., asterisk on the label).

### Requirement 2: Make README Field Optional in Backend Validation

**User Story:** As a user uploading a project, I want the backend to accept uploads without a readme field, so that the upload succeeds even when no README content is explicitly provided.

#### Acceptance Criteria

1. WHEN an upload request is received without a readme field, or with a readme field that is empty or contains only whitespace, THE Lambda_Handler SHALL accept the request without returning a validation error for the missing readme and SHALL treat the readme value as an empty string for downstream processing.
2. WHEN an upload request includes readme content that exceeds 50,000 characters, THE Lambda_Handler SHALL reject the request with a 400 status code and a response body containing an error message indicating the readme length limit has been exceeded.
3. WHEN an upload request includes readme content that is between 1 and 50,000 characters, THE Lambda_Handler SHALL accept the readme content and include it in the upload processing.
4. THE Shared_Types SHALL define the readme field as optional in the UploadRequest interface, allowing it to be omitted or undefined.

### Requirement 3: Auto-Detect README File in Uploaded Folder

**User Story:** As a user uploading a project, I want the system to detect a README file in my uploaded folder, so that I do not have to copy-paste its content manually.

#### Acceptance Criteria

1. WHEN files are selected via the folder picker, THE Upload_Form SHALL scan the file list for a README_File at the root level of the uploaded folder, where root level is defined as files whose webkitRelativePath contains exactly one path separator (i.e., `folderName/filename` with no additional nested directories).
2. THE Upload_Form SHALL recognize files matching the following names as a README_File (case-insensitive on the base name): `README.md`, `README.txt`, `README`, `readme.md`, `readme.txt`, `readme`.
3. WHEN multiple files match the README_File criteria, THE Upload_Form SHALL select the first match in the priority order: `.md` extension first, `.txt` extension second, no extension third. IF multiple files share the same extension priority, THEN THE Upload_Form SHALL select the first one encountered in the file list order.
4. IF no file in the uploaded folder matches the README_File criteria at the root level, THEN THE Upload_Form SHALL leave the readme textarea unchanged.
5. WHEN the readme textarea has been auto-populated from a detected README_File, THE Upload_Form SHALL allow the user to edit the populated content before submission.

### Requirement 4: Autofill README Textarea with Detected Content

**User Story:** As a user uploading a project, I want the README textarea to be automatically filled with my project's README file content, so that I save time and avoid copy-pasting.

#### Acceptance Criteria

1. WHEN a user selects a folder via the file input and the selected folder contains a README_File at the root level and the README textarea is empty or contains only whitespace, THE Upload_Form SHALL read the text content of the detected README_File and populate the README textarea with that content.
2. WHEN a README_File is detected in the uploaded folder and the README textarea already contains non-whitespace user-entered content, THE Upload_Form SHALL preserve the existing content and not overwrite it.
3. WHEN the Autofill populates the README textarea, THE Upload_Form SHALL display a visible notice adjacent to the README textarea indicating the README was auto-filled from the detected file, and the notice SHALL remain visible until the user modifies the textarea content or submits the form.
4. WHEN the README_File content exceeds 50,000 characters, THE Upload_Form SHALL truncate the autofilled content to 50,000 characters and display a warning adjacent to the README textarea indicating truncation occurred and stating the maximum allowed length.
5. IF the detected README_File cannot be read as text, THEN THE Upload_Form SHALL leave the README textarea unchanged and not display an autofill notice.

### Requirement 5: Update Shared Type Definitions

**User Story:** As a developer maintaining the codebase, I want the shared type definitions to reflect that readme is optional, so that the frontend and backend contracts remain consistent.

#### Acceptance Criteria

1. THE Shared_Types SHALL define the `readme` field in the `UploadRequest` interface as an optional string (`readme?: string`).
2. IF the `readme` field is provided and non-empty in an `UploadRequest`, THEN THE Shared_Types SHALL enforce a maximum length constraint of 50,000 characters for the readme field value.
3. IF the `readme` field is omitted or set to `undefined` in an `UploadRequest`, THEN THE Shared_Types SHALL treat the upload as having no readme content without raising a validation error.
