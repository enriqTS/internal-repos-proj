# Technical Design Document

## Overview

This design replaces the current multipart-through-API-Gateway upload flow with a presigned S3 URL pattern. The frontend zips project files client-side (after DENY_LIST filtering), obtains a presigned PUT URL from a lightweight initiation endpoint, uploads directly to S3, then calls a finalization endpoint that triggers server-side processing. This eliminates the 10MB API Gateway payload limit while reusing existing filtering, archiving, and index generation logic.

## Architecture

### High-Level Flow

```
┌──────────┐       POST /upload/initiate        ┌──────────────┐
│          │ ────────────────────────────────►   │  Initiate    │
│          │ ◄──── { sessionId, presignedUrl } ──│  Lambda      │
│          │                                     └──────┬───────┘
│          │                                            │ generates
│ Frontend │       PUT presignedUrl                     ▼
│          │ ─────────────────────────────────► ┌──────────────┐
│          │                                    │  S3 Staging  │
│          │                                    │  Bucket      │
│          │       POST /upload/finalize        └──────┬───────┘
│          │ ────────────────────────────────►   ┌─────┴────────┐
│          │ ◄──── { path, warning? }        ── │  Processing  │
└──────────┘                                    │  Lambda      │
                                                └──────┬───────┘
                                                       │ writes
                                                       ▼
                                                ┌──────────────┐
                                                │  Frontend    │
                                                │  Bucket      │
                                                │  (projects/) │
                                                └──────────────┘
```

### Component Breakdown

1. **Frontend (upload-form.ts, api.ts)** — Client-side zip creation, presigned upload, progress tracking
2. **Initiate Lambda** — Metadata validation, presigned URL generation, duplicate checking
3. **Processing Lambda** — Downloads staged zip, extracts, filters, archives, writes project, regenerates index
4. **S3 Staging Bucket** — Temporary storage with lifecycle expiration
5. **API Gateway** — Routes `/upload/initiate` and `/upload/finalize`, both JSON-only (no multipart)

## Data Models

### Initiate Request (POST /upload/initiate)

```typescript
interface InitiateRequest {
  name: string;       // 1-64 chars, /^[a-zA-Z0-9_-]+$/
  tags?: string;      // comma-separated, max 10 tags, each max 32 chars
  readme?: string;    // max 50,000 chars
}
```

### Initiate Response

```typescript
interface InitiateResponse {
  sessionId: string;      // UUID v4
  uploadUrl: string;      // presigned S3 PUT URL
  expiresAt: string;      // ISO 8601 timestamp (15 min from now)
}
```

### Finalize Request (POST /upload/finalize)

```typescript
interface FinalizeRequest {
  sessionId: string;  // UUID from initiate response
}
```

### Finalize Response

```typescript
interface FinalizeResponse {
  message: string;
  path: string;       // "projects/{name}/"
  warning?: string;   // e.g., ".gitignore parse failure"
}
```

### Session Metadata (stored in S3 alongside zip)

```typescript
interface SessionMetadata {
  sessionId: string;
  name: string;
  tags: string;
  readme: string;
  createdAt: string;  // ISO 8601
}
```

The initiate Lambda stores this as `staging/{sessionId}/metadata.json` alongside the zip upload path `staging/{sessionId}/upload.zip`. This allows the processing Lambda to retrieve project metadata without additional API calls.

## Infrastructure Design

### Staging Bucket

A separate S3 bucket dedicated to temporary upload staging:

```hcl
resource "aws_s3_bucket" "staging" {
  bucket = "${var.bucket_name_prefix}-staging"
}

resource "aws_s3_bucket_lifecycle_configuration" "staging" {
  bucket = aws_s3_bucket.staging.id

  rule {
    id     = "expire-staging-uploads"
    status = "Enabled"

    filter {
      prefix = "staging/"
    }

    expiration {
      days = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "staging" {
  bucket = aws_s3_bucket.staging.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"]
    allowed_origins = ["*"]  # Tighten to actual domain in production
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_public_access_block" "staging" {
  bucket                  = aws_s3_bucket.staging.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

### IAM Permissions

The Lambda execution role needs:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject",
    "s3:GetObject",
    "s3:DeleteObject"
  ],
  "Resource": "arn:aws:s3:::${staging_bucket}/staging/*"
}
```

Plus existing permissions on the frontend bucket for writing projects and the global index.

### API Gateway Routes

Two new resources under the existing API:

- `POST /upload/initiate` → Initiate Lambda
- `POST /upload/finalize` → Processing Lambda

Both require API key (`api_key_required = true`) and use `AWS_PROXY` integration. The old `/upload` multipart endpoint is removed.

### Lambda Configuration

| Property | Initiate Lambda | Processing Lambda |
|----------|----------------|-------------------|
| Runtime | nodejs22.x | nodejs22.x |
| Memory | 256 MB | 1024 MB |
| Timeout | 10 sec | 120 sec |
| Handler | initiate.handler | process.handler |
| Env Vars | `STAGING_BUCKET`, `FRONTEND_BUCKET` | `STAGING_BUCKET`, `BUCKET_NAME` |

The processing Lambda needs more memory and timeout because it downloads, extracts, filters, and re-archives potentially large zip files.

## Frontend Design

### New Dependencies

- **JSZip** (`jszip@^3.10.0`) — Client-side zip creation. Lightweight, well-maintained, supports streaming and progress events.

### Upload Flow (upload-form.ts)

```typescript
async function handleUpload(name, tags, readme, files) {
  // 1. Client-side filter
  const filtered = filterFileList(files);
  if (filtered.length === 0) { showError("No uploadable files"); return; }

  // 2. Create zip client-side
  const zip = new JSZip();
  for (const file of filtered) {
    const path = stripTopLevelFolder(file.webkitRelativePath);
    zip.file(path, file);
  }
  const blob = await zip.generateAsync({ type: "blob" });

  // 3. Check size
  if (blob.size > MAX_CLIENT_ZIP_SIZE) { showError("Too large"); return; }

  // 4. Call initiate endpoint
  const { sessionId, uploadUrl } = await initiateUpload({ name, tags, readme });

  // 5. Upload zip to S3 via presigned URL (with progress)
  await uploadToS3(uploadUrl, blob, onProgress);

  // 6. Call finalize endpoint
  const result = await finalizeUpload(sessionId);

  // 7. Show success
  showSuccess(result);
}
```

### API Module (api.ts)

New functions added to `frontend/src/api.ts`:

```typescript
export async function initiateUpload(params: InitiateRequest): Promise<ApiResult<InitiateResponse>>
export async function finalizeUpload(sessionId: string): Promise<ApiResult<FinalizeResponse>>
export async function uploadToS3(url: string, blob: Blob, onProgress?: (pct: number) => void): Promise<void>
```

The `uploadToS3` function uses `XMLHttpRequest` for progress events (fetch API doesn't support upload progress natively).

## Lambda Design

### Initiate Lambda (lambda/src/initiate.ts)

```typescript
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Parse JSON body → InitiateRequest
  // 2. Validate name, tags, readme (reuse shared validation)
  // 3. Check project doesn't already exist (HeadObject on frontend bucket)
  // 4. Generate UUID session ID
  // 5. Write session metadata to staging/{sessionId}/metadata.json
  // 6. Generate presigned PUT URL for staging/{sessionId}/upload.zip
  //    - Conditions: content-length-range [1, 500MB], content-type: application/zip
  // 7. Return { sessionId, uploadUrl, expiresAt }
}
```

### Processing Lambda (lambda/src/process.ts)

```typescript
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import JSZip from 'jszip';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Parse JSON body → FinalizeRequest
  // 2. Download metadata.json from staging/{sessionId}/
  // 3. Download upload.zip from staging/{sessionId}/
  // 4. Extract zip into FileEntry[] array (using JSZip or yauzl)
  // 5. Apply server-side filtering (filterFiles from filter.ts)
  // 6. Generate artifact.zip (createArtifactZip from archiver-wrapper.ts)
  // 7. Write project to frontend bucket (writeProject from s3-writer.ts)
  // 8. Regenerate search index (regenerateIndex from index-generator.ts)
  // 9. Delete staging files (cleanup)
  // 10. Return success with path and any warnings
}
```

### Shared Validation (lambda/src/validate.ts)

Extract the validation logic from the current `handler.ts` into a standalone module so both the initiate and processing Lambdas can use it:

```typescript
export function validateMetadata(data: { name?: string; tags?: string; readme?: string }): string | null
```

## New Shared Constants

```typescript
/** Maximum client-side zip size in bytes (500 MB) */
export const MAX_CLIENT_ZIP_SIZE = 500 * 1024 * 1024;

/** Presigned URL expiration in seconds (15 minutes) */
export const PRESIGNED_URL_EXPIRY = 15 * 60;
```

## File Structure Changes

```
lambda/src/
├── handler.ts          → REMOVED (replaced by initiate + process)
├── initiate.ts         → NEW: Upload initiation endpoint
├── process.ts          → NEW: Upload finalization/processing endpoint
├── validate.ts         → NEW: Extracted shared validation logic
├── filter.ts           → UNCHANGED: Server-side filtering
├── archiver-wrapper.ts → UNCHANGED: Zip creation
├── s3-writer.ts        → UNCHANGED: Project write to S3
└── index-generator.ts  → UNCHANGED: Search index regeneration

frontend/src/
├── api.ts              → MODIFIED: New initiateUpload, finalizeUpload, uploadToS3
├── upload-form.ts      → MODIFIED: New zip+presigned flow, progress UI
└── ...                 → UNCHANGED

shared/src/
├── constants.ts        → MODIFIED: Add MAX_CLIENT_ZIP_SIZE, PRESIGNED_URL_EXPIRY
├── types.ts            → MODIFIED: Add InitiateRequest, InitiateResponse, FinalizeRequest, FinalizeResponse, SessionMetadata
└── index.ts            → UNCHANGED

infra/
├── main.tf             → MODIFIED: Add staging bucket + lifecycle + CORS
├── api.tf              → MODIFIED: Replace /upload with /upload/initiate + /upload/finalize
├── variables.tf        → UNCHANGED
└── outputs.tf          → MODIFIED: Add staging bucket output
```

## Build Changes

The Lambda build script needs to produce two entrypoints:

```json
{
  "scripts": {
    "build": "esbuild src/initiate.ts src/process.ts --bundle --platform=node --target=node22 --format=cjs --outdir=dist --external:@aws-sdk"
  }
}
```

The Terraform `archive_file` data source continues to zip the entire `lambda/dist/` directory. The Lambda functions reference different handlers: `initiate.handler` and `process.handler`.

## Dependencies

### Frontend (new)
- `jszip@^3.10.0` — Client-side zip creation

### Lambda (new)
- `@aws-sdk/s3-request-presigner@^3.500.0` — Presigned URL generation
- `jszip@^3.10.0` — Server-side zip extraction (lighter alternative to unzip for in-memory extraction)

### Lambda (removed)
- `busboy` — No longer needed (no multipart parsing)

## Error Handling

| Scenario | Response |
|----------|----------|
| Invalid metadata in initiate | 400 with field-specific error |
| Project name already exists | 409 Conflict |
| Session not found in finalize | 404 Not Found |
| S3 upload fails (frontend) | Frontend shows retry option |
| All files filtered server-side | 400 "No files remain" |
| Artifact exceeds 100MB | 400 "Artifact too large" |
| Index regeneration fails | 500 with error message (project still saved) |

## Security Considerations

1. **Presigned URL scoping**: URLs are scoped to a specific session path with content-length conditions — clients cannot write to arbitrary S3 keys
2. **Session metadata stored server-side**: The project name/tags/readme are stored by the initiate Lambda in S3, not passed again by the client at finalize — prevents tampering
3. **API key required on both endpoints**: Both initiate and finalize require the x-api-key header
4. **Staging cleanup**: Lifecycle policy ensures abandoned uploads don't accumulate; processing Lambda cleans up immediately on success or failure
5. **Public access blocked**: Staging bucket blocks all public access; only presigned URLs grant PUT permission

## Migration Notes

Since the system is not in production, the old `/upload` endpoint and multipart handler can be removed entirely. No migration path or backward compatibility is needed.
