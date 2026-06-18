import { createFileRoute } from "@tanstack/react-router";
import {
  reminderFromCalendlyWebhook,
  upsertCalendlyReminder,
} from "@/lib/calendly-reminders.server";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorizedWebhook(request: Request) {
  const secret = process.env.CALENDLY_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const url = new URL(request.url);
  return (
    request.headers.get("x-calendly-webhook-secret") === secret ||
    request.headers.get("x-webhook-secret") === secret ||
    url.searchParams.get("secret") === secret
  );
}

export const Route = createFileRoute("/api/calendly-reminders/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorizedWebhook(request)) {
          return jsonResponse({ ok: false, error: "Unauthorized webhook request." }, 401);
        }

        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);

        const eventName = String(body.event || body.event_type || "");
        if (eventName && eventName !== "invitee.created") {
          return jsonResponse({
            ok: true,
            ignored: true,
            reason: `Unsupported event ${eventName}`,
          });
        }

        const reminder = reminderFromCalendlyWebhook(body);
        const result = await upsertCalendlyReminder(reminder);

        return jsonResponse({
          ok: true,
          event: eventName || "invitee.created",
          reminderId: reminder.id,
          calendlyInviteeUri: reminder.calendlyInviteeUri,
          reminderSendAt: reminder.reminderSendAt,
          ...result,
        });
      },
    },
  },
});
