import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  isBinaryFile,
  isImageFile,
  EXTENSION_MAP,
  FILENAME_MAP,
  BINARY_EXTENSIONS,
  IMAGE_EXTENSIONS,
} from './language-mapper';

describe('detectLanguage', () => {
  it('returns language for known extensions', () => {
    expect(detectLanguage('main.ts')).toBe('typescript');
    expect(detectLanguage('app.py')).toBe('python');
    expect(detectLanguage('server.go')).toBe('go');
    expect(detectLanguage('config.json')).toBe('json');
    expect(detectLanguage('styles.css')).toBe('css');
    expect(detectLanguage('deploy.tf')).toBe('hcl');
    expect(detectLanguage('query.sql')).toBe('sql');
  });

  it('handles files with paths', () => {
    expect(detectLanguage('src/components/Button.tsx')).toBe('typescript');
    expect(detectLanguage('lib/utils/helper.js')).toBe('javascript');
  });

  it('checks FILENAME_MAP before EXTENSION_MAP', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('Makefile')).toBe('makefile');
    expect(detectLanguage('Jenkinsfile')).toBe('groovy');
    expect(detectLanguage('.gitignore')).toBe('bash');
    expect(detectLanguage('.editorconfig')).toBe('ini');
  });

  it('handles special filenames in paths', () => {
    expect(detectLanguage('project/Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('src/.gitignore')).toBe('bash');
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('data.xyz')).toBeNull();
    expect(detectLanguage('file.unknownext')).toBeNull();
  });

  it('returns null for files without extensions that are not in FILENAME_MAP', () => {
    expect(detectLanguage('LICENSE')).toBeNull();
    expect(detectLanguage('CHANGELOG')).toBeNull();
  });

  it('is case-insensitive for extensions', () => {
    expect(detectLanguage('Main.TS')).toBe('typescript');
    expect(detectLanguage('app.PY')).toBe('python');
    expect(detectLanguage('image.PNG')).toBeNull(); // .png not in EXTENSION_MAP
  });

  it('uses last dot for extension detection', () => {
    expect(detectLanguage('file.backup.ts')).toBe('typescript');
    expect(detectLanguage('archive.tar.gz')).toBeNull(); // .gz not in EXTENSION_MAP
  });
});

describe('isBinaryFile', () => {
  it('returns true for image files', () => {
    expect(isBinaryFile('photo.png')).toBe(true);
    expect(isBinaryFile('image.jpg')).toBe(true);
    expect(isBinaryFile('icon.svg')).toBe(true);
  });

  it('returns true for font files', () => {
    expect(isBinaryFile('font.woff2')).toBe(true);
    expect(isBinaryFile('text.ttf')).toBe(true);
  });

  it('returns true for archive files', () => {
    expect(isBinaryFile('bundle.zip')).toBe(true);
    expect(isBinaryFile('package.tar')).toBe(true);
    expect(isBinaryFile('compressed.gz')).toBe(true);
  });

  it('returns true for compiled files', () => {
    expect(isBinaryFile('app.exe')).toBe(true);
    expect(isBinaryFile('lib.dll')).toBe(true);
    expect(isBinaryFile('module.pyc')).toBe(true);
  });

  it('returns false for text files', () => {
    expect(isBinaryFile('main.ts')).toBe(false);
    expect(isBinaryFile('readme.md')).toBe(false);
    expect(isBinaryFile('config.json')).toBe(false);
  });

  it('returns false for files without extensions', () => {
    expect(isBinaryFile('Makefile')).toBe(false);
    expect(isBinaryFile('LICENSE')).toBe(false);
  });

  it('handles paths', () => {
    expect(isBinaryFile('assets/logo.png')).toBe(true);
    expect(isBinaryFile('src/main.ts')).toBe(false);
  });

  it('is case-insensitive for extensions', () => {
    expect(isBinaryFile('image.PNG')).toBe(true);
    expect(isBinaryFile('photo.JPG')).toBe(true);
  });
});

describe('isImageFile', () => {
  it('returns true for supported image formats', () => {
    expect(isImageFile('photo.png')).toBe(true);
    expect(isImageFile('image.jpg')).toBe(true);
    expect(isImageFile('picture.jpeg')).toBe(true);
    expect(isImageFile('animation.gif')).toBe(true);
    expect(isImageFile('modern.webp')).toBe(true);
    expect(isImageFile('vector.svg')).toBe(true);
  });

  it('returns false for non-image binary files', () => {
    expect(isImageFile('font.woff2')).toBe(false);
    expect(isImageFile('document.pdf')).toBe(false);
    expect(isImageFile('archive.zip')).toBe(false);
  });

  it('returns false for text files', () => {
    expect(isImageFile('main.ts')).toBe(false);
    expect(isImageFile('readme.md')).toBe(false);
  });

  it('returns false for non-previewable image formats', () => {
    expect(isImageFile('image.bmp')).toBe(false);
    expect(isImageFile('image.tiff')).toBe(false);
    expect(isImageFile('favicon.ico')).toBe(false);
  });

  it('handles paths', () => {
    expect(isImageFile('assets/images/logo.png')).toBe(true);
    expect(isImageFile('docs/screenshot.jpg')).toBe(true);
  });

  it('is case-insensitive for extensions', () => {
    expect(isImageFile('PHOTO.PNG')).toBe(true);
    expect(isImageFile('image.SVG')).toBe(true);
  });
});

describe('data structure integrity', () => {
  it('IMAGE_EXTENSIONS is a subset of BINARY_EXTENSIONS', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(BINARY_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it('EXTENSION_MAP does not overlap with BINARY_EXTENSIONS', () => {
    for (const ext of Object.keys(EXTENSION_MAP)) {
      expect(BINARY_EXTENSIONS.has(ext)).toBe(false);
    }
  });
});
