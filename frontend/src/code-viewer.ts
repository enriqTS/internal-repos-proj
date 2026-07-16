import hljs from 'highlight.js';
import { detectLanguage, isBinaryFile, isImageFile } from './language-mapper';

/**
 * Options for creating a code viewer component.
 */
export interface CodeViewerOptions {
  /** File content as text */
  content: string;
  /** File name for language detection */
  filename: string;
  /** File size in bytes (from manifest) */
  fileSize: number;
  /** Full CDN URL for image preview */
  fileUrl: string;
}

/** Threshold in bytes above which syntax highlighting is skipped for performance. */
const LARGE_FILE_THRESHOLD = 500 * 1024; // 500 KB

/**
 * Generate an array of line numbers [1, 2, ..., N] for a given content string.
 * Splits on '\n'. If content ends with '\n', the trailing empty line is not counted.
 */
export function generateLineNumbers(content: string): number[] {
  if (!content) return [1];

  let lines = content.split('\n');

  // If content ends with '\n', don't count the trailing empty line
  if (content.endsWith('\n') && lines.length > 1) {
    lines = lines.slice(0, -1);
  }

  return lines.map((_, i) => i + 1);
}

/**
 * Escape HTML special characters to prevent XSS when rendering content.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Create the code viewer component.
 *
 * Handles four cases:
 * a. Image files: renders an inline <img> preview
 * b. Binary files (non-image): shows "Binary file — cannot preview" message
 * c. Text files > 500 KB: renders plain text without syntax highlighting
 * d. Text files <= 500 KB: applies highlight.js with detected language
 */
export function createCodeViewer(options: CodeViewerOptions): HTMLElement {
  const { content, filename, fileSize, fileUrl } = options;

  // Case a: Image file
  if (isImageFile(filename)) {
    return renderImagePreview(fileUrl, filename);
  }

  // Case b: Binary file (non-image)
  if (isBinaryFile(filename)) {
    return renderBinaryMessage();
  }

  // Case c & d: Text file (with or without highlighting)
  const isLargeFile = fileSize > LARGE_FILE_THRESHOLD;
  return renderCodeContent(content, filename, isLargeFile);
}

/**
 * Render an inline image preview with max-width and preserved aspect ratio.
 */
function renderImagePreview(fileUrl: string, filename: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'flex items-center justify-center p-8 border border-border rounded-sm bg-surface';

  const img = document.createElement('img');
  img.src = fileUrl;
  img.alt = filename;
  img.className = 'max-w-full h-auto';

  container.appendChild(img);
  return container;
}

/**
 * Render a centered message for binary files that cannot be previewed.
 */
function renderBinaryMessage(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'flex items-center justify-center p-12 border border-border rounded-sm bg-surface';

  const message = document.createElement('p');
  message.className = 'text-text-muted text-sm font-mono';
  message.textContent = 'Binary file \u2014 cannot preview';

  container.appendChild(message);
  return container;
}

/**
 * Render code content with line numbers, optional syntax highlighting, and copy button.
 */
function renderCodeContent(content: string, filename: string, isLargeFile: boolean): HTMLElement {
  // Outer relative container for positioning the copy button
  const wrapper = document.createElement('div');
  wrapper.className = 'relative border border-border rounded-sm bg-surface';

  // Notice for large files
  if (isLargeFile) {
    const notice = document.createElement('div');
    notice.className = 'px-4 py-2 text-xs text-text-muted bg-code-bg border-b border-border font-mono';
    notice.textContent = 'Syntax highlighting skipped for performance';
    wrapper.appendChild(notice);
  }

  // Copy button (positioned top-right)
  const copyBtn = document.createElement('button');
  copyBtn.className = 'absolute top-2 right-2 px-3 py-1 text-xs font-mono font-semibold text-text-muted bg-surface border border-border rounded-sm cursor-pointer transition-all duration-180 hover:text-text hover:border-border-strong z-10';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => handleCopy(copyBtn, content));
  wrapper.appendChild(copyBtn);

  // Scrollable code area
  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'overflow-x-auto';

  // Table layout for line numbers + code
  const table = document.createElement('table');
  table.className = 'w-full border-collapse font-mono text-sm leading-relaxed';

  const tbody = document.createElement('tbody');

  // Generate highlighted content
  let highlightedLines: string[];
  if (isLargeFile) {
    highlightedLines = splitContentToLines(escapeHtml(content));
  } else {
    const highlighted = highlightContent(content, filename);
    highlightedLines = splitContentToLines(highlighted);
  }

  const lineNumbers = generateLineNumbers(content);

  for (let i = 0; i < lineNumbers.length; i++) {
    const tr = document.createElement('tr');

    // Line number cell
    const lineNumTd = document.createElement('td');
    lineNumTd.className = 'text-right text-text-muted select-none pr-4 pl-4 border-r border-border align-top whitespace-nowrap';
    lineNumTd.textContent = String(lineNumbers[i]);
    tr.appendChild(lineNumTd);

    // Code content cell
    const codeTd = document.createElement('td');
    codeTd.className = 'pl-4 pr-4 align-top whitespace-pre';
    codeTd.innerHTML = highlightedLines[i] ?? '';
    tr.appendChild(codeTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  scrollContainer.appendChild(table);
  wrapper.appendChild(scrollContainer);

  return wrapper;
}

/**
 * Apply syntax highlighting to content using highlight.js.
 * Returns HTML string with highlight spans.
 */
function highlightContent(content: string, filename: string): string {
  const language = detectLanguage(filename);

  if (language) {
    try {
      return hljs.highlight(content, { language }).value;
    } catch {
      // Language not registered or error — fall through to auto-detect
    }
  }

  // Auto-detect fallback — always try, don't gate on relevance
  try {
    const result = hljs.highlightAuto(content);
    return result.value;
  } catch {
    return escapeHtml(content);
  }
}

/**
 * Split highlighted HTML content into individual lines.
 * Handles the case where content ends with '\n' (trailing empty line not included).
 */
function splitContentToLines(htmlContent: string): string[] {
  let lines = htmlContent.split('\n');

  // Match generateLineNumbers behavior: if original ends with '\n', drop trailing empty
  if (htmlContent.endsWith('\n') && lines.length > 1) {
    lines = lines.slice(0, -1);
  }

  return lines;
}

/**
 * Handle the copy button click — copy raw content to clipboard.
 * Shows "Copied!" or "Copy failed" feedback for 2 seconds.
 */
async function handleCopy(btn: HTMLButtonElement, content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  }

  setTimeout(() => {
    btn.textContent = 'Copy';
  }, 2000);
}
