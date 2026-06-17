import ignore from 'ignore';
import { DENY_LIST } from 'shared/constants';
import { FileEntry } from 'shared/types';

/**
 * Result of filtering uploaded files.
 */
export interface FilterResult {
  /** Files that passed filtering (not denied or ignored) */
  files: FileEntry[];
  /** Optional warning message (e.g., .gitignore parse failure) */
  warning?: string;
}

/**
 * Error thrown when all files are filtered out.
 */
export class AllFilesFilteredError extends Error {
  constructor() {
    super('No files remain after filtering');
    this.name = 'AllFilesFilteredError';
  }
}

/**
 * Checks whether a file path matches any deny list pattern.
 *
 * Patterns supported:
 * - Directory patterns ending with `/` match any path segment (e.g., `.git/` matches `.git/config` and `sub/.git/file`)
 * - Exact filename patterns (e.g., `.DS_Store`) match the basename
 * - Glob patterns with `*` (e.g., `*.pyc`, `.env.*`) match the basename
 */
function matchesDenyList(filePath: string): boolean {
  const segments = filePath.split('/');
  const basename = segments[segments.length - 1];

  for (const pattern of DENY_LIST) {
    // Directory pattern (ends with /)
    if (pattern.endsWith('/')) {
      const dirName = pattern.slice(0, -1);
      // Check if any segment in the path matches the directory name
      if (segments.some((seg) => seg === dirName)) {
        return true;
      }
      continue;
    }

    // Glob pattern with wildcard
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );
      if (regex.test(basename)) {
        return true;
      }
      continue;
    }

    // Exact match against basename
    if (basename === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * Filters uploaded files by applying the deny list and optionally .gitignore rules.
 *
 * - Deny list patterns always take precedence and cannot be overridden by .gitignore negation.
 * - If a `.gitignore` file is present in the file list, it is parsed and applied as additional filtering.
 * - If `.gitignore` parsing fails, filtering proceeds with deny list only and a warning is returned.
 * - Throws `AllFilesFilteredError` if no files remain after filtering.
 */
export function filterFiles(files: FileEntry[]): FilterResult {
  let warning: string | undefined;
  let gitignoreFilter: ((path: string) => boolean) | undefined;

  // Look for .gitignore in the file list (root-level only)
  const gitignoreEntry = files.find((f) => f.path === '.gitignore');

  if (gitignoreEntry) {
    try {
      const gitignoreContent = gitignoreEntry.content.toString('utf-8');
      const ig = ignore().add(gitignoreContent);
      gitignoreFilter = ig.createFilter();
    } catch {
      warning = '.gitignore could not be parsed; proceeding with deny list only';
    }
  }

  const filtered = files.filter((file) => {
    // Skip the .gitignore file itself from the output
    if (file.path === '.gitignore') {
      return false;
    }

    // Deny list takes absolute precedence - cannot be overridden
    if (matchesDenyList(file.path)) {
      return false;
    }

    // Apply .gitignore filtering (only if parsed successfully)
    if (gitignoreFilter) {
      // The `ignore` filter returns true for paths that should be KEPT
      return gitignoreFilter(file.path);
    }

    return true;
  });

  if (filtered.length === 0) {
    throw new AllFilesFilteredError();
  }

  return { files: filtered, warning };
}
