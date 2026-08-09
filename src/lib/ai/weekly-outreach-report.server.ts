import { createAIService } from "@/lib/ai/ai-service.server";
import { z } from "zod";

export type WeeklyOutreachNarrativeFacts = {
  reportDays: number;
  memberCount: number;
  creatorOutreachSent: number;
  brandOutreachSent: number;
  calendlyBooked: number;
  bookedCalls: number;
  invalidTaggingThreads: number;
  missedInbound: number;
};

export type WeeklyOutreachNarrative = {
  summary: string;
  verdict: string;
  modelUsed: string;
  warnings: string[];
};

export type MissingMemberTagCandidate = {
  candidateId: string;
  from: string;
  subject: string;
  receivedAt: string;
  emailText: string;
};

export type ExclusiveCreatorAssignment = {
  creatorId: string;
  creatorName: string;
  memberId: string;
  memberName: string;
};

export type MissingMemberTagDecision = {
  candidateId: string;
  report: boolean;
  creatorId: string;
  memberId: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type WeeklyOutreachNarrativeOutput = Pick<WeeklyOutreachNarrative, "summary" | "verdict">;

const weeklyOutreachNarrativeOutput = z
  .object({
    summary: z.string().trim().min(1).max(320),
    verdict: z.string().trim().min(1).max(260),
  })
  .strict();

const weeklyOutreachNarrativeSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "verdict"],
  properties: {
    summary: {
      type: "string",
      maxLength: 320,
      description: "One or two concise Vietnamese sentences summarizing the supplied metrics.",
    },
    verdict: {
      type: "string",
      maxLength: 260,
      description: "One concise Vietnamese management verdict based only on the supplied facts.",
    },
  },
};

const missingMemberTagDecision = z
  .object({
    candidateId: z.string().trim().min(1).max(120),
    report: z.boolean(),
    creatorId: z.string().trim().max(120),
    memberId: z.string().trim().max(120),
    confidence: z.enum(["high", "medium", "low"]),
    reason: z.string().trim().max(180),
  })
  .strict();

const missingMemberTagOutput = z
  .object({ decisions: z.array(missingMemberTagDecision).max(60) })
  .strict();

const missingMemberTagSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateId", "report", "creatorId", "memberId", "confidence", "reason"],
        properties: {
          candidateId: { type: "string", maxLength: 120 },
          report: { type: "boolean" },
          creatorId: { type: "string", maxLength: 120 },
          memberId: { type: "string", maxLength: 120 },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", maxLength: 180 },
        },
      },
    },
  },
};

export async function identifyMissingMemberTags({
  candidates,
  assignments,
}: {
  candidates: MissingMemberTagCandidate[];
  assignments: ExclusiveCreatorAssignment[];
}): Promise<{ decisions: MissingMemberTagDecision[]; modelUsed: string; warnings: string[] }> {
  if (candidates.length === 0 || assignments.length === 0) {
    return { decisions: [], modelUsed: "", warnings: [] };
  }

  const aiService = createAIService();
  const result = await aiService.generateStructured<z.infer<typeof missingMemberTagOutput>>({
    schemaName: "weekly_gmail_missing_member_tags",
    schema: missingMemberTagSchema,
    maxTokens: 2_400,
    temperature: 0.05,
    timeoutMs: 45_000,
    messages: [
      {
        role: "system",
        content: [
          "You review inbound emails that have no team-member Gmail tag and no team reply.",
          "The mailbox receives spam, newsletters, automated notifications, cold sales and irrelevant mail; ignore those.",
          "Report only when the email text gives strong evidence that it concerns one creator in the supplied exclusive-creator assignments.",
          "Use only the supplied creatorId and memberId. Never invent a creator, member or relationship.",
          "Set report=true only for high confidence. Medium or low confidence must be ignored.",
          "A shared first name, vague campaign language or sender display name alone is not enough.",
          "For ignored emails, return empty creatorId and memberId and a short reason.",
          "Return concise JSON only.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Find likely missed inbound emails that should carry an exclusive creator's member tag",
            exclusiveCreatorAssignments: assignments,
            inboundCandidates: candidates,
          },
          null,
          2,
        ),
      },
    ],
  });
  const output = missingMemberTagOutput.parse(result.output);
  return { decisions: output.decisions, modelUsed: result.modelUsed, warnings: result.warnings };
}

export async function generateWeeklyOutreachNarrative(
  facts: WeeklyOutreachNarrativeFacts,
): Promise<WeeklyOutreachNarrative> {
  const aiService = createAIService();
  const result = await aiService.generateStructured<WeeklyOutreachNarrativeOutput>({
    schemaName: "weekly_gmail_outreach_narrative",
    schema: weeklyOutreachNarrativeSchema,
    maxTokens: 420,
    temperature: 0.15,
    timeoutMs: 35_000,
    messages: [
      {
        role: "system",
        content: [
          "Bạn viết phần nhận định ngắn cho báo cáo Gmail Outreach hằng tuần.",
          "Chỉ sử dụng số liệu JSON được cung cấp. Không bịa số, tên member, nguyên nhân hoặc hoạt động.",
          "Viết bằng tiếng Việt, trực tiếp, thực tế, không dùng lời động viên chung chung.",
          "Không viết bất kỳ chữ số nào; số liệu đã được hiển thị ở phần cố định của report.",
          "Tập trung vào outreach, booked calls, missed inbound và tagging.",
          "Creator outreach và brand outreach chỉ tính conversation mới bắt đầu trong kỳ báo cáo.",
          "Không đề cập follow-up sequence hoặc tần suất follow-up.",
          "Trả về đúng JSON theo schema, không thêm markdown.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({ task: "Viết summary và verdict", facts }, null, 2),
      },
    ],
  });
  const output = weeklyOutreachNarrativeOutput.parse(result.output);

  if (/\d/.test(`${output.summary} ${output.verdict}`)) {
    throw new Error("OpenRouter added numeric claims to the narrative.");
  }

  return {
    ...output,
    modelUsed: result.modelUsed,
    warnings: result.warnings,
  };
}
