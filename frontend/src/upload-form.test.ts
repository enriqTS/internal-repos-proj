/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateForm, renderUploadForm } from './upload-form';

describe('validateForm', () => {
  /**
   * Create a mock FileList for testing.
   * jsdom doesn't support DataTransfer, so we create a minimal FileList-like object.
   */
  function createFileList(count: number): FileList {
    const files: File[] = [];
    for (let i = 0; i < count; i++) {
      files.push(new File(['content'], `file${i}.txt`, { type: 'text/plain' }));
    }
    // Create a FileList-like object
    const fileList = Object.create(null);
    for (let i = 0; i < files.length; i++) {
      fileList[i] = files[i];
    }
    fileList.length = files.length;
    fileList.item = (index: number) => files[index] ?? null;
    fileList[Symbol.iterator] = function* () {
      for (let i = 0; i < files.length; i++) {
        yield files[i];
      }
    };
    return fileList as unknown as FileList;
  }

  describe('project name validation', () => {
    it('returns error when name is empty', () => {
      const errors = validateForm('', 'some readme', createFileList(1));
      expect(errors.name).toBe('Nome do projeto é obrigatório');
    });

    it('returns error when name is only whitespace', () => {
      const errors = validateForm('   ', 'some readme', createFileList(1));
      expect(errors.name).toBe('Nome do projeto é obrigatório');
    });

    it('returns error when name exceeds 64 characters', () => {
      const longName = 'a'.repeat(65);
      const errors = validateForm(longName, 'some readme', createFileList(1));
      expect(errors.name).toContain('no máximo 64 caracteres');
    });

    it('returns error when name has invalid characters', () => {
      const errors = validateForm('my project!', 'some readme', createFileList(1));
      expect(errors.name).toContain('alfanuméricos');
    });

    it('accepts valid names with hyphens and underscores', () => {
      const errors = validateForm('my-project_01', 'some readme', createFileList(1));
      expect(errors.name).toBeUndefined();
    });

    it('accepts a name at exactly 64 characters', () => {
      const name = 'a'.repeat(64);
      const errors = validateForm(name, 'some readme', createFileList(1));
      expect(errors.name).toBeUndefined();
    });
  });

  describe('readme validation', () => {
    it('accepts empty readme (field is optional)', () => {
      const errors = validateForm('project', '', createFileList(1));
      expect(errors.readme).toBeUndefined();
    });

    it('accepts whitespace-only readme (field is optional)', () => {
      const errors = validateForm('project', '   ', createFileList(1));
      expect(errors.readme).toBeUndefined();
    });

    it('returns error when readme exceeds 50,000 characters', () => {
      const longReadme = 'x'.repeat(50_001);
      const errors = validateForm('project', longReadme, createFileList(1));
      expect(errors.readme).toContain('no máximo');
      expect(errors.readme).toContain('caracteres');
    });

    it('accepts readme at exactly 50,000 characters', () => {
      const readme = 'x'.repeat(50_000);
      const errors = validateForm('project', readme, createFileList(1));
      expect(errors.readme).toBeUndefined();
    });
  });

  describe('files validation', () => {
    it('returns error when files is null', () => {
      const errors = validateForm('project', 'readme', null);
      expect(errors.files).toBe('Pelo menos um arquivo deve ser selecionado');
    });

    it('returns error when no files selected', () => {
      const errors = validateForm('project', 'readme', createFileList(0));
      expect(errors.files).toBe('Pelo menos um arquivo deve ser selecionado');
    });

    it('accepts when files are selected', () => {
      const errors = validateForm('project', 'readme', createFileList(1));
      expect(errors.files).toBeUndefined();
    });
  });

  describe('combined validation', () => {
    it('returns no errors for fully valid input', () => {
      const errors = validateForm('my-project', '# Readme', createFileList(2));
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it('returns multiple errors simultaneously', () => {
      const errors = validateForm('', '', null);
      expect(errors.name).toBeDefined();
      expect(errors.files).toBeDefined();
      // readme is now optional, so no error for empty readme
      expect(errors.readme).toBeUndefined();
    });
  });
});

vi.mock('./api', () => ({
  initiateUpload: vi.fn(),
  uploadToS3: vi.fn(),
  finalizeUpload: vi.fn(),
  fetchTagRegistry: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  suggestTags: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
}));

vi.mock('./tag-selector', () => {
  const mockTagSelector = {
    setAvailableTags: vi.fn(),
    applySuggestions: vi.fn(),
    getSelectedTags: vi.fn(() => []),
    getNewTags: vi.fn(() => []),
    hasUserInteracted: vi.fn(() => false),
    destroy: vi.fn(),
  };
  return {
    createTagSelector: vi.fn(() => mockTagSelector),
  };
});

vi.mock('./search-state', () => ({
  invalidateSearchIndex: vi.fn(),
  searchIndexLoaded: false,
  markSearchIndexLoaded: vi.fn(),
}));

vi.mock('jszip', () => {
  const mockGenerateAsync = vi.fn(() => Promise.resolve(new Blob(['fake-zip'], { type: 'application/zip' })));
  const mockFile = vi.fn();
  return {
    default: vi.fn(() => ({
      file: mockFile,
      generateAsync: mockGenerateAsync,
    })),
  };
});

// Mock drop-zone to expose onFiles callback for testing
let capturedOnFiles: ((files: FileList) => void) | null = null;
vi.mock('./drop-zone', () => ({
  createDropZone: vi.fn((opts: { container: HTMLElement; onFiles: (files: FileList) => void }) => {
    capturedOnFiles = opts.onFiles;
    return {
      getFiles: vi.fn(() => null),
      reset: vi.fn(),
      destroy: vi.fn(),
    };
  }),
}));

// Mock readme-preview to provide a controllable textarea
vi.mock('./readme-preview', () => ({
  createReadmePreview: vi.fn((opts: { container: HTMLElement; textareaId?: string; maxLength?: number; placeholder?: string; rows?: number }) => {
    const textarea = document.createElement('textarea');
    if (opts.textareaId) textarea.id = opts.textareaId;
    if (opts.maxLength) textarea.maxLength = opts.maxLength;
    if (opts.placeholder) textarea.placeholder = opts.placeholder;
    if (opts.rows) textarea.rows = opts.rows;
    opts.container.appendChild(textarea);
    return {
      getValue: () => textarea.value,
      setValue: (content: string) => { textarea.value = content; },
      getTextarea: () => textarea,
      setEditMode: vi.fn(),
      setPreviewMode: vi.fn(),
      getMode: () => 'edit' as const,
      destroy: vi.fn(),
    };
  }),
}));

// Mock marked and highlight.js
vi.mock('marked', () => ({
  Marked: vi.fn(() => ({
    parse: vi.fn((content: string) => `<p>${content}</p>`),
  })),
}));

vi.mock('marked-highlight', () => ({
  markedHighlight: vi.fn(() => ({})),
}));

vi.mock('highlight.js', () => ({
  default: {
    getLanguage: vi.fn(() => null),
    highlight: vi.fn(() => ({ value: '' })),
    highlightAuto: vi.fn(() => ({ value: '' })),
  },
}));

function createMockFile(name: string, relativePath: string): File {
  const file = new File(['content'], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, writable: false });
  return file;
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

describe('renderUploadForm', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    capturedOnFiles = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders a form with all required fields', () => {
    renderUploadForm(container);

    const form = container.querySelector('form');
    expect(form).not.toBeNull();

    // Check for project name input
    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.type).toBe('text');

    // Check for tag selector container
    const tagSelectorContainer = container.querySelector('.tag-selector-container');
    expect(tagSelectorContainer).not.toBeNull();

    // Check for readme textarea (created by readme-preview mock)
    const readme = container.querySelector('#project-readme') as HTMLTextAreaElement;
    expect(readme).not.toBeNull();
    expect(readme.tagName).toBe('TEXTAREA');

    // Check for drop zone container
    const dropZoneContainer = container.querySelector('.drop-zone-container');
    expect(dropZoneContainer).not.toBeNull();
  });

  it('renders the readme textarea without the required attribute', () => {
    renderUploadForm(container);
    const readme = container.querySelector('#project-readme') as HTMLTextAreaElement;
    expect(readme).not.toBeNull();
    expect(readme.hasAttribute('required')).toBe(false);
  });

  it('renders a submit button', () => {
    renderUploadForm(container);
    const btn = container.querySelector('button[type="submit"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('Enviar Projeto');
  });

  it('renders form elements in correct order: drop-zone, name, tags, submit, status, readme', () => {
    renderUploadForm(container);
    const form = container.querySelector('form')!;
    const children = Array.from(form.children);

    // Find indices of key elements
    const dropZoneIdx = children.findIndex(el => el.classList.contains('drop-zone-container'));
    const nameIdx = children.findIndex(el => el.querySelector('#project-name'));
    const tagsIdx = children.findIndex(el => el.querySelector('.tag-selector-container'));
    const submitIdx = children.findIndex(el => el.tagName === 'BUTTON' && (el as HTMLButtonElement).type === 'submit');
    const statusIdx = children.findIndex(el => el.classList.contains('upload-status'));
    const readmeIdx = children.findIndex(el => el.querySelector('#project-readme'));

    expect(dropZoneIdx).toBeLessThan(nameIdx);
    expect(nameIdx).toBeLessThan(tagsIdx);
    expect(tagsIdx).toBeLessThan(submitIdx);
    expect(submitIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(readmeIdx);
  });

  it('shows validation errors on invalid submission', async () => {
    renderUploadForm(container);
    const form = container.querySelector('form')!;

    // Submit with empty fields (no files selected via drop zone)
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    const errors = container.querySelectorAll('.field-error');
    const errorTexts = Array.from(errors).map((e) => e.textContent).filter((t) => t);
    expect(errorTexts.length).toBeGreaterThan(0);
  });

  it('redirects to project list on successful upload (initiate → S3 → finalize)', async () => {
    const { initiateUpload, uploadToS3, finalizeUpload } = await import('./api');
    const { invalidateSearchIndex } = await import('./search-state');
    const mockedInitiate = vi.mocked(initiateUpload);
    const mockedUploadToS3 = vi.mocked(uploadToS3);
    const mockedFinalize = vi.mocked(finalizeUpload);

    mockedInitiate.mockResolvedValueOnce({
      ok: true,
      data: { sessionId: 'sess-123', uploadUrl: 'https://s3.example.com/presigned', expiresAt: '2025-01-01T00:15:00Z' },
    });
    mockedUploadToS3.mockResolvedValueOnce(undefined);
    mockedFinalize.mockResolvedValueOnce({
      ok: true,
      data: { message: 'Project uploaded successfully!', path: 'projects/test-project/' },
    });

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;

    nameInput.value = 'test-project';
    readmeArea.value = '# Test Project';

    // Simulate file selection via drop zone
    const mockFiles = createMockFileList([
      createMockFile('main.ts', 'my-project/src/main.ts'),
    ]);
    capturedOnFiles!(mockFiles);

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify the full sequence was called
    expect(mockedInitiate).toHaveBeenCalledWith({ name: 'test-project', tags: [], readme: '# Test Project' });
    expect(mockedUploadToS3).toHaveBeenCalledWith('https://s3.example.com/presigned', expect.any(Blob), expect.any(Function));
    expect(mockedFinalize).toHaveBeenCalledWith('sess-123');

    // Verify redirect to project list
    expect(window.location.hash).toBe('#/projects');

    // Verify search index was invalidated
    expect(invalidateSearchIndex).toHaveBeenCalled();

    // Verify no success message was displayed
    const statusEl = container.querySelector('.upload-status');
    expect(statusEl!.textContent).not.toContain('uploaded successfully');
    expect(statusEl!.classList.contains('upload-status--success')).toBe(false);
  });

  it('shows error message when initiate fails', async () => {
    const { initiateUpload } = await import('./api');
    const mockedInitiate = vi.mocked(initiateUpload);

    mockedInitiate.mockResolvedValueOnce({
      ok: false,
      error: 'Project name already taken',
    });

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;

    nameInput.value = 'existing-project';
    readmeArea.value = '# Readme';

    // Simulate file selection via drop zone
    const mockFiles = createMockFileList([
      createMockFile('file.ts', 'my-project/file.ts'),
    ]);
    capturedOnFiles!(mockFiles);

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusEl = container.querySelector('.upload-status');
    expect(statusEl!.textContent).toBe('Project name already taken');
    expect(statusEl!.classList.contains('upload-status--error')).toBe(true);
  });

  it('disables submit button during upload', async () => {
    const { initiateUpload, uploadToS3, finalizeUpload } = await import('./api');
    const mockedInitiate = vi.mocked(initiateUpload);
    const mockedUploadToS3 = vi.mocked(uploadToS3);
    const mockedFinalize = vi.mocked(finalizeUpload);

    let resolveS3!: () => void;
    const s3Promise = new Promise<void>((resolve) => { resolveS3 = resolve; });

    mockedInitiate.mockResolvedValueOnce({
      ok: true,
      data: { sessionId: 'sess-456', uploadUrl: 'https://s3.example.com/put', expiresAt: '2025-01-01T00:15:00Z' },
    });
    mockedUploadToS3.mockReturnValueOnce(s3Promise);
    mockedFinalize.mockResolvedValueOnce({
      ok: true,
      data: { message: 'Success', path: 'projects/my-project/' },
    });

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

    nameInput.value = 'my-project';
    readmeArea.value = '# Test';

    // Simulate file selection via drop zone
    const mockFiles = createMockFileList([
      createMockFile('index.ts', 'my-project/index.ts'),
    ]);
    capturedOnFiles!(mockFiles);

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    // During upload, button should be disabled
    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.textContent).toBe('Enviando...');

    // Resolve the S3 upload
    resolveS3();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After successful upload, page redirects — button state doesn't matter
    // but we verify the redirect happened
    expect(window.location.hash).toBe('#/projects');
  });

  it('shows error when all files are filtered out by DENY_LIST', async () => {
    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;

    nameInput.value = 'my-project';
    readmeArea.value = '# Test';

    // All files match DENY_LIST patterns (node_modules/, .git/)
    const mockFiles = createMockFileList([
      createMockFile('package.json', 'my-project/node_modules/package.json'),
      createMockFile('config', 'my-project/.git/config'),
    ]);
    capturedOnFiles!(mockFiles);

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusEl = container.querySelector('.upload-status');
    expect(statusEl!.textContent).toContain('Nenhum arquivo restou');
    expect(statusEl!.classList.contains('upload-status--error')).toBe(true);
  });

  it('shows error when S3 upload fails', async () => {
    const { initiateUpload, uploadToS3 } = await import('./api');
    const mockedInitiate = vi.mocked(initiateUpload);
    const mockedUploadToS3 = vi.mocked(uploadToS3);

    mockedInitiate.mockResolvedValueOnce({
      ok: true,
      data: { sessionId: 'sess-789', uploadUrl: 'https://s3.example.com/put', expiresAt: '2025-01-01T00:15:00Z' },
    });
    mockedUploadToS3.mockRejectedValueOnce(new Error('S3 upload failed (HTTP 403)'));

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;

    nameInput.value = 'my-project';
    readmeArea.value = '# Test';

    // Simulate file selection via drop zone
    const mockFiles = createMockFileList([
      createMockFile('app.ts', 'my-project/app.ts'),
    ]);
    capturedOnFiles!(mockFiles);

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusEl = container.querySelector('.upload-status');
    expect(statusEl!.textContent).toContain('S3 upload failed');
    expect(statusEl!.classList.contains('upload-status--error')).toBe(true);

    // Button should be re-enabled after error
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('shows error when finalize fails', async () => {
    const { initiateUpload, uploadToS3, finalizeUpload } = await import('./api');
    const mockedInitiate = vi.mocked(initiateUpload);
    const mockedUploadToS3 = vi.mocked(uploadToS3);
    const mockedFinalize = vi.mocked(finalizeUpload);

    mockedInitiate.mockResolvedValueOnce({
      ok: true,
      data: { sessionId: 'sess-abc', uploadUrl: 'https://s3.example.com/put', expiresAt: '2025-01-01T00:15:00Z' },
    });
    mockedUploadToS3.mockResolvedValueOnce(undefined);
    mockedFinalize.mockResolvedValueOnce({
      ok: false,
      error: 'Upload finalization failed (HTTP 500)',
    });

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;

    nameInput.value = 'my-project';
    readmeArea.value = '# Test';

    // Simulate file selection via drop zone
    const mockFiles = createMockFileList([
      createMockFile('app.ts', 'my-project/app.ts'),
    ]);
    capturedOnFiles!(mockFiles);

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusEl = container.querySelector('.upload-status');
    expect(statusEl!.textContent).toBe('Upload finalization failed (HTTP 500)');
    expect(statusEl!.classList.contains('upload-status--error')).toBe(true);
  });

  it('shows error when zip exceeds MAX_CLIENT_ZIP_SIZE', async () => {
    // Override the JSZip mock to return a blob that exceeds size limit
    const JSZip = (await import('jszip')).default;
    const mockInstance = new JSZip();
    // 500 MB + 1 byte
    const oversizedBlob = new Blob([new ArrayBuffer(500 * 1024 * 1024 + 1)]);
    vi.mocked(mockInstance.generateAsync).mockResolvedValueOnce(oversizedBlob);

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;

    nameInput.value = 'my-project';
    readmeArea.value = '# Test';

    // Simulate file selection via drop zone
    const mockFiles = createMockFileList([
      createMockFile('big-file.bin', 'my-project/big-file.bin'),
    ]);
    capturedOnFiles!(mockFiles);

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusEl = container.querySelector('.upload-status');
    expect(statusEl!.textContent).toContain('muito grande');
    expect(statusEl!.classList.contains('upload-status--error')).toBe(true);

    // initiateUpload should NOT have been called
    const { initiateUpload } = await import('./api');
    expect(initiateUpload).not.toHaveBeenCalled();
  });
});
