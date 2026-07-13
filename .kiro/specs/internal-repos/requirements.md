# Requirements Document

## Introduction

Internal Repos is an internal tool that enables employees to search, browse, and upload past company projects. The system consists of a static frontend (S3 + CloudFront), a serverless upload endpoint (API Gateway + Lambda), and an auto-generated search index. Employees can discover projects via fuzzy search, view README documentation with syntax highlighting, download project artifacts, and contribute new projects through a web upload form or CI/CD pipeline.

## Glossary

- **Frontend**: The single-page application hosted on S3 and served via CloudFront, built with Vite
- **Search_Index**: The `global-index.json` manifest file that contains metadata for all projects, used for client-side search
- **Upload_Lambda**: The AWS Lambda function triggered by API Gateway that processes project uploads
- **Project_Entry**: A directory under `projects/{project-name}/` in S3 containing readme.md, metadata.json, and artifact.zip
- **Metadata**: A JSON file (`metadata.json`) containing project name, description, tags, and date
- **Artifact**: A zip archive (`artifact.zip`) of the uploaded project source files after filtering
- **Deny_List**: A hardcoded set of file/directory patterns that are always excluded from artifacts (.git/, .terraform/, node_modules/, __pycache__/, .env, .env.*, *.pyc, .DS_Store)
- **Fuse_Search**: Client-side fuzzy search powered by Fuse.js matching against project names and tags

## Requirements

### Requirement 1: Project Search

**User Story:** As an employee, I want to search for past projects by name or tags, so that I can quickly find relevant work without browsing manually.

#### Acceptance Criteria

1. WHEN the Frontend loads, THE Frontend SHALL fetch the Search_Index and initialize Fuse_Search with project names, descriptions, and tags as searchable fields
2. WHEN a user types a query into the search input, THE Frontend SHALL debounce the input by 200ms and then THE Fuse_Search SHALL return matching projects ranked by relevance within 100ms for indexes containing up to 1000 projects
3. WHEN the search query is empty, THE Frontend SHALL display all projects from the Search_Index sorted by date descending
4. WHEN no projects match the search query, THE Frontend SHALL display a message indicating no results were found
5. IF the Search_Index fails to load during Frontend initialization, THEN THE Frontend SHALL display an error message indicating that projects could not be loaded and SHALL provide a retry option
6. WHEN a user types a query of fewer than 1 character, THE Frontend SHALL treat the query as empty and display all projects

### Requirement 2: Project Browsing

**User Story:** As an employee, I want to browse project details including documentation, so that I can understand what a project does and how it works.

#### Acceptance Criteria

1. WHEN a user selects a project from the search results, THE Frontend SHALL fetch and render the project readme.md using marked with syntax highlighting via highlight.js within 2 seconds for files up to 1MB in size
2. WHEN a user views a project detail page, THE Frontend SHALL display the project name, description, tags, and date (in "YYYY-MM-DD" format) from the Metadata
3. WHEN a user clicks the download link, THE Frontend SHALL initiate a direct download of the Artifact from S3
4. IF the readme.md fails to load, THEN THE Frontend SHALL display an error message indicating the documentation is unavailable while still displaying the available Metadata fields
5. IF the Metadata fails to load, THEN THE Frontend SHALL display an error message indicating project details are unavailable
6. IF the Artifact is unavailable, THEN THE Frontend SHALL disable the download link and display a message indicating the artifact is not available for download

### Requirement 3: Project Upload via UI

**User Story:** As an employee, I want to upload a new project through a web form, so that I can share my work with the rest of the team.

#### Acceptance Criteria

1. THE Frontend SHALL provide an upload form with fields for project name (maximum 64 characters, restricted to alphanumeric characters, hyphens, and underscores), tags (comma-separated, maximum 10 tags each up to 32 characters), readme content (textarea, maximum 50,000 characters), and a file input supporting folder selection via webkitdirectory
2. WHEN a user submits the upload form, THE Frontend SHALL send the project files and metadata to the API Gateway POST endpoint with a maximum total payload size of 10 MB
3. WHEN the Upload_Lambda receives an upload request with all required fields present and valid project name format, THE Upload_Lambda SHALL write readme.md, metadata.json, and artifact.zip to the Project_Entry path in S3
4. WHEN the Upload_Lambda completes writing project files, THE Upload_Lambda SHALL regenerate the Search_Index by scanning all existing metadata.json files in S3
5. IF the upload request is missing required fields (project name, readme content, or at least one file), THEN THE Upload_Lambda SHALL return a 400 error with a message indicating which required fields are missing
6. IF a project with the same name already exists in S3, THEN THE Upload_Lambda SHALL return a 409 error with a message indicating the project name is already taken
7. IF the project name contains characters other than alphanumeric characters, hyphens, or underscores, THEN THE Upload_Lambda SHALL return a 400 error with a message indicating the allowed character set
8. WHEN the upload completes successfully, THE Frontend SHALL display a confirmation message and clear the upload form

### Requirement 4: Artifact Filtering

**User Story:** As an employee, I want uploaded project artifacts to exclude unnecessary files, so that downloads remain small and sensitive files are not stored.

#### Acceptance Criteria

1. WHEN the Upload_Lambda processes uploaded files, THE Upload_Lambda SHALL exclude all files and directories matching the Deny_List using glob-style pattern matching
2. WHEN a .gitignore file is present in the uploaded project root, THE Upload_Lambda SHALL parse the root-level .gitignore and exclude matching files in addition to the Deny_List, where Deny_List patterns shall take precedence and cannot be overridden by .gitignore negation patterns
3. WHEN the Upload_Lambda has filtered the files, THE Upload_Lambda SHALL compress the remaining files into a single artifact.zip using the archiver library, preserving the original directory structure relative to the project root
4. IF all files in an upload match the Deny_List or .gitignore patterns, THEN THE Upload_Lambda SHALL return a 400 error indicating no files remain after filtering
5. IF the resulting artifact.zip exceeds 100 MB in size, THEN THE Upload_Lambda SHALL return a 400 error indicating the artifact exceeds the maximum allowed size
6. IF the .gitignore file is present but cannot be parsed, THEN THE Upload_Lambda SHALL proceed with filtering using only the Deny_List and include a warning in the response indicating the .gitignore was ignored due to a parse error

### Requirement 5: Search Index Generation

**User Story:** As an employee, I want the project index to stay current automatically, so that newly uploaded projects are immediately searchable.

#### Acceptance Criteria

1. WHEN the Upload_Lambda finishes writing a new Project_Entry, THE Upload_Lambda SHALL scan all projects/ prefixes in S3 to collect each metadata.json, including the newly written Project_Entry
2. WHEN the scan of all metadata.json files is complete, THE Upload_Lambda SHALL generate a Search_Index as a valid JSON array of objects, each containing the fields: name, description, tags, date, and path corresponding to the Project_Entry location
3. WHEN the Search_Index is regenerated, THE Upload_Lambda SHALL overwrite the global-index.json file at the S3 bucket root
4. IF a metadata.json file is malformed (invalid JSON or missing any of the required fields: name, description, tags, or date) or unreadable, THEN THE Upload_Lambda SHALL skip that project and continue generating the Search_Index from the remaining valid projects
5. IF the Upload_Lambda fails to write global-index.json to S3, THEN THE Upload_Lambda SHALL return an error response indicating that index generation failed, without deleting the previously existing global-index.json

### Requirement 6: Authentication

**User Story:** As an administrator, I want the upload endpoint to be protected, so that only authorized employees can add projects.

#### Acceptance Criteria

1. THE API Gateway SHALL require a valid API key (matching a key configured in an API Gateway usage plan) in the x-api-key header for all requests to the upload endpoint
2. IF a request to the upload endpoint is missing or contains an invalid API key, THEN THE API Gateway SHALL return a 403 Forbidden response with a JSON body containing an error message
3. THE Frontend SHALL include the API key in all requests to the upload endpoint, where the key is provided via build-time environment configuration and not hardcoded in source code
4. THE read-only endpoints (Search_Index fetch, readme.md fetch, Artifact download) SHALL NOT require authentication and SHALL be publicly accessible via CloudFront

### Requirement 7: Infrastructure and Deployment

**User Story:** As a developer, I want the infrastructure and application to be deployed through a CI/CD pipeline, so that changes are consistently and safely delivered.

#### Acceptance Criteria

1. WHEN code is pushed to the main branch, THE CI/CD_Pipeline SHALL run terraform plan and apply to provision infrastructure (S3, CloudFront, API Gateway, Lambda)
2. WHEN infrastructure provisioning succeeds, THE CI/CD_Pipeline SHALL build the frontend using npm run build and sync the build output directory to the S3 bucket
3. WHEN the S3 sync completes, THE CI/CD_Pipeline SHALL create a CloudFront cache invalidation for all paths
4. WHEN a pull request containing files under a projects/{project-name}/ directory is merged to the main branch, THE CI/CD_Pipeline SHALL validate that the project directory contains at minimum a readme.md and a metadata.json file, deploy the project files to the corresponding Project_Entry path in S3, and regenerate the Search_Index
5. IF terraform plan, npm run build, or S3 sync fails during the pipeline execution, THEN THE CI/CD_Pipeline SHALL halt the pipeline, skip all subsequent steps, and report the failure with the name of the failed step

### Requirement 8: Static Hosting and CDN

**User Story:** As an employee, I want the application to load quickly over HTTPS, so that I have a fast and secure browsing experience.

#### Acceptance Criteria

1. THE S3_Bucket SHALL be configured for static website hosting with index.html as the default document and index.html as the error document to support SPA client-side routing
2. THE CloudFront_Distribution SHALL serve all S3 content over HTTPS and SHALL redirect HTTP requests to HTTPS
3. WHEN a user requests the application URL, THE CloudFront_Distribution SHALL return cached content with a Time-to-First-Byte under 500ms for repeat requests from the same edge location
4. THE CloudFront_Distribution SHALL support a custom domain name with a valid TLS certificate issued via AWS Certificate Manager
