import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type SlackApiResponse<T> = T & {
  ok: boolean;
  error?: string;
  needed?: string;
  provided?: string;
  response_metadata?: {
    next_cursor?: string;
    scopes?: string[];
    acceptedScopes?: string[];
    accepted_scopes?: string[];
  };
};

type SlackAuthTestResponse = {
  team_id?: string;
  user_id?: string;
  team?: string;
  url?: string;
};

type SlackConversation = {
  id: string;
  user?: string;
  is_im?: boolean;
  is_archived?: boolean;
};

type SlackConversationListResponse = {
  channels?: SlackConversation[];
  response_metadata?: {
    next_cursor?: string;
    scopes?: string[];
    acceptedScopes?: string[];
  };
};

type SlackMessage = {
  type?: string;
  subtype?: string;
  user?: string;
  text?: string;
  ts?: string;
  bot_id?: string;
  app_id?: string;
  files?: unknown[];
};

type SlackHistoryResponse = {
  messages?: SlackMessage[];
  response_metadata?: {
    next_cursor?: string;
    scopes?: string[];
    acceptedScopes?: string[];
  };
};

type SlackUserInfoResponse = {
  user?: {
    id?: string;
    name?: string;
    real_name?: string;
    profile?: {
      display_name?: string;
      real_name?: string;
      email?: string;
    };
  };
  response_metadata?: {
    scopes?: string[];
    acceptedScopes?: string[];
  };
};

type SlackActionState = {
  status: "done" | "dismissed" | "snoozed";
  lastMessageTs: string;
  snoozedUntil?: string;
  updatedAt: string;
};

type SlackSyncOptions = {
  source: "cron" | "manual" | "diagnostics";
};

type SlackSyncResult = {
  ok: boolean;
  checkedAt: string;
  count: number;
  warnings: string[];
  error: string | null;
};

type SlackRuntimeEnv = {
  slackUserToken: string;
  slackOwnerUserId: string;
  slackBotToken: string;
  slackSigningSecret: string;
  cronSecret: string;
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
};

export type SlackNotificationItem = {
  id: string;
  conversationId: string;
  personName: string;
  personUserId: string | null;
  lastMessageAt: string;
  lastMessageTs: string;
  overdueHours: number;
  timeOverdue: string;
  jumpUrl: string | null;
  snippet: string | null;
};

export type SlackNotificationsPayload = {
  checkedAt: string;
  lastSyncAt: string | null;
  count: number;
  items: SlackNotificationItem[];
  warning: string | null;
};

export type SlackNotificationDiagnostics = {
  checkedAt: string;
  env: Array<{ name: string; exists: boolean }>;
  slackConnected: boolean;
  ownerUserConfigured: boolean;
  ownerUserMatchesToken: boolean | null;
  scopesDetected: string[];
  dmFetchSuccess: boolean;
  redisConfigured: boolean;
  redisReadable: boolean;
  redisWritable: boolean;
  lastSyncAt: string | null;
  lastCheckAt: string | null;
  totalDmChannelsScanned: number;
  overdueCount: number;
  activeNotificationCount: number;
  lastError: string | null;
  lastWarning: string | null;
};

const SLACK_API_URL = "https://slack.com/api";
const FOLLOW_UP_AFTER_HOURS = 24;
const SNOOZE_DEFAULT_HOURS = 24;
const REDIS_KEY_PREFIX = "team-billion:slack-followups";
const NOTIFICATIONS_KEY = `${REDIS_KEY_PREFIX}:notifications`;
const DIAGNOSTICS_KEY = `${REDIS_KEY_PREFIX}:diagnostics`;
const STATE_KEY_PREFIX = `${REDIS_KEY_PREFIX}:state`;
const REDIS_STATE_TTL_SECONDS = 60 * 60 * 24 * 45;
const REDIS_NOTIFICATION_TTL_SECONDS = 60 * 60 * 26;
const SLACK_HISTORY_LIMIT = 20;
const SLACK_LIST_LIMIT = 200;

const notificationActionInput = z.object({
  conversationId: z.string().min(1).max(120),
  lastMessageTs: z.string().min(1).max(40),
});

const snoozeNotificationInput = notificationActionInput.extend({
  hours: z.number().int().min(1).max(168).optional().default(SNOOZE_DEFAULT_HOURS),
});

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readSlackEnv(): SlackRuntimeEnv {
  return {
    slackUserToken: process.env.SLACK_USER_TOKEN?.trim() ?? "",
    slackOwnerUserId: process.env.SLACK_OWNER_USER_ID?.trim() ?? "",
    slackBotToken: process.env.SLACK_BOT_TOKEN?.trim() ?? "",
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET?.trim() ?? "",
    cronSecret: process.env.CRON_SECRET?.trim() ?? "",
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "",
  };
}

export function getSlackNotificationEnvDiagnostics() {
  const env = readSlackEnv();
  return [
    { name: "SLACK_USER_TOKEN", exists: Boolean(env.slackUserToken) },
    { name: "SLACK_OWNER_USER_ID", exists: Boolean(env.slackOwnerUserId) },
    { name: "SLACK_BOT_TOKEN", exists: Boolean(env.slackBotToken) },
    { name: "SLACK_SIGNING_SECRET", exists: Boolean(env.slackSigningSecret) },
    { name: "CRON_SECRET", exists: Boolean(env.cronSecret) },
    { name: "UPSTASH_REDIS_REST_URL", exists: Boolean(env.upstashRedisRestUrl) },
    { name: "UPSTASH_REDIS_REST_TOKEN", exists: Boolean(env.upstashRedisRestToken) },
  ];
}

function requireSlackConfig(env: SlackRuntimeEnv) {
  if (!env.slackUserToken) {
    throw new Error("SLACK_USER_TOKEN is missing.");
  }

  if (!env.slackOwnerUserId) {
    throw new Error("SLACK_OWNER_USER_ID is missing.");
  }
}

function getRedisConfig(env = readSlackEnv()) {
  if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) {
    return null;
  }

  return {
    url: env.upstashRedisRestUrl.replace(/\/+$/, ""),
    token: env.upstashRedisRestToken,
  };
}

async function redisCommand<T>(command: Array<string | number>) {
  const config = getRedisConfig();

  if (!config) {
    throw new Error("Upstash Redis REST env vars are missing.");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | { result?: T; error?: string }
    | null;

  if (!response.ok || payload?.error) {
    throw new Error(payload?.error ?? `Redis request failed with ${response.status}.`);
  }

  return payload?.result as T;
}

async function redisGetJson<T>(key: string): Promise<T | null> {
  const value = await redisCommand<string | null>(["GET", key]);

  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function redisSetJson(key: string, value: unknown, ttlSeconds?: number) {
  const command: Array<string | number> = ["SET", key, JSON.stringify(value)];

  if (ttlSeconds) {
    command.push("EX", ttlSeconds);
  }

  await redisCommand<"OK">(command);
}

function stateKey(conversationId: string) {
  return `${STATE_KEY_PREFIX}:${conversationId}`;
}

async function readNotificationActionState(conversationId: string) {
  return redisGetJson<SlackActionState>(stateKey(conversationId));
}

async function writeNotificationActionState(conversationId: string, state: SlackActionState) {
  await redisSetJson(stateKey(conversationId), state, REDIS_STATE_TTL_SECONDS);
}

async function readStoredNotifications(): Promise<SlackNotificationsPayload> {
  const stored = await redisGetJson<SlackNotificationsPayload>(NOTIFICATIONS_KEY);

  if (stored) return stored;

  return {
    checkedAt: nowIso(),
    lastSyncAt: null,
    count: 0,
    items: [],
    warning: "Slack notifications have not been checked yet.",
  };
}

async function writeStoredNotifications(items: SlackNotificationItem[], warning: string | null) {
  const payload = {
    checkedAt: nowIso(),
    lastSyncAt: nowIso(),
    count: items.length,
    items,
    warning,
  } satisfies SlackNotificationsPayload;

  await redisSetJson(NOTIFICATIONS_KEY, payload, REDIS_NOTIFICATION_TTL_SECONDS);
  return payload;
}

function collectScopes(
  scopeSet: Set<string>,
  response: {
    response_metadata?: { scopes?: string[]; acceptedScopes?: string[]; accepted_scopes?: string[] };
  },
) {
  response.response_metadata?.scopes?.forEach((scope) => scopeSet.add(scope));
  response.response_metadata?.acceptedScopes?.forEach((scope) => scopeSet.add(scope));
  response.response_metadata?.accepted_scopes?.forEach((scope) => scopeSet.add(scope));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function slackApi<T>(
  method: string,
  params: Record<string, string | number | boolean | undefined> = {},
  token = readSlackEnv().slackUserToken,
  attempt = 0,
): Promise<SlackApiResponse<T>> {
  const url = new URL(`${SLACK_API_URL}/${method}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    cache: "no-store",
  });

  if (response.status === 429 && attempt < 1) {
    const retryAfterSeconds = Number(response.headers.get("retry-after") ?? "2");
    await sleep(Math.min(Math.max(retryAfterSeconds, 1), 10) * 1000);
    return slackApi<T>(method, params, token, attempt + 1);
  }

  const payload = (await response.json().catch(() => null)) as SlackApiResponse<T> | null;

  if (!response.ok) {
    return {
      ok: false,
      error: `slack_http_${response.status}`,
    } as SlackApiResponse<T>;
  }

  return payload ?? ({ ok: false, error: "invalid_slack_response" } as SlackApiResponse<T>);
}

function slackTsToMs(ts: string) {
  const parsed = Number(ts);
  return Number.isFinite(parsed) ? Math.floor(parsed * 1000) : 0;
}

function formatHoursOverdue(hours: number) {
  if (hours < 48) return `${hours}h overdue`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder > 0 ? `${days}d ${remainder}h overdue` : `${days}d overdue`;
}

function cleanSlackText(text: string) {
  return text
    .replace(/<mailto:([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSnippet(message: SlackMessage) {
  const cleanText = cleanSlackText(message.text ?? "");

  if (!cleanText) return null;

  return cleanText.length > 140 ? `${cleanText.slice(0, 137)}...` : cleanText;
}

function isMeaningfulMessage(message: SlackMessage) {
  if (message.type !== "message") return false;
  if (!message.user || !message.ts) return false;
  if (message.bot_id || message.app_id) return false;
  if (message.subtype) return false;

  return Boolean(message.text?.trim() || message.files?.length);
}

function shouldSuppressForAction(state: SlackActionState | null, lastMessageTs: string, nowMs: number) {
  if (!state || state.lastMessageTs !== lastMessageTs) return false;

  if (state.status === "done" || state.status === "dismissed") return true;

  if (state.status === "snoozed" && state.snoozedUntil) {
    return Date.parse(state.snoozedUntil) > nowMs;
  }

  return false;
}

async function fetchAllDmConversations(scopeSet: Set<string>) {
  const conversations: SlackConversation[] = [];
  let cursor = "";

  for (let page = 0; page < 5; page += 1) {
    const response = await slackApi<SlackConversationListResponse>("conversations.list", {
      types: "im",
      exclude_archived: true,
      limit: SLACK_LIST_LIMIT,
      cursor,
    });

    if (!response.ok) {
      throw new Error(`Slack conversations.list failed: ${response.error ?? "unknown_error"}`);
    }

    collectScopes(scopeSet, response);
    conversations.push(...(response.channels ?? []).filter((channel) => channel.id));
    cursor = response.response_metadata?.next_cursor ?? "";

    if (!cursor) break;
  }

  return conversations;
}

async function fetchLatestMeaningfulMessage(channelId: string, scopeSet: Set<string>) {
  const response = await slackApi<SlackHistoryResponse>("conversations.history", {
    channel: channelId,
    limit: SLACK_HISTORY_LIMIT,
  });

  if (!response.ok) {
    throw new Error(`Slack conversations.history failed: ${response.error ?? "unknown_error"}`);
  }

  collectScopes(scopeSet, response);
  return (response.messages ?? []).find(isMeaningfulMessage) ?? null;
}

async function fetchSlackPersonName(userId: string | undefined, scopeSet: Set<string>) {
  if (!userId) return "Slack DM";

  const response = await slackApi<SlackUserInfoResponse>("users.info", { user: userId });

  if (!response.ok) return `Slack user ${userId}`;

  collectScopes(scopeSet, response);
  const user = response.user;

  return (
    user?.profile?.display_name?.trim() ||
    user?.profile?.real_name?.trim() ||
    user?.real_name?.trim() ||
    user?.name?.trim() ||
    `Slack user ${userId}`
  );
}

function makeSlackJumpUrl(teamId: string | undefined, channelId: string) {
  if (!teamId) return null;
  return `https://app.slack.com/client/${teamId}/${channelId}`;
}

function makeDiagnosticsBase(): SlackNotificationDiagnostics {
  const env = readSlackEnv();

  return {
    checkedAt: nowIso(),
    env: getSlackNotificationEnvDiagnostics(),
    slackConnected: false,
    ownerUserConfigured: Boolean(env.slackOwnerUserId),
    ownerUserMatchesToken: null,
    scopesDetected: [],
    dmFetchSuccess: false,
    redisConfigured: Boolean(getRedisConfig(env)),
    redisReadable: false,
    redisWritable: false,
    lastSyncAt: null,
    lastCheckAt: null,
    totalDmChannelsScanned: 0,
    overdueCount: 0,
    activeNotificationCount: 0,
    lastError: null,
    lastWarning: null,
  };
}

async function writeSlackDiagnostics(diagnostics: SlackNotificationDiagnostics) {
  try {
    await redisSetJson(DIAGNOSTICS_KEY, diagnostics, REDIS_NOTIFICATION_TTL_SECONDS);
  } catch (error) {
    console.warn("[team-billion:slack] could not write diagnostics", {
      error: errorMessage(error),
    });
  }
}

export async function getSlackNotificationDiagnostics(): Promise<SlackNotificationDiagnostics> {
  const base = makeDiagnosticsBase();

  if (!base.redisConfigured) {
    return {
      ...base,
      lastWarning: "Upstash Redis is not configured.",
    };
  }

  try {
    const stored = await redisGetJson<SlackNotificationDiagnostics>(DIAGNOSTICS_KEY);
    const notifications = await readStoredNotifications();

    return {
      ...(stored ?? base),
      checkedAt: nowIso(),
      env: getSlackNotificationEnvDiagnostics(),
      redisConfigured: true,
      redisReadable: true,
      activeNotificationCount: notifications.count,
    };
  } catch (error) {
    return {
      ...base,
      lastError: errorMessage(error),
    };
  }
}

export async function syncSlackNotifications(
  options: SlackSyncOptions = { source: "manual" },
): Promise<SlackSyncResult> {
  const env = readSlackEnv();
  const scopeSet = new Set<string>();
  const warnings: string[] = [];
  const diagnostics = makeDiagnosticsBase();
  diagnostics.lastCheckAt = nowIso();

  try {
    requireSlackConfig(env);

    if (!getRedisConfig(env)) {
      throw new Error("Upstash Redis REST env vars are missing.");
    }

    const auth = await slackApi<SlackAuthTestResponse>("auth.test");

    if (!auth.ok) {
      throw new Error(`Slack auth.test failed: ${auth.error ?? "unknown_error"}`);
    }

    collectScopes(scopeSet, auth);
    diagnostics.slackConnected = true;
    diagnostics.ownerUserMatchesToken = auth.user_id ? auth.user_id === env.slackOwnerUserId : null;

    if (auth.user_id && auth.user_id !== env.slackOwnerUserId) {
      warnings.push("SLACK_OWNER_USER_ID does not match the user token owner.");
    }

    const conversations = await fetchAllDmConversations(scopeSet);
    diagnostics.dmFetchSuccess = true;
    diagnostics.totalDmChannelsScanned = conversations.length;

    const nowMs = Date.now();
    const notifications: SlackNotificationItem[] = [];

    for (const conversation of conversations) {
      const latestMessage = await fetchLatestMeaningfulMessage(conversation.id, scopeSet);

      if (!latestMessage?.ts) continue;
      if (latestMessage.user === env.slackOwnerUserId) continue;

      const messageAgeHours = Math.floor((nowMs - slackTsToMs(latestMessage.ts)) / 3_600_000);

      if (messageAgeHours < FOLLOW_UP_AFTER_HOURS) continue;

      const actionState = await readNotificationActionState(conversation.id);

      if (shouldSuppressForAction(actionState, latestMessage.ts, nowMs)) {
        continue;
      }

      const personName = await fetchSlackPersonName(conversation.user ?? latestMessage.user, scopeSet);

      notifications.push({
        id: conversation.id,
        conversationId: conversation.id,
        personName,
        personUserId: conversation.user ?? latestMessage.user ?? null,
        lastMessageAt: new Date(slackTsToMs(latestMessage.ts)).toISOString(),
        lastMessageTs: latestMessage.ts,
        overdueHours: messageAgeHours,
        timeOverdue: formatHoursOverdue(messageAgeHours),
        jumpUrl: makeSlackJumpUrl(auth.team_id, conversation.id),
        snippet: makeSnippet(latestMessage),
      });
    }

    notifications.sort(
      (left, right) => Date.parse(left.lastMessageAt) - Date.parse(right.lastMessageAt),
    );

    await writeStoredNotifications(notifications, warnings[0] ?? null);

    diagnostics.redisReadable = true;
    diagnostics.redisWritable = true;
    diagnostics.scopesDetected = Array.from(scopeSet).sort();
    diagnostics.overdueCount = notifications.length;
    diagnostics.activeNotificationCount = notifications.length;
    diagnostics.lastSyncAt = nowIso();
    diagnostics.lastWarning = warnings[0] ?? null;

    await writeSlackDiagnostics(diagnostics);

    console.info("[team-billion:slack] sync complete", {
      source: options.source,
      dmChannelsScanned: conversations.length,
      overdueCount: notifications.length,
      warnings,
    });

    return {
      ok: true,
      checkedAt: diagnostics.lastCheckAt,
      count: notifications.length,
      warnings,
      error: null,
    };
  } catch (error) {
    const message = errorMessage(error);
    diagnostics.scopesDetected = Array.from(scopeSet).sort();
    diagnostics.lastError = message;
    diagnostics.lastWarning = warnings[0] ?? null;

    await writeSlackDiagnostics(diagnostics);

    console.error("[team-billion:slack] sync failed", {
      source: options.source,
      error: message,
      warnings,
    });

    return {
      ok: false,
      checkedAt: diagnostics.lastCheckAt ?? nowIso(),
      count: 0,
      warnings,
      error: message,
    };
  }
}

export const fetchSlackNotifications = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();

  if (!getRedisConfig()) {
    return {
      checkedAt: nowIso(),
      lastSyncAt: null,
      count: 0,
      items: [],
      warning: "Slack reminders need Upstash Redis env vars before they can appear.",
    } satisfies SlackNotificationsPayload;
  }

  try {
    return await readStoredNotifications();
  } catch (error) {
    return {
      checkedAt: nowIso(),
      lastSyncAt: null,
      count: 0,
      items: [],
      warning: errorMessage(error),
    } satisfies SlackNotificationsPayload;
  }
});

export const markSlackNotificationDone = createServerFn({ method: "POST" })
  .inputValidator(notificationActionInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();

    await writeNotificationActionState(data.conversationId, {
      status: "done",
      lastMessageTs: data.lastMessageTs,
      updatedAt: nowIso(),
    });
    await syncSlackNotifications({ source: "manual" });

    return { ok: true as const };
  });

export const dismissSlackNotification = createServerFn({ method: "POST" })
  .inputValidator(notificationActionInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();

    await writeNotificationActionState(data.conversationId, {
      status: "dismissed",
      lastMessageTs: data.lastMessageTs,
      updatedAt: nowIso(),
    });
    await syncSlackNotifications({ source: "manual" });

    return { ok: true as const };
  });

export const snoozeSlackNotification = createServerFn({ method: "POST" })
  .inputValidator(snoozeNotificationInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();

    await writeNotificationActionState(data.conversationId, {
      status: "snoozed",
      lastMessageTs: data.lastMessageTs,
      snoozedUntil: new Date(Date.now() + data.hours * 3_600_000).toISOString(),
      updatedAt: nowIso(),
    });
    await syncSlackNotifications({ source: "manual" });

    return { ok: true as const };
  });

export const slackNotificationsQuery = {
  queryKey: ["team-billion-slack-followups", "v1"],
  queryFn: () => fetchSlackNotifications(),
  refetchInterval: 5 * 60 * 1000,
  staleTime: 60 * 1000,
};
