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
