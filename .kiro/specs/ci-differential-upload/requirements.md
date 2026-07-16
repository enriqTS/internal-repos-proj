# Requirements Document

## Introduction

This feature optimizes the CI/CD template deployment pipeline by implementing differential (hash-based) uploads. Instead of unconditionally uploading all template files on every push to main, the system computes content hashes, compares them against a stored manifest in S3, and uploads only files that have actually changed. This dramatically reduces deploy time when templates have not been modified or only a few files differ.

## Glossary

- **Differential_Upload_Script**: The TypeScript/Node.js CI script responsible for computing file hashes, comparing them to a remote manifest, and uploading only changed files to S3.
- **Hash_Manifest**: A JSON file stored in S3 that maps each file's relative path to its SHA-256 content hash and file size. Used to determine which files have changed between builds.
- **Template**: A directory under `templates/chatbot-rag-*/` containing source files, metadata, documentation, and architecture diagrams that are deployed to S3.
- **File_Tree_Manifest**: The existing `file-tree.json` manifest listing all files and directories for the file browser frontend component.
- **Templates_Bucket**: The S3 bucket that stores deployed template assets, separate from the frontend bucket.
- **Expand_Script**: The existing `expand-template-files.ts` script that walks a template directory and uploads each file individually to S3.

## Requirements

### Requirement 1: Compute Content Hashes for Template Files

**User Story:** As a CI pipeline operator, I want the system to compute SHA-256 hashes for all deployable template files, so that changes can be detected without re-uploading everything.

#### Acceptance Criteria

1. WHEN a template directory is processed, THE Differential_Upload_Script SHALL compute a SHA-256 hash for each file discovered by the directory walker, using the raw file content bytes as input (excluding filename, metadata, and filesystem attributes from the hash computation).
2. THE Differential_Upload_Script SHALL exclude the following directories during traversal: `.git`, `node_modules`, `__pycache__`, `.pytest_cache`, `.hypothesis`, `.ruff_cache`, `.kiro`, `.venv`, `venv`, `dist`, `build`, `.terraform`.
3. THE Differential_Upload_Script SHALL produce a Hash_Manifest containing, for every discovered file: the relative path (using forward-slash separators relative to the template root directory), the lowercase hexadecimal SHA-256 hash (64 characters), and the file size in bytes.
4. IF the template directory does not exist or contains zero files after exclusion rules are applied, THEN THE Differential_Upload_Script SHALL exit with a non-zero exit code and log an error message indicating the empty or missing directory.
5. WHEN computing hashes, THE Differential_Upload_Script SHALL read each file sequentially in its entirety to produce a deterministic hash that is identical across repeated runs on unchanged file content.

### Requirement 2: Store and Retrieve Hash Manifest from S3

**User Story:** As a CI pipeline operator, I want hash manifests stored in S3 alongside the template assets, so that subsequent builds can retrieve them for comparison.

#### Acceptance Criteria

1. WHEN a template deployment completes, THE Differential_Upload_Script SHALL upload the computed Hash_Manifest to S3 at the key `{prefix}/{name}/hash-manifest.json` with `application/json` content type.
2. WHEN a template deployment begins, THE Differential_Upload_Script SHALL attempt to retrieve the existing Hash_Manifest from S3 at the key `{prefix}/{name}/hash-manifest.json`.
3. IF the Hash_Manifest does not exist in S3 (HTTP 404 / NoSuchKey response), THEN THE Differential_Upload_Script SHALL treat all files as new and upload the complete set.
4. IF the Hash_Manifest retrieval fails due to a transient error (network timeout, HTTP 5xx, or access denied), THEN THE Differential_Upload_Script SHALL fail the deployment and report an error message indicating the retrieval failure reason.
5. IF the Hash_Manifest upload fails after deployment completes, THEN THE Differential_Upload_Script SHALL fail the pipeline run and report an error message indicating that the manifest was not persisted.

### Requirement 3: Differential Comparison and Selective Upload

**User Story:** As a CI pipeline operator, I want only changed or new files to be uploaded, so that deployment time is reduced when few files differ.

#### Acceptance Criteria

1. WHEN both a local Hash_Manifest and a remote Hash_Manifest are available, THE Differential_Upload_Script SHALL compare file hashes to identify files as added (present locally but not remotely), modified (present in both but with different SHA-256 hash), or deleted (present remotely but not locally).
2. WHEN the comparison identifies added or modified files, THE Differential_Upload_Script SHALL upload only those files to S3 at key `{prefix}/{name}/files/{relativePath}`.
3. WHEN the comparison identifies deleted files, THE Differential_Upload_Script SHALL remove the corresponding S3 objects using DeleteObjectCommand.
4. IF no files have changed between local and remote manifests, THEN THE Differential_Upload_Script SHALL skip all upload and delete operations and log a message indicating zero changes detected for that template.
5. THE Differential_Upload_Script SHALL log the count of added, modified, deleted, and unchanged files for each template to standard output.
6. IF a remote Hash_Manifest is not available for a template, THEN THE Differential_Upload_Script SHALL treat all local files as added and upload the complete file set.
7. IF an S3 upload or delete operation fails, THEN THE Differential_Upload_Script SHALL report the failed file path and error, and continue processing remaining files before exiting with a non-zero status code.
8. WHEN processing multiple templates, THE Differential_Upload_Script SHALL perform the comparison and upload independently per template, so that a failure in one template does not prevent processing of subsequent templates.

### Requirement 4: Regenerate File Tree Manifest on Change

**User Story:** As a frontend developer, I want the file-tree.json to remain accurate after differential uploads, so that the file browser displays the correct directory structure.

#### Acceptance Criteria

1. WHEN at least one file has been added, modified, or deleted in a template, THE Differential_Upload_Script SHALL regenerate the File_Tree_Manifest from the complete set of local template files (including unchanged files) and upload it to S3 at the key `{prefix}/{name}/file-tree.json` with content type `application/json`.
2. IF no files have changed in a template, THEN THE Differential_Upload_Script SHALL skip File_Tree_Manifest regeneration and upload.
3. THE File_Tree_Manifest SHALL conform to the same JSON schema as the existing Expand_Script: a root object with `version` (integer 1), `totalFiles` (integer count of file entries), `totalSize` (integer sum of all file sizes in bytes), and `entries` (array of objects each containing `path` (string relative path), `type` (`"file"` or `"directory"`), and `size` (integer, present only for file entries)).
4. WHEN the File_Tree_Manifest is regenerated, THE Differential_Upload_Script SHALL include entries for all files currently present in the local template directory and SHALL NOT include entries for files that were deleted in the current differential pass.

### Requirement 5: Metadata and Artifact Differential Upload

**User Story:** As a CI pipeline operator, I want the metadata files (metadata.json, readme.md, architecture images, artifact.zip) to also be uploaded differentially, so that the entire template deploy step benefits from hash-based caching.

#### Acceptance Criteria

1. WHEN a template's `metadata.json` content hash in the current run differs from its hash recorded in the persisted manifest, THE Differential_Upload_Script SHALL upload the updated metadata.json to the S3 key `templates/{name}/metadata.json`.
2. WHEN a template's `README.md` content hash in the current run differs from its hash recorded in the persisted manifest, THE Differential_Upload_Script SHALL upload the updated file to the S3 key `templates/{name}/readme.md`.
3. WHEN a template's architecture diagram file (SVG or PNG) content hash in the current run differs from its hash recorded in the persisted manifest, THE Differential_Upload_Script SHALL upload the updated architecture image to the S3 key `templates/{name}/architecture.{ext}`.
4. WHEN the content hash of any packagable source file within a template differs from its hash recorded in the persisted manifest, THE Differential_Upload_Script SHALL regenerate the artifact.zip — including all template directory contents except files matching the exclusion patterns (docs/, .git*, build/, .kiro/, *.zip) — and upload it to the S3 key `templates/{name}/artifact.zip`.
5. IF all packagable source file hashes within a template match their hashes in the persisted manifest, THEN THE Differential_Upload_Script SHALL skip artifact.zip generation and upload for that template.
6. WHEN the Differential_Upload_Script computes hashes for a template, THE Differential_Upload_Script SHALL include metadata.json, README.md, and architecture diagram files in the manifest alongside packagable source file hashes.
7. IF a file tracked in the persisted manifest no longer exists in the current template directory, THEN THE Differential_Upload_Script SHALL treat that template as changed and regenerate the artifact.zip.

### Requirement 6: Preserve S3 Key Structure Compatibility

**User Story:** As a system maintainer, I want the differential upload to use the same S3 key paths as the current deployment, so that existing infrastructure and frontend remain compatible.

#### Acceptance Criteria

1. THE Differential_Upload_Script SHALL upload template source files to the key `{prefix}/{name}/files/{relativePath}`, where `{prefix}` is the CLI-provided prefix argument (defaulting to `templates`), `{name}` is the template name, and `{relativePath}` uses forward-slash separators matching the existing Expand_Script convention.
2. THE Differential_Upload_Script SHALL upload the File_Tree_Manifest to the key `{prefix}/{name}/file-tree.json`.
3. THE Differential_Upload_Script SHALL upload metadata at the key `templates/{name}/metadata.json`, sourced from the template directory's `metadata.json` file.
4. THE Differential_Upload_Script SHALL upload the readme at the key `templates/{name}/readme.md`, sourced from the template directory's `README.md` file (case-insensitive match on source, lowercase key on destination).
5. WHEN both `architecture.svg` and `architecture.png` exist in a template directory, THE Differential_Upload_Script SHALL upload the SVG variant to `templates/{name}/architecture.svg` and ignore the PNG variant.
6. WHEN only one architecture image format (`.svg` or `.png`) exists in a template directory, THE Differential_Upload_Script SHALL upload it to the corresponding key `templates/{name}/architecture.svg` or `templates/{name}/architecture.png`.
7. THE Differential_Upload_Script SHALL upload the artifact at the key `templates/{name}/artifact.zip`.
8. IF a template directory does not contain a given optional asset (readme, architecture image), THEN THE Differential_Upload_Script SHALL skip that asset's upload without error.

### Requirement 7: CI Workflow Integration

**User Story:** As a DevOps engineer, I want the differential upload script to replace the existing unconditional upload steps in `deploy.yml`, so that builds are faster without changing the workflow trigger model.

#### Acceptance Criteria

1. THE deploy.yml workflow SHALL replace the existing "Package and deploy templates" step and the "Expand template files for file browser" step with a single step that invokes the Differential_Upload_Script once for each template directory matching `templates/chatbot-rag-*/`, and SHALL succeed without error if zero directories match the pattern.
2. THE deploy.yml workflow SHALL pass the Templates_Bucket name (from the `templates_bucket` Terraform output) to the Differential_Upload_Script via the `BUCKET_NAME` environment variable.
3. THE Differential_Upload_Script SHALL accept positional arguments `<name> <source-dir> [prefix]` where `prefix` defaults to `"templates"` when omitted, matching the existing Expand_Script interface.
4. IF the Differential_Upload_Script encounters an error that prevents completing the upload for a template (S3 API failure after 3 retry attempts, missing required source files, or failure to generate artifact.zip), THEN THE Differential_Upload_Script SHALL exit with a non-zero status code and log a message identifying the failed operation, the affected template name, and the error cause.
5. IF the Differential_Upload_Script exits with a non-zero status code, THEN THE deploy.yml workflow SHALL fail the job immediately without processing remaining template directories.
6. THE Differential_Upload_Script SHALL produce the same set of S3 objects per template that the two replaced steps currently produce: `metadata.json`, `readme.md`, architecture image (`architecture.svg` and/or `architecture.png`), `artifact.zip`, individual expanded files under `files/`, and `file-tree.json`.

### Requirement 8: Hash Manifest Schema and Versioning

**User Story:** As a developer, I want the hash manifest to be versioned, so that future schema changes can be handled gracefully without breaking existing deployments.

#### Acceptance Criteria

1. THE Hash_Manifest SHALL include a `version` field with integer value `1` as a top-level key in the JSON document.
2. THE Hash_Manifest SHALL include a `generatedAt` field with an ISO-8601 timestamp in UTC (ending in "Z") representing the moment the manifest was created.
3. THE Hash_Manifest SHALL include a `files` object where each key is a relative POSIX path (using "/" separators) and each value is an object containing a `hash` field (string, lowercase hex, 64 characters representing SHA-256) and a `size` field (integer, bytes, minimum 0).
4. IF the remote Hash_Manifest has a `version` value greater than `1` or a non-integer `version` value, THEN THE Differential_Upload_Script SHALL log a warning indicating the unrecognized version and treat all local files as new, performing a full upload.
5. IF the remote Hash_Manifest is missing, cannot be parsed as valid JSON, or lacks any of the required top-level fields (`version`, `generatedAt`, `files`), THEN THE Differential_Upload_Script SHALL treat all local files as new and perform a full upload.
6. THE Hash_Manifest SHALL contain no additional top-level fields beyond `version`, `generatedAt`, and `files`.
7. WHEN the Differential_Upload_Script generates a new Hash_Manifest, THE Differential_Upload_Script SHALL validate that the resulting JSON is under 5 MB in size before uploading it to S3.

### Requirement 9: Correct Content-Type Assignment

**User Story:** As a frontend developer, I want uploaded files to retain correct Content-Type headers, so that the file browser and download features work correctly.

#### Acceptance Criteria

1. THE Differential_Upload_Script SHALL assign Content-Type by extracting the substring from the last dot (`.`) in the filename to the end, converting it to lowercase, and looking it up in the same CONTENT_TYPE_MAP used by the existing Expand_Script.
2. IF a file has no dot in its filename OR its lowercase extension is not present in the CONTENT_TYPE_MAP, THEN THE Differential_Upload_Script SHALL assign `application/octet-stream` as the Content-Type.
3. WHEN a file has multiple dots in its name (e.g., `archive.tar.gz`), THE Differential_Upload_Script SHALL use only the last extension segment (e.g., `.gz`) for Content-Type lookup.
