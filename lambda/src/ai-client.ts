import Anthropic from "@anthropic-ai/sdk";

export const MODEL_ID = "moonshotai.kimi-k2.5";

let clientInstance: Anthropic | null = null;

export function getAIClient(): Anthropic {
  if (!clientInstance) {
    clientInstance = new Anthropic({
      baseURL: "https://bedrock-mantle.us-east-1.api.aws/anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY!,
      defaultHeaders: {
        "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID!,
      },
    });
  }
  return clientInstance;
}
