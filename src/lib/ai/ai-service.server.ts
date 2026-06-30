import {
  OpenRouterProvider,
  getOpenRouterDefaultModel,
  getOpenRouterFallbackModel,
  getOpenRouterSafeFallbackModel,
} from "@/lib/ai/openrouter-provider.server";
import type { AIChatMessage, AIProvider } from "@/lib/ai/provider";

type GenerateStructuredInput = {
  messages: AIChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export type AIServiceResult<TOutput> = {
  output: TOutput;
  modelUsed: string;
  warnings: string[];
};

export class AIService {
  constructor(private readonly provider: AIProvider) {}

  async generateStructured<TOutput>({
    messages,
    schemaName,
    schema,
    maxTokens,
    temperature,
    timeoutMs,
  }: GenerateStructuredInput): Promise<AIServiceResult<TOutput>> {
    const defaultModel = getOpenRouterDefaultModel();
    const fallbackModel = getOpenRouterFallbackModel();
    const safeFallbackModel = getOpenRouterSafeFallbackModel();
    const models = [defaultModel, fallbackModel, safeFallbackModel].filter(
      (model, index, allModels): model is string =>
        Boolean(model) && allModels.indexOf(model) === index,
    );
    const warnings: string[] = [];
    let lastError: Error | null = null;

    for (const model of models) {
      try {
        const result = await this.provider.generateJson<TOutput>({
          messages,
          schemaName,
          schema,
          model,
          maxTokens,
          temperature,
          timeoutMs,
        });

        return {
          output: result.output,
          modelUsed: result.modelUsed,
          warnings,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown AI provider error.");
        console.error(`[ai-service] ${model} failed: ${lastError.message}`);

        if (models.length > 1 && model === defaultModel) {
          warnings.push("Default model failed, so a fallback model was used.");
        }
      }
    }

    throw lastError ?? new Error("No AI model is configured.");
  }
}

export function createAIService() {
  return new AIService(new OpenRouterProvider());
}
