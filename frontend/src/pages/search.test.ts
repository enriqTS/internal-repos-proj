/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initializeSearch, search, debounce, renderResults, setupSearch } from './search';
import type { SearchIndex } from 'shared/types';

const mockIndex: SearchIndex = [
  {
    name: 'project-alpha',
    description: 'Internal CI/CD tooling for deployment automation',
    tags: ['ci-cd', 'automation', 'devops'],
    date: '2024-01-15',
    path: 'projects/project-alpha/',
  },
  {
    name: 'data-pipeline',
    description: 'ETL pipeline for data warehouse ingestion',
    tags: ['data', 'etl', 'warehouse'],
    date: '2024-03-20',
    path: 'projects/data-pipeline/',
  },
  {
    name: 'auth-service',
    description: 'Authentication microservice with OAuth2',
    tags: ['auth', 'oauth', 'security'],
    date: '2024-02-10',
    path: 'projects/auth-service/',
  },
];

describe('search module', () => {
  beforeEach(() => {
    initializeSearch(mockIndex);
  });

  describe('initializeSearch', () => {
    it('should initialize without errors', () => {
      expect(() => initializeSearch(mockIndex)).not.toThrow();
    });

    it('should handle empty index', () => {
      initializeSearch([]);
      const results = search('');
      expect(results).toHaveLength(0);
    });
  });

  describe('search', () => {
    it('should return all projects sorted by date descending when query is empty', () => {
      const results = search('');
      expect(results).toHaveLength(3);
      expect(results[0].item.name).toBe('data-pipeline');   // 2024-03-20
      expect(results[1].item.name).toBe('auth-service');    // 2024-02-10
      expect(results[2].item.name).toBe('project-alpha');   // 2024-01-15
    });

    it('should return all projects sorted by date descending when query is whitespace', () => {
      const results = search('   ');
      expect(results).toHaveLength(3);
      expect(results[0].item.name).toBe('data-pipeline');
    });

    it('should return matching results for a valid query', () => {
      const results = search('auth');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.name).toBe('auth-service');
    });

    it('should return results matching tags', () => {
      const results = search('devops');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.name).toBe('project-alpha');
    });

    it('should return results matching description', () => {
      const results = search('pipeline');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.name).toBe('data-pipeline');
    });

    it('should return empty array when no matches found', () => {
      const results = search('xyznonexistent');
      expect(results).toHaveLength(0);
    });

    it('should include score in results for non-empty queries', () => {
      const results = search('auth');
      expect(results[0].score).toBeDefined();
      expect(typeof results[0].score).toBe('number');
    });

    it('should not include score for empty query results', () => {
      const results = search('');
      expect(results[0].score).toBeUndefined();
    });
  });

  describe('debounce', () => {
    it('should delay function execution', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 200);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });

    it('should reset the timer on subsequent calls', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 200);

      debounced();
      vi.advanceTimersByTime(100);
      debounced();
      vi.advanceTimersByTime(100);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });

    it('should pass arguments to the debounced function', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 200);

      debounced('arg1', 'arg2');
      vi.advanceTimersByTime(200);

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
      vi.useRealTimers();
    });

    it('should default to 200ms delay', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn);

      debounced();
      vi.advanceTimersByTime(199);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });
  });

  describe('renderResults', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
    });

    it('should display "No results found" when results are empty', () => {
      renderResults([], container);
      const noResults = container.querySelector('p');
      expect(noResults).not.toBeNull();
      expect(noResults!.textContent).toBe('Nenhum resultado encontrado');
    });

    it('should render a grid of results with name, description, and tags', () => {
      const results = search('');
      renderResults(results, container);

      const items = container.querySelectorAll('[role="link"]');
      expect(items).toHaveLength(3);

      const firstItem = items[0];
      expect(firstItem.querySelector('h3')!.textContent).toBe('data-pipeline');
      expect(firstItem.querySelector('p')!.textContent).toBe(
        'ETL pipeline for data warehouse ingestion',
      );
      const tags = firstItem.querySelectorAll('span');
      expect(tags).toHaveLength(3);
      expect(tags[0].textContent).toBe('data');
    });

    it('should clear previous content before rendering', () => {
      container.innerHTML = '<p>Old content</p>';
      renderResults([], container);
      const noResults = container.querySelector('p');
      expect(noResults).not.toBeNull();
      expect(noResults!.textContent).toBe('Nenhum resultado encontrado');
      expect(container.innerHTML).not.toContain('Old content');
    });
  });

  describe('setupSearch', () => {
    it('should render initial results on setup', () => {
      const input = document.createElement('input');
      const container = document.createElement('div');

      setupSearch(input, container);

      // Should render all projects initially
      const items = container.querySelectorAll('[role="link"]');
      expect(items).toHaveLength(3);
    });

    it('should wire input event to debounced search', () => {
      vi.useFakeTimers();
      const input = document.createElement('input');
      const container = document.createElement('div');

      setupSearch(input, container);

      // Simulate typing
      input.value = 'auth';
      input.dispatchEvent(new Event('input'));

      // Before debounce delay, still shows initial results
      vi.advanceTimersByTime(100);

      // After debounce delay, shows filtered results
      vi.advanceTimersByTime(100);
      const items = container.querySelectorAll('[role="link"]');
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].querySelector('h3')!.textContent).toBe('auth-service');

      vi.useRealTimers();
    });
  });
});
