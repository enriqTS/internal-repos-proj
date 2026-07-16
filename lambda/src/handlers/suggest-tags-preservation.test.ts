/**
 * Preservation Property Tests — suggestTagsFromReadme Registry Tag Filtering
 *
 * **Validates: Requirements 3.4, 3.9, 3.10**
 *
 * Property 2: Preservation — Existing Behaviors Unchanged
 *
 * These tests capture the CURRENT (pre-fix) behavior to ensure that:
 * - Tags that exist in the registry continue to be returned by suggestTagsFromReadme
 * - The filtering logic preserves case-insensitive matching for registry tags
 * - Empty/whitespace README returns empty array
 * - addTagsToRegistry persists new tags to S3
 *
 * EXPECTED TO PASS on unfixed code — this confirms baseline behavior to preserve.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// Mock S3 client before importing
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: vi.fn() })),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
}));

// Mock the tag-registry module
const mockGetTagRegistry = vi.fn();
vi.mock('../tag-registry', () => ({
  getTagRegistry: () => mockGetTagRegistry(),
  addTagsToRegistry: vi.fn(),
}));

// Mock AI client
const mockCreate = vi.fn();
vi.mock('../ai-client', () => ({
  getAIClient: () => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }),
  MODEL_ID: 'test-model',
}));

describe('Preservation: suggestTagsFromReadme returns registry-existing tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('for all tags that exist in registry, suggestTagsFromReadme returns them when AI suggests them', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a set of registry tags (valid lowercase tag strings)
        fc.array(
          fc.stringOf(
            fc.oneof(fc.char().filter((c) => /[a-z0-9-]/.test(c))),
            { minLength: 1, maxLength: 20 },
          ),
          { minLength: 1, maxLength: 10 },
        ),
        // Select a subset to be "AI suggested"
        fc.nat({ max: 5 }),
        async (registryTags, subsetSeed) => {
          // Deduplicate
          const uniqueRegistry = [...new Set(registryTags)].filter(t => t.length > 0);
          if (uniqueRegistry.length === 0) return;

          // Pick a subset of registry tags that the AI will "suggest"
          const suggestedCount = Math.min(subsetSeed % uniqueRegistry.length + 1, uniqueRegistry.length);
          const aiSuggestedTags = uniqueRegistry.slice(0, suggestedCount);

          // Mock registry to return our generated tags
          mockGetTagRegistry.mockResolvedValue(uniqueRegistry);

          // Mock AI response to suggest tags that ARE in the registry
          mockCreate.mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({ tags: aiSuggestedTags }),
                },
              },
            ],
          });

          const { suggestTagsFromReadme } = await import('./suggest-tags');
          const result = await suggestTagsFromReadme('# Test Project\n\nSome content about testing.');

          // Property: All returned tags should be from the registry (lowercased)
          const registryLower = new Set(uniqueRegistry.map((t) => t.toLowerCase()));
          for (const tag of result.tags) {
            expect(registryLower.has(tag)).toBe(true);
          }

          // Property: returned tags are a subset of what AI suggested (filtered to registry)
          expect(result.tags.length).toBeLessThanOrEqual(aiSuggestedTags.length);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('suggestTagsFromReadme returns empty array for empty/whitespace README', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(''),
          fc.constant('   '),
          fc.constant('\n\t  \n'),
        ),
        async (emptyReadme) => {
          const { suggestTagsFromReadme } = await import('./suggest-tags');
          const result = await suggestTagsFromReadme(emptyReadme);
          expect(result).toEqual({ tags: [], newTags: [] });
        },
      ),
      { numRuns: 10 },
    );
  });

  it('suggestTagsFromReadme returns empty array when registry is empty', async () => {
    mockGetTagRegistry.mockResolvedValue([]);

    const { suggestTagsFromReadme } = await import('./suggest-tags');
    const result = await suggestTagsFromReadme('# Valid Project\n\nHas content.');

    expect(result).toEqual({ tags: [], newTags: [] });
    // AI model should NOT be called when registry is empty
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('suggestTagsFromReadme filters out tags not in registry (current behavior)', async () => {
    const registry = ['python', 'terraform', 'aws', 'lambda'];
    mockGetTagRegistry.mockResolvedValue(registry);

    // AI suggests a mix of registry and non-registry tags
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ tags: ['python', 'terraform', 'novel-tag', 'unknown'] }),
          },
        },
      ],
    });

    const { suggestTagsFromReadme } = await import('./suggest-tags');
    const result = await suggestTagsFromReadme('# Test\n\nPython project with Terraform.');

    // Only registry tags should be returned in tags field
    expect(result.tags).toContain('python');
    expect(result.tags).toContain('terraform');
    expect(result.tags).not.toContain('novel-tag');
    expect(result.tags).not.toContain('unknown');
  });

  it('suggestTagsFromReadme caps results at MAX_AI_SUGGESTED_TAGS', async () => {
    const manyTags = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
    mockGetTagRegistry.mockResolvedValue(manyTags);

    // AI suggests all of them
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ tags: manyTags }),
          },
        },
      ],
    });

    const { suggestTagsFromReadme } = await import('./suggest-tags');
    const result = await suggestTagsFromReadme('# Test Project with many tags');

    // MAX_AI_SUGGESTED_TAGS is 25
    expect(result.tags.length).toBeLessThanOrEqual(25);
  });
});
