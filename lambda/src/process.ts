import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import JSZip from 'jszip';
import { filterFiles, AllFilesFilteredError } from './filter';
import { createArtifactZip, ArtifactTooLargeError } from './archiver-wrapper';
import { writeProject, ProjectExistsError } from './s3-writer';
import { regenerateIndex } from './index-generator';
import { addTagsToRegistry } from './tag-registry';
import { generateReadme } from './generate-readme';
import { suggestTagsFromReadme } from './suggest-tags';
import type { FinalizeRequest, FinalizeResponse, SessionMetadata, FileEntry, ProjectMetadata } from 'shared';

const s3Client = new S3Client({});

/** Standard CORS headers included in every response. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

/**
 * Check if the session metadata tags field contains any non-empty user-provided tags.
 * The tags field is a comma-separated string. Returns true if at least one
 * non-whitespace tag exists after splitting.
 */
export function hasUserTags(tags: string): boolean {
  return tags.split(',').some(t => t.trim().length > 0);
}

/**
 * Lambda handler for POST /upload/finalize.
 * Downloads staged zip from S3, processes it (filter, archive, write), and cleans up.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Handle preflight OPTIONS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS },
      body: '',
    };
  }

  const stagingBucket = process.env.STAGING_BUCKET!;
  let sessionId: string | undefined;

  try {
    // 1. Parse JSON body
    const body: FinalizeRequest = JSON.parse(event.body || '{}');
    sessionId = body.sessionId;

    if (!sessionId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Missing required field: sessionId' }),
      };
    }

    // 2. Download session metadata from staging bucket
    const metadataKey = `staging/${sessionId}/metadata.json`;
    let sessionMeta: SessionMetadata;
    try {
      const metaResponse = await s3Client.send(
        new GetObjectCommand({ Bucket: stagingBucket, Key: metadataKey })
      );
      const metaBody = await metaResponse.Body?.transformToString();
      if (!metaBody) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Upload session not found or has expired' }),
        };
      }
      sessionMeta = JSON.parse(metaBody);
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'NoSuchKey' || (err as any).$metadata?.httpStatusCode === 404)) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Upload session not found or has expired' }),
        };
      }
      throw err;
    }

    // 3. Download upload.zip from staging bucket
    const zipKey = `staging/${sessionId}/upload.zip`;
    let zipBuffer: Buffer;
    try {
      const zipResponse = await s3Client.send(
        new GetObjectCommand({ Bucket: stagingBucket, Key: zipKey })
      );
      const zipBytes = await zipResponse.Body?.transformToByteArray();
      if (!zipBytes) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Upload zip not found or has expired' }),
        };
      }
      zipBuffer = Buffer.from(zipBytes);
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'NoSuchKey' || (err as any).$metadata?.httpStatusCode === 404)) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Upload zip not found or has expired' }),
        };
      }
      throw err;
    }

    // 4. Extract zip contents into FileEntry[]
    const zip = await JSZip.loadAsync(zipBuffer);
    const files: FileEntry[] = [];
    const entries = Object.entries(zip.files);
    for (const [path, entry] of entries) {
      if (!entry.dir) {
        const content = await entry.async('nodebuffer');
        files.push({ path, content });
      }
    }

    // 5. Apply server-side filtering
    const filterResult = filterFiles(files);

    // 6. Persist new tags to the registry (best-effort)
    let registryWarning: string | undefined;
    if (sessionMeta.newTags && sessionMeta.newTags.length > 0) {
      try {
        await addTagsToRegistry(sessionMeta.newTags);
      } catch {
        registryWarning = 'Tag registry could not be updated';
      }
    }

    // 6.5: Generate README if not provided (create mode only)
    let readmeContent = sessionMeta.readme;
    let readmeWarning: string | undefined;

    if (sessionMeta.mode !== 'replace' && (!readmeContent || !readmeContent.trim())) {
      const result = await generateReadme(sessionMeta.name, filterResult.files);
      readmeContent = result.readme || 'No description provided';
      readmeWarning = result.warning;
    }

    // 6.75: Auto-tag from generated README (create mode only)
    let autoTags: string[] = [];
    let tagWarning: string | undefined;

    if (
      sessionMeta.mode !== 'replace' &&
      !hasUserTags(sessionMeta.tags) &&
      readmeContent &&
      readmeContent.trim() &&
      readmeContent !== 'No description provided'
    ) {
      try {
        autoTags = await suggestTagsFromReadme(readmeContent);
      } catch {
        // Should not throw (suggestTagsFromReadme catches internally),
        // but defensive catch for safety
        tagWarning = 'Automatic tag suggestion was unsuccessful';
      }
    }

    // 7. Generate artifact.zip
    const artifact = await createArtifactZip(filterResult.files);

    // 8. Write project to frontend bucket (behavior depends on mode)
    const frontendBucket = process.env.BUCKET_NAME!;

    if (sessionMeta.mode === 'replace') {
      // Replace mode: overwrite only artifact.zip, preserve metadata.json and readme.md
      await s3Client.send(
        new PutObjectCommand({
          Bucket: frontendBucket,
          Key: `projects/${sessionMeta.name}/artifact.zip`,
          Body: artifact,
          ContentType: 'application/zip',
        })
      );
      // Do NOT regenerate search index in replace mode
    } else {
      // Create mode: write full project (readme, metadata, artifact)
      const metadata: ProjectMetadata = {
        name: sessionMeta.name,
        description: readmeContent.slice(0, 200) || 'No description provided',
        tags: sessionMeta.tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
        date: new Date().toISOString().split('T')[0],
      };

      await writeProject({
        name: sessionMeta.name,
        readme: readmeContent,
        metadata,
        artifact,
      });

      // 9. Regenerate search index (only for create mode)
      await regenerateIndex();
    }

    // 10. Cleanup staged files
    await cleanupStagedFiles(stagingBucket, sessionId);

    // 11. Return success response
    const warnings = [filterResult.warning, registryWarning, readmeWarning].filter(Boolean).join('; ');
    const response: FinalizeResponse = {
      message: 'Project uploaded successfully',
      path: `projects/${sessionMeta.name}/`,
      ...(warnings ? { warning: warnings } : {}),
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify(response),
    };
  } catch (err) {
    // Cleanup staged files on error too
    if (sessionId) {
      await cleanupStagedFiles(stagingBucket, sessionId).catch(() => {
        // Ignore cleanup errors — lifecycle policy will handle it
      });
    }

    if (err instanceof AllFilesFilteredError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: err.message }),
      };
    }

    if (err instanceof ArtifactTooLargeError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: err.message }),
      };
    }

    if (err instanceof ProjectExistsError) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: err.message }),
      };
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: message }),
    };
  }
}

/**
 * Delete staged metadata.json and upload.zip from the staging bucket.
 */
async function cleanupStagedFiles(bucket: string, sessionId: string): Promise<void> {
  await Promise.all([
    s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `staging/${sessionId}/metadata.json` })),
    s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `staging/${sessionId}/upload.zip` })),
  ]);
}
