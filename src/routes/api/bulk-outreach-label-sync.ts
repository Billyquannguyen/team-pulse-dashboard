import { createFileRoute } from "@tanstack/react-router";
import { processPendingBulkOutreachLabels } from "@/lib/bulk-sender";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/bulk-outreach-label-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET?.trim();
        if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
          return json({ ok: false, error: "Unauthorized." }, 401);
        }
        try {
          return json({ ok: true, ...(await processPendingBulkOutreachLabels()) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Label sync failed.";
          console.error(`[bulk-outreach-label-sync] ${message}`);
          return json({ ok: false, error: message }, 500);
        }
      },
    },
  },
});
