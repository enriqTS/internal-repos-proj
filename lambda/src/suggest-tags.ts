import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getTagRegistry } from './tag-registry';
import type { SuggestTagsRequest, SuggestTagsResponse } from 'shared';

const bedrockClient = new BedrockRuntimeClient({});

/** Maximum characters of README content sent to the model. */
const MAX_README_INPUT_LENGTH = 10_000;

/** Bedrock model ID for Kimi K2.5 */
const MODEL_ID = 'us.moonshotai.kimi-k2.5-0613-v1:0';

/** Standard CORS headers included in every response. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST',
};

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

    // 4. Build prompt and invoke Bedrock
    const prompt = `You are a tag classification system. Given a project README and a list of available tags, suggest the most relevant tags for this project.\n\nAvailable tags: ${registryTags.join(', ')}\n\nREADME:\n${readmeContent}\n\nRespond with a JSON object containing a "tags" field with an array of up to 10 suggested tags. Only suggest tags from the available tags list.`;

    const requestBody = JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
    });

    console.log(`[suggest-tags] Invoking Bedrock model: ${MODEL_ID}`);

    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: requestBody,
    });

    const response = await bedrockClient.send(command);
    console.log('[suggest-tags] Bedrock response received');

    // 5. Parse model response
    const responseBody = new TextDecoder().decode(response.body);
    console.log(`[suggest-tags] Raw response: ${responseBody.slice(0, 500)}`);
    const modelOutput = JSON.parse(responseBody);

    // Extract the text content from the model response
    let content: string;
    if (modelOutput.choices && modelOutput.choices[0]?.message?.content) {
      content = modelOutput.choices[0].message.content;
    } else if (modelOutput.content && typeof modelOutput.content === 'string') {
      content = modelOutput.content;
    } else if (modelOutput.completion) {
      content = modelOutput.completion;
    } else {
      content = responseBody;
    }

    // 6. Extract JSON from the content (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*"tags"[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ tags: [] } satisfies SuggestTagsResponse),
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

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
