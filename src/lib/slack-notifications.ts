import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  PRODUCTION_SLACK_FOLLOW_UP_THRESHOLD_MS,
  evaluateSlackDmFollowup,
  findLatestMeaningfulSlackMessage,
  formatSlackOverdue,
  makeSlackSnippet,
  slackTsToMs,
  type SlackActionStateForRules,
  type SlackMessageRuleInput,
} from "@/lib/slack-notification-rules";

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
  user_profile?: {
    display_name?: string;
    real_name?: string;
    name?: string;
  };
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

type SlackActionState = SlackActionStateForRules & {
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
  thresholdMinutes: number;
  productionThresholdLocked: boolean;
  lastSyncAt: string | null;
  lastCheckAt: string | null;
  totalDmChannelsScanned: number;
  overdueCount: number;
  activeNotificationCount: number;
  lastError: string | null;
  lastWarning: string | null;
};

const SLACK_API_URL = "https://slack.com/api";
const SNOOZE_DEFAULT_HOURS = 24;
const REDIS_KEY_PREFIX = "team-billion:slack-followups";
const NOTIFICATIONS_KEY = `${REDIS_KEY_PREFIX}:notifications`;
const DIAGNOSTICS_KEY = `${REDIS_KEY_PREFIX}:diagnostics`;
const STATE_KEY_PREFIX = `${REDIS_KEY_PREFIX}:state`;
const REDIS_STATE_TTL_SECONDS = 60 * 60 * 24 * 45;
const REDIS_NOTIFICATION_TTL_SECONDS = 60 * 60 * 26;
const SLACK_HISTORY_LIMIT = 20;
const SLACK_LIST_LIMIT = 200;
const SLACK_RECENT_LOOKBACK_DAYS = 14;
const DEV_THRESHOLD_ENV = "SLACK_FOLLOWUP_THRESHOLD_MINUTES";
const TEST_NOTIFICATION_ID = "DTEAM_BILLION_TEST_NOTIFICATION";
const slackUserNameCache = new Map<string, string>();

let localDevNotifications: SlackNotificationsPayload | null = null;
let localDevDiagnostics: SlackNotificationDiagnostics | null = null;
const localDevActionStates = new Map<string, SlackActionState>();

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

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function getFollowUpThresholdMs() {
  if (isProductionRuntime()) {
    return PRODUCTION_SLACK_FOLLOW_UP_THRESHOLD_MS;
  }

  const thresholdMinutes = Number(process.env[DEV_THRESHOLD_ENV] ?? "");

  if (Number.isFinite(thresholdMinutes) && thresholdMinutes >= 1) {
    return thresholdMinutes * 60_000;
  }

  return PRODUCTION_SLACK_FOLLOW_UP_THRESHOLD_MS;
}

function getFollowUpLookbackMs() {
  const configuredDays = Number(process.env.SLACK_FOLLOWUP_LOOKBACK_DAYS ?? "");
  const days =
    Number.isFinite(configuredDays) && configuredDays >= 1
      ? Math.min(configuredDays, 90)
      : SLACK_RECENT_LOOKBACK_DAYS;

  return days * 24 * 60 * 60 * 1000;
}

function canUseLocalDevStore() {
  return !isProductionRuntime() && !getRedisConfig();
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
  if (canUseLocalDevStore()) {
    return localDevActionStates.get(conversationId) ?? null;
  }

  return redisGetJson<SlackActionState>(stateKey(conversationId));
}

async function writeNotificationActionState(conversationId: string, state: SlackActionState) {
  if (canUseLocalDevStore()) {
    localDevActionStates.set(conversationId, state);
    return;
  }

  await redisSetJson(stateKey(conversationId), state, REDIS_STATE_TTL_SECONDS);
}

async function readStoredNotifications(): Promise<SlackNotificationsPayload> {
  if (canUseLocalDevStore()) {
    return (
      localDevNotifications ?? {
        checkedAt: nowIso(),
        lastSyncAt: null,
        count: 0,
        items: [],
        warning: "Local test storage is active. Upstash Redis is not configured here.",
      }
    );
  }

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

async function writeStoredNotificationsPayload(payload: SlackNotificationsPayload) {
  if (canUseLocalDevStore()) {
    localDevNotifications = payload;
    return payload;
  }

  await redisSetJson(NOTIFICATIONS_KEY, payload, REDIS_NOTIFICATION_TTL_SECONDS);
  return payload;
}

async function writeStoredNotifications(items: SlackNotificationItem[], warning: string | null) {
  return writeStoredNotificationsPayload({
    checkedAt: nowIso(),
    lastSyncAt: nowIso(),
    count: items.length,
    items,
    warning,
  });
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

async function fetchLatestMeaningfulMessage(
  channelId: string,
  scopeSet: Set<string>,
  oldestTs: string,
) {
  const response = await slackApi<SlackHistoryResponse>("conversations.history", {
    channel: channelId,
    limit: SLACK_HISTORY_LIMIT,
    oldest: oldestTs,
  });

  if (!response.ok) {
    throw new Error(`Slack conversations.history failed: ${response.error ?? "unknown_error"}`);
  }

  collectScopes(scopeSet, response);
  return findLatestMeaningfulSlackMessage((response.messages ?? []) as SlackMessageRuleInput[]);
}

function profileDisplayName(profile: SlackMessage["user_profile"] | undefined) {
  return (
    profile?.display_name?.trim() ||
    profile?.real_name?.trim() ||
    profile?.name?.trim() ||
    ""
  );
}

async function fetchSlackPersonName(
  userId: string | undefined,
  scopeSet: Set<string>,
  fallbackProfile: SlackMessage["user_profile"] | undefined,
  warnings: string[],
) {
  const profileName = profileDisplayName(fallbackProfile);
  if (profileName) return profileName;
  if (!userId) return "Slack DM";
  const cached = slackUserNameCache.get(userId);
  if (cached) return cached;

  const response = await slackApi<SlackUserInfoResponse>("users.info", { user: userId });

  if (!response.ok) {
    if (
      response.error === "missing_scope" &&
      !warnings.some((warning) => warning.includes("users:read"))
    ) {
      warnings.push("Slack real names need the users:read scope on SLACK_USER_TOKEN.");
    }

    return `Slack user ${userId}`;
  }

  collectScopes(scopeSet, response);
  const user = response.user;

  const name =
    user?.profile?.display_name?.trim() ||
    user?.profile?.real_name?.trim() ||
    user?.real_name?.trim() ||
    user?.name?.trim() ||
    `Slack user ${userId}`;

  slackUserNameCache.set(userId, name);
  return name;
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
    thresholdMinutes: Math.round(getFollowUpThresholdMs() / 60_000),
    productionThresholdLocked: isProductionRuntime(),
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
  if (canUseLocalDevStore()) {
    localDevDiagnostics = diagnostics;
    return;
  }

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

  if (canUseLocalDevStore()) {
    const notifications = await readStoredNotifications();

    return {
      ...(localDevDiagnostics ?? base),
      checkedAt: nowIso(),
      env: getSlackNotificationEnvDiagnostics(),
      redisConfigured: false,
      redisReadable: true,
      redisWritable: true,
      thresholdMinutes: base.thresholdMinutes,
      productionThresholdLocked: false,
      activeNotificationCount: notifications.count,
      lastWarning:
        localDevDiagnostics?.lastWarning ??
        "Using local in-memory test storage. Add Upstash Redis env vars for deployment.",
    };
  }

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
      thresholdMinutes: stored?.thresholdMinutes ?? base.thresholdMinutes,
      productionThresholdLocked:
        stored?.productionThresholdLocked ?? base.productionThresholdLocked,
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

    if (!getRedisConfig(env) && !canUseLocalDevStore()) {
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
    const thresholdMs = getFollowUpThresholdMs();
    const oldestTs = ((nowMs - getFollowUpLookbackMs()) / 1000).toFixed(6);
    const notifications: SlackNotificationItem[] = [];

    for (const conversation of conversations) {
      const latestMessage = await fetchLatestMeaningfulMessage(
        conversation.id,
        scopeSet,
        oldestTs,
      );

      const actionState = await readNotificationActionState(conversation.id);
      const evaluation = evaluateSlackDmFollowup({
        messages: latestMessage ? [latestMessage] : [],
        ownerUserId: env.slackOwnerUserId,
        nowMs,
        thresholdMs,
        actionState,
      });

      if (evaluation.status !== "notify") continue;

      const personName = await fetchSlackPersonName(
        conversation.user ?? evaluation.message.user,
        scopeSet,
        (evaluation.message as SlackMessage).user_profile,
        warnings,
      );

      notifications.push({
        id: conversation.id,
        conversationId: conversation.id,
        personName,
        personUserId: conversation.user ?? evaluation.message.user ?? null,
        lastMessageAt: evaluation.lastMessageAt,
        lastMessageTs: evaluation.message.ts,
        overdueHours: evaluation.overdueHours,
        timeOverdue: evaluation.timeOverdue,
        jumpUrl: makeSlackJumpUrl(auth.team_id, conversation.id),
        snippet: evaluation.snippet,
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
    if (canUseLocalDevStore()) {
      return readStoredNotifications();
    }

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

async function removeStoredNotification(conversationId: string, lastMessageTs: string) {
  const stored = await readStoredNotifications();
  const items = stored.items.filter(
    (item) => item.conversationId !== conversationId || item.lastMessageTs !== lastMessageTs,
  );

  await writeStoredNotificationsPayload(
    {
      ...stored,
      checkedAt: nowIso(),
      count: items.length,
      items,
    } satisfies SlackNotificationsPayload,
  );
}

export const createTestSlackNotification = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdminAuth } = await import("@/lib/auth.server");
  await requireAdminAuth();

  if (!getRedisConfig() && !canUseLocalDevStore()) {
    return {
      ok: false as const,
      message: "Upstash Redis env vars are missing, so the test notification cannot be stored.",
    };
  }

  const lastMessageMs = Date.now() - 25 * 60 * 60 * 1000;
  const lastMessageTs = (lastMessageMs / 1000).toFixed(6);
  const existing = await readStoredNotifications();
  const testItem = {
    id: TEST_NOTIFICATION_ID,
    conversationId: TEST_NOTIFICATION_ID,
    personName: "Test Slack Reminder",
    personUserId: "UTEST",
    lastMessageAt: new Date(lastMessageMs).toISOString(),
    lastMessageTs,
    overdueHours: 25,
    timeOverdue: formatSlackOverdue(25),
    jumpUrl: null,
    snippet: makeSlackSnippet({
      type: "message",
      user: "UTEST",
      ts: lastMessageTs,
      text: "This is a fake dashboard notification for testing the bell.",
    }),
  } satisfies SlackNotificationItem;
  const items = [
    testItem,
    ...existing.items.filter((item) => item.conversationId !== TEST_NOTIFICATION_ID),
  ];

  await writeStoredNotificationsPayload(
    {
      checkedAt: nowIso(),
      lastSyncAt: existing.lastSyncAt ?? nowIso(),
      count: items.length,
      items,
      warning: existing.warning,
    } satisfies SlackNotificationsPayload,
  );

  return {
    ok: true as const,
    message: "Test Slack notification created. Open the bell to preview it.",
  };
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
    await removeStoredNotification(data.conversationId, data.lastMessageTs);
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
    await removeStoredNotification(data.conversationId, data.lastMessageTs);
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
    await removeStoredNotification(data.conversationId, data.lastMessageTs);
    await syncSlackNotifications({ source: "manual" });

    return { ok: true as const };
  });

export const slackNotificationsQuery = {
  queryKey: ["team-billion-slack-followups", "v1"],
  queryFn: () => fetchSlackNotifications(),
  refetchInterval: 5 * 60 * 1000,
  staleTime: 60 * 1000,
};
