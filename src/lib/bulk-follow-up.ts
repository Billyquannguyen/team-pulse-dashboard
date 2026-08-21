import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";

export type GmailFollowUpLabel = { id: string; name: string };

export type FollowUpCandidate = {
  threadId: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  interactionLevel: 1 | 2 | 3 | 4 | 5;
  lastSentAt: string;
  lastSentMessageId: string;
  references: string;
  labelIds: string[];
};

export type FollowUpTemplate = {
  id: string;
  name: string;
  htmlBody: string;
  textBody: string;
  createdAt: string;
  updatedAt: string;
  rowNumber?: number;
};

const scanInput = z.object({
  labelIds: z.array(z.string().min(1).max(200)).min(1).max(10),
  interactionLevel: z.number().int().min(1).max(5),
  minimumDaysSinceLastSent: z.union([z.literal(3), z.literal(7), z.literal(14), z.literal(30)]),
});

export type FollowUpScanInput = z.infer<typeof scanInput>;

const templateInput = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  htmlBody: z.string().trim().min(1).max(60_000),
  textBody: z.string().trim().min(1).max(20_000),
});

const deleteTemplateInput = z.object({ id: z.string().trim().min(1).max(120) });

type GmailHeader = { name?: string; value?: string };
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: GmailHeader[] };
};
type GmailThread = { id?: string; messages?: GmailMessage[] };

const TEMPLATE_TAB_NAME = "BulkFollowUpTemplates";
const TEMPLATE_HEADERS = ["ID", "Name", "HTML Body", "Text Body", "Created At", "Updated At"];
const TEMPLATE_CACHE_MS = 45_000;
let templateCache: { expiresAt: number; data: FollowUpTemplate[] } | null = null;
let suppressionCache: { expiresAt: number; addresses: Set<string> } | null = null;

const getGmailOAuthServer = createServerOnlyFn(async () => import("@/lib/gmail-oauth.server"));
const getFollowUpRedisServer = createServerOnlyFn(
  async () => import("@/lib/bulk-follow-up-redis.server"),
);

const SAFE_TEMPLATE_TAGS = [
  "p",
  "div",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
  "span",
];

export async function sanitizeFollowUpTemplateHtml(value: string) {
  const { parseDocument } = await import("htmlparser2");
  type HtmlNode = {
    type?: string;
    name?: string;
    data?: string;
    attribs?: Record<string, string>;
    children?: HtmlNode[];
  };
  const escapeText = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttribute = (text: string) =>
    escapeText(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const render = (node: HtmlNode): string => {
    if (node.type === "text") return escapeText(node.data ?? "");
    if (node.type === "script" || node.type === "style" || node.type === "comment") return "";
    const children = (node.children ?? []).map(render).join("");
    const tag = node.name?.toLowerCase() ?? "";
    if (!SAFE_TEMPLATE_TAGS.includes(tag)) return children;
    if (tag === "br") return "<br>";
    let attributes = "";
    if (tag === "a") {
      const href = node.attribs?.href?.trim() ?? "";
      try {
        const parsed = new URL(href);
        if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
          attributes = ` href="${escapeAttribute(parsed.toString())}" target="_blank" rel="noopener noreferrer"`;
        }
      } catch {
        attributes = "";
      }
    }
    return `<${tag}${attributes}>${children}</${tag}>`;
  };
  const document = parseDocument(value) as unknown as HtmlNode;
  return (document.children ?? []).map(render).join("").trim();
}

export async function getGmailReadAccessToken() {
  const { getMasterGmailAccessToken } = await getGmailOAuthServer();
  return getMasterGmailAccessToken();
}

async function gmailJson<T>(accessToken: string, path: string, params?: URLSearchParams) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  if (params) url.search = params.toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok || !payload) {
    const detail = payload?.error?.message ?? `Gmail returned ${response.status}.`;
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${detail} Reconnect Gmail with read, compose, and settings permissions.`);
    }
    throw new Error(detail);
  }
  return payload;
}

function getHeader(message: GmailMessage, name: string) {
  return (
    message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function extractAddresses(value: string) {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

function recipientName(value: string, email: string) {
  const beforeEmail = value.slice(0, value.toLowerCase().indexOf(email.toLowerCase())).trim();
  return beforeEmail.replace(/["'<>,]/g, "").trim();
}

function messageTimestamp(message: GmailMessage) {
  const timestamp = Number(message.internalDate ?? 0);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeSubject(value: string) {
  const subject = value.trim() || "Follow-up";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

async function listThreadIdsForWindow(
  accessToken: string,
  labelId: string,
  after: Date,
  before: Date,
) {
  const ids: string[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      labelIds: labelId,
      q: `in:sent after:${after.toISOString().slice(0, 10).replaceAll("-", "/")} before:${before
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "/")}`,
      maxResults: "500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await gmailJson<{
      threads?: Array<{ id?: string }>;
      nextPageToken?: string;
    }>(accessToken, "threads", params);
    for (const thread of result.threads ?? []) if (thread.id) ids.push(thread.id);
    pageToken = result.nextPageToken ?? "";
  } while (pageToken);
  return ids;
}

async function getThread(accessToken: string, threadId: string) {
  const params = new URLSearchParams({ format: "metadata" });
  for (const header of ["From", "To", "Subject", "Message-ID", "References"]) {
    params.append("metadataHeaders", header);
  }
  return gmailJson<GmailThread>(accessToken, `threads/${encodeURIComponent(threadId)}`, params);
}

async function getPrimaryGmailAddress(accessToken: string) {
  const result = await gmailJson<{ emailAddress?: string }>(accessToken, "profile");
  return result.emailAddress?.toLowerCase() ?? "";
}

export function candidateFromThread(
  thread: GmailThread,
  sendingAddresses: Set<string>,
  requiredInteractionLevel: number,
  cutoff: number,
  suppressedAddresses = new Set<string>(),
): FollowUpCandidate | null {
  const messages = (thread.messages ?? [])
    .filter((message) => !(message.labelIds ?? []).includes("DRAFT"))
    .sort((left, right) => messageTimestamp(left) - messageTimestamp(right));
  if (!thread.id || messages.length === 0) return null;
  if (!(messages[0].labelIds ?? []).includes("SENT")) return null;
  if (messages.some((message) => !(message.labelIds ?? []).includes("SENT"))) return null;
  if (messages.length !== requiredInteractionLevel || messages.length > 5) return null;

  const lastMessage = messages.at(-1);
  if (!lastMessage) return null;
  const lastSentAt = messageTimestamp(lastMessage);
  if (!lastSentAt || lastSentAt > cutoff) return null;

  const toHeader = getHeader(lastMessage, "To") || getHeader(messages[0], "To");
  const threadSendingAddresses = new Set([
    ...sendingAddresses,
    ...messages.flatMap((message) => extractAddresses(getHeader(message, "From"))),
  ]);
  const externalRecipients = extractAddresses(toHeader).filter(
    (address) => !threadSendingAddresses.has(address),
  );
  if (externalRecipients.length !== 1) return null;
  if (suppressedAddresses.has(externalRecipients[0])) return null;

  const lastMessageId = getHeader(lastMessage, "Message-ID").trim();
  if (!lastMessageId) return null;
  const existingReferences = getHeader(lastMessage, "References").trim();
  const references = `${existingReferences} ${lastMessageId}`.trim();
  const labelIds = Array.from(new Set(messages.flatMap((message) => message.labelIds ?? [])));

  return {
    threadId: thread.id,
    recipientEmail: externalRecipients[0],
    recipientName: recipientName(toHeader, externalRecipients[0]),
    subject: normalizeSubject(
      getHeader(lastMessage, "Subject") || getHeader(messages[0], "Subject"),
    ),
    interactionLevel: messages.length as 1 | 2 | 3 | 4 | 5,
    lastSentAt: new Date(lastSentAt).toISOString(),
    lastSentMessageId: lastMessageId,
    references,
    labelIds,
  };
}

async function getSuppressedRecipientAddresses(accessToken: string) {
  if (suppressionCache && suppressionCache.expiresAt > Date.now()) {
    return suppressionCache.addresses;
  }
  const addresses = new Set<string>();
  let pageToken = "";
  let scanned = 0;
  do {
    const params = new URLSearchParams({
      q: 'newer_than:5y (from:mailer-daemon OR from:postmaster OR subject:undeliverable OR subject:"delivery status notification")',
      maxResults: "500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await gmailJson<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(
      accessToken,
      "messages",
      params,
    );
    const ids = (result.messages ?? []).flatMap((message) => (message.id ? [message.id] : []));
    for (let index = 0; index < ids.length; index += 10) {
      const messages = await Promise.all(
        ids.slice(index, index + 10).map((id) => {
          const metadata = new URLSearchParams({ format: "metadata" });
          for (const header of ["X-Failed-Recipients", "Final-Recipient", "Original-Recipient"]) {
            metadata.append("metadataHeaders", header);
          }
          return gmailJson<GmailMessage>(
            accessToken,
            `messages/${encodeURIComponent(id)}`,
            metadata,
          );
        }),
      );
      for (const message of messages) {
        for (const headerName of ["X-Failed-Recipients", "Final-Recipient", "Original-Recipient"]) {
          for (const address of extractAddresses(getHeader(message, headerName)))
            addresses.add(address);
        }
      }
    }
    scanned += ids.length;
    pageToken = result.nextPageToken ?? "";
  } while (pageToken && scanned < 2_000);
  suppressionCache = { addresses, expiresAt: Date.now() + 60 * 60 * 1000 };
  return addresses;
}

async function scanFollowUpCandidates(input: FollowUpScanInput) {
  const accessToken = await getGmailReadAccessToken();
  const primaryAddress = await getPrimaryGmailAddress(accessToken);
  const sendingAddresses = new Set(primaryAddress ? [primaryAddress] : []);
  const suppressedAddresses = await getSuppressedRecipientAddresses(accessToken);
  const cutoff = Date.now() - input.minimumDaysSinceLastSent * 24 * 60 * 60 * 1000;
  const candidates: FollowUpCandidate[] = [];
  const seen = new Set<string>();
  const cutoffDate = new Date(cutoff);
  let hasMore = false;
  for (let year = 2004; year <= cutoffDate.getUTCFullYear(); year += 1) {
    const after = new Date(Date.UTC(year, 0, 1));
    const before = new Date(Math.min(Date.UTC(year + 1, 0, 1), cutoffDate.getTime()));
    if (before <= after) continue;
    const groups = await Promise.all(
      input.labelIds.map((labelId) => listThreadIdsForWindow(accessToken, labelId, after, before)),
    );
    const ids = Array.from(new Set(groups.flat())).filter((id) => !seen.has(id));
    ids.forEach((id) => seen.add(id));
    for (let index = 0; index < ids.length; index += 5) {
      const threads = await Promise.all(
        ids.slice(index, index + 5).map((threadId) => getThread(accessToken, threadId)),
      );
      for (const thread of threads) {
        const candidate = candidateFromThread(
          thread,
          sendingAddresses,
          input.interactionLevel,
          cutoff,
          suppressedAddresses,
        );
        if (candidate) candidates.push(candidate);
      }
    }
    if (candidates.length > 100) {
      hasMore = true;
      break;
    }
  }
  const sorted = candidates.sort(
    (left, right) => new Date(left.lastSentAt).getTime() - new Date(right.lastSentAt).getTime(),
  );
  return { candidates: sorted.slice(0, 100), hasMore };
}

export async function revalidateFollowUpCandidate(
  expected: FollowUpCandidate,
  input: FollowUpScanInput,
) {
  const accessToken = await getGmailReadAccessToken();
  const primaryAddress = await getPrimaryGmailAddress(accessToken);
  const suppressed = await getSuppressedRecipientAddresses(accessToken);
  const cutoff = Date.now() - input.minimumDaysSinceLastSent * 86_400_000;
  const current = candidateFromThread(
    await getThread(accessToken, expected.threadId),
    new Set(primaryAddress ? [primaryAddress] : []),
    input.interactionLevel,
    cutoff,
    suppressed,
  );
  if (!current || current.recipientEmail !== expected.recipientEmail) return null;
  if (!current.labelIds.some((labelId) => input.labelIds.includes(labelId))) return null;
  return current;
}

async function getGoogleSheetsServer() {
  return import("@/lib/google-sheets.server");
}

function templateSpreadsheetId() {
  const value = process.env.TEAM_ASSETS_SPREADSHEET_ID?.trim();
  if (!value) throw new Error("Missing TEAM_ASSETS_SPREADSHEET_ID in Vercel.");
  return value;
}

async function ensureTemplateWorksheet() {
  const google = await getGoogleSheetsServer();
  const config = google.getGoogleSheetsConfig();
  const spreadsheetId = templateSpreadsheetId();
  let tabs = await google.fetchSpreadsheetTabs(config, spreadsheetId);
  let sheet = tabs.find((tab) => tab.sheetName === TEMPLATE_TAB_NAME);
  if (!sheet) {
    await google.createSheetTab(config, spreadsheetId, TEMPLATE_TAB_NAME);
    tabs = await google.fetchSpreadsheetTabs(config, spreadsheetId);
    sheet = tabs.find((tab) => tab.sheetName === TEMPLATE_TAB_NAME);
  }
  if (!sheet) throw new Error(`Could not create the ${TEMPLATE_TAB_NAME} worksheet.`);
  const rows = await google.fetchSheetRows(config, spreadsheetId, sheet);
  if (rows.headers.length === 0) {
    await google.updateSheetRow(config, spreadsheetId, sheet, 1, TEMPLATE_HEADERS);
    return {
      google,
      config,
      spreadsheetId,
      sheet,
      headers: TEMPLATE_HEADERS,
      rows: [] as string[][],
    };
  }
  return { google, config, spreadsheetId, sheet, headers: rows.headers, rows: rows.rows };
}

function headerIndex(headers: string[], aliases: string[]) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return aliases.map((alias) => normalized.indexOf(alias)).find((index) => index >= 0) ?? -1;
}

function parseTemplates(headers: string[], rows: string[][]) {
  const indexes = {
    id: headerIndex(headers, ["id", "template id"]),
    name: headerIndex(headers, ["name", "template name"]),
    htmlBody: headerIndex(headers, ["html body", "html", "body html"]),
    textBody: headerIndex(headers, ["text body", "text", "plain text"]),
    createdAt: headerIndex(headers, ["created at", "createdat"]),
    updatedAt: headerIndex(headers, ["updated at", "updatedat"]),
  };
  return rows
    .map((row, index): FollowUpTemplate | null => {
      const id = row[indexes.id]?.trim();
      const name = row[indexes.name]?.trim();
      if (!id || !name) return null;
      return {
        id,
        name,
        htmlBody: row[indexes.htmlBody] ?? "",
        textBody: row[indexes.textBody] ?? "",
        createdAt: row[indexes.createdAt] ?? "",
        updatedAt: row[indexes.updatedAt] ?? "",
        rowNumber: index + 2,
      };
    })
    .filter((template): template is FollowUpTemplate => Boolean(template))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function templateRow(headers: string[], template: FollowUpTemplate) {
  const row = Array.from({ length: headers.length }, () => "");
  const set = (aliases: string[], value: string) => {
    const index = headerIndex(headers, aliases);
    if (index >= 0) row[index] = value;
  };
  set(["id", "template id"], template.id);
  set(["name", "template name"], template.name);
  set(["html body", "html", "body html"], template.htmlBody);
  set(["text body", "text", "plain text"], template.textBody);
  set(["created at", "createdat"], template.createdAt);
  set(["updated at", "updatedat"], template.updatedAt);
  return row;
}

async function listTemplatesServer(force = false) {
  if (!force && templateCache && templateCache.expiresAt > Date.now()) return templateCache.data;
  const worksheet = await ensureTemplateWorksheet();
  const templates = await Promise.all(
    parseTemplates(worksheet.headers, worksheet.rows).map(async (template) => ({
      ...template,
      htmlBody: await sanitizeFollowUpTemplateHtml(template.htmlBody),
    })),
  );
  templateCache = { data: templates, expiresAt: Date.now() + TEMPLATE_CACHE_MS };
  return templates;
}

export const fetchGmailFollowUpLabels = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  const auth = await requireDashboardAuth();
  const { followUpRedisCommand } = await getFollowUpRedisServer();
  const accessToken = await getGmailReadAccessToken();
  const result = await gmailJson<{
    labels?: Array<{ id?: string; name?: string; type?: string }>;
  }>(accessToken, "labels");
  const allLabels = (result.labels ?? [])
    .filter((label) => label.type === "user" && label.id && label.name)
    .map((label) => ({ id: label.id!, name: label.name! }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const raw = await followUpRedisCommand<string | null>([
    "GET",
    "team-billion:bulk-follow-up:allowed-labels:v1",
  ]);
  const allowedLabelIds = raw ? (JSON.parse(raw) as string[]) : [];
  return {
    labels: auth.isAdmin
      ? allLabels
      : allLabels.filter((label) => allowedLabelIds.includes(label.id)),
    allowedLabelIds,
    configured: Boolean(raw),
    canManage: auth.isAdmin,
  };
});

export const updateAllowedFollowUpLabels = createServerFn({ method: "POST" })
  .inputValidator(z.object({ labelIds: z.array(z.string().min(1).max(200)).max(50) }))
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const { followUpRedisCommand, withFollowUpLock } = await getFollowUpRedisServer();
    const accessToken = await getGmailReadAccessToken();
    const actual = await gmailJson<{ labels?: Array<{ id?: string; type?: string }> }>(
      accessToken,
      "labels",
    );
    const userIds = new Set(
      (actual.labels ?? [])
        .filter((label) => label.type === "user")
        .flatMap((label) => (label.id ? [label.id] : [])),
    );
    if (data.labelIds.some((id) => !userIds.has(id)))
      throw new Error("One Gmail label is invalid.");
    await withFollowUpLock("allowed-labels", 15, () =>
      followUpRedisCommand<"OK">([
        "SET",
        "team-billion:bulk-follow-up:allowed-labels:v1",
        JSON.stringify(data.labelIds),
      ]),
    );
    return { ok: true as const };
  });

export const fetchFollowUpCandidates = createServerFn({ method: "POST" })
  .inputValidator(scanInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    const { followUpRedisCommand } = await getFollowUpRedisServer();
    const raw = await followUpRedisCommand<string | null>([
      "GET",
      "team-billion:bulk-follow-up:allowed-labels:v1",
    ]);
    const allowed = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    if (!raw || data.labelIds.some((id) => !allowed.has(id))) {
      throw new Error("An admin must allow every selected Gmail label first.");
    }
    const result = await scanFollowUpCandidates(data);
    return result;
  });

export const fetchFollowUpTemplates = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  return listTemplatesServer();
});

export const saveFollowUpTemplate = createServerFn({ method: "POST" })
  .inputValidator(templateInput)
  .handler(async ({ data }) => {
    const { requireWritableDashboardAuth } = await import("@/lib/auth.server");
    await requireWritableDashboardAuth();
    const { withFollowUpLock } = await getFollowUpRedisServer();
    return withFollowUpLock("templates", 20, async () => {
      const worksheet = await ensureTemplateWorksheet();
      const current = parseTemplates(worksheet.headers, worksheet.rows);
      const existing = data.id ? current.find((template) => template.id === data.id) : null;
      const now = new Date().toISOString();
      const htmlBody = await sanitizeFollowUpTemplateHtml(data.htmlBody);
      if (!htmlBody) throw new Error("The template message is empty after safety checks.");
      const textBody = htmlBody
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim();
      const template: FollowUpTemplate = {
        id: existing?.id ?? crypto.randomUUID(),
        name: data.name,
        htmlBody,
        textBody,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        rowNumber: existing?.rowNumber,
      };
      const row = templateRow(worksheet.headers, template);
      if (existing?.rowNumber) {
        await worksheet.google.updateSheetRowRaw(
          worksheet.config,
          worksheet.spreadsheetId,
          worksheet.sheet,
          existing.rowNumber,
          row,
        );
      } else {
        await worksheet.google.appendSheetRowRaw(
          worksheet.config,
          worksheet.spreadsheetId,
          worksheet.sheet,
          row,
        );
      }
      templateCache = null;
      return { ok: true as const, template };
    });
  });

export const deleteFollowUpTemplate = createServerFn({ method: "POST" })
  .inputValidator(deleteTemplateInput)
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const { withFollowUpLock } = await getFollowUpRedisServer();
    return withFollowUpLock("templates", 20, async () => {
      const worksheet = await ensureTemplateWorksheet();
      const template = parseTemplates(worksheet.headers, worksheet.rows).find(
        (item) => item.id === data.id,
      );
      if (!template?.rowNumber) throw new Error("This follow-up template no longer exists.");
      await worksheet.google.deleteSheetRow(
        worksheet.config,
        worksheet.spreadsheetId,
        worksheet.sheet,
        template.rowNumber,
      );
      templateCache = null;
      return { ok: true as const };
    });
  });
