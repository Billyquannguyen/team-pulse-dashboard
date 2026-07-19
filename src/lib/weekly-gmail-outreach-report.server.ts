import "@tanstack/react-start/server-only";
import { generateWeeklyOutreachNarrative } from "@/lib/ai/weekly-outreach-report.server";
import { getWeeklyOutreachReportMembers, type TeamMemberConfig } from "@/lib/team-members";
import {
  analyzeOutreachSequence,
  CREATOR_FOLLOW_UP_DAYS,
  type OutreachSequenceMessage,
} from "@/lib/weekly-gmail-outreach-report.logic";

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
  calendlyBooked: number;
  missedInbound: number;
  followUpsDue: number;
  completedDueFollowUps: number;
  overdueCreatorThreads: number;
  fullSequenceDueThreads: number;
  incompleteFullSequenceThreads: number;
  completedFullSequenceThreads: number;
  issues: string[];
};

type WeeklyReportTotals = Omit<MemberReportMetrics, "member" | "gmailLabelId" | "issues">;

type ReportNarrative = {
  summary: string;
  verdict: string;
  modelUsed: string | null;
  warnings: string[];
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

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPORT_DAYS = 7;
const DEFAULT_SEQUENCE_LOOKBACK_DAYS = 90;
const THREAD_FETCH_CONCURRENCY = 12;
const REPORT_TIME_ZONE = "Asia/Ho_Chi_Minh";
const DEFAULT_CALENDLY_BOOKED_QUERY =
  '{"calendly" "calendly.com" "scheduled event" "booked" "confirmed"}';
const DEFAULT_CATEGORY_LABEL_NAMES: ReportCategoryLabelNames = {
  brandInbound: "Brand inbound",
  brandOutreach: "Brand outreach",
  ongoingDeals: "Ongoing Deals",
};

function emptyTotals(): WeeklyReportTotals {
  return {
    creatorOutreachSent: 0,
    brandOutreachSent: 0,
    calendlyBooked: 0,
    missedInbound: 0,
    followUpsDue: 0,
    completedDueFollowUps: 0,
    overdueCreatorThreads: 0,
    fullSequenceDueThreads: 0,
    incompleteFullSequenceThreads: 0,
    completedFullSequenceThreads: 0,
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

function getSequenceLookbackDays() {
  return Math.max(
    CREATOR_FOLLOW_UP_DAYS.at(-1) ?? 14,
    getPositiveIntegerEnv(
      "WEEKLY_GMAIL_SEQUENCE_LOOKBACK_DAYS",
      DEFAULT_SEQUENCE_LOOKBACK_DAYS,
      365,
    ),
  );
}

function getConfiguredQuery(envName: string, fallback: string) {
  return process.env[envName]?.trim() || fallback;
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

function withReportWindow(query: string, days: number) {
  return `${query} newer_than:${days}d -in:spam -in:trash`.replace(/\s+/g, " ").trim();
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

function getWindowLabel(days: number, now: Date) {
  const start = new Date(now.getTime() - days * DAY_IN_MS);
  return `${formatDate(start)} - ${formatDate(now)}`;
}

async function getGmailReadonlyAccessToken() {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: requiredGmailEnv("GMAIL_CLIENT_ID"),
        client_secret: requiredGmailEnv("GMAIL_CLIENT_SECRET"),
        refresh_token: requiredGmailEnv("WEEKLY_GMAIL_READONLY_REFRESH_TOKEN"),
        grant_type: "refresh_token",
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    } | null;

    if (!response.ok || !payload?.access_token) {
      throw new GmailAuthError(
        payload?.error_description || payload?.error || "Gmail could not create an access token.",
      );
    }

    return payload.access_token;
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

async function countGmailMessages(accessToken: string, labelIds: string[], query: string) {
  let count = 0;
  let pageToken = "";

  do {
    const params = new URLSearchParams();
    params.set("q", query);
    params.set("maxResults", "500");
    for (const labelId of labelIds) params.append("labelIds", labelId);
    if (pageToken) params.set("pageToken", pageToken);

    const response = await gmailGet<GmailMessagesResponse>(accessToken, "messages", params);
    count += response.messages?.length ?? 0;
    pageToken = response.nextPageToken ?? "";
  } while (pageToken);

  return count;
}

async function listGmailThreadIds(accessToken: string, labelIds: string[], query: string) {
  const threadIds: string[] = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams();
    params.set("q", query);
    params.set("maxResults", "500");
    for (const labelId of labelIds) params.append("labelIds", labelId);
    if (pageToken) params.set("pageToken", pageToken);

    const response = await gmailGet<GmailThreadsResponse>(accessToken, "threads", params);
    for (const thread of response.threads ?? []) {
      if (thread.id) threadIds.push(thread.id);
    }
    pageToken = response.nextPageToken ?? "";
  } while (pageToken);

  return Array.from(new Set(threadIds));
}

async function countGmailThreads(accessToken: string, labelIds: string[], query: string) {
  return (await listGmailThreadIds(accessToken, labelIds, query)).length;
}

async function getGmailThread(accessToken: string, threadId: string) {
  const params = new URLSearchParams();
  params.set("format", "metadata");
  params.append("metadataHeaders", "From");

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

function isCreatorOutreachThread(
  threadLabelIds: Set<string>,
  memberLabelId: string,
  customUserLabelIds: Set<string>,
) {
  const customLabels = Array.from(threadLabelIds).filter((labelId) =>
    customUserLabelIds.has(labelId),
  );
  return customLabels.length === 1 && customLabels[0] === memberLabelId;
}

function countSentMessagesSince(thread: GmailThread, sinceMs: number, nowMs: number) {
  return (thread.messages ?? []).filter((message) => {
    const labelIds = message.labelIds ?? [];
    const timestamp = getMessageTimestamp(message);
    return labelIds.includes("SENT") && timestamp >= sinceMs && timestamp <= nowMs;
  }).length;
}

function toSequenceMessages(thread: GmailThread): OutreachSequenceMessage[] {
  return (thread.messages ?? []).map((message) => {
    const labelIds = message.labelIds ?? [];
    return {
      internalDate: getMessageTimestamp(message),
      sent: labelIds.includes("SENT"),
      draft: labelIds.includes("DRAFT"),
    };
  });
}

async function collectMemberMetrics(
  accessToken: string,
  member: TeamMemberConfig,
  labelIndex: Map<string, GmailLabel>,
  customUserLabelIds: Set<string>,
  categoryLabels: ReportCategoryLabels,
  categoryLabelNames: ReportCategoryLabelNames,
  days: number,
  lookbackDays: number,
  now: Date,
  threadCache: Map<string, Promise<GmailThread>>,
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
  const nowMs = now.getTime();
  const reportStartMs = nowMs - days * DAY_IN_MS;
  const creatorExclusions = Object.values(categoryLabelNames)
    .map((name) => `-label:${quoteGmailSearchValue(name)}`)
    .join(" ");
  const creatorThreadQuery = [
    "in:sent",
    creatorExclusions,
    `newer_than:${Math.max(days, lookbackDays)}d`,
    "-in:spam",
    "-in:trash",
  ]
    .filter(Boolean)
    .join(" ");
  const brandOutreachQuery = withReportWindow(
    `in:sent label:${quoteGmailSearchValue(categoryLabelNames.brandOutreach)}`,
    days,
  );
  const missedInboundQuery = withReportWindow(
    `in:inbox is:unread -from:me label:${quoteGmailSearchValue(categoryLabelNames.brandInbound)}`,
    days,
  );
  const calendlyQuery = withReportWindow(
    getConfiguredQuery("WEEKLY_GMAIL_CALENDLY_BOOKED_QUERY", DEFAULT_CALENDLY_BOOKED_QUERY),
    days,
  );

  try {
    const [[brandOutreachSent, missedInbound, calendlyBooked], threadIds] = await Promise.all([
      Promise.all([
        categoryLabels.brandOutreach
          ? countGmailMessages(
              accessToken,
              [label.id, categoryLabels.brandOutreach.id],
              brandOutreachQuery,
            )
          : Promise.resolve(0),
        categoryLabels.brandInbound
          ? countGmailThreads(
              accessToken,
              [label.id, categoryLabels.brandInbound.id],
              missedInboundQuery,
            )
          : Promise.resolve(0),
        countGmailThreads(accessToken, [label.id], calendlyQuery),
      ]),
      listGmailThreadIds(accessToken, [label.id], creatorThreadQuery),
    ]);
    const threads = await loadGmailThreads(accessToken, threadIds, threadCache);

    metrics.brandOutreachSent = brandOutreachSent;
    metrics.missedInbound = missedInbound;
    metrics.calendlyBooked = calendlyBooked;

    for (const thread of threads) {
      const threadLabelIds = getThreadLabelIds(thread);
      if (!isCreatorOutreachThread(threadLabelIds, label.id, customUserLabelIds)) continue;

      metrics.creatorOutreachSent += countSentMessagesSince(thread, reportStartMs, nowMs);
      const sequence = analyzeOutreachSequence(toSequenceMessages(thread), nowMs);

      if (!sequence || sequence.hasReply || sequence.followUpsDue === 0) continue;

      metrics.followUpsDue += sequence.followUpsDue;
      metrics.completedDueFollowUps += sequence.completedDueFollowUps;
      if (sequence.isOverdue) metrics.overdueCreatorThreads += 1;
      if (sequence.isFullSequenceDue) {
        metrics.fullSequenceDueThreads += 1;
        if (sequence.isFullSequenceComplete) {
          metrics.completedFullSequenceThreads += 1;
        } else {
          metrics.incompleteFullSequenceThreads += 1;
        }
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
    calendlyBooked: left.calendlyBooked + right.calendlyBooked,
    missedInbound: left.missedInbound + right.missedInbound,
    followUpsDue: left.followUpsDue + right.followUpsDue,
    completedDueFollowUps: left.completedDueFollowUps + right.completedDueFollowUps,
    overdueCreatorThreads: left.overdueCreatorThreads + right.overdueCreatorThreads,
    fullSequenceDueThreads: left.fullSequenceDueThreads + right.fullSequenceDueThreads,
    incompleteFullSequenceThreads:
      left.incompleteFullSequenceThreads + right.incompleteFullSequenceThreads,
    completedFullSequenceThreads:
      left.completedFullSequenceThreads + right.completedFullSequenceThreads,
  };
}

function getVerdictCategory(totals: WeeklyReportTotals) {
  if (totals.fullSequenceDueThreads === 0) return "insufficient" as const;
  if (totals.incompleteFullSequenceThreads === 0) return "complete" as const;
  if (totals.incompleteFullSequenceThreads * 2 > totals.fullSequenceDueThreads) {
    return "majority_incomplete" as const;
  }
  return "some_incomplete" as const;
}

function buildFallbackVerdict(totals: WeeklyReportTotals) {
  const category = getVerdictCategory(totals);

  if (category === "insufficient") {
    return "Chưa có creator outreach nào qua mốc 14 ngày để đánh giá đủ sequence.";
  }
  if (category === "complete") {
    return "Các creator outreach đã hoàn thành đủ sequence 3 lần follow-up theo lịch 3, 7 và 14 ngày.";
  }
  if (category === "majority_incomplete") {
    return "Có vẻ phần lớn creator outreach chưa hoàn thành đủ sequence 3 lần follow-up dù đã qua mốc 14 ngày.";
  }
  return "Một số creator outreach chưa hoàn thành đủ sequence 3 lần follow-up dù đã qua mốc 14 ngày.";
}

function buildFallbackSummary(totals: WeeklyReportTotals) {
  if (totals.followUpsDue === 0) {
    return "Tuần này chưa có lượt follow-up creator nào đến hạn theo lịch 3, 7 và 14 ngày.";
  }

  const rate = Math.round((totals.completedDueFollowUps / totals.followUpsDue) * 100);
  return `Đội ngũ đã hoàn thành ${rate}% số lượt follow-up đang đến hạn; hiện có ${formatNumber(
    totals.overdueCreatorThreads,
  )} conversation bị trễ.`;
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
      verdictCategory: getVerdictCategory(totals),
    });

    return {
      summary: result.summary,
      verdict: result.verdict,
      modelUsed: result.modelUsed,
      warnings: result.warnings,
    };
  } catch (error) {
    console.error(
      `[weekly-gmail-report] OpenRouter narrative failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      summary: buildFallbackSummary(totals),
      verdict: buildFallbackVerdict(totals),
      modelUsed: null,
      warnings: [
        "Gmail scan đã hoàn tất; OpenRouter không khả dụng nên chỉ phần Nhận định dùng mẫu cố định.",
      ],
    };
  }
}

function buildVietnameseReport(
  metrics: MemberReportMetrics[],
  totals: WeeklyReportTotals,
  narrative: ReportNarrative,
  issues: string[],
  days: number,
  lookbackDays: number,
  now: Date,
) {
  const followUpRate =
    totals.followUpsDue > 0
      ? Math.round((totals.completedDueFollowUps / totals.followUpsDue) * 100)
      : null;
  const reportIssues = [...narrative.warnings, ...issues];

  const lines = [
    "**Báo cáo Gmail Outreach hằng tuần**",
    `Thời gian: ${getWindowLabel(days, now)} (${days} ngày gần nhất)`,
    "",
    "**Tổng quan**",
    `Creator outreach đã gửi: ${formatNumber(totals.creatorOutreachSent)}`,
    `Brand outreach đã gửi: ${formatNumber(totals.brandOutreachSent)}`,
    `Calendly booked: ${formatNumber(totals.calendlyBooked)}`,
    `Brand inbound chưa xử lý: ${formatNumber(totals.missedInbound)}`,
    "",
    "**Tần suất follow up**",
    followUpRate === null
      ? "Chưa có lượt follow-up nào đến hạn."
      : `Đã hoàn thành ${formatNumber(totals.completedDueFollowUps)}/${formatNumber(
          totals.followUpsDue,
        )} lượt follow-up đến hạn (${followUpRate}%).`,
    `Conversation đang trễ follow-up: ${formatNumber(totals.overdueCreatorThreads)}`,
    `Qua 14 ngày nhưng chưa đủ 3 follow-up: ${formatNumber(
      totals.incompleteFullSequenceThreads,
    )}/${formatNumber(totals.fullSequenceDueThreads)}`,
    `Đã hoàn thành đủ 3 follow-up: ${formatNumber(totals.completedFullSequenceThreads)}`,
    "",
    "**Nhận định**",
    narrative.summary,
    narrative.verdict,
    narrative.modelUsed
      ? `OpenRouter model: ${narrative.modelUsed}`
      : "OpenRouter: fallback mẫu cố định (Gmail scan vẫn hoàn tất)",
    `Phạm vi kiểm tra sequence: ${formatNumber(lookbackDays)} ngày gần nhất.`,
    "",
    "**Theo member**",
  ];

  if (metrics.length === 0) {
    lines.push("Không có member nào đủ điều kiện trong TeamMembers.");
  } else {
    for (const item of metrics) {
      lines.push(
        `${formatMemberName(item.member)}: Creator ${formatNumber(
          item.creatorOutreachSent,
        )} | Brand ${formatNumber(item.brandOutreachSent)} | Follow-up ${formatNumber(
          item.completedDueFollowUps,
        )}/${formatNumber(item.followUpsDue)} | Trễ ${formatNumber(
          item.overdueCreatorThreads,
        )} | Missed inbound ${formatNumber(item.missedInbound)}`,
      );
    }
  }

  lines.push("", "**Tagging/config cần kiểm tra**");
  if (reportIssues.length === 0) {
    lines.push("Không có vấn đề cấu hình được phát hiện.");
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
      "Kiểm tra `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `WEEKLY_GMAIL_READONLY_REFRESH_TOKEN`, và scope `gmail.readonly`.",
    ].join("\n"),
    [],
  );
}

export async function runWeeklyGmailOutreachReport(): Promise<WeeklyReportResult> {
  const members = await getWeeklyOutreachReportMembers();
  const days = getReportDays();
  const lookbackDays = getSequenceLookbackDays();
  const now = new Date();
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
    const metrics: MemberReportMetrics[] = [];
    const threadCache = new Map<string, Promise<GmailThread>>();

    for (const member of members) {
      metrics.push(
        await collectMemberMetrics(
          accessToken,
          member,
          labelIndex,
          customUserLabelIds,
          categoryLabelResult.labels,
          categoryLabelNames,
          days,
          lookbackDays,
          now,
          threadCache,
        ),
      );
    }

    const totals = metrics.reduce(addMetrics, emptyTotals());
    const narrative = await getReportNarrative(totals, days, members.length);
    const issues = [
      ...baseIssues,
      ...categoryLabelResult.issues,
      ...metrics.flatMap((item) => item.issues),
    ];
    const content = buildVietnameseReport(
      metrics,
      totals,
      narrative,
      issues,
      days,
      lookbackDays,
      now,
    );
    const mentionUserIds = members
      .map((member) => member.discordUserId.trim())
      .filter(validDiscordUserId);

    await postDiscordMessage(content, Array.from(new Set(mentionUserIds)));

    return {
      ok: true,
      posted: true,
      memberCount: members.length,
      totals,
      openRouterUsed: Boolean(narrative.modelUsed),
      openRouterModel: narrative.modelUsed,
      issues: [...narrative.warnings, ...issues],
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
