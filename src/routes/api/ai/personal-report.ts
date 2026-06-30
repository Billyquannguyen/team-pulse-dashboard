import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { generateAIPersonalReport } from "@/lib/ai/personal-report.server";

const requestSchema = z.object({
  memberId: z.string().min(1).max(120),
  memberName: z.string().min(1).max(160),
  dateRange: z.string().max(160).optional(),
  month: z.string().max(160).optional(),
  structuredReportData: z.record(z.unknown()),
  tone: z.string().max(160).optional(),
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/ai/personal-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { requireDashboardAuth } = await import("@/lib/auth.server");
        await requireDashboardAuth();

        const body = await request.json().catch(() => null);
        const parsed = requestSchema.safeParse(body);

        if (!parsed.success) {
          return jsonResponse(
            {
              ok: false,
              error: "Invalid personal report request.",
              details: parsed.error.flatten(),
            },
            400,
          );
        }

        try {
          const report = await generateAIPersonalReport(parsed.data);
          return jsonResponse({ ok: true, report });
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI report generation failed.";
          console.error(`[personal-report-ai] ${message}`);

          return jsonResponse(
            {
              ok: false,
              error: message,
            },
            500,
          );
        }
      },
    },
  },
});
