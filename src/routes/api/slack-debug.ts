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

  return {
    slackUserToken,
    slackBotToken,
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
        const { requireAdminAuth } = await import("@/lib/auth.server");

        try {
          await requireAdminAuth();
        } catch {
          return jsonResponse(
            {
              ok: false,
              error: "Admin access required.",
            },
            401,
          );
        }

        const env = readSlackDebugEnv();
        const calls = await Promise.all([
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
            label: "Related scopes probe: conversations.list using SLACK_USER_TOKEN",
            method: "conversations.list",
            token: env.slackUserToken,
            tokenSource: "SLACK_USER_TOKEN",
            params: { types: "im", limit: 1, exclude_archived: true },
          }),
          callSlackApi({
            label: "Related scopes probe: conversations.list using SLACK_BOT_TOKEN",
            method: "conversations.list",
            token: env.slackBotToken,
            tokenSource: "SLACK_BOT_TOKEN",
            params: { types: "im", limit: 1, exclude_archived: true },
          }),
        ]);

        const scopesReturned = Array.from(
          new Set(calls.flatMap((call) => collectScopesFromJson(call.responseJson))),
        ).sort();

        return jsonResponse({
          ok: true,
          temporary: true,
          checkedAt: new Date().toISOString(),
          probeUserId: PROBE_USER_ID,
          tokenShapes: env.tokens,
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
