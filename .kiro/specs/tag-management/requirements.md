# Requirements Document

## Introduction

Tag Management enhances the Internal Repos project upload and search experience by replacing the free-text tag input with a structured tag selection system. Users select from existing tags via a multi-select interface, can add new tags through an explicit action, and benefit from AI-generated tag suggestions powered by AWS Bedrock (Kimi K2.5 model). The search page gains tag-based filtering so users can narrow results by specific tags.

## Glossary

- **Tag_Registry**: A JSON file (`tags.json`) stored at the S3 bucket root that contains the canonical list of all available tags in the system
- **Tag_Selector**: The frontend UI component that displays available tags as selectable options during project upload
- **Tag_Filter**: The frontend UI component on the search page that allows users to filter project results by selecting one or more tags
- **Tag_Suggestion_Lambda**: The AWS Lambda function that invokes AWS Bedrock with the Kimi K2.5 model to generate tag suggestions based on a project README
- **Suggestion_Prompt**: The prompt sent to the Kimi K2.5 model containing the project README and the list of existing tags from the Tag_Registry
- **Upload_Form**: The frontend form used to upload new projects, containing the Tag_Selector component
- **Search_Page**: The frontend page displaying the search input, Tag_Filter, and project results
- **Frontend**: The single-page application hosted on S3 and served via CloudFront
- **Upload_Lambda**: The AWS Lambda function that processes project uploads (initiate and finalize)

## Requirements

### Requirement 1: Tag Registry

**User Story:** As an administrator, I want a centralized list of available tags, so that tag usage remains consistent across projects.

#### Acceptance Criteria

1. WHEN the Upload_Form or Search_Page loads, THE Frontend SHALL fetch the Tag_Registry from `tags.json` at the S3 bucket root and make the tag list available for display or autocompletion within 2 seconds
2. WHEN a user adds a new tag during project upload, THE Upload_Lambda SHALL normalize the tag to lowercase, append it to the Tag_Registry, and persist the updated Tag_Registry to S3
3. THE Tag_Registry SHALL store tags as a JSON array of unique, lowercase strings sorted alphabetically, containing a maximum of 500 entries
4. WHEN the Upload_Lambda updates the Tag_Registry, THE Upload_Lambda SHALL ensure no duplicate tags are added by comparing new tags against existing entries case-insensitively
5. IF the Tag_Registry file does not exist in S3, THEN THE Frontend SHALL treat the available tag list as empty and allow the user to create new tags
6. IF the Tag_Registry file does not exist when the Upload_Lambda processes a new tag, THEN THE Upload_Lambda SHALL create a new Tag_Registry containing only the new tags
7. IF the Frontend fails to fetch the Tag_Registry due to a network or server error (non-404), THEN THE Frontend SHALL treat the available tag list as empty, allow the user to create new tags, and display a warning indicating that existing tag suggestions are unavailable
8. IF the Upload_Lambda fails to persist the updated Tag_Registry to S3, THEN THE Upload_Lambda SHALL proceed with the project upload without failing, and SHALL include a warning in the response indicating that the Tag_Registry could not be updated

### Requirement 2: Tag Selection in Upload Form

**User Story:** As an employee, I want to select tags from existing options when uploading a project, so that I use consistent terminology without needing to remember exact tag names.

#### Acceptance Criteria

1. WHEN the Upload_Form loads, THE Tag_Selector SHALL fetch and display all tags from the Tag_Registry as selectable options
2. WHEN a user clicks a tag in the Tag_Selector, THE Tag_Selector SHALL toggle the selected state of that tag and visually indicate whether the tag is selected or deselected
3. WHILE the Tag_Selector has 10 tags selected, THE Tag_Selector SHALL disable selection of additional unselected tags
4. IF a user attempts to select an eleventh tag, THEN THE Tag_Selector SHALL prevent the selection and display a message indicating the maximum tag limit of 10 has been reached
5. WHEN the Upload_Form is submitted, THE Upload_Form SHALL include all selected tags as a comma-separated string in the request body
6. WHEN a user clicks the "Add new tag" button in the Tag_Selector, THE Tag_Selector SHALL display a text input for entering a new tag name
7. WHEN a user submits a new tag via the "Add new tag" input, THE Tag_Selector SHALL validate that the tag is between 1 and 32 characters, contains only alphanumeric characters, hyphens, and underscores, and is not already present in the Tag_Registry (case-insensitive comparison)
8. WHEN a new tag passes validation, THE Tag_Selector SHALL add the new tag to the selectable list, mark it as selected, clear the text input, and include the tag in the upload request so the Upload_Lambda can persist it to the Tag_Registry
9. IF a new tag fails validation, THEN THE Tag_Selector SHALL display the specific validation error (too long, too short, invalid characters, or already exists) adjacent to the text input
10. IF the Tag_Registry fails to load when the Upload_Form loads, THEN THE Tag_Selector SHALL display a message indicating that existing tags could not be loaded, and SHALL still allow the user to add new tags manually

### Requirement 3: Tag-Based Search Filtering

**User Story:** As an employee, I want to filter search results by tags, so that I can quickly narrow down projects to those relevant to a specific technology or topic.

#### Acceptance Criteria

1. WHEN the Search_Page loads, THE Tag_Filter SHALL extract the unique set of all tags from the Search_Index and display them as selectable filter options sorted alphabetically
2. WHEN a user selects one or more tags in the Tag_Filter, THE Frontend SHALL filter the displayed search results to show only projects whose tags include ALL selected filter tags (AND logic) and update the displayed results within 100ms
3. WHEN a user deselects all tags in the Tag_Filter, THE Frontend SHALL display unfiltered search results (either all projects or the current text search results)
4. WHEN both a text search query and tag filters are active, THE Frontend SHALL apply the tag filter to the text search results, showing only projects that match both the text query and all selected tags
5. THE Tag_Filter SHALL visually distinguish active filter tags from inactive ones by applying a distinct CSS class to selected tags
6. WHEN a user clicks an active tag filter, THE Tag_Filter SHALL deselect it and update the displayed results within 100ms
7. IF the combined text search and tag filter produces zero matching projects, THEN THE Frontend SHALL display a message indicating no results were found for the current filter combination
8. WHEN the Search_Index contains no tags across all projects, THE Tag_Filter SHALL not render any filter options

### Requirement 4: AI-Generated Tag Suggestions

**User Story:** As an employee, I want the system to suggest relevant tags based on my project README, so that my project is accurately tagged without manual effort.

#### Acceptance Criteria

1. WHEN the README textarea in the Upload_Form contains 50 or more characters and the content has not changed for 500ms (debounced), THE Frontend SHALL send a single tag suggestion request to the Tag_Suggestion_Lambda with the current README content
2. WHEN the Tag_Suggestion_Lambda receives a suggestion request, THE Tag_Suggestion_Lambda SHALL invoke AWS Bedrock with the Kimi K2.5 model using the invoke_model API, passing the README content and the current Tag_Registry as context in the Suggestion_Prompt, with a maximum invocation timeout of 10 seconds
3. THE Tag_Suggestion_Lambda SHALL instruct the model to return a JSON object with a "tags" field containing an array of at most 10 suggested tag strings, where each suggested tag exists in the Tag_Registry
4. WHEN the Tag_Suggestion_Lambda receives a response from the model, THE Tag_Suggestion_Lambda SHALL validate that the response is valid JSON containing a "tags" field with an array of strings, discard any tags not found in the Tag_Registry, and return the remaining valid tags (up to 10)
5. WHEN the Frontend receives tag suggestions containing one or more tags, THE Tag_Selector SHALL display the suggestions as pre-selected tags, each with a label or icon distinguishing them as AI-suggested (distinct from manually selected tags)
6. IF the user has manually added or removed any tag in the Tag_Selector before suggestions arrive, THEN THE Frontend SHALL discard the AI suggestions and keep the user-modified tag selection unchanged
7. IF the user has not interacted with the Tag_Selector and AI suggestions are available, THEN THE Frontend SHALL use the AI-suggested tags as the default selection
8. IF the Tag_Suggestion_Lambda fails to invoke the model, the invocation exceeds the 10-second timeout, or the model returns a response that is not valid JSON or does not contain a "tags" field with an array of strings, THEN THE Tag_Suggestion_Lambda SHALL return an empty suggestions array and THE Frontend SHALL proceed without suggestions
9. IF the README content is empty or contains fewer than 50 characters, THEN THE Frontend SHALL skip requesting tag suggestions

### Requirement 5: Tag Suggestion Infrastructure

**User Story:** As a developer, I want the AI tag suggestion capability deployed as part of the existing infrastructure, so that it integrates seamlessly with the current system.

#### Acceptance Criteria

1. THE Tag_Suggestion_Lambda SHALL be deployed as a separate Lambda function with its own API Gateway endpoint (POST /tags/suggest), using the nodejs22.x runtime and a memory allocation of 512 MB
2. THE Tag_Suggestion_Lambda IAM role SHALL have permission to invoke the bedrock:InvokeModel action for the Kimi K2.5 model and read access (s3:GetObject) to the frontend S3 bucket at the path `tags.json` for fetching the Tag_Registry
3. THE API Gateway SHALL require a valid API key for the POST /tags/suggest endpoint, using the same usage plan as the upload endpoints
4. THE Tag_Suggestion_Lambda SHALL have a timeout of 30 seconds to accommodate model inference time
5. THE Tag_Suggestion_Lambda SHALL limit the README content sent to the model to 10,000 characters, truncating content beyond the first 10,000 characters when the input exceeds this limit
6. IF the Bedrock model invocation fails or times out, THEN THE Tag_Suggestion_Lambda SHALL return a 502 error response with a message indicating that tag suggestions are temporarily unavailable
7. THE API Gateway SHALL configure CORS for the POST /tags/suggest endpoint, allowing OPTIONS preflight requests and returning Access-Control-Allow-Origin, Access-Control-Allow-Methods, and Access-Control-Allow-Headers response headers consistent with the existing upload endpoints

### Requirement 6: Backend Tag Validation Updates

**User Story:** As a developer, I want the backend to support the new tag selection workflow, so that both selected and newly created tags are properly validated and stored.

#### Acceptance Criteria

1. WHEN the Upload_Lambda receives tags in the upload request, THE Upload_Lambda SHALL accept each tag as either a reference to an existing tag in the Tag_Registry or as a new tag explicitly marked with a `isNew: true` flag, and SHALL validate that each referenced existing tag is present in the Tag_Registry
2. WHEN the Upload_Lambda receives new tags (not in the Tag_Registry), THE Upload_Lambda SHALL validate that each new tag is between 1 and 32 characters in length and contains only lowercase alphanumeric characters, hyphens, and underscores (matching the pattern `^[a-z0-9_-]+$`)
3. WHEN all validations pass, THE Upload_Lambda SHALL add any new tags to the Tag_Registry before completing the upload, and SHALL complete the addition within the same request lifecycle
4. THE Upload_Lambda SHALL continue to store tags as a comma-separated string in SessionMetadata and as a string array in ProjectMetadata and ProjectIndexEntry
5. IF any tag fails validation (a referenced tag does not exist in the Tag_Registry, or a new tag violates the length or character-set rules), THEN THE Upload_Lambda SHALL return a 400 error with a message indicating which tag is invalid and the reason for rejection, without persisting any new tags from the request
6. IF a new tag in the request matches an existing entry in the Tag_Registry (case-insensitive), THEN THE Upload_Lambda SHALL treat it as a reference to the existing tag rather than creating a duplicate entry
