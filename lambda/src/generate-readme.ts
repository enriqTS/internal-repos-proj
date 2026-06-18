import { FileEntry } from 'shared/types';
import { MAX_README_LENGTH } from 'shared/constants';

// ─── Module-local constants ───────────────────────────────────────────────────

/** Maximum token budget for model input */
const README_TOKEN_BUDGET = 100_000;

/** Character-to-token ratio (1 token ≈ 4 chars) */
const CHARS_PER_TOKEN = 4;

/** Maximum tokens for model output */
const README_MAX_OUTPUT_TOKENS = 4096;

/** Bedrock invocation timeout in milliseconds */
const README_GENERATION_TIMEOUT_MS = 30_000;

/** Bedrock model ID */
const README_MODEL_ID = 'us.moonshotai.kimi-k2.5-0613-v1:0';

// ─── Classification data ──────────────────────────────────────────────────────

/** Entry point base names (matched at root or src/) */
const ENTRY_POINT_BASES = ['main', 'index', 'app', 'server'];

/** Root-level config files always included as Tier 1 */
const ROOT_CONFIG_FILES = ['package.json', 'Dockerfile', 'docker-compose.yml', 'Makefile'];

/** Source code extensions for Tier 2 */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.py', '.go', '.java', '.rs', '.rb', '.cpp', '.c', '.h',
  '.cs', '.swift', '.kt', '.scala', '.clj', '.ex', '.exs', '.hs',
  '.ml', '.lua', '.php', '.sh',
]);

/** Binary/media extensions for Skip */
const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.o', '.a', '.lib',
  '.class', '.wasm', '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.mp3', '.mp4',
  '.wav', '.avi', '.mov', '.webm', '.webp', '.bmp', '.tiff',
]);

/** Lock files (exact names) for Skip */
const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock',
]);

/** Test path segments (case-insensitive) */
const TEST_SEGMENTS = ['test', 'spec', '__tests__'];

// ─── Exported types and interfaces ───────────────────────────────────────────

/** Classification tier for a file */
export type FileTier = 'tier1' | 'tier2' | 'tier3' | 'skip';

/** A file with its classification and optionally its text content */
export interface PrioritizedFile {
  path: string;
  tier: FileTier;
  /** Text content included in prompt (undefined for tier3/skip) */
  content?: string;
}

/** Result of file prioritization */
export interface PrioritizationResult {
  /** Files with full content to include in prompt (tier1 + budget-fitting tier2) */
  includedFiles: PrioritizedFile[];
  /** File paths for directory listing (tier3) */
  directoryListing: string[];
  /** Total estimated tokens consumed */
  totalTokens: number;
}

// ─── Pure helper functions ────────────────────────────────────────────────────

/**
 * Estimate token count from character count.
 * @param charCount - Number of characters
 * @returns Estimated token count (Math.ceil(charCount / 4))
 */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/**
 * Classify a single file into its tier.
 * Precedence order: Tier_1 > Skip > Tier_2 > Tier_3
 *
 * @param filePath - Relative file path
 * @param contentSize - Size of file content in bytes
 * @returns The tier classification
 */
export function classifyFile(filePath: string, contentSize: number): FileTier {
  const segments = filePath.split('/');
  const basename = segments[segments.length - 1];
  const ext = getExtension(basename);
  const dir = segments.length > 1 ? segments.slice(0, -1).join('/') : '';

  // ── Tier 1 checks ──────────────────────────────────────────────────────────

  // Entry points at root or src/
  const dotIndex = basename.indexOf('.');
  if (dotIndex > 0) {
    const base = basename.slice(0, dotIndex);
    // Ensure it has exactly one extension (no additional dots after the first)
    const afterDot = basename.slice(dotIndex + 1);
    if (!afterDot.includes('.') && ENTRY_POINT_BASES.includes(base)) {
      // At root (no directory) or directly in src/
      if (dir === '' || dir === 'src') {
        return 'tier1';
      }
    }
  }

  // Root config files
  if (dir === '' && ROOT_CONFIG_FILES.includes(basename)) {
    return 'tier1';
  }

  // ── Skip checks ────────────────────────────────────────────────────────────

  // Binary/media extensions
  if (ext && BINARY_EXTENSIONS.has(ext)) {
    return 'skip';
  }

  // Lock files
  if (LOCK_FILES.has(basename)) {
    return 'skip';
  }

  // Large JSON/YAML (>10KB)
  if ((ext === '.json' || ext === '.yaml' || ext === '.yml') && contentSize > 10_240) {
    return 'skip';
  }

  // CI/CD files
  if (
    filePath.startsWith('.github/') ||
    basename === '.gitlab-ci.yml' ||
    basename === 'Jenkinsfile' ||
    filePath.startsWith('.circleci/')
  ) {
    return 'skip';
  }

  // IaC files
  if (ext === '.tf' || ext === '.tfvars') {
    return 'skip';
  }
  if (basename.toLowerCase().startsWith('cloudformation')) {
    return 'skip';
  }
  if (basename.endsWith('.sam.yml')) {
    return 'skip';
  }

  // Generated files
  if (
    basename.includes('.generated.') ||
    basename.endsWith('.min.js') ||
    basename.endsWith('.min.css') ||
    basename.endsWith('.map') ||
    basename.endsWith('.d.ts')
  ) {
    return 'skip';
  }

  // ── Tier 2 checks ──────────────────────────────────────────────────────────

  if (ext && SOURCE_EXTENSIONS.has(ext)) {
    // Exclude files with test/spec/__tests__ path segments
    const hasTestSegment = segments.some(
      (seg) => TEST_SEGMENTS.includes(seg.toLowerCase())
    );
    if (!hasTestSegment) {
      return 'tier2';
    }
  }

  // ── Default: Tier 3 ────────────────────────────────────────────────────────
  return 'tier3';
}

/**
 * Trim package.json to only relevant fields.
 * Keeps: name, version, description, scripts, dependencies, devDependencies
 *
 * @param content - Raw package.json content string
 * @returns Trimmed JSON string with only allowed fields
 */
export function trimPackageJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    const trimmed: Record<string, unknown> = {};

    const allowedFields = ['name', 'version', 'description', 'scripts', 'dependencies', 'devDependencies'];
    for (const field of allowedFields) {
      if (field in parsed) {
        trimmed[field] = parsed[field];
      }
    }

    return JSON.stringify(trimmed, null, 2);
  } catch {
    // If JSON parsing fails, return the raw content
    return content;
  }
}

// ─── Prompt construction ──────────────────────────────────────────────────────

/**
 * Build the model prompt from prioritized files.
 *
 * Structure (in order):
 * 1. System instruction (README sections directive, no-fabrication rule)
 * 2. Project name
 * 3. For each included file: file path header + full text content
 * 4. Directory listing section with Tier_3 file paths
 *
 * @param projectName - The project name from session metadata
 * @param prioritization - Result from prioritizeFiles()
 * @returns The complete prompt string for the model
 */
export function buildPrompt(projectName: string, prioritization: PrioritizationResult): string {
  const parts: string[] = [];

  // 1. System instruction
  parts.push(
    `You are a technical documentation expert. Generate a markdown README for the project described below.` +
    `\n\nThe README must contain the following sections in order:` +
    `\n- Project title` +
    `\n- Description` +
    `\n- Key features` +
    `\n- Technology stack` +
    `\n- Project structure overview` +
    `\n- Setup/usage instructions (omit this section entirely if the provided files do not contain sufficient information to determine setup or usage steps)` +
    `\n\nIMPORTANT: Base the README only on the provided file content. Do not fabricate features, dependencies, or any information not present in the files.`
  );

  // 2. Project name
  parts.push(`\n\n# Project: ${projectName}`);

  // 3. Included files with path headers and content
  if (prioritization.includedFiles.length > 0) {
    parts.push(`\n\n## File Contents\n`);
    for (const file of prioritization.includedFiles) {
      if (file.content !== undefined) {
        parts.push(`\n### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
      }
    }
  }

  // 4. Directory listing
  if (prioritization.directoryListing.length > 0) {
    parts.push(`\n\n## Directory Listing\n`);
    for (const path of prioritization.directoryListing) {
      parts.push(`\n${path}`);
    }
  }

  return parts.join('');
}

// ─── Core prioritization function ─────────────────────────────────────────────

/**
 * Classify and select files within the token budget.
 *
 * Algorithm:
 * 1. Classify all files; decode content as UTF-8 (skip files that fail)
 * 2. Include all Tier_1 files with full content (package.json trimmed)
 * 3. If Tier_1 alone exceeds budget, skip Tier_2 entirely
 * 4. Otherwise, sort Tier_2 alphabetically (case-insensitive) and add until budget reached
 * 5. Collect Tier_3 file paths as directory listing (counted toward budget)
 *
 * @param files - Filtered FileEntry[] from the upload
 * @returns PrioritizationResult with included content and directory listing
 */
export function prioritizeFiles(files: FileEntry[]): PrioritizationResult {
  const tier1Files: { path: string; content: string }[] = [];
  const tier2Files: { path: string; content: string }[] = [];
  const tier3Paths: string[] = [];

  // Step 1: Classify all files and decode content
  for (const file of files) {
    const tier = classifyFile(file.path, file.content.length);

    if (tier === 'skip') {
      continue;
    }

    // Attempt to decode as UTF-8 text; skip silently if it fails
    let textContent: string;
    try {
      textContent = file.content.toString('utf-8');
      // Check for replacement characters indicating invalid UTF-8
      // A simple heuristic: if decoding produces NULL bytes, it's likely binary
      if (textContent.includes('\0')) {
        continue;
      }
    } catch {
      continue;
    }

    if (tier === 'tier1') {
      // Trim package.json content
      const content = file.path === 'package.json' ? trimPackageJson(textContent) : textContent;
      tier1Files.push({ path: file.path, content });
    } else if (tier === 'tier2') {
      tier2Files.push({ path: file.path, content: textContent });
    } else {
      // tier3
      tier3Paths.push(file.path);
    }
  }

  // Step 2: Include all Tier_1 files regardless of budget
  const includedFiles: PrioritizedFile[] = [];
  let totalTokens = 0;

  for (const f of tier1Files) {
    includedFiles.push({ path: f.path, tier: 'tier1', content: f.content });
    totalTokens += estimateTokens(f.content.length);
  }

  // Step 3: If Tier_1 exceeds budget, skip Tier_2 entirely
  if (totalTokens < README_TOKEN_BUDGET) {
    // Step 4: Sort Tier_2 case-insensitive alphabetically by path
    tier2Files.sort((a, b) =>
      a.path.toLowerCase().localeCompare(b.path.toLowerCase())
    );

    // Add Tier_2 files sequentially until next file would exceed budget
    for (const f of tier2Files) {
      const fileTokens = estimateTokens(f.content.length);
      if (totalTokens + fileTokens > README_TOKEN_BUDGET) {
        break;
      }
      includedFiles.push({ path: f.path, tier: 'tier2', content: f.content });
      totalTokens += fileTokens;
    }
  }

  // Step 5: Collect Tier_3 file paths as directory listing
  // Count each path toward token budget using same ratio
  const directoryListing: string[] = [];
  for (const path of tier3Paths) {
    const pathTokens = estimateTokens(path.length);
    if (totalTokens + pathTokens > README_TOKEN_BUDGET) {
      break;
    }
    directoryListing.push(path);
    totalTokens += pathTokens;
  }

  return { includedFiles, directoryListing, totalTokens };
}

// ─── Response extraction ──────────────────────────────────────────────────────

/**
 * Extract text content from a Bedrock response body, checking fields in order.
 * Returns null instead of falling back to raw responseBody when no field matches.
 *
 * @param responseBody - Raw JSON string from Bedrock response
 * @returns Extracted text content or null if no valid content found
 */
export function extractModelContent(responseBody: string): string | null {
  try {
    const modelOutput = JSON.parse(responseBody);

    if (modelOutput.choices && modelOutput.choices[0]?.message?.content) {
      return modelOutput.choices[0].message.content;
    }

    if (modelOutput.content && typeof modelOutput.content === 'string') {
      return modelOutput.content;
    }

    if (modelOutput.completion) {
      return modelOutput.completion;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Output validation ────────────────────────────────────────────────────────

/**
 * Validate and truncate generated README content.
 * - Rejects empty/whitespace-only content (returns null)
 * - Returns content as-is if ≤ MAX_README_LENGTH and has non-whitespace
 * - Truncates at last newline at or before MAX_README_LENGTH boundary if too long
 * - Falls back to hard truncation at MAX_README_LENGTH if no newline found
 *
 * @param content - Raw model output
 * @returns Validated content or null if invalid
 */
export function validateReadmeOutput(content: string): string | null {
  // Reject empty or whitespace-only content
  if (!content || !content.trim()) {
    return null;
  }

  // Content within limit — return as-is
  if (content.length <= MAX_README_LENGTH) {
    return content;
  }

  // Content exceeds limit — truncate at last newline at or before boundary
  const boundary = content.lastIndexOf('\n', MAX_README_LENGTH);

  if (boundary >= 1) {
    return content.slice(0, boundary);
  }

  // No newline found within boundary — hard truncate at exactly MAX_README_LENGTH
  return content.slice(0, MAX_README_LENGTH);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Get the file extension (including the dot) from a basename.
 * Returns empty string if no extension.
 */
function getExtension(basename: string): string {
  const lastDot = basename.lastIndexOf('.');
  if (lastDot <= 0) return '';
  return basename.slice(lastDot);
}
