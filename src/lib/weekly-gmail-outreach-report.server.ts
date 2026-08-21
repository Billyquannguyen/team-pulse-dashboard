import "@tanstack/react-start/server-only";
import { getMasterGmailAccessToken } from "@/lib/gmail-oauth.server";
import {
  classifyBrandInboundConversations,
  generateWeeklyOutreachNarrative,
  identifyMissingMemberTags,
  type BrandInboundCandidate,
  type ExclusiveCreatorReference,
  type MissingMemberTagCandidate,
} from "@/lib/ai/weekly-outreach-report.server";
import type { Creator } from "@/data/creators";
import { getExclusiveDashboardCreatorsForServer } from "@/lib/signed-creators.server";
import { getWeeklyOutreachReportMembers, type TeamMemberConfig } from "@/lib/team-members";

type GmailLabel = {
  id: string;
  name: string;
  type?: string;
};

type GmailLabelsResponse = {
  labels?: GmailLabel[];
};

type GmailMessagesResponse = {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
};

type GmailThreadsResponse = {
  threads?: Array<{ id?: string }>;
  nextPageToken?: string;
};

type GmailThreadMessage = {
  id?: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailMessagePart;
};

type GmailMessagePart = {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

type GmailThread = {
  id?: string;
  messages?: GmailThreadMessage[];
};

type ReportCategoryLabels = {
  brandInbound: GmailLabel | null;
  brandOutreach: GmailLabel | null;
  ongoingDeals: GmailLabel | null;
};

type ReportCategoryLabelNames = {
  brandInbound: string;
  brandOutreach: string;
  ongoingDeals: string;
};

type MemberReportMetrics = {
  member: TeamMemberConfig;
  gmailLabelId: string | null;
  creatorOutreachSent: number;
  brandOutreachSent: number;
  bookedCalls: number;
  invalidTaggingThreads: number;
  missedInbound: number;
  issues: string[];
};

type WeeklyReportTotals = Omit<MemberReportMetrics, "member" | "gmailLabelId" | "issues">;

type ReportNarrative = {
  summary: string;
  verdict: string;
  modelUsed: string | null;
  warnings: string[];
  fallbackReason: string | null;
};

type WeeklyReportResult = {
  ok: boolean;
  posted: boolean;
  memberCount: number;
  totals: WeeklyReportTotals;
  openRouterUsed: boolean;
  openRouterModel: string | null;
  issues: string[];
};

type MissingMemberTagAlert = {
  candidateId: string;
  member: TeamMemberConfig;
  creatorName: string;
  sentence: string;
};

type ReportWindow = {
  startMs: number;
  endMs: number;
};

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPORT_DAYS = 7;
const THREAD_FETCH_CONCURRENCY = 12;
const MAX_UNTAGGED_INBOUND_CANDIDATES = 50;
const MAX_STALE_BRAND_INBOUND_CANDIDATES = 200;
const MAX_AI_EMAIL_TEXT_LENGTH = 1_200;
const BRAND_INBOUND_STALE_MS = 48 * 60 * 60 * 1_000;
const REPORT_TIME_ZONE = "Asia/Ho_Chi_Minh";
const REPORT_TIME_ZONE_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DEFAULT_BOOKED_CALL_LABEL_NAME = "For Quân";
const DEFAULT_CATEGORY_LABEL_NAMES: ReportCategoryLabelNames = {
  brandInbound: "Brand inbound",
  brandOutreach: "Brand outreach",
  ongoingDeals: "Ongoing Deals",
};

function emptyTotals(): WeeklyReportTotals {
  return {
    creatorOutreachSent: 0,
    brandOutreachSent: 0,
    bookedCalls: 0,
    invalidTaggingThreads: 0,
    missedInbound: 0,
  };
}

function emptyMemberMetrics(member: TeamMemberConfig, issues: string[]): MemberReportMetrics {
  return {
    member,
    gmailLabelId: null,
    ...emptyTotals(),
    issues,
  };
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredGmailEnv(name: string) {
  try {
    return requiredEnv(name);
  } catch (error) {
    throw new GmailAuthError(error instanceof Error ? error.message : String(error));
  }
}

function getDiscordWebhookUrl() {
  return (
    process.env.WEEKLY_GMAIL_REPORT_DISCORD_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_WEBHOOK_URL?.trim() ||
    ""
  );
}

function getPositiveIntegerEnv(name: string, fallback: number, maximum: number) {
  const raw = Number(process.env[name] ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(maximum, Math.max(1, Math.round(raw)));
}

function getReportDays() {
  return getPositiveIntegerEnv("WEEKLY_GMAIL_REPORT_DAYS", DEFAULT_REPORT_DAYS, 31);
}

function getCategoryLabelNames(): ReportCategoryLabelNames {
  return {
    brandInbound:
      process.env.WEEKLY_GMAIL_BRAND_INBOUND_LABEL?.trim() ||
      DEFAULT_CATEGORY_LABEL_NAMES.brandInbound,
    brandOutreach:
      process.env.WEEKLY_GMAIL_BRAND_OUTREACH_LABEL?.trim() ||
      DEFAULT_CATEGORY_LABEL_NAMES.brandOutreach,
    ongoingDeals:
      process.env.WEEKLY_GMAIL_ONGOING_DEALS_LABEL?.trim() ||
      DEFAULT_CATEGORY_LABEL_NAMES.ongoingDeals,
  };
}

function getBookedCallLabelName() {
  return process.env.WEEKLY_GMAIL_BOOKED_CALL_LABEL?.trim() || DEFAULT_BOOKED_CALL_LABEL_NAME;
}

export function getReportWindow(days: number, now: Date): ReportWindow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: REPORT_TIME_ZONE,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const endMs =
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) -
    REPORT_TIME_ZONE_OFFSET_MS;
  return { startMs: endMs - days * DAY_IN_MS, endMs };
}

function withReportWindow(query: string, window: ReportWindow) {
  const after = Math.floor(window.startMs / 1_000);
  const before = Math.floor(window.endMs / 1_000);
  return `${query} after:${after} before:${before} -in:spam -in:trash`.replace(/\s+/g, " ").trim();
}

function quoteGmailSearchValue(value: string) {
  return `"${value.replace(/["\\]/g, " ").trim()}"`;
}

function normalizeLabelKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function validDiscordUserId(value: string) {
  return /^\d{16,25}$/.test(value.trim());
}

function formatMemberName(member: TeamMemberConfig) {
  const userId = member.discordUserId.trim();
  return validDiscordUserId(userId) ? `<@${userId}>` : member.displayName;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: REPORT_TIME_ZONE,
  }).format(value);
}

function getWindowLabel(window: ReportWindow) {
  return `${formatDate(new Date(window.startMs))} - ${formatDate(new Date(window.endMs - 1))}`;
}

async function getGmailReadonlyAccessToken() {
  try {
    return await getMasterGmailAccessToken();
  } catch (error) {
    if (error instanceof GmailAuthError) throw error;
    throw new GmailAuthError(
      error instanceof Error ? error.message : "Gmail authentication failed.",
    );
  }
}

async function gmailGet<T>(accessToken: string, path: string, params?: URLSearchParams) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  if (params) {
    params.forEach((value, key) => url.searchParams.append(key, value));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    const message = payload?.error?.message || `Gmail returned ${response.status}.`;
    if (response.status === 401 || response.status === 403) {
      throw new GmailAuthError(message);
    }
    throw new Error(message);
  }

  return (payload ?? {}) as T;
}

async function listGmailLabels(accessToken: string) {
  const response = await gmailGet<GmailLabelsResponse>(accessToken, "labels");
  return response.labels ?? [];
}

async function listGmailMessageThreadIds(accessToken: string, labelIds: string[], query: string) {
  const threadIds = new Set<string>();
  let pageToken = "";

  do {
    const params = new URLSearchParams();
    params.set("q", query);
    params.set("maxResults", "500");
    for (const labelId of labelIds) params.append("labelIds", labelId);
    if (pageToken) params.set("pageToken", pageToken);

    const response = await gmailGet<GmailMessagesResponse>(accessToken, "messages", params);
    for (const message of response.messages ?? []) {
      if (message.threadId) threadIds.add(message.threadId);
    }
    pageToken = response.nextPageToken ?? "";
  } while (pageToken);

  return Array.from(threadIds);
}

async function listGmailThreadIds(
  accessToken: string,
  labelIds: string[],
  query: string,
  maximum = Number.POSITIVE_INFINITY,
) {
  const threadIds: string[] = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams();
    params.set("q", query);
    params.set("maxResults", String(Math.min(500, Math.max(1, maximum - threadIds.length))));
    for (const labelId of labelIds) params.append("labelIds", labelId);
    if (pageToken) params.set("pageToken", pageToken);

    const response = await gmailGet<GmailThreadsResponse>(accessToken, "threads", params);
    for (const thread of response.threads ?? []) {
      if (thread.id) threadIds.push(thread.id);
    }
    pageToken = response.nextPageToken ?? "";
  } while (pageToken && threadIds.length < maximum);

  return Array.from(new Set(threadIds)).slice(0, maximum);
}

async function getGmailThread(accessToken: string, threadId: string) {
  const params = new URLSearchParams();
  params.set("format", "metadata");
  params.append("metadataHeaders", "From");

  return gmailGet<GmailThread>(accessToken, `threads/${encodeURIComponent(threadId)}`, params);
}

async function getFullGmailThread(accessToken: string, threadId: string) {
  const params = new URLSearchParams();
  params.set("format", "full");
  return gmailGet<GmailThread>(accessToken, `threads/${encodeURIComponent(threadId)}`, params);
}

async function loadGmailThreads(
  accessToken: string,
  threadIds: string[],
  threadCache: Map<string, Promise<GmailThread>>,
) {
  const threads: GmailThread[] = [];

  for (let index = 0; index < threadIds.length; index += THREAD_FETCH_CONCURRENCY) {
    const batch = threadIds.slice(index, index + THREAD_FETCH_CONCURRENCY);
    const loaded = await Promise.all(
      batch.map((threadId) => {
        const cached = threadCache.get(threadId);
        if (cached) return cached;

        const request = getGmailThread(accessToken, threadId);
        threadCache.set(threadId, request);
        return request;
      }),
    );
    threads.push(...loaded);
  }

  return threads;
}

async function loadFullGmailThreads(accessToken: string, threadIds: string[]) {
  const threads: GmailThread[] = [];

  for (let index = 0; index < threadIds.length; index += THREAD_FETCH_CONCURRENCY) {
    const batch = threadIds.slice(index, index + THREAD_FETCH_CONCURRENCY);
    threads.push(
      ...(await Promise.all(batch.map((threadId) => getFullGmailThread(accessToken, threadId)))),
    );
  }

  return threads;
}

function buildLabelIndex(labels: GmailLabel[]) {
  const index = new Map<string, GmailLabel>();

  for (const label of labels) {
    index.set(label.id, label);
    index.set(normalizeLabelKey(label.name), label);
  }

  return index;
}

function resolveLabel(labelIndex: Map<string, GmailLabel>, name: string) {
  return labelIndex.get(name) ?? labelIndex.get(normalizeLabelKey(name)) ?? null;
}

function resolveCategoryLabels(
  labelIndex: Map<string, GmailLabel>,
  names: ReportCategoryLabelNames,
) {
  const labels: ReportCategoryLabels = {
    brandInbound: resolveLabel(labelIndex, names.brandInbound),
    brandOutreach: resolveLabel(labelIndex, names.brandOutreach),
    ongoingDeals: resolveLabel(labelIndex, names.ongoingDeals),
  };
  const issues = (Object.keys(labels) as Array<keyof ReportCategoryLabels>)
    .filter((key) => !labels[key])
    .map((key) => `Không tìm thấy Gmail category label "${names[key]}".`);

  return { labels, issues };
}

function findDuplicateLabels(members: TeamMemberConfig[]) {
  const seen = new Map<string, string[]>();

  for (const member of members) {
    const key = normalizeLabelKey(member.gmailLabel);
    if (!key) continue;
    seen.set(key, [...(seen.get(key) ?? []), member.displayName]);
  }

  return Array.from(seen.entries())
    .filter(([, names]) => names.length > 1)
    .map(
      ([label, names]) =>
        `Gmail Label "${label}" đang được dùng cho nhiều member: ${names.join(", ")}.`,
    );
}

function getMessageTimestamp(message: GmailThreadMessage) {
  const value = Number(message.internalDate ?? "");
  return Number.isFinite(value) ? value : 0;
}

function getThreadLabelIds(thread: GmailThread) {
  const labelIds = new Set<string>();
  for (const message of thread.messages ?? []) {
    for (const labelId of message.labelIds ?? []) labelIds.add(labelId);
  }
  return labelIds;
}

function getCustomThreadLabelIds(threadLabelIds: Set<string>, customUserLabelIds: Set<string>) {
  return Array.from(threadLabelIds).filter((labelId) => customUserLabelIds.has(labelId));
}

function isCreatorOutreachThread(
  threadLabelIds: Set<string>,
  memberLabelId: string,
  customUserLabelIds: Set<string>,
) {
  const customLabels = getCustomThreadLabelIds(threadLabelIds, customUserLabelIds);
  return customLabels.length === 1 && customLabels[0] === memberLabelId;
}

function getDeliveredThreadMessages(thread: GmailThread) {
  return (thread.messages ?? [])
    .filter(
      (message) => !(message.labelIds ?? []).includes("DRAFT") && getMessageTimestamp(message) > 0,
    )
    .sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));
}

function getHeader(message: GmailThreadMessage, name: string) {
  return (
    message.payload?.headers
      ?.find((header) => header.name?.trim().toLowerCase() === name.toLowerCase())
      ?.value?.trim() ?? ""
  );
}

function decodeGmailBody(data: string) {
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function collectMessageText(part: GmailMessagePart | undefined): string[] {
  if (!part) return [];
  const childText = (part.parts ?? []).flatMap(collectMessageText);
  if (childText.length > 0) return childText;

  const decoded = part.body?.data ? decodeGmailBody(part.body.data) : "";
  if (!decoded) return [];
  if (part.mimeType?.toLowerCase() === "text/html") {
    return [
      decoded
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ];
  }
  return [decoded];
}

function cleanEmailText(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isClearlyAutomatedEmail(message: GmailThreadMessage) {
  const from = getHeader(message, "From").toLowerCase();
  const subject = getHeader(message, "Subject").toLowerCase();
  const autoSubmitted = getHeader(message, "Auto-Submitted").toLowerCase();
  const precedence = getHeader(message, "Precedence").toLowerCase();
  const hasUnsubscribeHeader = Boolean(getHeader(message, "List-Unsubscribe"));

  return (
    /(?:^|[<@._-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster)(?:[>@._-]|$)/i.test(from) ||
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    /^(bulk|junk|list)$/.test(precedence) ||
    hasUnsubscribeHeader ||
    /\b(newsletter|weekly digest|daily digest|unsubscribe|delivery status|automatic reply|out of office|password reset|verification code|confirm your email|receipt)\b/i.test(
      subject,
    )
  );
}

function hasAnyMemberLabel(thread: GmailThread, memberLabelIds: Set<string>) {
  return Array.from(getThreadLabelIds(thread)).some((labelId) => memberLabelIds.has(labelId));
}

function normalizeMentionKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function creatorAliasFromUrl(value: string) {
  try {
    const url = new URL(value);
    const segment = url.pathname
      .split("/")
      .filter(Boolean)
      .findLast((item) => item !== "reels");
    return normalizeMentionKey((segment ?? "").replace(/^@/, ""));
  } catch {
    return "";
  }
}

function buildExclusiveCreatorReferences(creators: Creator[]) {
  const references = new Map<
    string,
    ExclusiveCreatorReference & { mentionKeys: string[]; ownerName: string }
  >();

  for (const creator of creators) {
    if (creator.relationship !== "Exclusive" || !creator.handle.trim()) continue;
    const creatorId = creator.id.trim();
    const mentionKeys = Array.from(
      new Set(
        [
          normalizeMentionKey(creator.handle),
          creatorAliasFromUrl(creator.tiktokLink ?? ""),
          creatorAliasFromUrl(creator.instagramLink ?? ""),
          creatorAliasFromUrl(creator.youtubeLink ?? ""),
        ].filter((value) => value.length >= 4),
      ),
    );
    if (mentionKeys.length === 0) continue;
    references.set(creatorId, {
      creatorId,
      creatorName: creator.handle.trim(),
      ownerName: creator.owner.trim(),
      mentionKeys,
    });
  }

  return Array.from(references.values());
}

function memberForDashboardOwner(owner: string, members: TeamMemberConfig[]) {
  const ownerKey = normalizeMentionKey(owner);
  if (!ownerKey) return null;
  return (
    members.find((member) =>
      [member.displayName, member.gmailLabel, member.id]
        .map(normalizeMentionKey)
        .some((value) => value === ownerKey),
    ) ?? null
  );
}

export function findMentionedExclusiveCreators(
  candidates: MissingMemberTagCandidate[],
  creators: Creator[],
) {
  const candidateText = candidates.map((candidate) => normalizeMentionKey(candidate.emailText));
  return buildExclusiveCreatorReferences(creators).filter((creator) =>
    creator.mentionKeys.some((key) => candidateText.some((text) => text.includes(key))),
  );
}

function discordInline(value: string, fallback: string) {
  const cleaned = value
    .replace(/([\\*_`~|])/g, "\\$1")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 160);
}

function formatAlertReceivedAt(receivedAt: string) {
  const date = new Date(receivedAt);
  if (!Number.isFinite(date.getTime())) return "an unknown time";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: REPORT_TIME_ZONE,
  }).format(date);
}

function buildMissingMemberTagSentence({
  candidate,
  member,
  creatorName,
}: {
  candidate: MissingMemberTagCandidate;
  member: TeamMemberConfig;
  creatorName: string;
}) {
  const subject = discordInline(candidate.subject, "No subject");
  const sender = discordInline(candidate.from, "unknown sender");
  const creator = discordInline(creatorName, "an exclusive creator");
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(candidate.candidateId)}`;
  const owner = `should be tagged **${discordInline(member.gmailLabel, member.displayName)}** for ${formatMemberName(member)}`;
  return `Email **“${subject}”** from **${sender}**, received **${formatAlertReceivedAt(
    candidate.receivedAt,
  )}**, ${owner} because it mentions exclusive creator **${creator}**; please check and add the tag: [open email](${gmailUrl}).`;
}

async function collectMissingMemberTagAlerts({
  accessToken,
  brandInboundLabel,
  window,
  members,
  memberLabelIds,
  creators,
}: {
  accessToken: string;
  brandInboundLabel: GmailLabel;
  window: ReportWindow;
  members: TeamMemberConfig[];
  memberLabelIds: Set<string>;
  creators: Creator[];
}) {
  const query = withReportWindow(
    `label:${quoteGmailSearchValue(brandInboundLabel.name)} -in:spam -in:trash`,
    window,
  );
  const threadIds = await listGmailThreadIds(
    accessToken,
    [brandInboundLabel.id],
    query,
    MAX_UNTAGGED_INBOUND_CANDIDATES,
  );
  const threads = await loadFullGmailThreads(accessToken, threadIds);
  const candidates: MissingMemberTagCandidate[] = [];

  for (const thread of threads) {
    if (!thread.id || hasAnyMemberLabel(thread, memberLabelIds)) continue;
    const messages = getDeliveredThreadMessages(thread);
    const latestInbound = [...messages]
      .reverse()
      .find((message) => !(message.labelIds ?? []).includes("SENT"));
    if (!latestInbound || isClearlyAutomatedEmail(latestInbound)) continue;

    const subject = getHeader(latestInbound, "Subject");
    const from = getHeader(latestInbound, "From");
    const bodyText = cleanEmailText(
      collectMessageText(latestInbound.payload).join(" ") || latestInbound.snippet || "",
    ).slice(0, MAX_AI_EMAIL_TEXT_LENGTH);
    if (!subject && !bodyText) continue;

    candidates.push({
      candidateId: thread.id,
      from,
      subject,
      receivedAt: new Date(getMessageTimestamp(latestInbound)).toISOString(),
      emailText: [subject, bodyText].filter(Boolean).join("\n").slice(0, MAX_AI_EMAIL_TEXT_LENGTH),
    });
  }

  const mentionedCreators = findMentionedExclusiveCreators(candidates, creators);
  if (mentionedCreators.length === 0) {
    return {
      alerts: [],
      warnings: [],
      modelUsed: "",
      candidatesChecked: candidates.length,
      exclusiveCreatorsMatched: 0,
    };
  }

  const aiResult = await identifyMissingMemberTags({
    candidates,
    creators: mentionedCreators.map(({ creatorId, creatorName }) => ({ creatorId, creatorName })),
  });
  const candidateIndex = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const creatorIndex = new Map(mentionedCreators.map((creator) => [creator.creatorId, creator]));
  const alerts = new Map<string, MissingMemberTagAlert>();

  for (const decision of aiResult.decisions) {
    if (!decision.report || decision.confidence !== "high") continue;
    const candidate = candidateIndex.get(decision.candidateId);
    const creator = creatorIndex.get(decision.creatorId);
    const member = creator
      ? memberForDashboardOwner(creator.ownerName, members)
      : null;
    if (!candidate || !creator || !member) continue;
    alerts.set(candidate.candidateId, {
      candidateId: candidate.candidateId,
      member,
      creatorName: creator.creatorName,
      sentence: buildMissingMemberTagSentence({
        candidate,
        member,
        creatorName: creator.creatorName,
      }),
    });
  }

  return {
    alerts: Array.from(alerts.values()),
    warnings: aiResult.warnings,
    modelUsed: aiResult.modelUsed,
    candidatesChecked: candidates.length,
    exclusiveCreatorsMatched: mentionedCreators.length,
  };
}

function buildBrandInboundTranscript(messages: GmailThreadMessage[]) {
  return messages
    .slice(-4)
    .map((message) => {
      const sender = (message.labelIds ?? []).includes("SENT") ? "TEAM" : "EXTERNAL";
      const from = getHeader(message, "From");
      const subject = getHeader(message, "Subject");
      const body = cleanEmailText(
        collectMessageText(message.payload).join(" ") || message.snippet || "",
      ).slice(0, 900);
      return `${sender}\nFrom: ${from}\nSubject: ${subject}\n${body}`;
    })
    .join("\n\n")
    .slice(0, 3_600);
}

async function collectOverdueTaggedBrandInbound({
  accessToken,
  brandInboundLabel,
  members,
  labelIndex,
  now,
}: {
  accessToken: string;
  brandInboundLabel: GmailLabel;
  members: TeamMemberConfig[];
  labelIndex: Map<string, GmailLabel>;
  now: Date;
}) {
  const staleBeforeMs = now.getTime() - BRAND_INBOUND_STALE_MS;
  const query = [
    `label:${quoteGmailSearchValue(brandInboundLabel.name)}`,
    `before:${Math.floor(staleBeforeMs / 1_000)}`,
    "-in:spam",
    "-in:trash",
  ].join(" ");
  const threadIds = await listGmailThreadIds(
    accessToken,
    [brandInboundLabel.id],
    query,
    MAX_STALE_BRAND_INBOUND_CANDIDATES,
  );
  const threads = await loadFullGmailThreads(accessToken, threadIds);
  const membersByLabelId = new Map(
    members
      .map((member) => {
        const labelId = resolveLabel(labelIndex, member.gmailLabel)?.id ?? "";
        return labelId ? ([labelId, member] as const) : null;
      })
      .filter((entry): entry is readonly [string, TeamMemberConfig] => entry !== null),
  );
  const candidates: BrandInboundCandidate[] = [];

  for (const thread of threads) {
    if (!thread.id) continue;
    const messages = getDeliveredThreadMessages(thread);
    const latest = messages.at(-1);
    if (!latest || (latest.labelIds ?? []).includes("SENT")) continue;
    const latestTimestamp = getMessageTimestamp(latest);
    if (!latestTimestamp || latestTimestamp > staleBeforeMs) continue;

    const member = Array.from(getThreadLabelIds(thread))
      .map((labelId) => membersByLabelId.get(labelId))
      .find((item): item is TeamMemberConfig => Boolean(item));
    if (!member) continue;

    candidates.push({
      candidateId: thread.id,
      memberId: member.id,
      subject: getHeader(latest, "Subject"),
      from: getHeader(latest, "From"),
      lastReceivedAt: new Date(latestTimestamp).toISOString(),
      transcript: buildBrandInboundTranscript(messages),
    });
  }

  const aiResult = await classifyBrandInboundConversations({ candidates });
  const candidateIndex = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const unresolvedByMember = new Map<string, number>();
  let uncertain = 0;

  for (const decision of aiResult.decisions) {
    const candidate = candidateIndex.get(decision.candidateId);
    if (!candidate) continue;
    if (decision.status === "uncertain") uncertain += 1;
    if (decision.status !== "unresolved" || decision.confidence !== "high") continue;
    unresolvedByMember.set(
      candidate.memberId,
      (unresolvedByMember.get(candidate.memberId) ?? 0) + 1,
    );
  }

  return {
    unresolvedByMember,
    candidatesChecked: candidates.length,
    uncertain,
    modelUsed: aiResult.modelUsed,
    warnings: aiResult.warnings,
  };
}

function isNewOutboundThread(thread: GmailThread, reportStartMs: number, reportEndMs: number) {
  const firstMessage = getDeliveredThreadMessages(thread)[0];
  const timestamp = firstMessage ? getMessageTimestamp(firstMessage) : 0;

  return (
    Boolean(firstMessage?.labelIds?.includes("SENT")) &&
    timestamp >= reportStartMs &&
    timestamp < reportEndMs
  );
}

async function collectMemberMetrics(
  accessToken: string,
  member: TeamMemberConfig,
  labelIndex: Map<string, GmailLabel>,
  customUserLabelIds: Set<string>,
  categoryLabels: ReportCategoryLabels,
  categoryLabelNames: ReportCategoryLabelNames,
  bookedCallLabel: GmailLabel | null,
  window: ReportWindow,
  threadCache: Map<string, Promise<GmailThread>>,
  countedBrandThreadIds: Set<string>,
  countedBookedThreadIds: Set<string>,
): Promise<MemberReportMetrics> {
  const issues: string[] = [];
  const label = member.gmailLabel ? resolveLabel(labelIndex, member.gmailLabel) : null;

  if (!member.gmailLabel) {
    issues.push(`${member.displayName}: thiếu Gmail Label.`);
  }

  if (member.gmailLabel && !label) {
    issues.push(
      `${member.displayName}: không tìm thấy Gmail Label "${member.gmailLabel}" trong Gmail.`,
    );
  }

  if (!member.discordUserId.trim()) {
    issues.push(`${member.displayName}: thiếu Discord User ID.`);
  } else if (!validDiscordUserId(member.discordUserId)) {
    issues.push(`${member.displayName}: Discord User ID không đúng định dạng.`);
  }

  if (!label) return emptyMemberMetrics(member, issues);

  const metrics: MemberReportMetrics = {
    ...emptyMemberMetrics(member, issues),
    gmailLabelId: label.id,
  };
  const reportStartMs = window.startMs;
  const reportEndMs = window.endMs;
  const creatorExclusions = Object.values(categoryLabelNames)
    .map((name) => `-label:${quoteGmailSearchValue(name)}`)
    .join(" ");
  const creatorThreadQuery = [
    "in:sent",
    creatorExclusions,
    `after:${Math.floor(window.startMs / 1_000)}`,
    `before:${Math.floor(window.endMs / 1_000)}`,
    "-in:spam",
    "-in:trash",
  ]
    .filter(Boolean)
    .join(" ");
  const brandOutreachQuery = withReportWindow(
    `in:sent label:${quoteGmailSearchValue(categoryLabelNames.brandOutreach)}`,
    window,
  );
  try {
    const [creatorThreadIds, brandOutreachThreadIds, bookedThreadIds] = await Promise.all([
      listGmailThreadIds(accessToken, [label.id], creatorThreadQuery),
      categoryLabels.brandOutreach
        ? listGmailThreadIds(
            accessToken,
            [label.id, categoryLabels.brandOutreach.id],
            brandOutreachQuery,
          )
        : Promise.resolve([]),
      bookedCallLabel
        ? listGmailMessageThreadIds(
            accessToken,
            [label.id, bookedCallLabel.id],
            withReportWindow("", window),
          )
        : Promise.resolve([]),
    ]);
    const [creatorThreads, brandOutreachThreads] = await Promise.all([
      loadGmailThreads(accessToken, creatorThreadIds, threadCache),
      loadGmailThreads(accessToken, brandOutreachThreadIds, threadCache),
    ]);

    for (const thread of brandOutreachThreads) {
      if (!thread.id || !isNewOutboundThread(thread, reportStartMs, reportEndMs)) continue;
      if (countedBrandThreadIds.has(thread.id)) continue;
      countedBrandThreadIds.add(thread.id);
      metrics.brandOutreachSent += 1;
    }
    for (const threadId of bookedThreadIds) {
      if (countedBookedThreadIds.has(threadId)) continue;
      countedBookedThreadIds.add(threadId);
      metrics.bookedCalls += 1;
    }

    for (const thread of creatorThreads) {
      const threadLabelIds = getThreadLabelIds(thread);
      if (!isCreatorOutreachThread(threadLabelIds, label.id, customUserLabelIds)) continue;
      if (isNewOutboundThread(thread, reportStartMs, reportEndMs)) {
        metrics.creatorOutreachSent += 1;
      }
    }

    return metrics;
  } catch (error) {
    if (error instanceof GmailAuthError) throw error;
    issues.push(
      `${member.displayName}: không đọc được Gmail metric (${error instanceof Error ? error.message : String(error)}).`,
    );
    return {
      ...emptyMemberMetrics(member, issues),
      gmailLabelId: label.id,
    };
  }
}

function addMetrics(left: WeeklyReportTotals, right: MemberReportMetrics): WeeklyReportTotals {
  return {
    creatorOutreachSent: left.creatorOutreachSent + right.creatorOutreachSent,
    brandOutreachSent: left.brandOutreachSent + right.brandOutreachSent,
    bookedCalls: left.bookedCalls + right.bookedCalls,
    invalidTaggingThreads: left.invalidTaggingThreads + right.invalidTaggingThreads,
    missedInbound: left.missedInbound + right.missedInbound,
  };
}

function buildFallbackVerdict(totals: WeeklyReportTotals) {
  if (totals.missedInbound > 0 && totals.invalidTaggingThreads > 0) {
    return "Cần trả lời các brand inbound đã chờ quá 48 giờ và thêm member tag cho các email đang tag sai quy tắc.";
  }
  if (totals.missedInbound > 0) {
    return "Cần trả lời các brand inbound đã có member tag nhưng external sender đang chờ quá 48 giờ.";
  }
  if (totals.invalidTaggingThreads > 0) {
    return "Cần thêm đúng member tag cho các Brand inbound đang tag sai quy tắc.";
  }
  return "Không phát hiện brand inbound đang chờ reply quá 48 giờ hoặc email thiếu member tag.";
}

function buildFallbackSummary() {
  return "Báo cáo đã tổng hợp creator outreach, brand outreach, booking và tình trạng tagging trong tuần.";
}

function describeOpenRouterFailure(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (message.includes("missing")) return "thiếu cấu hình";
  if (message.includes("timed out") || message.includes("timeout")) return "hết thời gian chờ";
  if (message.includes("(401)") || message.includes("(403)")) return "API key bị từ chối";
  if (message.includes("(402)") || message.includes("credit")) return "không đủ credit";
  if (message.includes("(429)") || message.includes("rate limit")) return "model bị giới hạn";
  if (message.includes("(404)")) return "model không khả dụng";
  if (
    message.includes("expected report format") ||
    message.includes("empty response") ||
    message.includes("invalid_type")
  ) {
    return "model trả về sai định dạng";
  }
  return "request hoặc model thất bại";
}

async function getReportNarrative(
  totals: WeeklyReportTotals,
  days: number,
  memberCount: number,
): Promise<ReportNarrative> {
  try {
    const result = await generateWeeklyOutreachNarrative({
      reportDays: days,
      memberCount,
      ...totals,
    });

    return {
      summary: result.summary,
      verdict: result.verdict,
      modelUsed: result.modelUsed,
      warnings: result.warnings,
      fallbackReason: null,
    };
  } catch (error) {
    console.error(
      `[weekly-gmail-report] OpenRouter narrative failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      summary: buildFallbackSummary(),
      verdict: buildFallbackVerdict(totals),
      modelUsed: null,
      warnings: [],
      fallbackReason: describeOpenRouterFailure(error),
    };
  }
}

function buildVietnameseReport(
  metrics: MemberReportMetrics[],
  totals: WeeklyReportTotals,
  narrative: ReportNarrative,
  issues: string[],
  missingMemberTagAlertCount: number,
  missingTagScanCompleted: boolean,
  unresolvedBrandInboundScanCompleted: boolean,
  days: number,
  window: ReportWindow,
) {
  const reportIssues = issues;

  const lines = [
    "**Báo cáo Gmail Outreach hằng tuần**",
    `Thời gian: ${getWindowLabel(window)} (${days} ngày hoàn tất gần nhất)`,
    "",
    "**Tổng quan**",
    `Creator outreach mới: ${formatNumber(totals.creatorOutreachSent)}`,
    `Brand outreach mới: ${formatNumber(totals.brandOutreachSent)}`,
    `Booked call (tag For Quân): ${formatNumber(totals.bookedCalls)}`,
    unresolvedBrandInboundScanCompleted
      ? `Brand inbound chưa xử lý (đã tag, chưa reply >48 giờ, AI xác nhận): ${formatNumber(totals.missedInbound)}`
      : "Brand inbound chưa xử lý: không xác định (AI check không hoàn tất)",
    missingTagScanCompleted
      ? `Tagging sai quy tắc (thiếu member tag): ${formatNumber(totals.invalidTaggingThreads)}`
      : "Tagging sai quy tắc: không xác định (AI check không hoàn tất)",
    "",
    "**Nhận định**",
    narrative.summary,
    narrative.verdict,
    narrative.modelUsed
      ? `OpenRouter model: ${narrative.modelUsed}`
      : `OpenRouter: fallback mẫu cố định (${narrative.fallbackReason})`,
    "",
    "**Theo member**",
  ];

  if (metrics.length === 0) {
    lines.push("Không có member nào đủ điều kiện trong TeamMembers.");
  } else {
    for (const item of metrics) {
      lines.push(
        `${formatMemberName(item.member)}: Creator mới ${formatNumber(
          item.creatorOutreachSent,
        )} | Brand mới ${formatNumber(item.brandOutreachSent)} | Booked ${formatNumber(
          item.bookedCalls,
        )} | Brand inbound >48h ${
          unresolvedBrandInboundScanCompleted
            ? formatNumber(item.missedInbound)
            : "không xác định"
        } | Thiếu tag ${
          missingTagScanCompleted
            ? formatNumber(item.invalidTaggingThreads)
            : "không xác định"
        }`,
      );
    }
  }

  lines.push("", "**Tagging/config cần kiểm tra**");
  if (missingMemberTagAlertCount > 0) {
    lines.push(
      `${formatNumber(missingMemberTagAlertCount)} email có khả năng thiếu member tag; xem notification riêng bên dưới.`,
    );
  }
  if (reportIssues.length === 0) {
    if (missingMemberTagAlertCount === 0) {
      lines.push(
        "AI không tìm thấy Brand inbound nào có khả năng cao đang thiếu member tag hoặc tag sai quy tắc.",
      );
    }
  } else {
    for (const issue of reportIssues.slice(0, 12)) {
      lines.push(`- ${issue}`);
    }
    if (reportIssues.length > 12) {
      lines.push(`- Còn ${formatNumber(reportIssues.length - 12)} vấn đề khác.`);
    }
  }

  const content = lines.join("\n");
  return content.length <= 1900
    ? content
    : `${content.slice(0, 1850)}\n...\nBáo cáo đã bị rút gọn vì quá dài.`;
}

async function postDiscordMessage(content: string, mentionUserIds: string[]) {
  const webhookUrl = getDiscordWebhookUrl();
  if (!webhookUrl) {
    throw new Error(
      "Missing WEEKLY_GMAIL_REPORT_DISCORD_WEBHOOK_URL or DISCORD_WEBHOOK_URL environment variable.",
    );
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Weekly Gmail Outreach",
      content,
      allowed_mentions:
        mentionUserIds.length > 0
          ? { users: mentionUserIds }
          : {
              parse: [],
            },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }
}

async function postGmailAuthErrorToDiscord() {
  await postDiscordMessage(
    [
      "**Báo cáo Gmail Outreach hằng tuần: lỗi Gmail**",
      "Không đọc được Gmail bằng quyền readonly.",
      "Kiểm tra `MASTER_GMAIL_CLIENT_ID`, `MASTER_GMAIL_CLIENT_SECRET`, `MASTER_GMAIL_REFRESH_TOKEN`, và các Gmail scopes của master token.",
    ].join("\n"),
    [],
  );
}

export async function runWeeklyGmailOutreachReport(): Promise<WeeklyReportResult> {
  const members = await getWeeklyOutreachReportMembers();
  const days = getReportDays();
  const now = new Date();
  const window = getReportWindow(days, now);
  const baseIssues = [
    ...findDuplicateLabels(members),
    ...(members.length === 0
      ? [
          "Không có member nào có Status = Active, Weekly Report Enabled = TRUE, và Team/Department = Creator hoặc Outreach.",
        ]
      : []),
  ];

  try {
    const accessToken = await getGmailReadonlyAccessToken();
    const labels = await listGmailLabels(accessToken);
    const labelIndex = buildLabelIndex(labels);
    const customUserLabelIds = new Set(
      labels.filter((label) => label.type?.toLowerCase() === "user").map((label) => label.id),
    );
    const categoryLabelNames = getCategoryLabelNames();
    const categoryLabelResult = resolveCategoryLabels(labelIndex, categoryLabelNames);
    const bookedCallLabelName = getBookedCallLabelName();
    const bookedCallLabel = resolveLabel(labelIndex, bookedCallLabelName);
    const metrics: MemberReportMetrics[] = [];
    const threadCache = new Map<string, Promise<GmailThread>>();
    const countedBrandThreadIds = new Set<string>();
    const countedBookedThreadIds = new Set<string>();

    for (const member of members) {
      metrics.push(
        await collectMemberMetrics(
          accessToken,
          member,
          labelIndex,
          customUserLabelIds,
          categoryLabelResult.labels,
          categoryLabelNames,
          bookedCallLabel,
          window,
          threadCache,
          countedBrandThreadIds,
          countedBookedThreadIds,
        ),
      );
    }

    let unresolvedBrandInboundScanCompleted = false;
    let unresolvedBrandInboundModelUsed = "";
    const unresolvedBrandInboundIssues: string[] = [];
    const unresolvedBrandInboundWarnings: string[] = [];
    if (categoryLabelResult.labels.brandInbound) {
      try {
        const scan = await collectOverdueTaggedBrandInbound({
          accessToken,
          brandInboundLabel: categoryLabelResult.labels.brandInbound,
          members,
          labelIndex,
          now,
        });
        for (const item of metrics) {
          item.missedInbound = scan.unresolvedByMember.get(item.member.id) ?? 0;
        }
        unresolvedBrandInboundScanCompleted = true;
        unresolvedBrandInboundModelUsed = scan.modelUsed;
        unresolvedBrandInboundWarnings.push(...scan.warnings);
        if (scan.uncertain > 0) {
          unresolvedBrandInboundWarnings.push(
            `${scan.uncertain} tagged conversation(s) were uncertain and not counted.`,
          );
        }
        console.info("[weekly-gmail-report] overdue-tagged-inbound AI scan completed", {
          candidatesChecked: scan.candidatesChecked,
          unresolved: Array.from(scan.unresolvedByMember.values()).reduce(
            (sum, count) => sum + count,
            0,
          ),
          uncertain: scan.uncertain,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[weekly-gmail-report] overdue-tagged-inbound AI scan failed: ${message}`);
        unresolvedBrandInboundIssues.push(
          `Không xác định được conversation đã tag nhưng chưa reply vì AI check thất bại (${message}).`,
        );
      }
    }

    let missingMemberTagAlerts: MissingMemberTagAlert[] = [];
    let missingTagScanCompleted = false;
    let missingTagModelUsed = "";
    const missingTagIssues: string[] = [];
    const missingTagWarnings: string[] = [];
    if (categoryLabelResult.labels.brandInbound) {
      try {
        const exclusiveCreators = await getExclusiveDashboardCreatorsForServer();
        const memberLabelIds = new Set(
          members
            .map((member) => resolveLabel(labelIndex, member.gmailLabel)?.id ?? "")
            .filter(Boolean),
        );
        const scan = await collectMissingMemberTagAlerts({
          accessToken,
          brandInboundLabel: categoryLabelResult.labels.brandInbound,
          window,
          members,
          memberLabelIds,
          creators: exclusiveCreators,
        });
        missingMemberTagAlerts = scan.alerts;
        missingTagScanCompleted = true;
        missingTagModelUsed = scan.modelUsed;
        missingTagWarnings.push(...scan.warnings);
        console.info("[weekly-gmail-report] missing-member-tag scan completed", {
          candidatesChecked: scan.candidatesChecked,
          alerts: scan.alerts.length,
          exclusiveCreatorsAvailable: exclusiveCreators.length,
          exclusiveCreatorsMatched: scan.exclusiveCreatorsMatched,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[weekly-gmail-report] missing-member-tag scan failed: ${message}`);
        missingTagIssues.push(`Không chạy được AI check cho email thiếu member tag (${message}).`);
      }
    }

    for (const alert of missingMemberTagAlerts) {
      const memberMetrics = metrics.find((item) => item.member.id === alert.member.id);
      if (memberMetrics) memberMetrics.invalidTaggingThreads += 1;
    }

    const totals = metrics.reduce(addMetrics, emptyTotals());
    const narrative = await getReportNarrative(totals, days, members.length);
    const issues = [
      ...baseIssues,
      ...categoryLabelResult.issues,
      ...(bookedCallLabel
        ? []
        : [`Không tìm thấy Gmail booked-call label "${bookedCallLabelName}".`]),
      ...metrics.flatMap((item) => item.issues),
      ...unresolvedBrandInboundIssues,
      ...missingTagIssues,
    ];
    const content = buildVietnameseReport(
      metrics,
      totals,
      narrative,
      issues,
      missingMemberTagAlerts.length,
      missingTagScanCompleted,
      unresolvedBrandInboundScanCompleted,
      days,
      window,
    );
    const mentionUserIds = members
      .map((member) => member.discordUserId.trim())
      .filter(validDiscordUserId);

    await postDiscordMessage(content, Array.from(new Set(mentionUserIds)));
    for (const alert of missingMemberTagAlerts) {
      const discordUserId = alert.member.discordUserId.trim();
      await postDiscordMessage(
        alert.sentence,
        validDiscordUserId(discordUserId) ? [discordUserId] : [],
      );
    }

    return {
      ok: true,
      posted: true,
      memberCount: members.length,
      totals,
      openRouterUsed: Boolean(
        narrative.modelUsed || missingTagModelUsed || unresolvedBrandInboundModelUsed
      ),
      openRouterModel:
        narrative.modelUsed || missingTagModelUsed || unresolvedBrandInboundModelUsed,
      issues: [
        ...narrative.warnings,
        ...unresolvedBrandInboundWarnings,
        ...missingTagWarnings,
        ...issues,
      ],
    };
  } catch (error) {
    if (error instanceof GmailAuthError) {
      await postGmailAuthErrorToDiscord();
      return {
        ok: false,
        posted: true,
        memberCount: members.length,
        totals: emptyTotals(),
        openRouterUsed: false,
        openRouterModel: null,
        issues: ["Gmail auth failed. Error was posted to Discord."],
      };
    }

    throw error;
  }
}
