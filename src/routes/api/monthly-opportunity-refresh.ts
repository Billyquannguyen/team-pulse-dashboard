import { createFileRoute } from "@tanstack/react-router";
import {
  isMonthlyRefreshInternalRequest,
  startMonthlyOpportunityRefreshRun,
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

export const Route = createFileRoute("/api/monthly-opportunity-refresh")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isMonthlyRefreshInternalRequest(request)) {
          return jsonResponse({ ok: false, error: "Unauthorized monthly refresh request." }, 401);
        }

        try {
          const result = await startMonthlyOpportunityRefreshRun("Vercel monthly schedule");
          return jsonResponse(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Monthly refresh could not start.";
          console.error(`[monthly-refresh] ${message}`);
          return jsonResponse({ ok: false, error: message }, 500);
        }
      },
    },
  },
});
