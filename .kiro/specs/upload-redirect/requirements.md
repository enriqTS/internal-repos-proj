# Requirements Document

## Introduction

After a successful project upload, the application currently displays a success message and resets the form. This feature replaces that behavior with an immediate redirect to the search/project list page (`#/`), so the user lands on the updated project list without manual navigation. The search index invalidation is preserved to ensure the list reflects the newly uploaded project.

## Glossary

- **Upload_Form**: The frontend component (`upload-form.ts`) that handles the multi-step project upload flow (zip creation, initiate, S3 upload, finalize).
- **Search_View**: The hash route `#/` that renders the project search and listing page.
- **Search_Index**: The cached project index used by the search view; invalidation forces a re-fetch on next render.
- **Finalize_Step**: The final API call in the upload flow that processes the uploaded zip and returns a success or error response.

## Requirements

### Requirement 1

**User Story:** As a user, I want to be redirected to the project list immediately after a successful upload, so that I can see my newly uploaded project without extra navigation steps.

#### Acceptance Criteria

1. WHEN the Finalize_Step returns a successful response, THE Upload_Form SHALL navigate the browser to the Search_View by assigning `window.location.hash = '#/'`.
2. WHEN the Finalize_Step returns a successful response, THE Upload_Form SHALL invalidate the Search_Index before performing the redirect.
3. WHEN the Finalize_Step returns a successful response, THE Upload_Form SHALL redirect without displaying a success status message to the user.
4. WHEN the Finalize_Step returns a successful response, THE Upload_Form SHALL not reset the form fields (the redirect replaces the form reset).

### Requirement 2

**User Story:** As a user, I want the project list to reflect my new upload when I arrive after redirect, so that I have confidence the upload completed.

#### Acceptance Criteria

1. WHEN the Search_View renders after an upload redirect, THE Search_View SHALL re-fetch the Search_Index from the server because the index was invalidated prior to redirect.

### Requirement 3

**User Story:** As a user, I want error handling to remain unchanged so that upload failures still display useful feedback on the upload form.

#### Acceptance Criteria

1. IF the Finalize_Step returns an error response, THEN THE Upload_Form SHALL display the error message in the status area and remain on the upload page.
2. IF any preceding upload step (initiate, S3 upload) fails, THEN THE Upload_Form SHALL display the error message in the status area and remain on the upload page.
