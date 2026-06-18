import { createFileRoute } from "@tanstack/react-router";

type CalendlyBooking = {
  creatorName: string;
  creatorEmail: string;
  meetingName: string;
  meetingStartTime: string;
  bookedAt: string;
};

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

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required Calendly webhook env var: ${name}`);
  return value;
}

function formatDateTime(value: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

function parseCalendlyBooking(body: Record<string, unknown>): CalendlyBooking {
  const payload = (
    body.payload && typeof body.payload === "object" ? body.payload : body
  ) as Record<string, unknown>;
  const scheduledEvent =
    payload.scheduled_event && typeof payload.scheduled_event === "object"
      ? (payload.scheduled_event as Record<string, unknown>)
      : {};

  const createdAt = String(payload.created_at || new Date().toISOString());
  const meetingStartTime = String(scheduledEvent.start_time || payload.start_time || "");

  return {
    creatorName: String(payload.name || "Unknown creator"),
    creatorEmail: String(payload.email || "Unknown email"),
    meetingName: String(scheduledEvent.name || payload.event_type_name || "Calendly meeting"),
    meetingStartTime,
    bookedAt: createdAt,
  };
}

function buildDiscordMessage(booking: CalendlyBooking) {
  return [
    "**New Calendly meeting booked**",
    "",
    `Creator: ${booking.creatorName}`,
    `Email: ${booking.creatorEmail}`,
    `Meeting: ${booking.meetingName}`,
    `Meeting time: ${formatDateTime(booking.meetingStartTime)}`,
    `Booked at: ${formatDateTime(booking.bookedAt)}`,
    "",
    "Please revisit Gmail, find the latest email thread for this creator, and compose a short recap for Billy.",
  ].join("\n");
}

async function sendDiscordNotification(booking: CalendlyBooking) {
  const response = await fetch(requiredEnv("CALENDLY_DISCORD_WEBHOOK_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Calendly Booking",
      content: buildDiscordMessage(booking),
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }
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

        const booking = parseCalendlyBooking(body);
        await sendDiscordNotification(booking);

        return jsonResponse({
          ok: true,
          event: eventName || "invitee.created",
          sent: true,
          creatorEmail: booking.creatorEmail,
        });
      },
    },
  },
});
