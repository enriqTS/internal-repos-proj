import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

/**
 * Single shared Marked instance configured with highlight.js syntax highlighting.
 * Uses 'hljs language-' prefix and auto-detection fallback.
 */
export const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  }),
);

/**
 * Render a readme section from pre-parsed HTML content.
 *
 * Returns a <section class="{contextClass}"> containing a
 * <div class="readme-content"> with the rendered HTML.
 *
 * If htmlContent is empty or contains only whitespace, renders a placeholder
 * message instead of the content.
 */
export function renderReadmeSection(htmlContent: string, contextClass: string): HTMLElement {
  const section = document.createElement('section');
  section.className = contextClass;

  const content = document.createElement('div');
  content.className = 'readme-content';

  if (!htmlContent || !htmlContent.trim()) {
    content.textContent = 'No documentation available';
  } else {
    content.innerHTML = htmlContent;
  }

  section.appendChild(content);
  return section;
}

/**
 * Render a readme error fallback element.
 *
 * Returns a <p class="error-message"> with the given message.
 */
export function renderReadmeError(message: string): HTMLElement {
  const errorEl = document.createElement('p');
  errorEl.className = 'error-message';
  errorEl.textContent = message;
  return errorEl;
}
