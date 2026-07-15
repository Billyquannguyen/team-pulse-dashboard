import { createFileRoute } from "@tanstack/react-router";
import { isUkSlackLinkAlertHour, syncSlackLinkAlerts } from "@/lib/slack-link-alerts.server";

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

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function handleSlackLinkAlertRequest(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return jsonResponse({ ok: false, error: "Unauthorized cron request." }, 401);
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && !isUkSlackLinkAlertHour()) {
    return jsonResponse({
      ok: true,
      skipped: true,
      reason: "Current Europe/London hour is outside 10:00, 12:00, 13:00, and 17:00.",
    });
  }

  const result = await syncSlackLinkAlerts();
  return jsonResponse(result, result.ok ? 200 : 500);
}

export const Route = createFileRoute("/api/slack-link-alerts")({
  server: {
    handlers: {
      GET: ({ request }) => handleSlackLinkAlertRequest(request),
    },
  },
});
