import { createFileRoute } from "@tanstack/react-router";
import { processFollowUpQueueTick } from "@/lib/bulk-follow-up-queue";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/bulk-follow-up-worker")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET?.trim();
        if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
          return json({ ok: false, error: "Unauthorized." }, 401);
        }
        try {
          return json({ ok: true, ...(await processFollowUpQueueTick()) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Follow-up worker failed.";
          console.error(`[bulk-follow-up-worker] ${message}`);
          return json({ ok: false, error: message }, 500);
        }
      },
    },
  },
});
