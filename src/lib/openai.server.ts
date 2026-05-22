export type OpenAiServerDiagnostics = {
  keyPresent: boolean;
  modelUsed: string;
};

type OpenAiResponseInput = {
  instructions: string;
  input: string;
  model?: string;
  maxOutputTokens?: number;
};

const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
const OPENAI_CONTRACT_REVIEW_MODEL_ENV = "OPENAI_CONTRACT_REVIEW_MODEL";
const DEFAULT_MODEL = "gpt-5.4-mini";

function getOpenAiApiKey() {
  return process.env[OPENAI_API_KEY_ENV]?.trim() ?? "";
}

export function getOpenAiModel() {
  return process.env[OPENAI_CONTRACT_REVIEW_MODEL_ENV]?.trim() || DEFAULT_MODEL;
}

export function getOpenAiEnvDiagnostics() {
  return [
    { name: OPENAI_API_KEY_ENV, exists: Boolean(getOpenAiApiKey()) },
    {
      name: OPENAI_CONTRACT_REVIEW_MODEL_ENV,
      exists: Boolean(process.env[OPENAI_CONTRACT_REVIEW_MODEL_ENV]?.trim()),
    },
  ];
}

export function getOpenAiDiagnostics(): OpenAiServerDiagnostics {
  return {
    keyPresent: Boolean(getOpenAiApiKey()),
    modelUsed: getOpenAiModel(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractResponseText(payload: unknown) {
  const record = asRecord(payload);
  if (typeof record.output_text === "string") return record.output_text.trim();
  const output = Array.isArray(record.output) ? record.output : [];

  const text = output
    .flatMap((item) => {
      const content = asRecord(item).content;
      return Array.isArray(content) ? content : [];
    })
    .map((contentItem) => {
      const item = asRecord(contentItem);
      return typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return text;
}

export async function callOpenAiText({
  instructions,
  input,
  model = getOpenAiModel(),
  maxOutputTokens = 1800,
}: OpenAiResponseInput) {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
    }),
  });

  if (!response.ok) {
    let detail = response.statusText;

    try {
      const payload = asRecord(await response.json());
      const error = asRecord(payload.error);
      detail = typeof error.message === "string" ? error.message : detail;
    } catch {
      detail = await response.text();
    }

    throw new Error(`OpenAI request failed (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);

  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return {
    text,
    model,
  };
}
