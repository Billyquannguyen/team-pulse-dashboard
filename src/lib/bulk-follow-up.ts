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

const followUpDayMilestoneSchema = z.union([
  z.literal(3),
  z.literal(7),
  z.literal(14),
  z.literal(30),
  z.literal(90),
]);

export const followUpScanInputSchema = z
  .object({
    labelIds: z.array(z.string().min(1).max(200)).min(1).max(10),
    interactionLevel: z.number().int().min(1).max(5),
    minimumDaysSinceLastSent: followUpDayMilestoneSchema,
    maximumDaysSinceLastSent: followUpDayMilestoneSchema,
  })
  .refine((input) => input.minimumDaysSinceLastSent <= input.maximumDaysSinceLastSent, {
    message: "The beginning of the follow-up window must be before its end.",
    path: ["maximumDaysSinceLastSent"],
  });

export type FollowUpScanInput = z.infer<typeof followUpScanInputSchema>;

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
const SUPPRESSION_CACHE_MS = 6 * 60 * 60 * 1000;
const SUPPRESSION_LOOKBACK_DAYS = 120;
const MAX_THREAD_DETAILS_PER_SCAN = 160;
const MAX_UNFILTERED_CANDIDATES = 150;
const GMAIL_READ_RETRY_DELAYS_MS = [20_000, 45_000];
const GMAIL_THREAD_BATCH_SIZE = 2;
const GMAIL_SUPPRESSION_BATCH_SIZE = 4;
const GMAIL_READ_BATCH_DELAY_MS = 1_250;
const GMAIL_LABEL_CACHE_KEY = "team-billion:bulk-follow-up:gmail-labels:v1";
const GMAIL_LABEL_CACHE_SECONDS = 10 * 60;
const FOLLOW_UP_SCAN_CACHE_SECONDS = 2 * 60;
const FOLLOW_UP_SCAN_LOCK_SECONDS = 4 * 60;
let templateCache: { expiresAt: number; data: FollowUpTemplate[] } | null = null;
const suppressionCache = new Map<string, { expiresAt: number; suppressed: boolean }>();

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
  for (let attempt = 0; attempt <= GMAIL_READ_RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: { message?: string } })
      | null;
    if (response.ok && payload) return payload;

    const detail = payload?.error?.message ?? `Gmail returned ${response.status}.`;
    const normalizedDetail = detail.toLowerCase();
    const isQuotaError =
      response.status === 429 ||
      normalizedDetail.includes("quota") ||
      normalizedDetail.includes("rate limit");
    if (isQuotaError) {
      const retryDelay = GMAIL_READ_RETRY_DELAYS_MS[attempt];
      if (retryDelay !== undefined) {
        console.warn(
          `[bulk-follow-up] Gmail quota reached; retrying in ${retryDelay / 1_000}s (${path}).`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }
      throw new Error("Gmail's temporary read limit was reached. Wait one minute and try again.");
    }
    const isPermissionError =
      response.status === 401 ||
      (response.status === 403 &&
        (normalizedDetail.includes("permission") || normalizedDetail.includes("scope")));
    if (isPermissionError) {
      throw new Error(`${detail} Reconnect Gmail with read, compose, and settings permissions.`);
    }
    throw new Error(detail);
  }

  throw new Error("Gmail's temporary read limit was reached. Wait one minute and try again.");
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
  const params = new URLSearchParams({
    labelIds: labelId,
    q: `in:sent after:${after.toISOString().slice(0, 10).replaceAll("-", "/")} before:${before
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "/")}`,
    maxResults: "500",
  });
  const result = await gmailJson<{ threads?: Array<{ id?: string }> }>(
    accessToken,
    "threads",
    params,
  );
  // Gmail returns newest first. Reverse the one-page window so the oldest
  // outreach is checked first without opening hundreds of newer threads.
  return (result.threads ?? []).flatMap((thread) => (thread.id ? [thread.id] : [])).reverse();
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

async function getCachedGmailFollowUpLabels(accessToken: string) {
  const { followUpRedisCommand } = await getFollowUpRedisServer();
  const cached = await followUpRedisCommand<string | null>(["GET", GMAIL_LABEL_CACHE_KEY]);
  if (cached) {
    try {
      return JSON.parse(cached) as GmailFollowUpLabel[];
    } catch {
      await followUpRedisCommand(["DEL", GMAIL_LABEL_CACHE_KEY]).catch(() => undefined);
    }
  }

  const result = await gmailJson<{
    labels?: Array<{ id?: string; name?: string; type?: string }>;
  }>(accessToken, "labels");
  const labels = (result.labels ?? [])
    .filter((label) => label.type === "user" && label.id && label.name)
    .map((label) => ({ id: label.id!, name: label.name! }))
    .sort((left, right) => left.name.localeCompare(right.name));
  await followUpRedisCommand([
    "SET",
    GMAIL_LABEL_CACHE_KEY,
    JSON.stringify(labels),
    "EX",
    GMAIL_LABEL_CACHE_SECONDS,
  ]);
  return labels;
}

function followUpScanCacheKey(input: FollowUpScanInput) {
  return [
    "team-billion:bulk-follow-up:scan:v1",
    [...input.labelIds].sort().join(","),
    input.interactionLevel,
    input.minimumDaysSinceLastSent,
    input.maximumDaysSinceLastSent,
  ].join(":");
}

async function readCachedFollowUpScan(input: FollowUpScanInput) {
  const { followUpRedisCommand } = await getFollowUpRedisServer();
  const raw = await followUpRedisCommand<string | null>(["GET", followUpScanCacheKey(input)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { candidates: FollowUpCandidate[]; hasMore: boolean };
  } catch {
    await followUpRedisCommand(["DEL", followUpScanCacheKey(input)]).catch(() => undefined);
    return null;
  }
}

async function scanFollowUpCandidatesWithQuotaGuard(input: FollowUpScanInput) {
  const cached = await readCachedFollowUpScan(input);
  if (cached) return cached;

  const { followUpRedisCommand, withFollowUpLock } = await getFollowUpRedisServer();
  return withFollowUpLock(
    "gmail-scan",
    FOLLOW_UP_SCAN_LOCK_SECONDS,
    async () => {
      const refreshedCache = await readCachedFollowUpScan(input);
      if (refreshedCache) return refreshedCache;
      const result = await scanFollowUpCandidates(input);
      await followUpRedisCommand([
        "SET",
        followUpScanCacheKey(input),
        JSON.stringify(result),
        "EX",
        FOLLOW_UP_SCAN_CACHE_SECONDS,
      ]);
      return result;
    },
    "Another Gmail follow-up search is already running. Wait for it to finish, then try again.",
  );
}

export function candidateFromThread(
  thread: GmailThread,
  sendingAddresses: Set<string>,
  requiredInteractionLevel: number,
  cutoff: number,
  suppressedAddresses = new Set<string>(),
  oldestCutoff = 0,
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
  if (!lastSentAt || lastSentAt > cutoff || lastSentAt < oldestCutoff) return null;

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

async function isSuppressedRecipient(accessToken: string, recipientEmail: string) {
  const normalizedEmail = recipientEmail.trim().toLowerCase();
  const cached = suppressionCache.get(normalizedEmail);
  if (cached && cached.expiresAt > Date.now()) return cached.suppressed;

  const params = new URLSearchParams({
    q: `newer_than:${SUPPRESSION_LOOKBACK_DAYS}d (from:mailer-daemon OR from:postmaster OR subject:undeliverable OR subject:"delivery status notification") "${normalizedEmail}"`,
    maxResults: "10",
  });
  const result = await gmailJson<{ messages?: Array<{ id?: string }> }>(
    accessToken,
    "messages",
    params,
  );
  const ids = (result.messages ?? []).flatMap((message) => (message.id ? [message.id] : []));
  let suppressed = false;
  for (let index = 0; index < ids.length && !suppressed; index += 5) {
    const messages = await Promise.all(
      ids.slice(index, index + 5).map((id) => {
        const metadata = new URLSearchParams({ format: "metadata" });
        for (const header of ["X-Failed-Recipients", "Final-Recipient", "Original-Recipient"]) {
          metadata.append("metadataHeaders", header);
        }
        return gmailJson<GmailMessage>(accessToken, `messages/${encodeURIComponent(id)}`, metadata);
      }),
    );
    suppressed = messages.some((message) =>
      ["X-Failed-Recipients", "Final-Recipient", "Original-Recipient"].some((headerName) =>
        extractAddresses(getHeader(message, headerName)).includes(normalizedEmail),
      ),
    );
  }
  suppressionCache.set(normalizedEmail, {
    suppressed,
    expiresAt: Date.now() + SUPPRESSION_CACHE_MS,
  });
  return suppressed;
}

async function scanFollowUpCandidates(input: FollowUpScanInput) {
  const accessToken = await getGmailReadAccessToken();
  const primaryAddress = await getPrimaryGmailAddress(accessToken);
  const sendingAddresses = new Set(primaryAddress ? [primaryAddress] : []);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = now - input.minimumDaysSinceLastSent * dayMs;
  const oldestCutoff = now - input.maximumDaysSinceLastSent * dayMs;
  const candidates: FollowUpCandidate[] = [];
  const acceptedThreadIds = new Set<string>();
  const inspectedThreadIds = new Set<string>();
  let inspectedThreadCount = 0;
  let inspectionBudgetReached = false;
  const scanChunkMs = 7 * dayMs;

  // Gmail lists matching threads newest-first. Walk from the oldest edge of the
  // chosen window so the 100-result cap always keeps the oldest eligible outreach.
  for (
    let chunkStart = oldestCutoff;
    chunkStart < cutoff &&
    candidates.length < MAX_UNFILTERED_CANDIDATES &&
    !inspectionBudgetReached;
    chunkStart += scanChunkMs
  ) {
    const chunkEnd = Math.min(chunkStart + scanChunkMs, cutoff);
    const groups = await Promise.all(
      input.labelIds.map((labelId) =>
        listThreadIdsForWindow(
          accessToken,
          labelId,
          new Date(chunkStart - dayMs),
          new Date(chunkEnd + dayMs),
        ),
      ),
    );
    const ids = Array.from(new Set(groups.flat())).filter((id) => !inspectedThreadIds.has(id));
    for (let index = 0; index < ids.length; index += GMAIL_THREAD_BATCH_SIZE) {
      const remainingBudget = MAX_THREAD_DETAILS_PER_SCAN - inspectedThreadCount;
      if (remainingBudget <= 0 || candidates.length >= MAX_UNFILTERED_CANDIDATES) {
        inspectionBudgetReached = true;
        break;
      }
      const batchIds = ids.slice(
        index,
        index + Math.min(GMAIL_THREAD_BATCH_SIZE, remainingBudget),
      );
      batchIds.forEach((threadId) => inspectedThreadIds.add(threadId));
      const threads = await Promise.all(
        batchIds.map((threadId) => getThread(accessToken, threadId)),
      );
      if (index + batchIds.length < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, GMAIL_READ_BATCH_DELAY_MS));
      }
      inspectedThreadCount += threads.length;
      for (const thread of threads) {
        const candidate = candidateFromThread(
          thread,
          sendingAddresses,
          input.interactionLevel,
          chunkEnd,
          new Set(),
          chunkStart,
        );
        if (candidate && !acceptedThreadIds.has(candidate.threadId)) {
          acceptedThreadIds.add(candidate.threadId);
          candidates.push(candidate);
        }
      }
    }
  }
  const sorted = candidates.sort(
    (left, right) => new Date(left.lastSentAt).getTime() - new Date(right.lastSentAt).getTime(),
  );
  const eligible: FollowUpCandidate[] = [];
  for (
    let index = 0;
    index < sorted.length && eligible.length <= 100;
    index += GMAIL_SUPPRESSION_BATCH_SIZE
  ) {
    const batch = sorted.slice(index, index + GMAIL_SUPPRESSION_BATCH_SIZE);
    const suppressed = await Promise.all(
      batch.map((candidate) => isSuppressedRecipient(accessToken, candidate.recipientEmail)),
    );
    if (index + batch.length < sorted.length) {
      await new Promise((resolve) => setTimeout(resolve, GMAIL_READ_BATCH_DELAY_MS));
    }
    for (let candidateIndex = 0; candidateIndex < batch.length; candidateIndex += 1) {
      const candidate = batch[candidateIndex];
      if (candidate && !suppressed[candidateIndex]) eligible.push(candidate);
    }
  }
  const hasMore =
    eligible.length > 100 ||
    inspectionBudgetReached ||
    candidates.length >= MAX_UNFILTERED_CANDIDATES;
  return { candidates: eligible.slice(0, 100), hasMore };
}

export async function revalidateFollowUpCandidate(
  expected: FollowUpCandidate,
  input: FollowUpScanInput,
) {
  const accessToken = await getGmailReadAccessToken();
  const primaryAddress = await getPrimaryGmailAddress(accessToken);
  const suppressed = (await isSuppressedRecipient(accessToken, expected.recipientEmail))
    ? new Set([expected.recipientEmail.toLowerCase()])
    : new Set<string>();
  const now = Date.now();
  const cutoff = now - input.minimumDaysSinceLastSent * 86_400_000;
  const oldestCutoff = now - input.maximumDaysSinceLastSent * 86_400_000;
  const current = candidateFromThread(
    await getThread(accessToken, expected.threadId),
    new Set(primaryAddress ? [primaryAddress] : []),
    input.interactionLevel,
    cutoff,
    suppressed,
    oldestCutoff,
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
  const accessToken = await getGmailReadAccessToken();
  const allLabels = await getCachedGmailFollowUpLabels(accessToken);
  return {
    labels: allLabels,
    canManage: auth.isAdmin,
  };
});

export const fetchFollowUpCandidates = createServerFn({ method: "POST" })
  .inputValidator(followUpScanInputSchema)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    const accessToken = await getGmailReadAccessToken();
    const userLabelIds = new Set(
      (await getCachedGmailFollowUpLabels(accessToken)).map((label) => label.id),
    );
    if (data.labelIds.some((id) => !userLabelIds.has(id))) {
      throw new Error("One selected Gmail label no longer exists. Refresh and try again.");
    }
    const result = await scanFollowUpCandidatesWithQuotaGuard(data);
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
