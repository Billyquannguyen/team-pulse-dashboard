import { createAIService } from "@/lib/ai/ai-service.server";

export type AIPersonalReportRequest = {
  memberId: string;
  memberName: string;
  dateRange?: string;
  month?: string;
  structuredReportData: Record<string, unknown>;
  tone?: string;
};

export type AIPersonalReportResponse = {
  summary: string;
  wins: string[];
  risks: string[];
  nextActions: string[];
  managerNote: string;
  modelUsed: string;
  warnings: string[];
};

type AIPersonalReportOutput = Omit<AIPersonalReportResponse, "modelUsed" | "warnings">;

const personalReportSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "wins", "risks", "nextActions", "managerNote"],
  properties: {
    summary: {
      type: "string",
      description: "Short practical performance summary grounded only in the provided data.",
    },
    wins: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: { type: "string" },
    },
    risks: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string" },
    },
    nextActions: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: { type: "string" },
    },
    managerNote: {
      type: "string",
      description: "Plain-English note Billy could use when reviewing this member.",
    },
  },
};

function buildSystemPrompt(tone?: string) {
  return [
    "You write Billy GPT Personal Reports for Team Billion managers.",
    "Use only the structured dashboard facts supplied by the user.",
    "Do not invent numbers, deals, creators, outreach activity, goals, or performance issues.",
    "If a field is missing or marked unavailable, say the data is missing.",
    "Keep the tone practical, direct, manager-friendly, and specific.",
    "Avoid generic motivational fluff.",
    "Explain what the member is doing well, what needs attention, and what Billy should do next.",
    "Return only valid JSON matching the requested schema. Do not add safety labels, markdown, or commentary outside the JSON object.",
    tone ? `Preferred tone: ${tone}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateAIPersonalReport({
  memberId,
  memberName,
  dateRange,
  month,
  structuredReportData,
  tone,
}: AIPersonalReportRequest): Promise<AIPersonalReportResponse> {
  const aiService = createAIService();
  const result = await aiService.generateStructured<AIPersonalReportOutput>({
    schemaName: "team_billion_personal_report",
    schema: personalReportSchema,
    maxTokens: 1400,
    temperature: 0.2,
    timeoutMs: 25_000,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(tone),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Generate a Billy GPT Personal Report from these structured dashboard facts.",
            selectedMember: {
              memberId,
              memberName,
              dateRange: dateRange || month || "Current dashboard period",
            },
            structuredReportData,
            outputSections: ["summary", "wins", "risks", "nextActions", "managerNote"],
          },
          null,
          2,
        ),
      },
    ],
  });

  return {
    ...result.output,
    modelUsed: result.modelUsed,
    warnings: result.warnings,
  };
}
