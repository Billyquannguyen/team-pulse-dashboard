import { createAIService } from "@/lib/ai/ai-service.server";
import { z } from "zod";

export type WeeklyOutreachNarrativeFacts = {
  reportDays: number;
  memberCount: number;
  creatorOutreachSent: number;
  brandOutreachSent: number;
  calendlyBooked: number;
  missedInbound: number;
  followUpsDue: number;
  completedDueFollowUps: number;
  overdueCreatorThreads: number;
  fullSequenceDueThreads: number;
  incompleteFullSequenceThreads: number;
  completedFullSequenceThreads: number;
  verdictCategory: "insufficient" | "complete" | "majority_incomplete" | "some_incomplete";
};

export type WeeklyOutreachNarrative = {
  summary: string;
  verdict: string;
  modelUsed: string;
  warnings: string[];
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
      description: "One concise Vietnamese management verdict matching verdictCategory.",
    },
  },
};

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
          "Không thay đổi ý nghĩa của verdictCategory.",
          "Không viết bất kỳ chữ số nào; số liệu đã được hiển thị ở phần cố định của report.",
          'Chỉ dùng cụm "phần lớn" khi verdictCategory là "majority_incomplete".',
          "Nếu verdictCategory là insufficient, phải nói chưa đủ dữ liệu qua mốc 14 ngày.",
          "Nếu verdictCategory là complete, phải nói các sequence đến hạn đã hoàn thành đủ.",
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

  if (facts.verdictCategory !== "majority_incomplete" && /phần lớn/i.test(output.verdict)) {
    throw new Error('OpenRouter used "phần lớn" for the wrong verdict category.');
  }

  if (/\d/.test(`${output.summary} ${output.verdict}`)) {
    throw new Error("OpenRouter added numeric claims to the narrative.");
  }

  return {
    ...output,
    modelUsed: result.modelUsed,
    warnings: result.warnings,
  };
}
