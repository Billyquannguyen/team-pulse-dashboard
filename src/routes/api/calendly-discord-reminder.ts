import { createFileRoute } from "@tanstack/react-router";

type JsonRecord = Record<string, unknown>;

const CALENDLY_BOOKED_EVENT = "invitee.created";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNestedString(source: JsonRecord, path: string[]) {
  let current: unknown = source;

  for (const part of path) {
    if (!isRecord(current)) return "";
    current = current[part];
  }

  return readString(current);
}

function readRuntimeConfig() {
  return {
    discordWebhookUrl:
      process.env.CALENDLY_DISCORD_WEBHOOK_URL?.trim() ||
      process.env.DISCORD_WEBHOOK_URL?.trim() ||
      "",
    reminderSecret: process.env.CALENDLY_DISCORD_REMINDER_SECRET?.trim() || "",
  };
}

function isAuthorizedReminderRequest(request: Request, reminderSecret: string) {
  if (!reminderSecret) return false;

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const headerSecret = request.headers.get("x-calendly-reminder-secret");

  return querySecret === reminderSecret || headerSecret === reminderSecret;
}

function safeParseJson(rawBody: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function payloadFromWebhook(body: JsonRecord) {
  const payload = body.payload;
  return isRecord(payload) ? payload : body;
}

function extractQuestions(payload: JsonRecord) {
  const questions = payload.questions_and_answers;
  if (!Array.isArray(questions)) return [] as string[];

  return questions
    .flatMap((item) => {
      if (!isRecord(item)) return [];

      const question = readString(item.question) || readString(item.name);
      const answerValue = item.answer;
      const answer = Array.isArray(answerValue)
        ? answerValue
            .map((part) => readString(part))
            .filter(Boolean)
            .join(", ")
        : readString(answerValue);

      if (!question || !answer) return [];
      return [`${question}: ${answer}`];
    })
    .slice(0, 5);
}

function extractCalendlyReminderDetails(body: JsonRecord) {
  const payload = payloadFromWebhook(body);
  const eventType = readString(body.event);
  const creatorEmail =
    readString(payload.email) ||
    readNestedString(payload, ["invitee", "email"]) ||
    readNestedString(payload, ["scheduled_event", "invitee", "email"]);
  const creatorName =
    readString(payload.name) ||
    [readString(payload.first_name), readString(payload.last_name)].filter(Boolean).join(" ") ||
    readNestedString(payload, ["invitee", "name"]);
  const meetingName =
    readNestedString(payload, ["scheduled_event", "name"]) ||
    readNestedString(payload, ["event_type", "name"]) ||
    readString(payload.event_type_name) ||
    "Calendly meeting";
  const meetingTime =
    readNestedString(payload, ["scheduled_event", "start_time"]) ||
    readString(payload.start_time) ||
    readString(payload.event_start_time);
  const calendlyLink =
    readString(payload.uri) ||
    readString(payload.event) ||
    readNestedString(payload, ["scheduled_event", "uri"]) ||
    "";

  return {
    eventType,
    creatorEmail,
    creatorName,
    meetingName,
    meetingTime,
    calendlyLink,
    questions: extractQuestions(payload),
  };
}

function formatDiscordMessage(details: ReturnType<typeof extractCalendlyReminderDetails>) {
  const lines = [
    "**New Calendly meeting booked**",
    "",
    `Creator: ${details.creatorName || "Unknown"}`,
    `Email: ${details.creatorEmail || "Unknown"}`,
    `Meeting: ${details.meetingName}`,
  ];

  if (details.meetingTime) {
    lines.push(`Time: ${details.meetingTime}`);
  }

  if (details.questions.length > 0) {
    lines.push("", "**Booking form answers**", ...details.questions.map((answer) => `- ${answer}`));
  }

  if (details.calendlyLink) {
    lines.push("", `Calendly record: ${details.calendlyLink}`);
  }

  lines.push(
    "",
    "Please revisit Gmail, find the latest email thread for this creator, and compose a short recap for Billy.",
  );

  return lines.join("\n");
}

async function postToDiscord(webhookUrl: string, content: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Calendly Reminder",
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed (${response.status}): ${responseText}`);
  }
}

async function sendTestReminder(discordWebhookUrl: string) {
  await postToDiscord(
    discordWebhookUrl,
    [
      "**Test Calendly reminder**",
      "",
      "Creator: Test Creator",
      "Email: creator@example.com",
      "Meeting: Test strategy call",
      "",
      "Please revisit Gmail, find the latest email thread for this creator, and compose a short recap for Billy.",
    ].join("\n"),
  );
}

export const Route = createFileRoute("/api/calendly-discord-reminder")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = readRuntimeConfig();
        if (!config.reminderSecret || !config.discordWebhookUrl) {
          return jsonResponse(
            {
              ok: false,
              error: "Missing CALENDLY_DISCORD_REMINDER_SECRET or CALENDLY_DISCORD_WEBHOOK_URL.",
            },
            500,
          );
        }

        if (!isAuthorizedReminderRequest(request, config.reminderSecret)) {
          return jsonResponse({ ok: false, error: "Unauthorized Calendly reminder request." }, 401);
        }

        const url = new URL(request.url);
        if (url.searchParams.get("test") === "1") {
          await sendTestReminder(config.discordWebhookUrl);
          return jsonResponse({ ok: true, sent: "test_discord_reminder" });
        }

        return jsonResponse({ ok: true, configured: true });
      },
      POST: async ({ request }) => {
        const config = readRuntimeConfig();
        if (!config.reminderSecret || !config.discordWebhookUrl) {
          return jsonResponse(
            {
              ok: false,
              error: "Missing CALENDLY_DISCORD_REMINDER_SECRET or CALENDLY_DISCORD_WEBHOOK_URL.",
            },
            500,
          );
        }

        if (!isAuthorizedReminderRequest(request, config.reminderSecret)) {
          return jsonResponse({ ok: false, error: "Unauthorized Calendly reminder request." }, 401);
        }

        const rawBody = await request.text();
        const body = safeParseJson(rawBody);
        if (!body) {
          return jsonResponse({ ok: false, error: "Invalid Calendly webhook JSON." }, 400);
        }

        const details = extractCalendlyReminderDetails(body);
        if (details.eventType && details.eventType !== CALENDLY_BOOKED_EVENT) {
          return jsonResponse({ ok: true, ignored: details.eventType });
        }

        await postToDiscord(config.discordWebhookUrl, formatDiscordMessage(details));

        return jsonResponse({
          ok: true,
          sent: "calendly_discord_reminder",
          creatorEmail: details.creatorEmail || null,
        });
      },
    },
  },
});
