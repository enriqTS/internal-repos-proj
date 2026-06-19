import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAIClient, MODEL_ID } from './ai-client';
import { getTagRegistry } from './tag-registry';
import type { SuggestTagsRequest, SuggestTagsResponse } from 'shared';

/** Maximum characters of README content sent to the model. */
const MAX_README_INPUT_LENGTH = 10_000;

/** Timeout in milliseconds for the AI model invocation in suggestTagsFromReadme. */
const SUGGEST_TAGS_TIMEOUT_MS = 10_000;

/** Standard CORS headers included in every response. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

/**
 * Safely extract a JSON object containing a "tags" array from AI model output.
 * Handles markdown code fences, trailing text, and other common quirks.
 * Uses a non-greedy approach to find the first valid JSON object with a "tags" field.
 */
function extractJson(content: string): { tags: unknown } | null {
  // Strip markdown code fences if present
  const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');

  // Find the first '{' and attempt to parse progressively to find valid JSON
  const startIdx = stripped.indexOf('{');
  if (startIdx === -1) return null;

  // Walk through the string tracking brace depth to find the matching closing brace
  let depth = 0;
  for (let i = startIdx; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) {
        const candidate = stripped.slice(startIdx, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && 'tags' in parsed) {
            return parsed;
          }
        } catch {
          // Not valid JSON at this closing brace, continue looking
        }
      }
    }
  }

  return null;
}

/**
 * Suggest tags for a project based on its README content.
 * Designed for direct invocation within the Finalize_Lambda (no HTTP).
 *
 * - Returns [] immediately if readme is empty, undefined, or whitespace-only
 * - Truncates README to 10,000 characters
 * - Fetches the current tag registry
 * - Invokes the AI model with the same prompt format as the handler
 * - Parses response and filters to registry-only tags
 * - Enforces a 10-second timeout via AbortController
 * - Returns empty array on any error (never throws)
 *
 * @param readme - The README content to analyze
 * @returns Array of suggested tag strings (0-10 items, all from registry)
 */
export async function suggestTagsFromReadme(readme: string): Promise<string[]> {
  try {
    // Early return if readme is empty, undefined, or whitespace-only
    if (!readme || !readme.trim()) {
      return [];
    }

    // Truncate README to 10,000 characters
    const readmeContent = readme.slice(0, MAX_README_INPUT_LENGTH);
    console.log(`[suggest-tags] suggestTagsFromReadme: README length: ${readmeContent.length} chars`);

    // Fetch current tag registry
    const registryTags = await getTagRegistry();
    console.log(`[suggest-tags] suggestTagsFromReadme: Registry has ${registryTags.length} tags`);

    if (registryTags.length === 0) {
      console.log('[suggest-tags] suggestTagsFromReadme: Empty registry, returning no suggestions');
      return [];
    }

    // Build prompt (same format as the handler)
    const prompt = `You are a tag classification system. Given a project README and a list of available tags, suggest the most relevant tags for this project.\n\nAvailable tags: ${registryTags.join(', ')}\n\nREADME:\n${readmeContent}\n\nRespond with a JSON object containing a "tags" field with an array of up to 10 suggested tags. Only suggest tags from the available tags list.`;

    console.log(`[suggest-tags] suggestTagsFromReadme: Invoking model: ${MODEL_ID}`);

    // Set up 10-second AbortController timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SUGGEST_TAGS_TIMEOUT_MS);

    try {
      const client = getAIClient();
      const response = await client.chat.completions.create(
        {
          model: MODEL_ID,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal }
      );

      console.log('[suggest-tags] suggestTagsFromReadme: Model response received');

      // Extract text content from the model response
      const content = response.choices[0]?.message?.content ?? null;

      if (!content) {
        return [];
      }

      // Extract JSON from the content (handle markdown code blocks)
      const parsed = extractJson(content);
      if (!parsed) {
        return [];
      }

      if (!parsed.tags || !Array.isArray(parsed.tags)) {
        return [];
      }

      // Filter to only tags present in registry (case-insensitive), cap at 10
      const registryLower = new Set(registryTags.map((t) => t.toLowerCase()));
      const suggestedTags: string[] = parsed.tags
        .filter((tag: unknown): tag is string => typeof tag === 'string')
        .map((tag: string) => tag.toLowerCase())
        .filter((tag: string) => registryLower.has(tag))
        .slice(0, 10);

      console.log(`[suggest-tags] suggestTagsFromReadme: Suggesting ${suggestedTags.length} tags: ${suggestedTags.join(', ')}`);

      return suggestedTags;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    // Log the error for CloudWatch visibility, then return empty array (never throws)
    console.error('[suggest-tags] suggestTagsFromReadme error:', err instanceof Error ? `${err.name}: ${err.message}` : err);
    return [];
  }
}

/**
 * Lambda handler for POST /tags/suggest.
 * Accepts a README and returns AI-suggested tags from the registry.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Handle preflight OPTIONS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS },
      body: '',
    };
  }

  try {
    // 1. Parse request body
    const body: SuggestTagsRequest = JSON.parse(event.body || '{}');

    if (!body.readme || typeof body.readme !== 'string') {
      console.log('[suggest-tags] No readme provided in request body');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ tags: [] } satisfies SuggestTagsResponse),
      };
    }

    // 2. Truncate README to 10,000 characters
    const readmeContent = body.readme.slice(0, MAX_README_INPUT_LENGTH);
    console.log(`[suggest-tags] README length: ${readmeContent.length} chars`);

    // 3. Fetch current tag registry
    const registryTags = await getTagRegistry();
    console.log(`[suggest-tags] Registry has ${registryTags.length} tags`);

    if (registryTags.length === 0) {
      console.log('[suggest-tags] Empty registry, returning no suggestions');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ tags: [] } satisfies SuggestTagsResponse),
      };
    }

    // 4. Build prompt and invoke AI model
    const prompt = `You are a tag classification system. Given a project README and a list of available tags, suggest the most relevant tags for this project.\n\nAvailable tags: ${registryTags.join(', ')}\n\nREADME:\n${readmeContent}\n\nRespond with a JSON object containing a "tags" field with an array of up to 10 suggested tags. Only suggest tags from the available tags list.`;

    console.log(`[suggest-tags] Invoking model: ${MODEL_ID}`);

    const client = getAIClient();
    const response = await client.chat.completions.create({
      model: MODEL_ID,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    console.log('[suggest-tags] Model response received');

    // 5. Extract text content from the model response
    const content = response.choices[0]?.message?.content ?? null;

    if (!content) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ tags: [] } satisfies SuggestTagsResponse),
      };
    }

    // 6. Extract JSON from the content (handle markdown code blocks)
    const parsed = extractJson(content);
    if (!parsed) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ tags: [] } satisfies SuggestTagsResponse),
      };
    }

    if (!parsed.tags || !Array.isArray(parsed.tags)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ tags: [] } satisfies SuggestTagsResponse),
      };
    }

    // 7. Filter to only tags present in registry (case-insensitive), cap at 10
    const registryLower = new Set(registryTags.map((t) => t.toLowerCase()));
    const suggestedTags: string[] = parsed.tags
      .filter((tag: unknown): tag is string => typeof tag === 'string')
      .map((tag: string) => tag.toLowerCase())
      .filter((tag: string) => registryLower.has(tag))
      .slice(0, 10);

    console.log(`[suggest-tags] Suggesting ${suggestedTags.length} tags: ${suggestedTags.join(', ')}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ tags: suggestedTags } satisfies SuggestTagsResponse),
    };
  } catch (err) {
    // Log the error for debugging, then return empty tags array
    console.error('[suggest-tags] Error:', err instanceof Error ? `${err.name}: ${err.message}` : err);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ tags: [] } satisfies SuggestTagsResponse),
    };
  }
}
