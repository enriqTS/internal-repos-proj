/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderTemplateDetail } from './template-detail';

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
  name: 'basic-lambda',
  description: 'A basic AWS Lambda template',
  tags: ['aws', 'lambda', 'serverless'],
  date: '2024-03-15',
  language: 'TypeScript',
};

/**
 * Helper: set up mockFetch to return successful metadata, readme, and architecture image HEAD.
 * Call order from renderTemplateDetail:
 *   1. fetchTemplateMetadata → GET metadata.json
 *   2. resolveArchitectureImageUrl → HEAD architecture image (concurrent with readme)
 *   3. fetchTemplateReadme → GET readme.md (concurrent with image HEAD)
 */
function mockSuccessfulRender(overrides?: {
  metadata?: Record<string, unknown>;
  readme?: string;
  archHeadOk?: boolean;
  archImageField?: string;
}) {
  const metadata = overrides?.metadata ?? validMetadata;
  const readme = overrides?.readme ?? '# Hello\n\nSome template docs';
  const archHeadOk = overrides?.archHeadOk ?? true;

  // 1. metadata.json fetch (via fetchTemplateMetadata which uses global fetch)
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(metadata),
  });

  // 2. HEAD request for architecture image
  mockFetch.mockResolvedValueOnce({
    ok: archHeadOk,
    headers: new Headers(archHeadOk ? { 'content-type': 'image/svg+xml' } : {}),
  });

  // 3. readme.md fetch
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: () => Promise.resolve(readme),
  });
}

describe('renderTemplateDetail', () => {
  describe('successful render', () => {
    it('shows metadata, download button, architecture image, and readme', async () => {
      mockSuccessfulRender();

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      // Metadata rendered
      expect(container.querySelector('.template-name')?.textContent).toBe('basic-lambda');
      expect(container.querySelector('.template-description')?.textContent).toBe(
        'A basic AWS Lambda template',
      );

      // Tags rendered
      const tags = container.querySelectorAll('.tag');
      expect(tags.length).toBe(3);
      expect(tags[0].textContent).toBe('aws');
      expect(tags[1].textContent).toBe('lambda');
      expect(tags[2].textContent).toBe('serverless');

      // Download button rendered
      const downloadLink = container.querySelector('a.download-link') as HTMLAnchorElement;
      expect(downloadLink).not.toBeNull();
      expect(downloadLink.textContent).toBe('Baixar Template');

      // Architecture section rendered
      const archSection = container.querySelector('.template-architecture');
      expect(archSection).not.toBeNull();
      const archImg = archSection?.querySelector('img') as HTMLImageElement;
      expect(archImg).not.toBeNull();
      expect(archImg.alt).toBe('Architecture diagram for basic-lambda');

      // Readme rendered
      const readmeContent = container.querySelector('.readme-content');
      expect(readmeContent).not.toBeNull();
      expect(readmeContent?.innerHTML).toContain('Hello');
    });
  });

  describe('metadata fetch failure', () => {
    it('renders error message "Detalhes do template não disponíveis" and no download button', async () => {
      // metadata fetch fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      const errorMsg = container.querySelector('.error-message');
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toBe('Detalhes do template não disponíveis');

      // No download button
      expect(container.querySelector('a.download-link')).toBeNull();

      // No detail content
      expect(container.querySelector('.template-detail')).toBeNull();
    });
  });

  describe('readme fetch failure', () => {
    it('renders fallback text "Documentação do template não disponível" but rest of page still renders', async () => {
      // metadata succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validMetadata),
      });

      // architecture HEAD succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/svg+xml' }),
      });

      // readme fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      // Rest of page still renders
      expect(container.querySelector('.template-name')?.textContent).toBe('basic-lambda');
      expect(container.querySelector('a.download-link')).not.toBeNull();
      expect(container.querySelector('.template-architecture')).not.toBeNull();

      // Readme error fallback shown
      const errorMsg = container.querySelector('.error-message');
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toBe('Documentação do template não disponível');

      // No readme content
      expect(container.querySelector('.readme-content')).toBeNull();
    });
  });

  describe('both image HEAD fetches fail', () => {
    it('no architecture section in DOM (no .template-architecture)', async () => {
      const metadataNoImage = { ...validMetadata, architectureImage: undefined };

      // metadata succeeds (call #1)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metadataNoImage),
      });

      // Promise.all starts resolveArchitectureImageUrl and fetchTemplateReadme concurrently.
      // resolveArchitectureImageUrl calls fetch first (SVG HEAD), then fetchTemplateReadme calls fetch.
      // After SVG HEAD resolves with ok:false, resolveArchitectureImageUrl tries PNG HEAD.

      // SVG HEAD fails (call #2 - from resolveArchitectureImageUrl)
      mockFetch.mockResolvedValueOnce({ ok: false, headers: new Headers() });

      // readme succeeds (call #3 - from fetchTemplateReadme)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Docs'),
      });

      // PNG HEAD fails (call #4 - from resolveArchitectureImageUrl after SVG fails)
      mockFetch.mockResolvedValueOnce({ ok: false, headers: new Headers() });

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      // No architecture section
      expect(container.querySelector('.template-architecture')).toBeNull();

      // Rest of the page still renders
      expect(container.querySelector('.template-name')?.textContent).toBe('basic-lambda');
      expect(container.querySelector('.readme-content')).not.toBeNull();
    });
  });

  describe('image onerror removes architecture section', () => {
    it('simulate onerror on img element removes .template-architecture from DOM', async () => {
      mockSuccessfulRender();

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      // Architecture section exists initially
      const archSection = container.querySelector('.template-architecture');
      expect(archSection).not.toBeNull();

      // Trigger onerror on the image
      const img = archSection?.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      img.onerror!(new Event('error'));

      // Architecture section should be removed
      expect(container.querySelector('.template-architecture')).toBeNull();
    });
  });

  describe('empty/missing template name', () => {
    it('shows "Nenhum template especificado"', async () => {
      const container = createContainer();
      await renderTemplateDetail({}, container);

      const errorMsg = container.querySelector('.error-message');
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toBe('Nenhum template especificado');
    });

    it('shows "Nenhum template especificado" for empty name', async () => {
      const container = createContainer();
      await renderTemplateDetail({ name: '' }, container);

      const errorMsg = container.querySelector('.error-message');
      expect(errorMsg).not.toBeNull();
      expect(errorMsg?.textContent).toBe('Nenhum template especificado');
    });
  });

  describe('download anchor attributes', () => {
    it('has correct href, download attr, and aria-label', async () => {
      mockSuccessfulRender();

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      const downloadLink = container.querySelector('a.download-link') as HTMLAnchorElement;
      expect(downloadLink).not.toBeNull();

      // href ends with /templates/{name}/artifact.zip
      expect(downloadLink.href).toContain('/templates/basic-lambda/artifact.zip');
      expect(downloadLink.href).toBe('https://cdn.example.com/templates/basic-lambda/artifact.zip');

      // download attribute is {name}.zip
      expect(downloadLink.getAttribute('download')).toBe('basic-lambda.zip');

      // aria-label
      expect(downloadLink.getAttribute('aria-label')).toBe(
        'Download basic-lambda template zip archive',
      );
    });
  });

  describe('architectureImage field in metadata', () => {
    it('"architecture.png" uses direct HEAD URL without trying SVG fallback', async () => {
      const metadataWithPng = { ...validMetadata, architectureImage: 'architecture.png' as const };

      // metadata succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metadataWithPng),
      });

      // Direct HEAD for architecture.png succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
      });

      // readme succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Docs'),
      });

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      // Architecture section rendered
      const archSection = container.querySelector('.template-architecture');
      expect(archSection).not.toBeNull();

      // Should only have made 3 fetch calls total (metadata, HEAD, readme)
      // No SVG fallback attempt
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify the HEAD call was for the PNG directly
      const headCall = mockFetch.mock.calls[1];
      expect(headCall[0]).toBe('https://cdn.example.com/templates/basic-lambda/architecture.png');
      expect(headCall[1]).toEqual({ method: 'HEAD' });
    });
  });

  describe('invalid architectureImage value triggers fallback strategy', () => {
    it('tries SVG then PNG when architectureImage is an invalid value', async () => {
      const metadataInvalidImage = {
        ...validMetadata,
        architectureImage: 'other.jpg' as any,
      };

      // metadata succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metadataInvalidImage),
      });

      // SVG HEAD succeeds (fallback path)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'image/svg+xml' }),
      });

      // readme succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('# Docs'),
      });

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      // Architecture section rendered (SVG fallback succeeded)
      expect(container.querySelector('.template-architecture')).not.toBeNull();

      // The HEAD call should be for architecture.svg (fallback), not "other.jpg"
      const headCall = mockFetch.mock.calls[1];
      expect(headCall[0]).toBe('https://cdn.example.com/templates/basic-lambda/architecture.svg');
      expect(headCall[1]).toEqual({ method: 'HEAD' });
    });
  });

  describe('no edit/delete controls', () => {
    it('does not render edit or delete controls on template detail page', async () => {
      mockSuccessfulRender();

      const container = createContainer();
      await renderTemplateDetail({ name: 'basic-lambda' }, container);

      // No edit button/link
      expect(container.querySelector('.project-edit-btn')).toBeNull();
      expect(container.querySelector('[class*="edit"]')).toBeNull();

      // No delete button
      expect(container.querySelector('.project-delete-btn')).toBeNull();
      expect(container.querySelector('button[class*="delete"]')).toBeNull();

      // No project-actions section
      expect(container.querySelector('.project-actions')).toBeNull();
    });
  });
});
