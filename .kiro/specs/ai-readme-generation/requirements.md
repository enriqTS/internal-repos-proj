# Requirements Document

## Introduction

AI-powered README generation for the Internal Repos project upload flow. When a user uploads a project without providing a README, the system automatically generates one using the Kimi K2.5 model (already integrated via Bedrock for tag suggestions). The generation uses a tiered file prioritization system to select the most informative files from the uploaded project, constructs a prompt within a ~100K token budget, and produces a markdown README. This is a one-time operation at upload time with graceful fallback if the model is unavailable.

## Glossary

- **Finalize_Lambda**: The Lambda function (`process.ts`) that handles POST /upload/finalize, responsible for processing uploaded zip files, filtering, creating artifacts, and writing to S3
- **README_Generator**: The module responsible for selecting files, building the prompt, invoking Bedrock, and returning generated README content
- **File_Prioritizer**: The component that classifies uploaded files into tiers and selects content within the token budget
- **Bedrock_Client**: The AWS SDK client used to invoke the Kimi K2.5 model via Amazon Bedrock
- **Token_Budget**: The approximate 100,000 token cap on input sent to the model to control costs
- **Tier_1_Files**: Entry points (main.*, index.*, app.*, server.*), package.json (trimmed), Dockerfile, docker-compose.yml, Makefile — always included with full content
- **Tier_2_Files**: Source code files (*.ts, *.py, *.go, *.java, *.rs, etc.) excluding test files — included with full content if budget allows
- **Tier_3_Files**: Test files, config files, and remaining files — included only as a directory listing of file names
- **Skip_Files**: Binary/media files, lock files, large JSON/YAML (>10KB), CI/CD pipelines, IaC files, generated files — excluded entirely from model input
- **SessionMetadata**: The metadata object stored in the staging bucket containing project name, tags, readme content, and upload mode

## Requirements

### Requirement 1: Trigger Condition

**User Story:** As an uploader, I want the system to generate a README only when I have not provided one, so that my manual README is never overwritten.

#### Acceptance Criteria

1. WHEN the SessionMetadata readme field is empty, contains only whitespace, or is undefined AND the upload mode is "create", THE Finalize_Lambda SHALL invoke the README_Generator with the uploaded project files to produce a README for the project.
2. WHEN the SessionMetadata readme field contains at least one non-whitespace character, THE Finalize_Lambda SHALL use the user-provided README as the project README without invoking the README_Generator.
3. WHEN the upload mode is "replace", THE Finalize_Lambda SHALL skip README generation regardless of the readme field value.
4. IF the README_Generator is invoked and fails to produce a README, THEN THE Finalize_Lambda SHALL proceed with the upload using an empty string as the readme value and SHALL include a warning in the response indicating that automatic README generation failed.

### Requirement 2: File Prioritization

**User Story:** As a system operator, I want uploaded files to be classified into priority tiers, so that the most informative files are sent to the model within the token budget.

#### Acceptance Criteria

1. THE File_Prioritizer SHALL classify each file into exactly one of four categories: Tier_1_Files, Tier_2_Files, Tier_3_Files, or Skip_Files, evaluating rules in the order Tier_1, Skip, Tier_2, with Tier_3 as the default for unmatched files
2. THE File_Prioritizer SHALL classify files matching entry point patterns (main.*, index.*, app.*, server.*, where * matches any single file extension) located at the project root directory or directly within a src/ directory as Tier_1_Files
3. THE File_Prioritizer SHALL classify package.json, Dockerfile, docker-compose.yml, and Makefile located at the project root directory as Tier_1_Files
4. THE File_Prioritizer SHALL classify source code files with extensions .ts, .py, .go, .java, .rs, .rb, .cpp, .c, .h, .cs, .swift, .kt, .scala, .clj, .ex, .exs, .hs, .ml, .lua, .php, .sh as Tier_2_Files, excluding files whose path contains a segment matching "test", "spec", or "__tests__" (case-insensitive comparison on each path segment between separators)
5. THE File_Prioritizer SHALL classify the following as Skip_Files: binary files (extensions: .exe, .dll, .so, .dylib, .bin, .dat, .o, .a, .lib, .class, .wasm, .pdf, .zip, .tar, .gz, .rar, .7z), media files (extensions: .png, .jpg, .jpeg, .gif, .svg, .ico, .mp3, .mp4, .wav, .avi, .mov, .webm, .webp, .bmp, .tiff), lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock, Gemfile.lock, poetry.lock), JSON/YAML files (.json, .yaml, .yml) whose content size exceeds 10,240 bytes, CI/CD files (paths starting with .github/, .gitlab-ci.yml, Jenkinsfile, paths starting with .circleci/), IaC files (*.tf, *.tfvars, filenames starting with "cloudformation", *.sam.yml), and generated files (*.generated.*, *.min.js, *.min.css, *.map, *.d.ts)
6. THE File_Prioritizer SHALL classify all remaining files not matched by Tier_1, Skip, or Tier_2 rules as Tier_3_Files
7. IF a file matches classification rules for more than one category, THEN THE File_Prioritizer SHALL assign the file to the highest-precedence category, where precedence order from highest to lowest is: Tier_1, Skip, Tier_2, Tier_3

### Requirement 3: Token Budget Management

**User Story:** As a system operator, I want the model input to stay within a token budget, so that costs remain predictable and requests do not exceed model limits.

#### Acceptance Criteria

1. THE File_Prioritizer SHALL include all Tier_1_Files with full content regardless of budget consumption
2. WHEN including package.json as a Tier_1_File, THE File_Prioritizer SHALL trim the content to only the "name", "version", "description", "scripts", "dependencies", and "devDependencies" fields
3. THE File_Prioritizer SHALL include Tier_2_Files with full content in case-insensitive alphabetical order by relative file path until the cumulative token estimate reaches the Token_Budget
4. WHEN including the next Tier_2_File would cause the cumulative token estimate to exceed the Token_Budget, THE File_Prioritizer SHALL exclude that file and stop adding additional Tier_2_Files without including partial file content
5. THE File_Prioritizer SHALL include Tier_3_Files as a flat list of file paths only, where each path is counted toward the token estimate using the same 1 token per 4 characters ratio but no file content is included
6. THE File_Prioritizer SHALL estimate token count using a ratio of 1 token per 4 characters of content
7. THE File_Prioritizer SHALL enforce a maximum Token_Budget of 100,000 tokens
8. IF the cumulative token estimate of all Tier_1_Files exceeds the Token_Budget, THEN THE File_Prioritizer SHALL still include all Tier_1_Files and SHALL skip Tier_2_File content inclusion entirely, proceeding directly to Tier_3_File path listing

### Requirement 4: Prompt Construction

**User Story:** As a developer, I want the model prompt to be well-structured, so that the generated README is accurate and useful.

#### Acceptance Criteria

1. THE README_Generator SHALL construct a prompt containing, in order: a system instruction, the project name, the full text content of each included Tier_1_File and Tier_2_File each preceded by its file path, and the directory listing of Tier_3_Files
2. THE README_Generator SHALL instruct the model to produce a markdown README containing the following sections in order: project title, description, key features, technology stack, project structure overview, and setup/usage instructions. IF the provided file content does not contain sufficient information to determine setup or usage steps, THEN THE README_Generator SHALL instruct the model to omit the setup/usage instructions section rather than fabricating content.
3. THE README_Generator SHALL instruct the model to base the README only on the provided file content and not fabricate features or dependencies not present in the files
4. IF a Tier_1_File or Tier_2_File cannot be read as text, THEN THE README_Generator SHALL exclude that file from the prompt and continue constructing the prompt with the remaining files

### Requirement 5: Model Invocation

**User Story:** As a developer, I want the system to invoke the Kimi K2.5 model correctly, so that README generation produces consistent results.

#### Acceptance Criteria

1. THE README_Generator SHALL invoke Bedrock using the InvokeModel API with model ID "us.moonshotai.kimi-k2.5-0613-v1:0", content type "application/json", and a request body containing a messages array with the prompt and max_tokens set to 4096.
2. THE README_Generator SHALL set a maximum invocation timeout of 30 seconds for the Bedrock model request.
3. WHEN the Bedrock model returns a response, THE README_Generator SHALL extract the generated markdown content from the response body by checking, in order: the `choices[0].message.content` field, the `content` field, or the `completion` field, and SHALL use the first non-empty value found.
4. IF the Bedrock model invocation fails, times out, or returns a response from which no content can be extracted, THEN THE README_Generator SHALL return an empty string as the generated README content without raising an unhandled error.

### Requirement 6: Graceful Fallback

**User Story:** As an uploader, I want my project upload to succeed even if README generation fails, so that a model error does not block my workflow.

#### Acceptance Criteria

1. IF the Bedrock invocation fails with any error (timeout, throttling, service error), THEN THE Finalize_Lambda SHALL log the error details (error type and message) to CloudWatch and continue the upload using "No description provided" as the readme content
2. IF the model returns an empty response body or a response that does not contain extractable text content, THEN THE README_Generator SHALL return an empty string, and THE Finalize_Lambda SHALL use "No description provided" as the readme content
3. WHEN README generation fails for any reason (Bedrock invocation error or unparseable response), THE Finalize_Lambda SHALL still complete all remaining upload steps (artifact creation, metadata write, index regeneration) without interruption and SHALL return a successful response to the caller
4. IF README generation fails, THEN THE Finalize_Lambda SHALL include a warning field in the FinalizeResponse indicating that README generation was skipped due to an error

### Requirement 7: Integration with Upload Flow

**User Story:** As a developer, I want README generation to fit into the existing finalize flow, so that no new infrastructure is required.

#### Acceptance Criteria

1. THE Finalize_Lambda SHALL invoke the README_Generator after file extraction and filtering (step 5 in current flow) and before writing project data to S3 (step 8 in current flow)
2. WHEN the README_Generator returns non-empty content, THE Finalize_Lambda SHALL use that content as the readme for metadata.description (first 200 characters) and the readme.md S3 object
3. THE Finalize_Lambda SHALL complete README generation within the existing 120-second Lambda timeout
4. THE README_Generator SHALL reuse the existing BedrockRuntimeClient and InvokeModelCommand pattern from the suggest-tags Lambda

### Requirement 8: Output Quality Constraints

**User Story:** As a project browser, I want generated READMEs to be well-formed and appropriately sized, so that they are useful when viewing projects.

#### Acceptance Criteria

1. THE README_Generator SHALL return content that is valid markdown, defined as content that can be parsed by the marked library without throwing an error and that contains at least one non-whitespace character
2. THE README_Generator SHALL return content that is at least 1 character and does not exceed the MAX_README_LENGTH constant (50,000 characters)
3. IF the generated content exceeds MAX_README_LENGTH, THEN THE README_Generator SHALL truncate the content at the last newline character at or before the MAX_README_LENGTH boundary to preserve complete lines, and the truncated result SHALL be at least 1 character long
4. IF the README_Generator produces empty or whitespace-only content, THEN THE README_Generator SHALL return an error indication to the caller rather than returning the empty content
