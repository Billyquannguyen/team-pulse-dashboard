import { createFileRoute } from "@tanstack/react-router";
import { runWeeklyGmailOutreachReport } from "@/lib/weekly-gmail-outreach-report.server";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const authorization = request.headers.get("authorization");
  const querySecret = new URL(request.url).searchParams.get("secret");
  return authorization === `Bearer ${secret}` || querySecret === secret;
}

export const Route = createFileRoute("/api/weekly-gmail-outreach-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorizedCronRequest(request)) {
          return jsonResponse({ ok: false, error: "Unauthorized cron request." }, 401);
        }

        try {
          const result = await runWeeklyGmailOutreachReport();
          return jsonResponse(result, result.ok ? 200 : 502);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Weekly Gmail report failed.";
          console.error(`[weekly-gmail-report] ${message}`);
          return jsonResponse({ ok: false, error: message }, 500);
        }
      },
    },
  },
});
