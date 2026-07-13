# Requirements Document

## Introduction

Auto-Tag from Generated README bridges the gap between AI-powered README generation and AI-powered tag suggestion. Currently, the system generates a README on the backend when the user does not provide one (during project upload finalization), and separately, the frontend triggers tag suggestions based on README content typed or autofilled into the textarea. However, when no README is provided and the backend generates one, the tag suggestion system is never invoked — resulting in projects uploaded without a README also having no tags. This feature connects the two systems so that after the Finalize_Lambda generates a README, it automatically uses that generated README to select appropriate tags via the existing Tag_Suggestion logic.

## Glossary

- **Finalize_Lambda**: The Lambda function (`process.ts`) handling POST /upload/finalize, responsible for processing uploaded zip files, filtering, README generation, artifact creation, and writing to S3
- **README_Generator**: The module (`generate-readme.ts`) responsible for selecting files, building the prompt, invoking Bedrock, and returning generated README content
- **Tag_Suggestion_Logic**: The logic from `suggest-tags.ts` that invokes the AI model with a README and the Tag_Registry to produce a list of relevant tags
- **Tag_Registry**: The JSON file (`tags.json`) stored at the S3 bucket root containing the canonical list of all available tags
- **SessionMetadata**: The metadata object stored in the staging bucket containing project name, tags, readme content, upload mode, and new tags
- **ProjectMetadata**: The metadata object written to the frontend bucket containing name, description, tags, and date
- **Auto_Tag_Result**: The list of tags produced by running the Tag_Suggestion_Logic against a generated README

## Requirements

### Requirement 1: Trigger Auto-Tagging After README Generation

**User Story:** As an employee uploading a project without a README, I want the system to automatically suggest and apply tags based on the generated README, so that my project is discoverable by tags without requiring me to manually select them.

#### Acceptance Criteria

1. WHEN the Finalize_Lambda generates a README (because the SessionMetadata readme field is empty or whitespace-only) AND the SessionMetadata tags field is empty or contains no non-empty tags, THE Finalize_Lambda SHALL invoke the Tag_Suggestion_Logic with the generated README content and store the returned tags (up to 10) in the ProjectMetadata tags array
2. WHEN the SessionMetadata tags field already contains one or more non-empty tags (user-selected or AI-suggested via the frontend), THE Finalize_Lambda SHALL skip auto-tagging and use the user-provided tags unchanged
3. WHEN the Finalize_Lambda generates a README but the generation result is empty or contains the fallback text "No description provided", THE Finalize_Lambda SHALL skip auto-tagging and proceed with an empty tag list
4. WHEN the upload mode is "replace", THE Finalize_Lambda SHALL skip auto-tagging regardless of the README or tags state
5. IF the Tag_Suggestion_Logic invocation fails, times out, or returns an invalid response during auto-tagging, THEN THE Finalize_Lambda SHALL proceed with an empty tag list and include a warning in the response indicating that auto-tagging was unavailable

### Requirement 2: Tag Suggestion Invocation from Backend

**User Story:** As a developer, I want the tag suggestion logic to be reusable from within the Finalize_Lambda, so that auto-tagging does not require an additional HTTP call or infrastructure changes.

#### Acceptance Criteria

1. THE Finalize_Lambda SHALL invoke the Tag_Suggestion_Logic as a direct function call within the same Lambda execution, reusing the existing AI client and Tag_Registry fetching logic, without making an HTTP request to the POST /tags/suggest endpoint
2. THE Tag_Suggestion_Logic invoked from the Finalize_Lambda SHALL use the same prompt format, model parameters, and response parsing logic as the existing suggest-tags Lambda handler, including case-insensitive matching of suggested tags against the Tag_Registry
3. THE Tag_Suggestion_Logic SHALL accept a README string and return an array of suggested tag strings (each present in the Tag_Registry), with a maximum of 10 tags
4. THE Tag_Suggestion_Logic SHALL truncate the README content to 10,000 characters before sending it to the model, consistent with the existing suggest-tags behavior
5. IF the README string is empty, undefined, or contains only whitespace, THEN THE Tag_Suggestion_Logic SHALL return an empty array without invoking the AI model
6. IF the Tag_Registry is empty or the AI model invocation fails, THEN THE Tag_Suggestion_Logic SHALL return an empty array without propagating the error to the Finalize_Lambda caller

### Requirement 3: Apply Auto-Tagged Results to Project Metadata

**User Story:** As an employee, I want auto-suggested tags to appear on my uploaded project, so that other team members can find my project by browsing or filtering tags.

#### Acceptance Criteria

1. WHEN the Tag_Suggestion_Logic returns one or more tags and the user has not manually modified the tag selection, THE Finalize_Lambda SHALL use the AI-suggested tags as the project tags, storing them as a string array in the ProjectMetadata tags field and including them in the ProjectIndexEntry tags field of the regenerated Search_Index
2. WHEN the Tag_Suggestion_Logic returns an empty array and the user has not manually selected any tags, THE Finalize_Lambda SHALL proceed with an empty tags array in the ProjectMetadata and ProjectIndexEntry
3. THE Finalize_Lambda SHALL store auto-tagged results in the same format as user-selected tags (a string array of up to 10 entries in ProjectMetadata and ProjectIndexEntry), with no distinction between auto-tagged and manually tagged projects in the persisted data
4. THE Finalize_Lambda SHALL NOT add auto-suggested tags to the Tag_Registry as new tags, since auto-suggested tags are always selected from existing registry entries
5. IF the user has manually selected or deselected tags in the Tag_Selector before submission, THEN THE Finalize_Lambda SHALL use the user-modified tag selection and discard any AI-suggested tags

### Requirement 4: Graceful Failure Handling

**User Story:** As an employee, I want my project upload to succeed even if auto-tagging fails, so that a model error during tag suggestion does not block my upload.

#### Acceptance Criteria

1. IF the Tag_Suggestion_Logic fails with any error (model invocation error, timeout, or invalid response format), THEN THE Finalize_Lambda SHALL log the error type and error message to CloudWatch, proceed with an empty tags array, and continue the upload without interruption
2. IF the Tag_Suggestion_Logic does not return a valid response within 10 seconds of invocation, THEN THE Finalize_Lambda SHALL abort the suggestion request and proceed with an empty tags array
3. WHEN auto-tagging fails or is aborted due to timeout, THE Finalize_Lambda SHALL include a warning string in the FinalizeResponse `warning` field indicating that automatic tag suggestion was unsuccessful
4. THE Finalize_Lambda SHALL complete the entire finalization flow (including README generation and tag suggestion) within the 120-second Lambda timeout by enforcing a maximum of 30 seconds for README generation and a maximum of 10 seconds for tag suggestion, ensuring at least 80 seconds remain for file processing, artifact creation, and S3 writes
5. IF both README generation and tag suggestion fail, THEN THE Finalize_Lambda SHALL proceed with the fallback README content and an empty tags array, and SHALL include warnings for both failures in the FinalizeResponse `warning` field

### Requirement 5: Execution Order in Finalize Flow

**User Story:** As a developer, I want auto-tagging to fit cleanly into the existing finalize flow, so that no race conditions or ordering issues arise.

#### Acceptance Criteria

1. THE Finalize_Lambda SHALL invoke auto-tagging after README generation (step 6.5) and before writing project data to S3 (step 8), so that the generated tags are included in the ProjectMetadata constructed at step 8
2. THE Finalize_Lambda SHALL invoke auto-tagging after new tag registry persistence (step 6), so that any user-created new tags are available in the Tag_Registry for the suggestion model to reference
3. WHEN both README generation and auto-tagging are performed in the same request, THE Finalize_Lambda SHALL execute them sequentially (README generation first, then auto-tagging), not in parallel, because auto-tagging depends on the generated README content as input

