import type { AIGenerateJsonInput, AIGenerateJsonResult, AIProvider } from "@/lib/ai/provider";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";
const OPENROUTER_DEFAULT_MODEL_ENV = "OPENROUTER_DEFAULT_MODEL";
const OPENROUTER_FALLBACK_MODEL_ENV = "OPENROUTER_FALLBACK_MODEL";
const DEFAULT_TIMEOUT_MS = 25_000;

type OpenRouterChoice = {
  message?: {
    content?: unknown;
  };
};

function getEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function getOpenRouterDefaultModel() {
  return getEnv(OPENROUTER_DEFAULT_MODEL_ENV);
}

export function getOpenRouterFallbackModel() {
  return getEnv(OPENROUTER_FALLBACK_MODEL_ENV);
}

export function getOpenRouterEnvDiagnostics() {
  return [
    { name: OPENROUTER_API_KEY_ENV, exists: Boolean(getEnv(OPENROUTER_API_KEY_ENV)) },
    { name: OPENROUTER_DEFAULT_MODEL_ENV, exists: Boolean(getEnv(OPENROUTER_DEFAULT_MODEL_ENV)) },
    {
      name: OPENROUTER_FALLBACK_MODEL_ENV,
      exists: Boolean(getEnv(OPENROUTER_FALLBACK_MODEL_ENV)),
    },
  ];
}

function extractMessageContent(payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const choices = Array.isArray(record.choices) ? (record.choices as OpenRouterChoice[]) : [];
  const content = choices[0]?.message?.content;

  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const text = (item as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function findJsonObjectText(content: string) {
  const start = content.indexOf("{");

  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return "";
}

function parseJsonContent<TOutput>(content: string): TOutput {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as TOutput;
  } catch (error) {
    const embeddedJson = findJsonObjectText(cleaned);

    if (embeddedJson) {
      return JSON.parse(embeddedJson) as TOutput;
    }

    throw new Error("OpenRouter returned text instead of the expected report format.");
  }
}

export class OpenRouterProvider implements AIProvider {
  async generateJson<TOutput>({
    messages,
    schemaName,
    schema,
    model,
    maxTokens = 1200,
    temperature = 0.2,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: AIGenerateJsonInput): Promise<AIGenerateJsonResult<TOutput>> {
    const apiKey = getEnv(OPENROUTER_API_KEY_ENV);

    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is missing.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://team-billion-dashboard.vercel.app",
          "X-Title": "Team Billion Dashboard",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema,
            },
          },
        }),
      });

      if (!response.ok) {
        let detail = response.statusText;

        try {
          const payload = (await response.json()) as Record<string, unknown>;
          const error = payload.error as Record<string, unknown> | undefined;
          detail = typeof error?.message === "string" ? error.message : detail;
        } catch {
          detail = await response.text();
        }

        throw new Error(`OpenRouter request failed (${response.status}): ${detail}`);
      }

      const payload = await response.json();
      const content = extractMessageContent(payload);

      if (!content) {
        throw new Error("OpenRouter returned an empty response.");
      }

      return {
        output: parseJsonContent<TOutput>(content),
        modelUsed: model,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenRouter request timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
