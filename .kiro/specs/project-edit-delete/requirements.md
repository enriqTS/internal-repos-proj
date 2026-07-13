# Requirements Document

## Introduction

Project Edit & Delete extends the Internal Repos tool with the ability to modify and remove existing projects. Currently, projects are immutable once uploaded. This feature allows employees to update project metadata (name, tags, readme content) and replace artifact files, as well as permanently delete projects that are no longer needed. Both operations trigger a search index rebuild to keep the global-index.json consistent.

## Glossary

- **Project_Entry**: A directory under `projects/{project-name}/` in S3 containing readme.md, metadata.json, and artifact.zip
- **Metadata**: The JSON file (`metadata.json`) containing project name, description, tags, and date
- **Search_Index**: The `global-index.json` manifest file at the S3 bucket root containing metadata for all projects
- **Edit_Lambda**: The AWS Lambda function that handles project update requests (PATCH /projects/{name})
- **Delete_Lambda**: The AWS Lambda function that handles project deletion requests (DELETE /projects/{name})
- **Frontend**: The single-page application hosted on S3 and served via CloudFront
- **API_Gateway**: The AWS API Gateway REST API fronting all Lambda endpoints
- **Tag_Registry**: The `tags.json` file in S3 that stores all known tags for autocomplete

## Requirements

### Requirement 1: Edit Project Metadata

**User Story:** As an employee, I want to edit a project's name, tags, and readme after upload, so that I can fix mistakes and keep project information current.

#### Acceptance Criteria

1. WHEN a user submits an edit request with a valid project name and at least one updated metadata field (name, tags, or readme), THE Edit_Lambda SHALL overwrite the corresponding metadata.json and readme.md files in the Project_Entry with the provided values while preserving any fields not included in the request
2. WHEN the edit request includes a new project name that differs from the current name, THE Edit_Lambda SHALL rename the Project_Entry by copying all files to the new path and deleting the old path
3. IF the edit request includes a new project name that is already taken by another project, THEN THE Edit_Lambda SHALL return a 409 error indicating the project name is already in use
4. IF the edit request references a project that does not exist, THEN THE Edit_Lambda SHALL return a 404 error indicating the project was not found
5. WHEN the Edit_Lambda successfully updates a Project_Entry, THE Edit_Lambda SHALL regenerate the Search_Index by scanning all projects/ prefixes in S3 to collect each metadata.json and overwriting global-index.json at the bucket root
6. THE Edit_Lambda SHALL validate the updated name using the same rules as upload (maximum 64 characters, alphanumeric characters, hyphens, and underscores only)
7. THE Edit_Lambda SHALL validate the updated tags using the same rules as upload (maximum 10 tags, each up to 32 characters, lowercase alphanumeric with hyphens and underscores)
8. THE Edit_Lambda SHALL validate the updated readme content using the same rules as upload (maximum 50,000 characters)
9. IF any validation rule fails during edit, THEN THE Edit_Lambda SHALL return a 400 error with a message describing the validation failure without applying any changes to the Project_Entry
10. WHEN an edit request includes new tags not yet in the Tag_Registry, THE Edit_Lambda SHALL add the new tags to the Tag_Registry
11. IF the rename operation fails after copying files to the new path but before deleting the old path, THEN THE Edit_Lambda SHALL delete the copied files at the new path and return a 500 error indicating the rename could not be completed
12. IF the edit request body contains no updatable fields (name, tags, or readme), THEN THE Edit_Lambda SHALL return a 400 error indicating at least one field must be provided for update

### Requirement 2: Replace Project Artifact

**User Story:** As an employee, I want to replace a project's artifact files after upload, so that I can update the source code without creating a new project entry.

#### Acceptance Criteria

1. WHEN a user submits an artifact replacement request with new files for an existing project, THE Edit_Lambda SHALL process the files using the same filtering and archiving pipeline as the upload flow (Deny_List, .gitignore parsing, archiver compression)
2. WHEN artifact processing completes, THE Edit_Lambda SHALL overwrite the existing artifact.zip in the Project_Entry with the new artifact while preserving the existing readme.md and metadata.json unchanged
3. IF all files in the replacement upload match the Deny_List or .gitignore patterns, THEN THE Edit_Lambda SHALL return a 400 error indicating no files remain after filtering
4. IF the resulting artifact.zip exceeds 100 MB in size, THEN THE Edit_Lambda SHALL return a 400 error indicating the artifact exceeds the maximum allowed size
5. THE artifact replacement flow SHALL use the same presigned upload mechanism as the initial upload (initiate session, upload zip to S3, finalize processing) and SHALL require a valid API key in the x-api-key header
6. IF the specified project does not exist in S3, THEN THE Edit_Lambda SHALL return a 404 error indicating the project was not found
7. WHEN artifact replacement completes successfully, THE Edit_Lambda SHALL delete the staged zip file from the Staging_Bucket and SHALL NOT regenerate the Search_Index since only the artifact binary changed

### Requirement 3: Delete Project

**User Story:** As an employee, I want to delete a project entirely, so that outdated or erroneous projects can be removed from the system.

#### Acceptance Criteria

1. WHEN a user submits a delete request for an existing project, THE Delete_Lambda SHALL remove all files under the Project_Entry path (readme.md, metadata.json, artifact.zip)
2. WHEN the Delete_Lambda successfully removes all Project_Entry files, THE Delete_Lambda SHALL regenerate the Search_Index to exclude the deleted project
3. IF the delete request references a project that does not exist, THEN THE Delete_Lambda SHALL return a 404 error indicating the project was not found
4. WHEN the delete operation completes successfully, THE Delete_Lambda SHALL return a 200 response with a confirmation message including the deleted project name
5. THE Delete_Lambda SHALL require a valid API key in the x-api-key header, consistent with the existing upload authentication
6. IF the Delete_Lambda fails to remove one or more files under the Project_Entry path, THEN THE Delete_Lambda SHALL return a 500 error indicating partial deletion failure and SHALL NOT regenerate the Search_Index
7. THE Delete_Lambda SHALL validate that the project name in the URL path matches the allowed format (alphanumeric characters, hyphens, and underscores only, maximum 64 characters) before attempting deletion

### Requirement 4: Edit UI

**User Story:** As an employee, I want an edit interface on the project detail page, so that I can modify project information without using external tools.

#### Acceptance Criteria

1. WHEN a user views a project detail page, THE Frontend SHALL display an "Edit" button that navigates to an edit form pre-filled with the current project name, tags, and readme content
2. WHEN the edit form loads, THE Frontend SHALL fetch the current project metadata and readme content to populate the form fields
3. IF the Frontend fails to fetch project metadata or readme content when loading the edit form, THEN THE Frontend SHALL display an error message indicating the project data could not be loaded and SHALL NOT render the edit form
4. THE edit form SHALL validate tags (maximum 10 tags, each up to 32 lowercase alphanumeric characters, hyphens, or underscores) and readme length (maximum 50,000 characters) using the same rules as the upload form
5. WHEN a user submits the edit form with metadata changes only (no new artifact), THE Frontend SHALL send a PATCH request to the API_Gateway with only the modified fields (tags and/or readme)
6. WHEN a user submits the edit form with a new folder selection, THE Frontend SHALL use the presigned upload flow to replace the artifact, followed by a metadata update via PATCH request
7. WHEN the edit operation completes successfully, THE Frontend SHALL display a confirmation message indicating the project was updated and navigate back to the updated project detail page within 2 seconds
8. IF the edit operation fails, THEN THE Frontend SHALL display the error message returned by the API, preserve all form field values, and keep the form editable for corrections

### Requirement 5: Delete UI

**User Story:** As an employee, I want a delete option on the project detail page with a confirmation step, so that I can remove projects while being protected from accidental deletion.

#### Acceptance Criteria

1. WHEN a user views a project detail page, THE Frontend SHALL display a "Delete" button
2. WHEN a user clicks the "Delete" button, THE Frontend SHALL display a confirmation dialog containing a text input and a confirm button, where the confirm button remains disabled until the user types the exact project name (case-sensitive match against the project metadata name)
3. WHEN the user types the correct project name and clicks the confirm button, THE Frontend SHALL disable the confirm button to prevent duplicate submissions and send a DELETE request to the API_Gateway for the specified project
4. IF the user dismisses the confirmation dialog or has typed a name that does not exactly match the project name, THEN THE Frontend SHALL cancel the delete operation and leave the project unchanged
5. WHEN the delete operation completes successfully, THE Frontend SHALL display a success message and navigate to the project list view (hash route #/)
6. IF the delete operation fails, THEN THE Frontend SHALL display the error message returned by the API, re-enable the confirm button, and keep the project detail page displayed
7. WHILE the DELETE request is in progress, THE Frontend SHALL display a loading indicator within the confirmation dialog

### Requirement 6: API Endpoints for Edit and Delete

**User Story:** As a developer, I want well-defined API endpoints for edit and delete operations, so that the frontend and any future integrations can manage projects programmatically.

#### Acceptance Criteria

1. THE API_Gateway SHALL expose a PATCH /projects/{name} endpoint that accepts a JSON body with optional fields: name (1–64 characters, alphanumeric, hyphens, and underscores only), tags (array of 1–10 tag strings, each 1–32 lowercase alphanumeric/hyphen/underscore characters), and readme (string, maximum 50,000 characters)
2. THE API_Gateway SHALL expose a DELETE /projects/{name} endpoint that accepts no body
3. THE API_Gateway SHALL require a valid API key in the x-api-key header for both the PATCH and DELETE endpoints
4. THE API_Gateway SHALL return appropriate CORS headers (Access-Control-Allow-Origin, Access-Control-Allow-Headers, Access-Control-Allow-Methods) for PATCH, DELETE, and OPTIONS requests on the /projects/{name} resource
5. IF the PATCH endpoint receives a request body with no recognized fields, THEN THE Edit_Lambda SHALL return a 400 error indicating at least one field must be provided for update
6. THE PATCH endpoint SHALL support partial updates, allowing a user to update only the fields included in the request body while leaving other fields at their existing values
7. WHEN the PATCH endpoint receives a valid request for an existing project, THE Edit_Lambda SHALL return a 200 response containing the updated project metadata
8. WHEN the DELETE endpoint receives a valid request for an existing project, THE Delete_Lambda SHALL remove the project entry from the global index, delete the project's S3 objects under its path prefix, and return a 200 response confirming deletion
9. IF the PATCH or DELETE endpoint receives a project name that does not match any existing project, THEN THE corresponding Lambda SHALL return a 404 error indicating the project was not found
