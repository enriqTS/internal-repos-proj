/**
 * Language detection and file classification module.
 * Maps file extensions and special filenames to highlight.js language identifiers,
 * and classifies files as binary or image for appropriate rendering.
 */

/** Map of file extensions to highlight.js language identifiers. */
export const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.swift': 'swift',
  '.tf': 'hcl',
  '.hcl': 'hcl',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.html': 'xml',
  '.htm': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.md': 'markdown',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.dockerfile': 'dockerfile',
  '.proto': 'protobuf',
  '.lua': 'lua',
  '.r': 'r',
  '.scala': 'scala',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.clj': 'clojure',
  '.vim': 'vim',
  '.ini': 'ini',
  '.cfg': 'ini',
};

/** Map of special filenames (exact match) to highlight.js language identifiers. */
export const FILENAME_MAP: Record<string, string> = {
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
  'Jenkinsfile': 'groovy',
  'Vagrantfile': 'ruby',
  'Gemfile': 'ruby',
  'Rakefile': 'ruby',
  '.gitignore': 'bash',
  '.dockerignore': 'bash',
  '.editorconfig': 'ini',
  '.env.example': 'bash',
  'Procfile': 'yaml',
  'Brewfile': 'ruby',
};

/** Set of file extensions considered binary (non-text). */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.class', '.pyc',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.jar', '.war',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
  '.sqlite', '.db',
]);

/** Set of file extensions that can be previewed as images. */
export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
]);

/**
 * Extracts the file extension from a filename, using the last dot position.
 * Returns an empty string if no extension is found.
 */
function getExtension(filename: string): string {
  const basename = filename.split('/').pop() || filename;
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return basename.slice(dotIndex).toLowerCase();
}

/**
 * Extracts the basename from a file path.
 */
function getBasename(filename: string): string {
  return filename.split('/').pop() || filename;
}

/**
 * Detects the highlight.js language identifier for a given filename.
 * Checks FILENAME_MAP first (exact basename match), then EXTENSION_MAP.
 * Returns null if no match (caller should use hljs auto-detect).
 */
export function detectLanguage(filename: string): string | null {
  const basename = getBasename(filename);

  // Check special filenames first (exact match)
  if (basename in FILENAME_MAP) {
    return FILENAME_MAP[basename];
  }

  // Check extension map
  const ext = getExtension(filename);
  if (ext && ext in EXTENSION_MAP) {
    return EXTENSION_MAP[ext];
  }

  return null;
}

/**
 * Checks if a file is binary (non-text) based on its extension.
 */
export function isBinaryFile(filename: string): boolean {
  const ext = getExtension(filename);
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Checks if a file is a previewable image based on its extension.
 */
export function isImageFile(filename: string): boolean {
  const ext = getExtension(filename);
  return IMAGE_EXTENSIONS.has(ext);
}
