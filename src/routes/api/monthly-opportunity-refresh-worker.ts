import { createFileRoute } from "@tanstack/react-router";
import {
  isMonthlyRefreshInternalRequest,
  runMonthlyOpportunityRefreshStep,
} from "@/lib/monthly-opportunity-refresh.server";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/monthly-opportunity-refresh-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isMonthlyRefreshInternalRequest(request)) {
          return jsonResponse({ ok: false, error: "Unauthorized monthly worker request." }, 401);
        }

        const payload = (await request.json().catch(() => null)) as { runId?: string } | null;
        const runId = payload?.runId?.trim() ?? "";
        if (!runId) return jsonResponse({ ok: false, error: "Run ID is required." }, 400);

        const state = await runMonthlyOpportunityRefreshStep(runId);
        return jsonResponse({ ok: true, runId, state });
      },
    },
  },
});
