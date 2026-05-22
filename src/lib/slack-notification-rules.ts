export type SlackMessageRuleInput = {
  type?: string;
  subtype?: string;
  user?: string;
  text?: string;
  ts?: string;
  bot_id?: string;
  app_id?: string;
  files?: unknown[];
};

export type SlackActionStateForRules = {
  status: "done" | "dismissed" | "snoozed";
  lastMessageTs: string;
  snoozedUntil?: string;
};

export type SlackFollowupEvaluation =
  | {
      status: "notify";
      message: SlackMessageRuleInput & { user: string; ts: string };
      lastMessageAt: string;
      overdueHours: number;
      timeOverdue: string;
      snippet: string | null;
    }
  | {
      status: "skip";
      reason:
        | "no_meaningful_message"
        | "latest_from_owner"
        | "below_threshold"
        | "suppressed_by_action";
    };

export const PRODUCTION_SLACK_FOLLOW_UP_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const MINIMUM_DEV_SLACK_FOLLOW_UP_THRESHOLD_MS = 60 * 1000;

export function slackTsToMs(ts: string) {
  const parsed = Number(ts);
  return Number.isFinite(parsed) ? Math.floor(parsed * 1000) : 0;
}

export function formatSlackOverdue(hours: number) {
  if (hours < 48) return `${hours}h overdue`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder > 0 ? `${days}d ${remainder}h overdue` : `${days}d overdue`;
}

export function cleanSlackText(text: string) {
  return text
    .replace(/<mailto:([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeSlackSnippet(message: SlackMessageRuleInput) {
  const cleanText = cleanSlackText(message.text ?? "");

  if (!cleanText) return null;

  return cleanText.length > 140 ? `${cleanText.slice(0, 137)}...` : cleanText;
}

export function isMeaningfulSlackMessage(message: SlackMessageRuleInput) {
  if (message.type !== "message") return false;
  if (!message.user || !message.ts) return false;
  if (message.bot_id || message.app_id) return false;
  if (message.subtype) return false;

  return Boolean(message.text?.trim() || message.files?.length);
}

export function findLatestMeaningfulSlackMessage(messages: SlackMessageRuleInput[]) {
  return messages.find(isMeaningfulSlackMessage) ?? null;
}

export function shouldSuppressSlackNotification(
  state: SlackActionStateForRules | null,
  lastMessageTs: string,
  nowMs: number,
) {
  if (!state || state.lastMessageTs !== lastMessageTs) return false;

  if (state.status === "done" || state.status === "dismissed") return true;

  if (state.status === "snoozed" && state.snoozedUntil) {
    return Date.parse(state.snoozedUntil) > nowMs;
  }

  return false;
}

export function evaluateSlackDmFollowup({
  messages,
  ownerUserId,
  nowMs,
  thresholdMs,
  actionState,
}: {
  messages: SlackMessageRuleInput[];
  ownerUserId: string;
  nowMs: number;
  thresholdMs: number;
  actionState: SlackActionStateForRules | null;
}): SlackFollowupEvaluation {
  const latestMessage = findLatestMeaningfulSlackMessage(messages);

  if (!latestMessage?.user || !latestMessage.ts) {
    return { status: "skip", reason: "no_meaningful_message" };
  }

  if (latestMessage.user === ownerUserId) {
    return { status: "skip", reason: "latest_from_owner" };
  }

  const messageAgeMs = nowMs - slackTsToMs(latestMessage.ts);

  if (messageAgeMs < thresholdMs) {
    return { status: "skip", reason: "below_threshold" };
  }

  if (shouldSuppressSlackNotification(actionState, latestMessage.ts, nowMs)) {
    return { status: "skip", reason: "suppressed_by_action" };
  }

  const overdueHours = Math.max(0, Math.floor(messageAgeMs / 3_600_000));

  return {
    status: "notify",
    message: latestMessage as SlackMessageRuleInput & { user: string; ts: string },
    lastMessageAt: new Date(slackTsToMs(latestMessage.ts)).toISOString(),
    overdueHours,
    timeOverdue: formatSlackOverdue(overdueHours),
    snippet: makeSlackSnippet(latestMessage),
  };
}
