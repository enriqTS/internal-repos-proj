/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderProjectDetail } from './project-detail';

vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com');

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createContainer(): HTMLElement {
  return document.createElement('div');
}

const validMetadata = {
  name: 'my-project',
  description: 'A test project for internal use',
  tags: ['web', 'api', 'typescript'],
  date: '2024-03-15',
};

describe('renderProjectDetail', () => {
  describe('successful render with all data', () => {
    it('displays metadata fields: name, description, tags, and date', async () => {
      // metadata fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validMetadata),
      });
      // readme fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Hello\n\nSome docs'),
      });
      // artifact HEAD check
      mockFetch.mockResolvedValueOnce({ ok: true });

      const container = createContainer();
      await renderProjectDetail('projects/my-project/', container);

      expect(container.querySelector('.project-name')?.textContent).toBe('my-project');
      expect(container.querySelector('.project-description')?.textContent).toBe(
        'A test project for internal use',
      );

      const tags = container.querySelectorAll('.project-tags .tag');
      expect(tags.length).toBe(3);
      expect(tags[0].textContent).toBe('web');
      expect(tags[1].textContent).toBe('api');
      expect(tags[2].textContent).toBe('typescript');

      expect(container.querySelector('.project-date')?.textContent).toBe('2024-03-15');
    });

    it('renders readme as HTML using marked', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validMetadata),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Title\n\nParagraph text'),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const container = createContainer();
      await renderProjectDetail('projects/my-project/', container);

      const readmeContent = container.querySelector('.readme-content');
      expect(readmeContent).not.toBeNull();
      expect(readmeContent?.innerHTML).toContain('<h1');
      expect(readmeContent?.innerHTML).toContain('Title');
      expect(readmeContent?.innerHTML).toContain('<p>Paragraph text</p>');
    });

    it('provides an enabled download link pointing to artifact.zip', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validMetadata),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Docs'),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const container = createContainer();
      await renderProjectDetail('projects/my-project/', container);

      const link = container.querySelector('a.download-link') as HTMLAnchorElement;
      expect(link).not.toBeNull();
      expect(link.href).toBe('https://cdn.example.com/projects/my-project/artifact.zip');
      expect(link.getAttribute('download')).toBe('my-project.zip');
      expect(link.getAttribute('aria-label')).toBe('Download my-project project zip archive');
    });
  });

  describe('metadata load failure', () => {
    it('shows error message and hides project details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const container = createContainer();
      await renderProjectDetail('projects/missing/', container);

      const errorMsg = container.querySelector('.metadata-error');
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toBe('Project details are unavailable');

      // No metadata or readme should be rendered
      expect(container.querySelector('.project-metadata')).toBeNull();
      expect(container.querySelector('.project-readme')).toBeNull();
    });
  });

  describe('readme load failure', () => {
    it('shows readme error but still displays metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validMetadata),
      });
      // readme fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });
      // artifact available
      mockFetch.mockResolvedValueOnce({ ok: true });

      const container = createContainer();
      await renderProjectDetail('projects/my-project/', container);

      // Metadata should still be visible
      expect(container.querySelector('.project-name')?.textContent).toBe('my-project');
      expect(container.querySelector('.project-description')?.textContent).toBe(
        'A test project for internal use',
      );

      // Readme error should be shown
      const readmeError = container.querySelector('.error-message');
      expect(readmeError).not.toBeNull();
      expect(readmeError?.textContent).toBe('Documentation is unavailable');

      // No readme content
      expect(container.querySelector('.readme-content')).toBeNull();
    });
  });

  describe('artifact unavailable', () => {
    it('disables download link with unavailable message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validMetadata),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Docs'),
      });
      // artifact not available
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const container = createContainer();
      await renderProjectDetail('projects/my-project/', container);

      // Should not have <a> link
      const link = container.querySelector('a.download-link');
      expect(link).toBeNull();

      // Should have disabled span
      const disabledLink = container.querySelector('.download-link.disabled');
      expect(disabledLink).not.toBeNull();
      expect(disabledLink?.getAttribute('aria-disabled')).toBe('true');

      // Should have unavailable message
      const unavailableMsg = container.querySelector('.artifact-unavailable');
      expect(unavailableMsg).not.toBeNull();
      expect(unavailableMsg?.textContent).toBe('Artifact is not available for download');
    });
  });

  describe('date formatting', () => {
    it('displays date in YYYY-MM-DD format from metadata', async () => {
      const metaWithDate = { ...validMetadata, date: '2023-12-25' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metaWithDate),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Docs'),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const container = createContainer();
      await renderProjectDetail('projects/my-project/', container);

      const dateEl = container.querySelector('.project-date');
      expect(dateEl?.textContent).toBe('2023-12-25');
      expect(dateEl?.getAttribute('datetime')).toBe('2023-12-25');
    });
  });
});
