import { createFileRoute } from "@tanstack/react-router";

const SLACK_API_URL = "https://slack.com/api";
const PROBE_USER_ID = "U08CX8BHVQ1";

type SlackRawCall = {
  label: string;
  method: string;
  tokenSource: "SLACK_USER_TOKEN" | "SLACK_BOT_TOKEN";
  tokenKind: string;
  tokenPresent: boolean;
  requestParams: Record<string, string | number | boolean>;
  httpStatus: number | null;
  httpOk: boolean;
  responseJson: unknown;
  responseText: string | null;
  fetchError: string | null;
};

type StoredSlackNotification = {
  id?: string;
  conversationId?: string;
  personName?: string;
  personUserId?: string | null;
  personNameSource?: string;
  lastMessageAt?: string;
  lastMessageTs?: string;
  timeOverdue?: string;
  snippet?: string | null;
  jumpUrl?: string | null;
};

type SlackConversationRecord = {
  id?: string;
  user?: string;
  is_im?: boolean;
  is_archived?: boolean;
  [key: string]: unknown;
};

const SLACK_NOTIFICATIONS_REDIS_KEY = "team-billion:slack-followups:notifications";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function tokenKind(token: string) {
  if (!token) return "missing";
  if (token.startsWith("xoxp")) return "xoxp";
  if (token.startsWith("xoxb")) return "xoxb";
  return "other";
}

function readSlackDebugEnv() {
  const slackUserToken = process.env.SLACK_USER_TOKEN?.trim() ?? "";
  const slackBotToken = process.env.SLACK_BOT_TOKEN?.trim() ?? "";
  const upstashRedisRestUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const upstashRedisRestToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";

  return {
    slackUserToken,
    slackBotToken,
    upstashRedisRestUrl,
    upstashRedisRestToken,
    tokens: {
      SLACK_USER_TOKEN: {
        present: Boolean(slackUserToken),
        startsWith: tokenKind(slackUserToken),
        expectedForPersonalDmHistory: "xoxp",
      },
      SLACK_BOT_TOKEN: {
        present: Boolean(slackBotToken),
        startsWith: tokenKind(slackBotToken),
        expectedForBotRuntime: "xoxb",
      },
    },
  };
}

async function readStoredSlackNotificationsForDebug(env: ReturnType<typeof readSlackDebugEnv>) {
  if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) {
    return {
      ok: false,
      redisConfigured: false,
      redisKey: SLACK_NOTIFICATIONS_REDIS_KEY,
      error: "UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing.",
      payload: null,
      matchedRecords: [] as StoredSlackNotification[],
    };
  }

  try {
    const response = await fetch(env.upstashRedisRestUrl.replace(/\/+$/, ""), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.upstashRedisRestToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["GET", SLACK_NOTIFICATIONS_REDIS_KEY]),
      cache: "no-store",
    });
    const redisResponse = (await response.json().catch(() => null)) as
      | { result?: string | null; error?: string }
      | null;

    if (!response.ok || redisResponse?.error) {
      return {
        ok: false,
        redisConfigured: true,
        redisKey: SLACK_NOTIFICATIONS_REDIS_KEY,
        error: redisResponse?.error ?? `Redis HTTP ${response.status}`,
        payload: redisResponse,
        matchedRecords: [] as StoredSlackNotification[],
      };
    }

    const payload = redisResponse?.result ? JSON.parse(redisResponse.result) : null;
    const items = Array.isArray(payload?.items)
      ? (payload.items as StoredSlackNotification[])
      : [];

    return {
      ok: true,
      redisConfigured: true,
      redisKey: SLACK_NOTIFICATIONS_REDIS_KEY,
      error: null,
      payload: {
        checkedAt: payload?.checkedAt ?? null,
        lastSyncAt: payload?.lastSyncAt ?? null,
        count: payload?.count ?? items.length,
        warning: payload?.warning ?? null,
      },
      matchedRecords: items.filter((item) => item.personUserId === PROBE_USER_ID),
      allRecordSummary: items.map((item) => ({
        conversationId: item.conversationId ?? null,
        personUserId: item.personUserId ?? null,
        personName: item.personName ?? null,
        personNameSource: item.personNameSource ?? "redis_legacy",
        lastMessageAt: item.lastMessageAt ?? null,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      redisConfigured: true,
      redisKey: SLACK_NOTIFICATIONS_REDIS_KEY,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      payload: null,
      matchedRecords: [] as StoredSlackNotification[],
    };
  }
}

function normalizeScopeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeScopeList(item));
  }

  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  return [];
}

function collectScopesFromJson(json: unknown) {
  if (!json || typeof json !== "object") return [];

  const body = json as Record<string, unknown>;
  const metadata =
    body.response_metadata && typeof body.response_metadata === "object"
      ? (body.response_metadata as Record<string, unknown>)
      : {};

  return [
    ...normalizeScopeList(body.scope),
    ...normalizeScopeList(body.scopes),
    ...normalizeScopeList(body.needed),
    ...normalizeScopeList(body.provided),
    ...normalizeScopeList(body.acceptedScopes),
    ...normalizeScopeList(body.accepted_scopes),
    ...normalizeScopeList(metadata.scopes),
    ...normalizeScopeList(metadata.acceptedScopes),
    ...normalizeScopeList(metadata.accepted_scopes),
  ];
}

function getChannelsFromSlackCall(call: SlackRawCall) {
  const json = call.responseJson;
  if (!json || typeof json !== "object") return [] as SlackConversationRecord[];

  const channels = (json as { channels?: unknown }).channels;
  return Array.isArray(channels) ? (channels as SlackConversationRecord[]) : [];
}

function makeSourceDiagnosis({
  redisMatchedRecords,
  liveMatchedChannels,
  hardcodedProbeOnly,
}: {
  redisMatchedRecords: StoredSlackNotification[];
  liveMatchedChannels: SlackConversationRecord[];
  hardcodedProbeOnly: boolean;
}) {
  if (redisMatchedRecords.length > 0 && liveMatchedChannels.length > 0) {
    return "This ID is in Redis and also appears as channel.user from Slack conversations.list. The dashboard produced it from conversation.user.";
  }

  if (redisMatchedRecords.length > 0) {
    return "This ID is in Redis, but it was not found in the current conversations.list response. That points to stale Redis data, a deleted/no-longer-visible user, or a Slack Connect/external visibility issue.";
  }

  if (liveMatchedChannels.length > 0) {
    return "This ID appears in Slack conversations.list as channel.user, but no stored notification currently points to it.";
  }

  if (hardcodedProbeOnly) {
    return "This ID is currently only the hardcoded probe user in /api/slack-debug. It was not found in Redis or the current DM channel list returned by Slack.";
  }

  return "No source found for this ID in the debug checks.";
}

async function callSlackApi({
  label,
  method,
  token,
  tokenSource,
  params = {},
}: {
  label: string;
  method: string;
  token: string;
  tokenSource: "SLACK_USER_TOKEN" | "SLACK_BOT_TOKEN";
  params?: Record<string, string | number | boolean>;
}): Promise<SlackRawCall> {
  if (!token) {
    return {
      label,
      method,
      tokenSource,
      tokenKind: "missing",
      tokenPresent: false,
      requestParams: params,
      httpStatus: null,
      httpOk: false,
      responseJson: {
        ok: false,
        error: `${tokenSource} is missing`,
      },
      responseText: null,
      fetchError: null,
    };
  }

  const url = new URL(`${SLACK_API_URL}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      cache: "no-store",
    });
    const responseText = await response.text();
    let responseJson: unknown = null;

    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = null;
    }

    return {
      label,
      method,
      tokenSource,
      tokenKind: tokenKind(token),
      tokenPresent: true,
      requestParams: params,
      httpStatus: response.status,
      httpOk: response.ok,
      responseJson,
      responseText,
      fetchError: null,
    };
  } catch (error) {
    return {
      label,
      method,
      tokenSource,
      tokenKind: tokenKind(token),
      tokenPresent: true,
      requestParams: params,
      httpStatus: null,
      httpOk: false,
      responseJson: null,
      responseText: null,
      fetchError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export const Route = createFileRoute("/api/slack-debug")({
  server: {
    handlers: {
      GET: async () => {
        const env = readSlackDebugEnv();
        const initialCalls = await Promise.all([
          callSlackApi({
            label: "1. auth.test using SLACK_USER_TOKEN",
            method: "auth.test",
            token: env.slackUserToken,
            tokenSource: "SLACK_USER_TOKEN",
          }),
          callSlackApi({
            label: "2. auth.test using SLACK_BOT_TOKEN",
            method: "auth.test",
            token: env.slackBotToken,
            tokenSource: "SLACK_BOT_TOKEN",
          }),
          callSlackApi({
            label: `3. users.info for ${PROBE_USER_ID} using SLACK_USER_TOKEN`,
            method: "users.info",
            token: env.slackUserToken,
            tokenSource: "SLACK_USER_TOKEN",
            params: { user: PROBE_USER_ID },
          }),
          callSlackApi({
            label: "Related scopes/source probe: conversations.list using SLACK_USER_TOKEN",
            method: "conversations.list",
            token: env.slackUserToken,
            tokenSource: "SLACK_USER_TOKEN",
            params: { types: "im", limit: 200, exclude_archived: true },
          }),
          callSlackApi({
            label: "Related scopes probe: conversations.list using SLACK_BOT_TOKEN",
            method: "conversations.list",
            token: env.slackBotToken,
            tokenSource: "SLACK_BOT_TOKEN",
            params: { types: "im", limit: 1, exclude_archived: true },
          }),
        ]);

        const storedNotifications = await readStoredSlackNotificationsForDebug(env);
        const userConversationListCall = initialCalls.find(
          (call) =>
            call.method === "conversations.list" && call.tokenSource === "SLACK_USER_TOKEN",
        );
        const dmChannels = userConversationListCall
          ? getChannelsFromSlackCall(userConversationListCall)
          : [];
        const liveMatchedChannels = dmChannels.filter((channel) => channel.user === PROBE_USER_ID);
        const channelIdsToInspect = Array.from(
          new Set([
            ...storedNotifications.matchedRecords
              .map((record) => record.conversationId)
              .filter((value): value is string => Boolean(value)),
            ...liveMatchedChannels.map((channel) => channel.id).filter((value): value is string =>
              Boolean(value),
            ),
          ]),
        ).slice(0, 5);
        const historyCalls = await Promise.all(
          channelIdsToInspect.map((channelId) =>
            callSlackApi({
              label: `Source trace: conversations.history for DM channel ${channelId}`,
              method: "conversations.history",
              token: env.slackUserToken,
              tokenSource: "SLACK_USER_TOKEN",
              params: { channel: channelId, limit: 5 },
            }),
          ),
        );
        const calls = [...initialCalls, ...historyCalls];
        const scopesReturned = Array.from(
          new Set(calls.flatMap((call) => collectScopesFromJson(call.responseJson))),
        ).sort();

        return jsonResponse({
          ok: true,
          temporary: true,
          publicDebugEndpoint: true,
          checkedAt: new Date().toISOString(),
          probeUserId: PROBE_USER_ID,
          tokenShapes: env.tokens,
          sourceTraceForProbeUser: {
            investigatedUserId: PROBE_USER_ID,
            hardcodedInThisDebugEndpoint: true,
            redis: storedNotifications,
            dmChannelList: {
              checkedVia: "conversations.list using SLACK_USER_TOKEN",
              totalChannelsReturnedInFirstPage: dmChannels.length,
              matchedByChannelUser: liveMatchedChannels,
            },
            extractionRuleInDashboardSync:
              "personUserId is saved as conversation.user ?? latestMeaningfulMessage.user",
            matchingHistoryCalls: historyCalls.map((call) => ({
              label: call.label,
              method: call.method,
              requestParams: call.requestParams,
              responseJson: call.responseJson,
            })),
            diagnosis: makeSourceDiagnosis({
              redisMatchedRecords: storedNotifications.matchedRecords,
              liveMatchedChannels,
              hardcodedProbeOnly: true,
            }),
          },
          runtimeTokenSource: {
            slackNotificationSystemDefault: "SLACK_USER_TOKEN",
            slackDmHistoryReads: "SLACK_USER_TOKEN",
            slackUsersInfoLookups: "SLACK_USER_TOKEN",
            botTokenUsedForDmFollowupScanning: false,
            codePath:
              "src/lib/slack-notifications.ts -> slackApi() default token -> readSlackEnv().slackUserToken",
            thisDebugEndpoint:
              "Uses SLACK_USER_TOKEN for personal DM probes and SLACK_BOT_TOKEN only for the bot auth/scopes probe.",
          },
          scopesReturned,
          fullSlackResponses: calls,
        });
      },
    },
  },
});
