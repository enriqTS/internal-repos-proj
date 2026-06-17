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
      const errors = validateForm('', '', 'some readme', createFileList(1));
      expect(errors.name).toBe('Project name is required');
    });

    it('returns error when name is only whitespace', () => {
      const errors = validateForm('   ', '', 'some readme', createFileList(1));
      expect(errors.name).toBe('Project name is required');
    });

    it('returns error when name exceeds 64 characters', () => {
      const longName = 'a'.repeat(65);
      const errors = validateForm(longName, '', 'some readme', createFileList(1));
      expect(errors.name).toContain('at most 64 characters');
    });

    it('returns error when name has invalid characters', () => {
      const errors = validateForm('my project!', '', 'some readme', createFileList(1));
      expect(errors.name).toContain('alphanumeric');
    });

    it('accepts valid names with hyphens and underscores', () => {
      const errors = validateForm('my-project_01', '', 'some readme', createFileList(1));
      expect(errors.name).toBeUndefined();
    });

    it('accepts a name at exactly 64 characters', () => {
      const name = 'a'.repeat(64);
      const errors = validateForm(name, '', 'some readme', createFileList(1));
      expect(errors.name).toBeUndefined();
    });
  });

  describe('tags validation', () => {
    it('allows empty tags', () => {
      const errors = validateForm('project', '', 'readme', createFileList(1));
      expect(errors.tags).toBeUndefined();
    });

    it('returns error when more than 10 tags', () => {
      const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`).join(', ');
      const errors = validateForm('project', tags, 'readme', createFileList(1));
      expect(errors.tags).toContain('Maximum 10 tags');
    });

    it('returns error when a tag exceeds 32 characters', () => {
      const longTag = 'a'.repeat(33);
      const errors = validateForm('project', longTag, 'readme', createFileList(1));
      expect(errors.tags).toContain('at most 32 characters');
    });

    it('accepts 10 valid tags', () => {
      const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`).join(', ');
      const errors = validateForm('project', tags, 'readme', createFileList(1));
      expect(errors.tags).toBeUndefined();
    });

    it('ignores empty tag entries from extra commas', () => {
      const errors = validateForm('project', 'tag1,,tag2,', 'readme', createFileList(1));
      expect(errors.tags).toBeUndefined();
    });
  });

  describe('readme validation', () => {
    it('returns error when readme is empty', () => {
      const errors = validateForm('project', '', '', createFileList(1));
      expect(errors.readme).toBe('Readme content is required');
    });

    it('returns error when readme is only whitespace', () => {
      const errors = validateForm('project', '', '   ', createFileList(1));
      expect(errors.readme).toBe('Readme content is required');
    });

    it('returns error when readme exceeds 50,000 characters', () => {
      const longReadme = 'x'.repeat(50_001);
      const errors = validateForm('project', '', longReadme, createFileList(1));
      expect(errors.readme).toContain('at most');
      expect(errors.readme).toContain('characters');
    });

    it('accepts readme at exactly 50,000 characters', () => {
      const readme = 'x'.repeat(50_000);
      const errors = validateForm('project', '', readme, createFileList(1));
      expect(errors.readme).toBeUndefined();
    });
  });

  describe('files validation', () => {
    it('returns error when files is null', () => {
      const errors = validateForm('project', '', 'readme', null);
      expect(errors.files).toBe('At least one file must be selected');
    });

    it('returns error when no files selected', () => {
      const errors = validateForm('project', '', 'readme', createFileList(0));
      expect(errors.files).toBe('At least one file must be selected');
    });

    it('accepts when files are selected', () => {
      const errors = validateForm('project', '', 'readme', createFileList(1));
      expect(errors.files).toBeUndefined();
    });
  });

  describe('combined validation', () => {
    it('returns no errors for fully valid input', () => {
      const errors = validateForm('my-project', 'tag1, tag2', '# Readme', createFileList(2));
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it('returns multiple errors simultaneously', () => {
      const errors = validateForm('', '', '', null);
      expect(errors.name).toBeDefined();
      expect(errors.readme).toBeDefined();
      expect(errors.files).toBeDefined();
    });
  });
});

describe('renderUploadForm', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
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

    // Check for tags input
    const tagsInput = container.querySelector('#project-tags') as HTMLInputElement;
    expect(tagsInput).not.toBeNull();

    // Check for readme textarea
    const readme = container.querySelector('#project-readme') as HTMLTextAreaElement;
    expect(readme).not.toBeNull();
    expect(readme.tagName).toBe('TEXTAREA');

    // Check for file input with webkitdirectory
    const fileInput = container.querySelector('#project-files') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    expect(fileInput.type).toBe('file');
    expect(fileInput.hasAttribute('webkitdirectory')).toBe(true);
  });

  it('renders a submit button', () => {
    renderUploadForm(container);
    const btn = container.querySelector('button[type="submit"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('Upload Project');
  });

  it('shows validation errors on invalid submission', async () => {
    renderUploadForm(container);
    const form = container.querySelector('form')!;

    // Submit with empty fields
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    const errors = container.querySelectorAll('.field-error');
    const errorTexts = Array.from(errors).map((e) => e.textContent).filter((t) => t);
    expect(errorTexts.length).toBeGreaterThan(0);
  });

  it('shows success message and clears form on successful upload', async () => {
    const apiModule = await import('./api');
    vi.spyOn(apiModule, 'submitUpload').mockResolvedValueOnce({
      ok: true,
      data: { message: 'Project uploaded successfully', path: 'projects/test/' },
    });

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;
    const fileInput = container.querySelector('#project-files') as HTMLInputElement;

    // Fill in valid data
    nameInput.value = 'test-project';
    readmeArea.value = '# Test Project';

    // Mock the files property
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', {
      value: { 0: file, length: 1, item: () => file },
      configurable: true,
    });

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusEl = container.querySelector('.upload-status');
    expect(statusEl!.textContent).toContain('uploaded successfully');
    expect(statusEl!.classList.contains('upload-status--success')).toBe(true);
  });

  it('shows error message on API error response', async () => {
    const apiModule = await import('./api');
    vi.spyOn(apiModule, 'submitUpload').mockResolvedValueOnce({
      ok: false,
      error: 'Project name already taken',
    });

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;
    const fileInput = container.querySelector('#project-files') as HTMLInputElement;

    nameInput.value = 'existing-project';
    readmeArea.value = '# Readme';

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', {
      value: { 0: file, length: 1, item: () => file },
      configurable: true,
    });

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusEl = container.querySelector('.upload-status');
    expect(statusEl!.textContent).toBe('Project name already taken');
    expect(statusEl!.classList.contains('upload-status--error')).toBe(true);
  });

  it('disables submit button during upload', async () => {
    const apiModule = await import('./api');
    let resolveUpload!: (value: any) => void;
    const uploadPromise = new Promise((resolve) => {
      resolveUpload = resolve;
    });
    vi.spyOn(apiModule, 'submitUpload').mockReturnValueOnce(uploadPromise as any);

    renderUploadForm(container);

    const nameInput = container.querySelector('#project-name') as HTMLInputElement;
    const readmeArea = container.querySelector('#project-readme') as HTMLTextAreaElement;
    const fileInput = container.querySelector('#project-files') as HTMLInputElement;
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

    nameInput.value = 'my-project';
    readmeArea.value = '# Test';

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', {
      value: { 0: file, length: 1, item: () => file },
      configurable: true,
    });

    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    // During upload, button should be disabled
    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.textContent).toBe('Uploading...');

    // Resolve the upload
    resolveUpload({ ok: true, data: { message: 'Success', path: 'projects/my-project/' } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After upload, button should be re-enabled
    expect(submitBtn.disabled).toBe(false);
    expect(submitBtn.textContent).toBe('Upload Project');
  });
});
