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

const BRAND_FINDER_GMAIL_CLIENT_ID_ENV = "BRAND_FINDER_GMAIL_CLIENT_ID";
const BRAND_FINDER_GMAIL_CLIENT_SECRET_ENV = "BRAND_FINDER_GMAIL_CLIENT_SECRET";
const BRAND_FINDER_GMAIL_REFRESH_TOKEN_ENV = "BRAND_FINDER_GMAIL_REFRESH_TOKEN";

function requiredBrandFinderGmailEnv(name: string) {
  const value = process.env[name] ?? "";
  if (!value) {
    throw new Error(
      `Missing ${name}. Add the Brand Finder Gmail OAuth variables in Vercel Environment Variables before creating Gmail drafts.`,
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
      client_id: requiredBrandFinderGmailEnv(BRAND_FINDER_GMAIL_CLIENT_ID_ENV),
      client_secret: requiredBrandFinderGmailEnv(BRAND_FINDER_GMAIL_CLIENT_SECRET_ENV),
      refresh_token: requiredBrandFinderGmailEnv(BRAND_FINDER_GMAIL_REFRESH_TOKEN_ENV),
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

async function getDefaultGmailSignature(accessToken: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => null)) as {
    sendAs?: Array<{
      signature?: string;
      isDefault?: boolean;
      isPrimary?: boolean;
    }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    const detail = payload?.error?.message || `Gmail returned ${response.status}.`;
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `${detail} Reconnect Gmail with gmail.compose and gmail.settings.basic permissions.`,
      );
    }
    throw new Error(detail);
  }

  const alias =
    payload?.sendAs?.find((item) => item.isDefault) ??
    payload?.sendAs?.find((item) => item.isPrimary) ??
    payload?.sendAs?.[0];

  if (!alias?.signature?.trim()) {
    throw new Error("The connected Gmail account does not have a default signature configured.");
  }

  return alias.signature.trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainTextToHtml(value: string) {
  return escapeHtml(value).replace(/\r\n?|\n/g, "<br>");
}

function signatureToPlainText(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildRawMessage(draft: GmailDraftInput, signatureHtml: string) {
  const boundary = `tb-brand-finder-${crypto.randomUUID()}`;
  const textSignature = signatureToPlainText(signatureHtml);
  const plainTextBody = `${draft.body.trim()}\n\n${textSignature}`;
  const htmlBody = `${plainTextToHtml(draft.body.trim())}<br><br>${signatureHtml}`;
  const message = [
    `To: ${sanitizeHeader(draft.to)}`,
    `Subject: ${sanitizeHeader(draft.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    plainTextBody,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return toBase64Url(message);
}

async function createOneDraft(
  accessToken: string,
  draft: GmailDraftInput,
  signatureHtml: string,
): Promise<GmailDraftResult> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        raw: buildRawMessage(draft, signatureHtml),
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
    const signatureHtml = await getDefaultGmailSignature(accessToken);
    const results: GmailDraftResult[] = [];

    for (const draft of data.drafts) {
      results.push(await createOneDraft(accessToken, draft, signatureHtml));
    }

    return { results };
  });
