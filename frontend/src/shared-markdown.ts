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
  content.className = 'readme-content leading-relaxed text-sm text-text [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_a]:text-accent [&_a]:underline [&_a]:hover:text-accent-hover [&_pre]:bg-code-bg [&_pre]:text-on-accent [&_pre]:font-mono [&_pre]:text-sm [&_pre]:p-4 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_code]:font-mono [&_code]:text-sm [&_blockquote]:border-l-4 [&_blockquote]:border-border-strong [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-text-muted [&_blockquote]:mb-3';

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
  errorEl.className = 'error-message text-sm text-error text-center py-4';
  errorEl.textContent = message;
  return errorEl;
}
