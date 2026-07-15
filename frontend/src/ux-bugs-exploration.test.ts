/**
 * @vitest-environment jsdom
 *
 * Bug Condition Exploration Tests — UX Defects Exist in Unfixed Code
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
 *
 * These tests are EXPECTED TO FAIL on unfixed code.
 * Failure confirms the bugs exist and provides counterexamples.
 *
 * DO NOT fix the tests or the code when they fail — that proves the bugs are real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Test 1a: Date typo in metadata.json ──────────────────────────────────────

describe('Bug Condition 1a: Date typo in chatbot-rag-agentcore metadata', () => {
  it('metadata.json date field should be "2026-07-14" (will FAIL — confirms typo "2025-07-14" exists)', () => {
    const metadataPath = path.resolve(
      __dirname,
      '../../templates/chatbot-rag-agentcore/metadata.json',
    );
    const raw = fs.readFileSync(metadataPath, 'utf-8');
    const metadata = JSON.parse(raw);

    // Expected: "2026-07-14" — the correct date
    // Actual (unfixed): "2025-07-14" — the typo
    expect(metadata.date).toBe('2026-07-14');
  });
});

// ─── Test 1b: Hidden exact dates in card grid ─────────────────────────────────

describe('Bug Condition 1b: Exact date not visible in card grid item text', () => {
  it('card date textContent should contain the ISO date string (will FAIL — date is hidden in title only)', async () => {
    const { renderCardGrid } = await import('./card-grid');

    const container = document.createElement('div');
    const testItem = {
      name: 'test-project',
      description: 'A test project',
      tags: ['test'],
      date: '2026-07-01',
    };

    renderCardGrid([testItem], {
      container,
      onCardActivate: () => {},
    });

    const dateEl = container.querySelector('.card-grid-item__date') as HTMLElement;
    expect(dateEl).not.toBeNull();

    // The visible date text should contain the ISO date "2026-07-01"
    // On unfixed code, textContent only has relative date (e.g. "há X semanas")
    expect(dateEl.textContent).toContain('2026-07-01');
  });
});

// ─── Test 1c: Truncation CSS in card grid ─────────────────────────────────────

describe('Bug Condition 1c: Card grid CSS enforces truncation', () => {
  beforeEach(() => {
    // Clear injected styles between tests
    const existing = document.getElementById('card-grid-styles');
    if (existing) existing.remove();
  });

  it('.card-grid-item should NOT have aspect-ratio: 1 and .card-grid-item__name should NOT have white-space: nowrap (will FAIL — truncation CSS exists)', async () => {
    const { renderCardGrid } = await import('./card-grid');

    const container = document.createElement('div');
    renderCardGrid(
      [{ name: 'a-very-long-project-name-that-would-be-truncated', description: 'desc', tags: [], date: '2026-01-01' }],
      { container, onCardActivate: () => {} },
    );

    // Get the injected style element
    const styleEl = document.getElementById('card-grid-styles');
    expect(styleEl).not.toBeNull();
    const cssText = styleEl!.textContent || '';

    // Assert card-grid-item does NOT have aspect-ratio: 1
    const cardItemBlock = cssText.match(/\.card-grid-item\s*\{[^}]*\}/)?.[0] || '';
    const hasAspectRatio = cardItemBlock.includes('aspect-ratio: 1');

    // Assert card-grid-item__name does NOT have white-space: nowrap
    const nameBlock = cssText.match(/\.card-grid-item__name\s*\{[^}]*\}/)?.[0] || '';
    const hasNoWrap = nameBlock.includes('white-space: nowrap');

    // Both should be false for the fix to work
    // On unfixed code: both are true → test fails
    expect(hasAspectRatio).toBe(false);
    expect(hasNoWrap).toBe(false);
  });
});

// ─── Test 1d: Missing upload button on projects page ──────────────────────────

vi.mock('./api', () => ({
  fetchSearchIndex: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  fetchProjectMetadata: vi.fn(() => Promise.resolve({ ok: true, data: { name: 'test', description: 'desc', tags: ['t'], date: '2024-01-01' } })),
  fetchProjectReadme: vi.fn(() => Promise.resolve({ ok: true, data: '# Test' })),
  fetchTagRegistry: vi.fn(() => Promise.resolve({ ok: true, data: ['tag1'] })),
  computePatchBody: vi.fn(() => null),
  updateProject: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
  initiateUpload: vi.fn(() => Promise.resolve({ ok: true, data: { sessionId: 'sess-1', uploadUrl: 'https://s3.example.com/url', expiresAt: '2025-01-01T00:00:00Z' } })),
  uploadToS3: vi.fn(() => Promise.resolve(undefined)),
  finalizeUpload: vi.fn(() => Promise.resolve({ ok: true, data: { message: 'Success', path: 'projects/test/' } })),
  deleteProject: vi.fn(() => Promise.resolve({ ok: true })),
  suggestTags: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
}));

vi.mock('./search', () => ({
  initializeSearch: vi.fn(),
  setupSearch: vi.fn(),
  search: vi.fn(() => []),
  renderResults: vi.fn(),
}));

vi.mock('./theme-manager', () => {
  const mockManager = {
    getTheme: vi.fn(() => 'light'),
    toggle: vi.fn(() => 'dark'),
    setTheme: vi.fn(),
    startListening: vi.fn(),
    stopListening: vi.fn(),
  };
  return {
    createThemeManager: vi.fn(() => mockManager),
    createThemeToggle: vi.fn(() => document.createElement('button')),
  };
});

vi.mock('./landing-page', () => ({
  renderLandingPage: vi.fn((_params: Record<string, string>, container: HTMLElement) => {
    container.innerHTML = '<div class="landing-page"><h1>Landing</h1></div>';
  }),
}));

vi.mock('./project-detail', () => ({
  renderProjectDetail: vi.fn(),
}));

vi.mock('./tag-selector', () => {
  const mockTagSelector = {
    setAvailableTags: vi.fn(),
    applySuggestions: vi.fn(),
    getSelectedTags: vi.fn(() => ['tag1']),
    getNewTags: vi.fn(() => []),
    hasUserInteracted: vi.fn(() => false),
    destroy: vi.fn(),
  };
  return {
    createTagSelector: vi.fn(() => mockTagSelector),
  };
});

vi.mock('jszip', () => ({
  default: vi.fn(() => ({
    file: vi.fn(),
    generateAsync: vi.fn(() => Promise.resolve(new Blob(['zip'], { type: 'application/zip' }))),
  })),
}));

describe('Bug Condition 1d: No upload button on projects page', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'app';
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('projects page should have an upload button/link to #/upload (will FAIL — no upload affordance exists)', async () => {
    const { fetchSearchIndex } = await import('./api');
    vi.mocked(fetchSearchIndex).mockResolvedValue({ ok: true, data: [] });

    window.location.hash = '#/projects';
    await import('./main');
    await new Promise((r) => setTimeout(r, 100));

    // Look for any link/button pointing to #/upload in the app container
    const uploadLink = container.querySelector('a[href="#/upload"], a[href$="/upload"]');
    const uploadButton = container.querySelector('button');
    const anyUploadAffordance =
      uploadLink ||
      (uploadButton && uploadButton.textContent?.toLowerCase().includes('upload'));

    // On unfixed code: no upload button exists on the projects page → test fails
    expect(anyUploadAffordance).not.toBeNull();
  });
});

// ─── Test 1e: Architecture image opens new tab ────────────────────────────────

describe('Bug Condition 1e: Architecture image should NOT open in new tab', () => {
  it('renderArchitectureSection should NOT wrap image in <a target="_blank"> (will FAIL — new-tab link exists)', async () => {
    const { renderArchitectureSection } = await import('./template-detail');

    const section = renderArchitectureSection(
      'https://cdn.example.com/templates/test/architecture.svg',
      'test-template',
    );

    // On unfixed code: there IS an <a target="_blank"> wrapping the image
    // Expected (fixed): NO <a target="_blank"> wrapper
    const newTabLink = section.querySelector('a[target="_blank"]');
    expect(newTabLink).toBeNull();
  });
});

// ─── Test 1f: Registry-only tag suggestions ───────────────────────────────────

describe('Bug Condition 1f: AI tag suggestions limited to registry-only', () => {
  it('SuggestTagsResponse type should have a newTags field (will FAIL — field does not exist)', async () => {
    // Read the types file and check for newTags field in SuggestTagsResponse
    const typesPath = path.resolve(__dirname, '../../shared/src/types.ts');
    const typesContent = fs.readFileSync(typesPath, 'utf-8');

    // Extract the SuggestTagsResponse interface
    const responseMatch = typesContent.match(
      /export interface SuggestTagsResponse\s*\{([^}]*)\}/,
    );
    expect(responseMatch).not.toBeNull();

    const interfaceBody = responseMatch![1];

    // Should contain a newTags field
    // On unfixed code: only has `tags: string[]` → test fails
    expect(interfaceBody).toContain('newTags');
  });
});
