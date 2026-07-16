import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import JSZip from 'jszip';
import { filterFiles, AllFilesFilteredError } from '../filter';
import { createArtifactZip, ArtifactTooLargeError } from '../archiver-wrapper';
import { expandFiles } from '../file-expander';
import { writeProject, ProjectExistsError } from '../s3-writer';
import { regenerateIndex } from '../index-generator';
import { addTagsToRegistry } from '../tag-registry';
import { generateReadme } from './generate-readme';
import { suggestTagsFromReadme } from './suggest-tags';
import type { FinalizeRequest, FinalizeResponse, SessionMetadata, FileEntry, ProjectMetadata } from 'shared';

const s3Client = new S3Client({});

/**
 * Extract the remote origin URL from a .git/config file content.
 * Parses the INI-style format to find [remote "origin"] url = <value>.
 * Converts SSH URLs to HTTPS and strips embedded credentials for safety.
 * Returns undefined if no valid URL is found.
 */
export function extractGitRemoteUrl(gitConfigContent: string): string | undefined {
  const lines = gitConfigContent.split('\n');
  let inRemoteOrigin = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect [remote "origin"] section
    if (/^\[remote\s+"origin"\]$/i.test(trimmed)) {
      inRemoteOrigin = true;
      continue;
    }

    // Detect start of another section
    if (trimmed.startsWith('[') && inRemoteOrigin) {
      break;
    }

    // Parse url = <value> within [remote "origin"]
    if (inRemoteOrigin) {
      const match = trimmed.match(/^url\s*=\s*(.+)$/i);
      if (match) {
        let url = match[1].trim();
        url = normalizeGitUrl(url);
        return url || undefined;
      }
    }
  }

  return undefined;
}

/**
 * Normalize a git URL to a clean HTTPS browsable URL.
 * - Converts SSH format (git@host:user/repo.git) to https://host/user/repo
 * - Strips .git suffix
 * - Strips embedded credentials (https://user:token@host/...)
 * - Returns empty string if the URL format is unrecognized
 */
export function normalizeGitUrl(url: string): string {
  // Handle SSH format: git@github.com:user/repo.git
  const sshMatch = url.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const path = sshMatch[2].replace(/\.git$/, '');
    return `https://${host}/${path}`;
  }

  // Handle HTTPS/HTTP URLs
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      // Strip credentials
      parsed.username = '';
      parsed.password = '';
      // Strip .git suffix from pathname
      parsed.pathname = parsed.pathname.replace(/\.git$/, '');
      // Force HTTPS
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    // Not a valid URL
  }

  // Handle ssh:// format: ssh://git@github.com/user/repo.git
  const sshProtoMatch = url.match(/^ssh:\/\/[^@]*@?([^/]+)\/(.+)$/);
  if (sshProtoMatch) {
    const host = sshProtoMatch[1];
    const path = sshProtoMatch[2].replace(/\.git$/, '');
    return `https://${host}/${path}`;
  }

  return '';
}

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

    // 3. Load files based on upload mode (zip or folder)
    let files: FileEntry[];

    if (sessionMeta.uploadType === 'folder') {
      // Folder mode: read individual files from staging/{sessionId}/files/
      files = await loadStagedFolderFiles(stagingBucket, sessionId, sessionMeta.filePaths);
    } else {
      // Zip mode (default): download and extract upload.zip
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
      files = [];
      const entries = Object.entries(zip.files);
      for (const [path, entry] of entries) {
        if (!entry.dir) {
          const content = await entry.async('nodebuffer');
          files.push({ path, content });
        }
      }
    }

    // 4.5: Extract git remote URL from .git/config (before filtering strips it)
    // Client-side URL from session metadata takes priority over server-side extraction
    let repositoryUrl: string | undefined = sessionMeta.repositoryUrl;
    if (!repositoryUrl) {
      const gitConfigEntry = files.find(
        (f) => f.path === '.git/config' || f.path.endsWith('/.git/config')
      );
      if (gitConfigEntry) {
        try {
          const configContent = gitConfigEntry.content.toString('utf-8');
          repositoryUrl = extractGitRemoteUrl(configContent);
        } catch {
          // Ignore parse errors — repositoryUrl stays undefined
        }
      }
    }

    // 5. Apply server-side filtering
    const filterResult = filterFiles(files);

    // 5.5: Expand files to individual S3 objects and generate manifest
    const frontendBucket = process.env.BUCKET_NAME!;
    let expansionWarning: string | undefined;
    try {
      const expandResult = await expandFiles(filterResult.files, sessionMeta.name, frontendBucket);
      // Upload file-tree.json manifest
      await s3Client.send(
        new PutObjectCommand({
          Bucket: frontendBucket,
          Key: `projects/${sessionMeta.name}/file-tree.json`,
          Body: JSON.stringify(expandResult.manifest),
          ContentType: 'application/json',
        })
      );
      if (expandResult.warnings.length > 0) {
        expansionWarning = expandResult.warnings.join('; ');
      }
    } catch {
      expansionWarning = 'File expansion encountered errors';
    }

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
        const suggestResult = await suggestTagsFromReadme(readmeContent);
        autoTags = suggestResult.tags;
      } catch {
        // Should not throw (suggestTagsFromReadme catches internally),
        // but defensive catch for safety
        tagWarning = 'Automatic tag suggestion was unsuccessful';
      }
    }

    // 7. Generate artifact.zip
    const artifact = await createArtifactZip(filterResult.files);

    // 8. Write project to frontend bucket (behavior depends on mode)

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
        tags: hasUserTags(sessionMeta.tags)
          ? sessionMeta.tags.split(',').map(t => t.trim()).filter(t => t.length > 0)
          : autoTags,
        date: new Date().toISOString().split('T')[0],
        ...(repositoryUrl && { repositoryUrl }),
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
    const warnings = [filterResult.warning, expansionWarning, registryWarning, readmeWarning, tagWarning].filter(Boolean).join('; ');
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
 * Delete staged files from the staging bucket.
 * Handles both zip mode (metadata.json + upload.zip) and folder mode (metadata.json + files/*).
 */
async function cleanupStagedFiles(bucket: string, sessionId: string): Promise<void> {
  // Always delete metadata.json
  const deletePromises: Promise<any>[] = [
    s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `staging/${sessionId}/metadata.json` })),
  ];

  // Try to delete upload.zip (zip mode) — ignore if doesn't exist
  deletePromises.push(
    s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `staging/${sessionId}/upload.zip` })).catch(() => {}),
  );

  // List and delete any files under staging/{sessionId}/files/ (folder mode)
  try {
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `staging/${sessionId}/files/`,
      })
    );
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      const fileDeletePromises = listResponse.Contents.map((obj) =>
        s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key! }))
      );
      deletePromises.push(...fileDeletePromises);
    }
  } catch {
    // Ignore list/delete errors for folder files — lifecycle policy will handle cleanup
  }

  await Promise.all(deletePromises);
}

/**
 * Load individual staged files from S3 for folder mode uploads.
 * Reads each file from `staging/{sessionId}/files/{filePath}`.
 *
 * @param bucket - The staging S3 bucket name
 * @param sessionId - The upload session ID
 * @param filePaths - Array of file paths stored in session metadata
 * @returns Array of FileEntry objects with path and content
 */
async function loadStagedFolderFiles(
  bucket: string,
  sessionId: string,
  filePaths: string[] | undefined,
): Promise<FileEntry[]> {
  if (!filePaths || filePaths.length === 0) {
    // Fall back to listing objects if filePaths not in metadata
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `staging/${sessionId}/files/`,
      })
    );
    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return [];
    }
    filePaths = listResponse.Contents
      .map((obj) => obj.Key!.replace(`staging/${sessionId}/files/`, ''))
      .filter((p) => p.length > 0);
  }

  const files: FileEntry[] = [];
  const downloadPromises = filePaths.map(async (filePath) => {
    const key = `staging/${sessionId}/files/${filePath}`;
    try {
      const response = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      const bytes = await response.Body?.transformToByteArray();
      if (bytes) {
        files.push({ path: filePath, content: Buffer.from(bytes) });
      }
    } catch {
      // Skip files that can't be read — they may have expired
    }
  });

  await Promise.all(downloadPromises);
  return files;
}
