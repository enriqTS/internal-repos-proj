import OpenAI from "openai";

export const MODEL_ID = "moonshotai.kimi-k2.5";

let clientInstance: OpenAI | null = null;

export function getAIClient(): OpenAI {
  if (!clientInstance) {
    clientInstance = new OpenAI({
      baseURL: "https://bedrock-mantle.us-east-1.api.aws/v1",
      apiKey: process.env.OPENAI_API_KEY!,
      defaultHeaders: {
        "OpenAI-Project": process.env.OPENAI_PROJECT_ID || "default",
      },
    });
  }
  return clientInstance;
}
