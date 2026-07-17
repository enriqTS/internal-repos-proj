/**
 * @vitest-environment jsdom
 *
 * Bug Condition Exploration Test - Stale Index After Mutation (Frontend)
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * This test asserts that after a successful mutation (upload, edit, delete),
 * `searchIndexLoaded` is reset to `false` so the next home page render
 * re-fetches the index.
 *
 * EXPECTED TO FAIL on unfixed code — failure proves the bug exists:
 * `searchIndexLoaded` remains `true` after all mutation operations,
 * meaning the frontend never re-fetches the index after mutations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// Mock all external dependencies before importing modules
vi.mock('./utils/api', () => ({
  fetchSearchIndex: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  fetchProjectMetadata: vi.fn(() => Promise.resolve({ ok: true, data: { name: 'test', description: 'desc', tags: ['t'], date: '2024-01-01' } })),
  fetchProjectReadme: vi.fn(() => Promise.resolve({ ok: true, data: '# Test' })),
  fetchTagRegistry: vi.fn(() => Promise.resolve({ ok: true, data: ['tag1'] })),
  computePatchBody: vi.fn(() => null),
  updateProject: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
  initiateUpload: vi.fn(() => Promise.resolve({ ok: true, data: { sessionId: 'sess-1', uploadUrl: 'https://s3.example.com/url', uploadUrls: { 'main.ts': 'https://s3.example.com/main.ts' }, mode: 'folder', expiresAt: '2025-01-01T00:00:00Z' } })),
  uploadToS3: vi.fn(() => Promise.resolve(undefined)),
  uploadFilesToS3: vi.fn(() => Promise.resolve(undefined)),
  finalizeUpload: vi.fn(() => Promise.resolve({ ok: true, data: { message: 'Success', path: 'projects/test/' } })),
  deleteProject: vi.fn(() => Promise.resolve({ ok: true })),
  suggestTags: vi.fn(() => Promise.resolve({ ok: true, data: { tags: [], newTags: [] } })),
}));

vi.mock('./pages/search', () => ({
  initializeSearch: vi.fn(),
  setupSearch: vi.fn(),
  search: vi.fn(() => []),
  renderResults: vi.fn(),
}));

vi.mock('./pages/project-detail', () => ({
  renderProjectDetail: vi.fn(),
}));

vi.mock('./components/tag-selector', () => {
  const mockTagSelector = {
    setAvailableTags: vi.fn(),
    applySuggestions: vi.fn(),
    applyNewSuggestions: vi.fn(),
    getSelectedTags: vi.fn(() => ['tag1']),
    getNewTags: vi.fn(() => []),
    hasUserInteracted: vi.fn(() => false),
    destroy: vi.fn(),
  };
  return {
    createTagSelector: vi.fn(() => mockTagSelector),
  };
});

vi.mock('jszip', () => {
  return {
    default: vi.fn(() => ({
      file: vi.fn(),
      generateAsync: vi.fn(() => Promise.resolve(new Blob(['zip'], { type: 'application/zip' }))),
    })),
  };
});

vi.mock('./utils/theme-manager', () => {
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

vi.mock('./pages/landing-page', () => ({
  renderLandingPage: vi.fn((_params: Record<string, string>, container: HTMLElement) => {
    container.innerHTML = '<div class="landing-page"><h1>Landing</h1></div>';
  }),
}));

describe('Bug Condition: searchIndexLoaded reset after mutations', () => {
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

  /**
   * Helper: triggers the home page route to perform initial index load,
   * then performs a mutation, then checks if a second home page render
   * re-fetches the index (which it should if searchIndexLoaded was reset).
   */
  async function simulateHomeLoadThenMutationThenHomeLoad(
    mutationType: 'upload' | 'edit' | 'delete',
  ): Promise<{ fetchCallCountAfterMutation: number }> {
    // Fresh import to get a clean module state
    const { fetchSearchIndex } = await import('./utils/api');
    const mockedFetch = vi.mocked(fetchSearchIndex);
    mockedFetch.mockResolvedValue({ ok: true, data: [] });

    // Import main to trigger the app init — this sets up routes and router
    // Instead, we'll directly test the behavior via the module's exported renderSearchView logic
    // Since main.ts doesn't export renderSearchView, we test indirectly by:
    // 1. Importing main (which calls init and sets up the router)
    // 2. Navigating to home to trigger initial load
    // 3. Performing a mutation
    // 4. Navigating to home again and checking if fetchSearchIndex was called again

    // Set the hash to projects route (search view)
    window.location.hash = '#/projects';
    await import('./main');

    // Wait for initial render
    await new Promise(r => setTimeout(r, 50));

    const fetchCountAfterInitialLoad = mockedFetch.mock.calls.length;
    // Should have been called at least once for initial load
    expect(fetchCountAfterInitialLoad).toBeGreaterThanOrEqual(1);

    // Now perform the mutation based on type
    if (mutationType === 'upload') {
      // Navigate to upload, fill form, submit
      window.location.hash = '#/upload';
      await new Promise(r => setTimeout(r, 50));

      const form = document.querySelector('form');
      if (form) {
        const nameInput = document.querySelector('#project-name') as HTMLInputElement;
        const readmeArea = document.querySelector('#project-readme') as HTMLTextAreaElement;
        // The drop-zone component creates a hidden file input inside .drop-zone
        const fileInput = document.querySelector('.drop-zone input[type="file"]') as HTMLInputElement;

        if (nameInput) nameInput.value = 'test-project';
        if (readmeArea) readmeArea.value = '# Test';

        // Mock the file input and trigger the drop-zone's change handler
        if (fileInput) {
          const mockFile = new File(['content'], 'main.ts', { type: 'text/plain' });
          Object.defineProperty(mockFile, 'webkitRelativePath', { value: 'proj/main.ts' });
          const fileList = createMockFileList([mockFile]);
          Object.defineProperty(fileInput, 'files', { value: fileList, configurable: true });
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 50));
        }

        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 100));
      }
    } else if (mutationType === 'delete') {
      // Navigate to a project, trigger delete
      window.location.hash = '#/project/test-project';
      await new Promise(r => setTimeout(r, 50));

      // Import and trigger delete dialog
      const { showDeleteDialog } = await import('./components/delete-dialog');
      showDeleteDialog('test-project');
      await new Promise(r => setTimeout(r, 50));

      // Type the project name and click confirm
      const input = document.querySelector('.delete-dialog-input') as HTMLInputElement;
      const confirmBtn = document.querySelector('.delete-dialog-confirm') as HTMLButtonElement;
      if (input && confirmBtn) {
        input.value = 'test-project';
        input.dispatchEvent(new Event('input'));
        confirmBtn.click();
        await new Promise(r => setTimeout(r, 100));
      }
    } else if (mutationType === 'edit') {
      // Navigate to edit page
      window.location.hash = '#/project/test-project/edit';
      await new Promise(r => setTimeout(r, 100));

      const form = document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Now navigate back to projects and check if fetchSearchIndex is called again
    window.location.hash = '#/projects';
    await new Promise(r => setTimeout(r, 100));

    return {
      fetchCallCountAfterMutation: mockedFetch.mock.calls.length - fetchCountAfterInitialLoad,
    };
  }

  function createMockFileList(files: File[]): FileList {
    const fileList = Object.create(null);
    for (let i = 0; i < files.length; i++) {
      fileList[i] = files[i];
    }
    fileList.length = files.length;
    fileList.item = (index: number) => files[index] ?? null;
    fileList[Symbol.iterator] = function* () {
      for (const f of files) yield f;
    };
    return fileList as unknown as FileList;
  }

  it('searchIndexLoaded must be reset after successful upload so home page re-fetches', async () => {
    const result = await simulateHomeLoadThenMutationThenHomeLoad('upload');
    // If the bug is fixed, fetchSearchIndex should be called again after the mutation
    // On unfixed code, this will be 0 (searchIndexLoaded stays true)
    expect(result.fetchCallCountAfterMutation).toBeGreaterThan(0);
  });

  it('searchIndexLoaded must be reset after successful delete so home page re-fetches', async () => {
    const result = await simulateHomeLoadThenMutationThenHomeLoad('delete');
    expect(result.fetchCallCountAfterMutation).toBeGreaterThan(0);
  });

  it('searchIndexLoaded must be reset after successful edit so home page re-fetches', async () => {
    const result = await simulateHomeLoadThenMutationThenHomeLoad('edit');
    expect(result.fetchCallCountAfterMutation).toBeGreaterThan(0);
  });
});


/**
 * Preservation Property Tests - Unchanged Behavior for Non-Mutation Flows (Frontend)
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * These tests establish baseline behavior on UNFIXED code.
 * They verify that:
 * - On first page load, fetchSearchIndex() is called
 * - After initial load succeeds, subsequent renders skip re-fetch
 * - Failed mutations do NOT reset searchIndexLoaded
 *
 * EXPECTED TO PASS on unfixed code — this confirms baseline behavior to preserve.
 */
describe('Preservation: Index loading behavior for non-mutation flows', () => {
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

  it('on first page load, fetchSearchIndex is called (searchIndexLoaded starts false)', async () => {
    const { fetchSearchIndex } = await import('./utils/api');
    const mockedFetch = vi.mocked(fetchSearchIndex);
    mockedFetch.mockResolvedValue({ ok: true, data: [] });

    window.location.hash = '#/projects';
    await import('./main');
    await new Promise(r => setTimeout(r, 50));

    // First load should always trigger fetchSearchIndex
    expect(mockedFetch).toHaveBeenCalled();
  });

  it('after initial load succeeds, subsequent home navigations skip re-fetch', async () => {
    const { fetchSearchIndex } = await import('./utils/api');
    const mockedFetch = vi.mocked(fetchSearchIndex);
    mockedFetch.mockResolvedValue({ ok: true, data: [] });

    window.location.hash = '#/projects';
    await import('./main');
    await new Promise(r => setTimeout(r, 50));

    const callCountAfterFirstLoad = mockedFetch.mock.calls.length;
    expect(callCountAfterFirstLoad).toBeGreaterThanOrEqual(1);

    // Navigate away and back to projects
    window.location.hash = '#/upload';
    await new Promise(r => setTimeout(r, 50));
    window.location.hash = '#/projects';
    await new Promise(r => setTimeout(r, 50));

    // Should NOT have called fetchSearchIndex again (flag stays true)
    expect(mockedFetch.mock.calls.length).toBe(callCountAfterFirstLoad);
  });

  it('for all non-mutation interactions, index loading behavior is unchanged (property-based)', async () => {
    // Property: for any sequence of non-mutation navigations (home, search, project detail),
    // fetchSearchIndex is called exactly once (on the first home page render)

    /**
     * Poll until a predicate becomes true, yielding to the event loop between checks.
     * Unlike fixed setTimeout delays, this adapts to the actual speed of async resolution
     * on any machine (local dev or slow CI runner).
     */
    async function waitFor(
      predicate: () => boolean,
      timeout = 4000,
    ): Promise<void> {
      const start = Date.now();
      while (!predicate()) {
        if (Date.now() - start > timeout) {
          throw new Error(`waitFor timed out after ${timeout}ms`);
        }
        await new Promise(r => setTimeout(r, 5));
      }
    }

    /**
     * Settle: flush all currently-pending async work by yielding multiple
     * event loop ticks. Used after navigations where we don't have a specific
     * condition to poll for.
     */
    async function settle(): Promise<void> {
      // Use real milliseconds to handle cases where jsdom's event loop
      // may schedule work on actual timers rather than just microtasks
      await new Promise(r => setTimeout(r, 50));
    }

    await fc.assert(
      fc.asyncProperty(
        // Generate sequences of non-mutation navigation actions
        fc.array(
          fc.oneof(
            fc.constant('home'),
            fc.constant('upload-page'), // just viewing the upload page, not submitting
            fc.constant('project-detail'),
          ),
          { minLength: 1, maxLength: 5 },
        ),
        async (navigations) => {
          // Reset modules so we get fresh state each run
          vi.resetModules();
          document.body.innerHTML = '';
          const freshContainer = document.createElement('div');
          freshContainer.id = 'app';
          document.body.appendChild(freshContainer);
          vi.clearAllMocks();

          // Track hashchange listeners so we can clean up after each iteration
          const originalAddEventListener = window.addEventListener.bind(window);
          const originalRemoveEventListener = window.removeEventListener.bind(window);
          const addedListeners: Array<{ type: string; listener: EventListenerOrEventListenerObject }> = [];

          window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
            addedListeners.push({ type, listener });
            return originalAddEventListener(type, listener, options);
          }) as typeof window.addEventListener;

          try {
            // Set hash to #/projects for the router to match on start
            window.location.hash = '#/projects';

            const { fetchSearchIndex } = await import('./utils/api');
            const mockedFetch = vi.mocked(fetchSearchIndex);
            mockedFetch.mockResolvedValue({ ok: true, data: [{ name: 'proj', description: 'desc', tags: ['t'], date: '2024-01-01', path: 'projects/proj/' }] });

            // Initialize app — router.start() calls onHashChange() which will invoke
            // renderSearchView since hash is already #/projects
            await import('./main');

            // Wait deterministically until fetchSearchIndex has been called at least once.
            // The router fires renderSearchView as a fire-and-forget async call, so we must
            // poll rather than relying on a fixed number of microtask ticks.
            await waitFor(() => mockedFetch.mock.calls.length >= 1);
            // Also let the post-fetch logic (initializeSearch, markSearchIndexLoaded) complete
            await settle();

          const callCountAfterInit = mockedFetch.mock.calls.length;

          // Perform each navigation in the sequence
          for (const nav of navigations) {
            if (nav === 'home') {
              window.location.hash = '#/projects';
            } else if (nav === 'upload-page') {
              window.location.hash = '#/upload';
            } else if (nav === 'project-detail') {
              window.location.hash = '#/project/proj';
            }
            // Let the route handler's async work settle
            await settle();
          }

          // After all non-mutation navigations, fetchSearchIndex should NOT have been
          // called again (searchIndexLoaded stays true after successful initial load)
          expect(mockedFetch.mock.calls.length).toBe(callCountAfterInit);
          } finally {
            // Clean up all event listeners added during this iteration to prevent
            // accumulated listeners from interfering with subsequent iterations
            for (const { type, listener } of addedListeners) {
              originalRemoveEventListener(type, listener);
            }
            window.addEventListener = originalAddEventListener as typeof window.addEventListener;
          }
        },
      ),
      { numRuns: 15 },
    );
  }, 30_000);

  it('failed mutations do NOT reset searchIndexLoaded', async () => {
    /**
     * Poll until a predicate becomes true, yielding to the event loop between checks.
     */
    async function waitFor(
      predicate: () => boolean,
      timeout = 2000,
    ): Promise<void> {
      const start = Date.now();
      while (!predicate()) {
        if (Date.now() - start > timeout) {
          throw new Error(`waitFor timed out after ${timeout}ms`);
        }
        await new Promise(r => setTimeout(r, 5));
      }
    }

    /**
     * Settle: flush all currently-pending async work by yielding multiple event loop ticks.
     */
    async function settle(): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant('failed-upload'),
          fc.constant('failed-delete'),
          fc.constant('failed-edit'),
        ),
        async (failureType) => {
          vi.resetModules();
          document.body.innerHTML = '';
          const freshContainer = document.createElement('div');
          freshContainer.id = 'app';
          document.body.appendChild(freshContainer);
          vi.clearAllMocks();

          // Set hash to #/projects for the router to match on start
          window.location.hash = '#/projects';

          const apiModule = await import('./utils/api');
          const mockedFetch = vi.mocked(apiModule.fetchSearchIndex);
          mockedFetch.mockResolvedValue({ ok: true, data: [] });

          // Make mutations fail
          vi.mocked(apiModule.initiateUpload).mockResolvedValue({ ok: false, error: 'Upload failed' });
          vi.mocked(apiModule.deleteProject).mockResolvedValue({ ok: false, error: 'Delete failed' });
          vi.mocked(apiModule.updateProject).mockResolvedValue({ ok: false, error: 'Edit failed' });
          // Ensure computePatchBody returns a non-null value so updateProject is actually called
          vi.mocked(apiModule.computePatchBody).mockReturnValue({ name: 'changed' });

          // Initialize app — performs initial index load
          window.location.hash = '#/projects';
          await import('./main');
          await waitFor(() => mockedFetch.mock.calls.length >= 1);
          await settle();

          const callCountAfterInit = mockedFetch.mock.calls.length;
          expect(callCountAfterInit).toBeGreaterThanOrEqual(1);

          // Attempt a failing mutation
          if (failureType === 'failed-upload') {
            window.location.hash = '#/upload';
            await settle();
            const form = document.querySelector('form');
            if (form) {
              const nameInput = document.querySelector('#project-name') as HTMLInputElement;
              if (nameInput) nameInput.value = 'test';
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              await settle();
            }
          } else if (failureType === 'failed-delete') {
            window.location.hash = '#/project/test-project';
            await settle();
            try {
              const { showDeleteDialog } = await import('./components/delete-dialog');
              showDeleteDialog('test-project');
              await settle();
              const input = document.querySelector('.delete-dialog-input') as HTMLInputElement;
              const confirmBtn = document.querySelector('.delete-dialog-confirm') as HTMLButtonElement;
              if (input && confirmBtn) {
                input.value = 'test-project';
                input.dispatchEvent(new Event('input'));
                confirmBtn.click();
                await settle();
              }
            } catch {
              // Delete dialog may not render without project detail
            }
          } else if (failureType === 'failed-edit') {
            window.location.hash = '#/project/test-project/edit';
            await settle();
            const form = document.querySelector('form');
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              await settle();
            }
          }

          // Navigate back to projects
          window.location.hash = '#/projects';
          await settle();

          // Failed mutations should NOT reset searchIndexLoaded,
          // so fetchSearchIndex should NOT be called again
          expect(mockedFetch.mock.calls.length).toBe(callCountAfterInit);
        },
      ),
      { numRuns: 10 },
    );
  }, 30_000);
});
