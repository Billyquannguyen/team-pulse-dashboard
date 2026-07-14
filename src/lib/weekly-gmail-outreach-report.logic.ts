export const CREATOR_FOLLOW_UP_DAYS = [3, 7, 14] as const;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type OutreachSequenceMessage = {
  internalDate: number;
  sent: boolean;
  draft: boolean;
};

export type OutreachSequenceAnalysis = {
  initialOutreachAt: number;
  ageDays: number;
  hasReply: boolean;
  followUpsSent: number;
  followUpsDue: number;
  completedDueFollowUps: number;
  isOverdue: boolean;
  isFullSequenceDue: boolean;
  isFullSequenceComplete: boolean;
};

export function analyzeOutreachSequence(
  messages: OutreachSequenceMessage[],
  nowMs: number,
): OutreachSequenceAnalysis | null {
  const deliveredMessages = messages
    .filter(
      (message) =>
        !message.draft && Number.isFinite(message.internalDate) && message.internalDate > 0,
    )
    .sort((left, right) => left.internalDate - right.internalDate);
  const firstMessage = deliveredMessages[0];

  if (!firstMessage?.sent) return null;

  const messagesAfterInitial = deliveredMessages.slice(1);
  const hasReply = messagesAfterInitial.some((message) => !message.sent);
  const ageDays = Math.max(0, (nowMs - firstMessage.internalDate) / DAY_IN_MS);
  const dueMilestones = CREATOR_FOLLOW_UP_DAYS.filter((day) => ageDays >= day);
  const followUpAges = messagesAfterInitial
    .filter((message) => message.sent)
    .map((message) => (message.internalDate - firstMessage.internalDate) / DAY_IN_MS);
  let followUpIndex = 0;
  let completedDueFollowUps = 0;

  for (const milestone of dueMilestones) {
    while (followUpIndex < followUpAges.length && followUpAges[followUpIndex] < milestone) {
      followUpIndex += 1;
    }

    if (followUpIndex >= followUpAges.length) break;
    completedDueFollowUps += 1;
    followUpIndex += 1;
  }

  const followUpsSent = followUpAges.length;
  const followUpsDue = dueMilestones.length;

  return {
    initialOutreachAt: firstMessage.internalDate,
    ageDays,
    hasReply,
    followUpsSent,
    followUpsDue,
    completedDueFollowUps,
    isOverdue: !hasReply && completedDueFollowUps < followUpsDue,
    isFullSequenceDue: !hasReply && followUpsDue === CREATOR_FOLLOW_UP_DAYS.length,
    isFullSequenceComplete: !hasReply && completedDueFollowUps === CREATOR_FOLLOW_UP_DAYS.length,
  };
}
