import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const gmailDraftSchema = z.object({
  id: z.string().min(1).max(220),
  to: z.string().email().max(320),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(10000),
});

const createGmailDraftsInput = z.object({
  drafts: z.array(gmailDraftSchema).min(1).max(100),
});

type GmailDraftInput = z.infer<typeof gmailDraftSchema>;

export type GmailDraftResult = {
  id: string;
  ok: boolean;
  gmailDraftId: string;
  gmailThreadId: string;
  message: string;
};

function requiredEnv(name: string) {
  const value = process.env[name] ?? "";
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it in Vercel Environment Variables before creating Gmail drafts.`,
    );
  }
  return value;
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGmailAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requiredEnv("GMAIL_CLIENT_ID"),
      client_secret: requiredEnv("GMAIL_CLIENT_SECRET"),
      refresh_token: requiredEnv("GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
  } | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error || "Gmail could not create an access token.");
  }

  return payload.access_token;
}

function buildRawMessage(draft: GmailDraftInput) {
  const message = [
    `To: ${sanitizeHeader(draft.to)}`,
    `Subject: ${sanitizeHeader(draft.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    draft.body,
  ].join("\r\n");

  return toBase64Url(message);
}

async function createOneDraft(
  accessToken: string,
  draft: GmailDraftInput,
): Promise<GmailDraftResult> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        raw: buildRawMessage(draft),
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    message?: {
      id?: string;
      threadId?: string;
    };
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload?.id) {
    return {
      id: draft.id,
      ok: false,
      gmailDraftId: "",
      gmailThreadId: "",
      message: payload?.error?.message || `Gmail returned ${response.status}.`,
    };
  }

  return {
    id: draft.id,
    ok: true,
    gmailDraftId: payload.id,
    gmailThreadId: payload.message?.threadId ?? "",
    message: "Draft created in Gmail.",
  };
}

export const createGmailDrafts = createServerFn({ method: "POST" })
  .inputValidator(createGmailDraftsInput)
  .handler(async ({ data }): Promise<{ results: GmailDraftResult[] }> => {
    const { requireWritableDashboardAuth } = await import("@/lib/auth.server");
    await requireWritableDashboardAuth();

    const accessToken = await getGmailAccessToken();
    const results: GmailDraftResult[] = [];

    for (const draft of data.drafts) {
      results.push(await createOneDraft(accessToken, draft));
    }

    return { results };
  });
