type SlackApiResponse<T> = T & {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
};

type SlackMessage = {
  type?: string;
  subtype?: string;
  user?: string;
  text?: string;
  ts?: string;
  bot_id?: string;
  app_id?: string;
};

type SlackHistoryResponse = {
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

type SlackUser = {
  id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  real_name?: string;
  name?: string;
  profile?: { display_name?: string; real_name?: string };
};

type SlackUsersListResponse = {
  members?: SlackUser[];
  response_metadata?: { next_cursor?: string };
};

type SlackConversation = {
  id?: string;
  name?: string;
  user?: string;
  is_im?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
};

type SlackConversationsListResponse = {
  channels?: SlackConversation[];
  response_metadata?: { next_cursor?: string };
};

type SlackPermalinkResponse = {
  permalink?: string;
};

export type SlackLinkAlertResult = {
  ok: boolean;
  checkedChannels: number;
  alertsSent: number;
  initializedChannels: number;
  matchedMembers: string[];
  error: string | null;
};

const SLACK_API_URL = "https://slack.com/api";
const REDIS_KEY_PREFIX = "team-billion:slack-link-alerts:checkpoint";
const LINK_PATTERN = /(?:https?:\/\/|<https?:\/\/)[^\s<>]+/i;
const UK_ALERT_HOURS = new Set([10, 12, 13, 17]);

export function isUkSlackLinkAlertHour(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );

  return UK_ALERT_HOURS.has(hour);
}

function csvEnv(name: string) {
  return Array.from(
    new Set(
      (process.env[name] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function configuredMemberNames() {
  const names = csvEnv("SLACK_LINK_ALERT_MEMBER_NAMES");
  if (names.length === 0) {
    throw new Error("SLACK_LINK_ALERT_MEMBER_NAMES must contain at least one Slack member name.");
  }
  return names;
}

function normalizeSlackName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

function slackUserNames(user: SlackUser) {
  return [user.profile?.display_name, user.profile?.real_name, user.real_name, user.name]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
}

function slackUserDisplayName(user: SlackUser) {
  return slackUserNames(user)[0] || "A priority member";
}

function redisConfig() {
  return {
    url: requiredEnv("UPSTASH_REDIS_REST_URL").replace(/\/+$/, ""),
    token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
  };
}

async function redisCommand<T>(command: Array<string | number>) {
  const config = redisConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: T;
    error?: string;
  } | null;

  if (!response.ok || payload?.error) {
    throw new Error(payload?.error ?? `Redis request failed with ${response.status}.`);
  }

  return payload?.result as T;
}

function checkpointKey(channelId: string) {
  return `${REDIS_KEY_PREFIX}:${channelId}`;
}

async function readCheckpoint(channelId: string) {
  return redisCommand<string | null>(["GET", checkpointKey(channelId)]);
}

async function writeCheckpoint(channelId: string, timestamp: string) {
  await redisCommand<"OK">(["SET", checkpointKey(channelId), timestamp]);
}

async function slackApi<T>(
  method: string,
  params: Record<string, string | number | undefined> = {},
) {
  const url = new URL(`${SLACK_API_URL}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requiredEnv("SLACK_USER_TOKEN")}` },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as SlackApiResponse<T> | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(`Slack ${method} failed: ${payload?.error ?? `HTTP ${response.status}`}`);
  }

  return payload;
}

async function messagesAfter(channelId: string, oldest: string) {
  const messages: SlackMessage[] = [];
  let cursor = "";

  for (let page = 0; page < 5; page += 1) {
    const response = await slackApi<SlackHistoryResponse>("conversations.history", {
      channel: channelId,
      oldest,
      inclusive: 0,
      limit: 100,
      cursor,
    });
    messages.push(...(response.messages ?? []));
    cursor = response.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }

  return messages
    .filter((message): message is SlackMessage & { ts: string } => Boolean(message.ts))
    .sort((left, right) => Number(left.ts) - Number(right.ts));
}

async function fetchAllSlackUsers() {
  const users: SlackUser[] = [];
  let cursor = "";

  for (let page = 0; page < 10; page += 1) {
    const response = await slackApi<SlackUsersListResponse>("users.list", {
      limit: 200,
      cursor,
    });
    users.push(...(response.members ?? []));
    cursor = response.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }

  return users.filter((user) => user.id && !user.deleted && !user.is_bot);
}

async function resolveConfiguredMembers() {
  const requestedNames = configuredMemberNames();
  const users = await fetchAllSlackUsers();
  const matches = new Map<string, string>();

  for (const requestedName of requestedNames) {
    const normalizedRequestedName = normalizeSlackName(requestedName);
    const matchingUsers = users.filter((user) =>
      slackUserNames(user).some((name) => normalizeSlackName(name) === normalizedRequestedName),
    );

    if (matchingUsers.length === 0) {
      throw new Error(`Could not find Slack member named "${requestedName}".`);
    }
    if (matchingUsers.length > 1) {
      throw new Error(`More than one Slack member matches "${requestedName}".`);
    }

    const user = matchingUsers[0];
    matches.set(user.id!, slackUserDisplayName(user));
  }

  return matches;
}

async function fetchAccessibleConversations(priorityMemberIds: Set<string>) {
  const conversations: SlackConversation[] = [];
  let cursor = "";

  for (let page = 0; page < 10; page += 1) {
    const response = await slackApi<SlackConversationsListResponse>("conversations.list", {
      types: "public_channel,private_channel,im",
      exclude_archived: 1,
      limit: 200,
      cursor,
    });
    conversations.push(...(response.channels ?? []));
    cursor = response.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }

  return conversations.filter(
    (conversation): conversation is SlackConversation & { id: string } =>
      Boolean(conversation.id) &&
      !conversation.is_archived &&
      (!conversation.is_im ||
        Boolean(conversation.user && priorityMemberIds.has(conversation.user))),
  );
}

function isLinkAlertMessage(message: SlackMessage, memberIds: Set<string>) {
  if (message.type !== "message" || message.subtype) return false;
  if (!message.user || !memberIds.has(message.user)) return false;
  if (message.bot_id || message.app_id) return false;
  return LINK_PATTERN.test(message.text ?? "");
}

async function messagePermalink(channelId: string, messageTs: string) {
  const response = await slackApi<SlackPermalinkResponse>("chat.getPermalink", {
    channel: channelId,
    message_ts: messageTs,
  });
  return response.permalink?.trim() || null;
}

function formatDiscordSlackQuote(text: string) {
  const cleaned = text
    .replace(/<mailto:([^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/\r\n/g, "\n")
    .trim();
  const shortened = cleaned.length > 1_000 ? `${cleaned.slice(0, 997)}...` : cleaned;

  return shortened
    .split("\n")
    .map((line) => `> ${line || " "}`)
    .join("\n");
}

async function postDiscordAlert({
  personName,
  location,
  slackMessage,
  permalink,
}: {
  personName: string;
  location: string;
  slackMessage: string;
  permalink: string | null;
}) {
  const openMessage = permalink ? `\n[Open the Slack message](${permalink})` : "";
  const quotedMessage = formatDiscordSlackQuote(slackMessage);
  const content =
    `Hi team, **${personName}** just sent a link ${location}. ` +
    `If it is something important, go reply ASAP!\n\n${quotedMessage}${openMessage}`;
  const response = await fetch(requiredEnv("SLACK_LINK_ALERT_DISCORD_WEBHOOK_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Slack Link Alert",
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed (${response.status}): ${detail}`);
  }
}

export async function syncSlackLinkAlerts(): Promise<SlackLinkAlertResult> {
  const initialCheckpoint = (Date.now() / 1000).toFixed(6);
  let alertsSent = 0;
  let initializedChannels = 0;
  let checkedChannels = 0;
  let matchedMembers: string[] = [];

  try {
    requiredEnv("SLACK_USER_TOKEN");
    requiredEnv("SLACK_LINK_ALERT_DISCORD_WEBHOOK_URL");
    redisConfig();
    const memberNamesById = await resolveConfiguredMembers();
    const memberIds = new Set(memberNamesById.keys());
    const conversations = await fetchAccessibleConversations(memberIds);
    matchedMembers = Array.from(memberNamesById.values());
    checkedChannels = conversations.length;

    for (const conversation of conversations) {
      const channelId = conversation.id;
      const checkpoint = await readCheckpoint(channelId);
      if (!checkpoint) {
        await writeCheckpoint(channelId, initialCheckpoint);
        initializedChannels += 1;
        continue;
      }

      const messages = await messagesAfter(channelId, checkpoint);

      for (const message of messages) {
        if (isLinkAlertMessage(message, memberIds) && message.user && message.ts) {
          const personName = memberNamesById.get(message.user) ?? "A priority member";
          const permalink = await messagePermalink(channelId, message.ts);
          const location = conversation.is_im
            ? `in a private Slack chat with **${personName}**`
            : `in Slack channel **#${conversation.name?.trim() || channelId}**`;
          await postDiscordAlert({
            personName,
            location,
            slackMessage: message.text ?? "Shared a link",
            permalink,
          });
          alertsSent += 1;
        }

        await writeCheckpoint(channelId, message.ts);
      }
    }

    return {
      ok: true,
      checkedChannels,
      alertsSent,
      initializedChannels,
      matchedMembers,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      checkedChannels,
      alertsSent,
      initializedChannels,
      matchedMembers,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
