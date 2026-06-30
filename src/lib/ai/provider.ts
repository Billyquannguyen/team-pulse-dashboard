export type AIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AIGenerateJsonInput = {
  messages: AIChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export type AIGenerateJsonResult<TOutput> = {
  output: TOutput;
  modelUsed: string;
};

export interface AIProvider {
  generateJson<TOutput>(input: AIGenerateJsonInput): Promise<AIGenerateJsonResult<TOutput>>;
}
