import { createFileRoute } from "@tanstack/react-router";

const SLACK_API_URL = "https://slack.com/api";

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
      records: [] as StoredSlackNotification[],
      allRecordSummary: [] as Array<Record<string, string | null>>,
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
        records: [] as StoredSlackNotification[],
        allRecordSummary: [] as Array<Record<string, string | null>>,
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
      records: items,
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
      records: [] as StoredSlackNotification[],
      allRecordSummary: [] as Array<Record<string, string | null>>,
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

function slackErrorReason(call: SlackRawCall | null) {
  if (!call) return "missing_person_user_id";
  if (call.fetchError) return call.fetchError;
  if (!call.responseJson || typeof call.responseJson !== "object") {
    return "invalid_or_empty_slack_response";
  }

  const body = call.responseJson as Record<string, unknown>;
  if (body.ok !== true) {
    const details = [
      typeof body.error === "string" ? body.error : "unknown_slack_error",
      typeof body.needed === "string" ? `needed=${body.needed}` : "",
      typeof body.provided === "string" ? `provided=${body.provided}` : "",
    ].filter(Boolean);

    return details.join(" ");
  }

  return null;
}

function resolveNameFromUsersInfo(call: SlackRawCall | null) {
  const error = slackErrorReason(call);
  if (error) {
    return {
      resolved: false,
      freshNameSource: null,
      freshName: null,
      unresolvedReason: error,
    };
  }

  const body = call?.responseJson as
    | {
        user?: {
          name?: string;
          real_name?: string;
          profile?: {
            display_name?: string;
            real_name?: string;
            email?: string;
          };
        };
      }
    | undefined;
  const user = body?.user;
  const freshName =
    user?.profile?.display_name?.trim() ||
    user?.profile?.real_name?.trim() ||
    user?.real_name?.trim() ||
    user?.name?.trim() ||
    "";

  if (!freshName) {
    return {
      resolved: false,
      freshNameSource: null,
      freshName: null,
      unresolvedReason: "users.info_ok_but_no_readable_profile_name",
    };
  }

  return {
    resolved: true,
    freshNameSource: "users.info",
    freshName,
    unresolvedReason: null,
  };
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
        const storedNotifications = await readStoredSlackNotificationsForDebug(env);
        const redisRecords = storedNotifications.records;
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
        const userInfoCalls = await Promise.all(
          redisRecords.map((record, index) => {
            if (!record.personUserId) return Promise.resolve(null);

            return callSlackApi({
              label: `Redis notification ${index + 1}: users.info for ${record.personUserId}`,
              method: "users.info",
              token: env.slackUserToken,
              tokenSource: "SLACK_USER_TOKEN",
              params: { user: record.personUserId },
            });
          }),
        );
        const userConversationListCall = initialCalls.find(
          (call) =>
            call.method === "conversations.list" && call.tokenSource === "SLACK_USER_TOKEN",
        );
        const dmChannels = userConversationListCall
          ? getChannelsFromSlackCall(userConversationListCall)
          : [];
        const redisPersonUserIds = Array.from(
          new Set(
            redisRecords
              .map((record) => record.personUserId)
              .filter((value): value is string => Boolean(value)),
          ),
        );
        const liveMatchedChannels = dmChannels.filter(
          (channel) => channel.user && redisPersonUserIds.includes(channel.user),
        );
        const channelIdsToInspect = Array.from(
          new Set([
            ...redisRecords
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
        const redisUserInfoProbes = redisRecords.map((record, index) => {
          const usersInfoResponse = userInfoCalls[index];
          const resolution = resolveNameFromUsersInfo(usersInfoResponse);

          return {
            recordIndex: index,
            conversationId: record.conversationId ?? null,
            personUserId: record.personUserId ?? null,
            storedPersonName: record.personName ?? null,
            storedPersonNameSource: record.personNameSource ?? "redis_legacy",
            sourceRecord: record,
            freshLookupAttempted: Boolean(record.personUserId),
            freshNameResolved: resolution.resolved,
            freshNameSource: resolution.freshNameSource,
            freshName: resolution.freshName,
            unresolvedReason: resolution.unresolvedReason,
            usersInfoResponse,
            matchingDmChannelFromConversationsList:
              dmChannels.find((channel) => channel.user === record.personUserId) ?? null,
          };
        });
        const calls = [
          ...initialCalls,
          ...userInfoCalls.filter((call): call is SlackRawCall => Boolean(call)),
          ...historyCalls,
        ];
        const scopesReturned = Array.from(
          new Set(calls.flatMap((call) => collectScopesFromJson(call.responseJson))),
        ).sort();

        return jsonResponse({
          ok: true,
          temporary: true,
          publicDebugEndpoint: true,
          checkedAt: new Date().toISOString(),
          probeMode: "Redis notification personUserId values",
          tokenShapes: env.tokens,
          redisNotificationUserProbes: {
            hardcodedProbeRemoved: true,
            redisKey: SLACK_NOTIFICATIONS_REDIS_KEY,
            uniquePersonUserIdsFromRedis: redisPersonUserIds,
            recordsChecked: redisRecords.length,
            redis: storedNotifications,
            dmChannelList: {
              checkedVia: "conversations.list using SLACK_USER_TOKEN",
              totalChannelsReturnedInFirstPage: dmChannels.length,
              matchedByRedisPersonUserId: liveMatchedChannels,
            },
            extractionRuleInDashboardSync:
              "personUserId is saved as conversation.user ?? latestMeaningfulMessage.user",
            userInfoResultsByRedisRecord: redisUserInfoProbes,
            matchingHistoryCalls: historyCalls.map((call) => ({
              label: call.label,
              method: call.method,
              requestParams: call.requestParams,
              responseJson: call.responseJson,
            })),
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
