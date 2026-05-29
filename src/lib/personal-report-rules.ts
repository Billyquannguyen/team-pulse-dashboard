import {
  buildTemplateInsight,
  REPORT_TEMPLATES,
  type ReportInsight,
} from "@/lib/personal-report-templates";

export type { ReportInsight } from "@/lib/personal-report-templates";

export type PersonalReportBenchmarks = {
  avgDealCount: number;
  avgLiveDealCount: number;
  avgRevenue: number;
  avgCreatorCount: number;
  avgCreatorEfficiency: number;
  avgDealValue: number;
  avgCommissionProgress: number;
  avgCreatorsSourced: number;
  avgContacted: number;
  avgEmailsSent: number;
  avgIgOutreach: number;
  avgReplies: number;
  avgCalls: number;
  avgSigned: number;
  avgReplyRate: number;
  avgBookingRate: number;
  avgCallClosingRate: number;
  avgOverallClosingRate: number;
  avgOpportunityDensity: number;
};

export type ReportRuleFacts = {
  exclusiveCreatorCount: number;
  exclusiveTarget: number;
  monthlyProgress: number;
  commissionGoalMissed: boolean;
  totalDealValue: number;
  avgDealValue: number;
  revenueEfficiency: number | null;
  memberDealCount: number;
  liveDealCount: number;
  inactiveCreatorCount: number;
  creatorRevenueShare: number;
  topThreeCreatorRevenueShare: number;
  opportunityDensity: number;
  creatorsSourced: number;
  contacted: number;
  emailsSent: number;
  replies: number;
  bookedCalls: number;
  signed: number;
  replyRate: number;
  bookingRate: number;
  callClosingRate: number;
  overallClosingRate: number;
  benchmarks: PersonalReportBenchmarks;
};

export const fallbackInsight: ReportInsight = buildTemplateInsight(
  "activityBaseline",
  1,
  ["There is not enough clean activity data yet.", "The report is using the current dashboard snapshot."],
);

export function formatMoney(value: number) {
  return `£${Math.round(value).toLocaleString()}`;
}

export function roundedAverage(value: number) {
  return Math.round(value).toLocaleString();
}

function significantlyBelow(value: number, teamAverage: number) {
  return teamAverage > 0 && value < teamAverage * 0.8;
}

function significantlyAbove(value: number, teamAverage: number) {
  return teamAverage > 0 && value > teamAverage * 1.2;
}

function belowTeam(value: number, teamAverage: number) {
  return teamAverage > 0 && value < teamAverage;
}

function aboveTeam(value: number, teamAverage: number) {
  return teamAverage > 0 && value > teamAverage;
}

function atOrAboveTeam(value: number, teamAverage: number) {
  return teamAverage > 0 && value >= teamAverage;
}

function pushInsight(list: ReportInsight[], insight: ReportInsight | null) {
  if (insight) list.push(insight);
}

export function evaluatePersonalReportRules(facts: ReportRuleFacts) {
  const {
    exclusiveCreatorCount,
    exclusiveTarget,
    monthlyProgress,
    commissionGoalMissed,
    totalDealValue,
    avgDealValue,
    revenueEfficiency,
    memberDealCount,
    liveDealCount,
    inactiveCreatorCount,
    creatorRevenueShare,
    topThreeCreatorRevenueShare,
    opportunityDensity,
    creatorsSourced,
    contacted,
    emailsSent,
    replies,
    bookedCalls,
    signed,
    replyRate,
    bookingRate,
    callClosingRate,
    overallClosingRate,
    benchmarks,
  } = facts;
  const weakRevenue =
    monthlyProgress < benchmarks.avgCommissionProgress ||
    commissionGoalMissed ||
    totalDealValue < benchmarks.avgRevenue;
  const strongSourcing = atOrAboveTeam(creatorsSourced, benchmarks.avgCreatorsSourced);
  const strongReplies =
    atOrAboveTeam(replies, benchmarks.avgReplies) || atOrAboveTeam(replyRate, benchmarks.avgReplyRate);
  const strongCalls = atOrAboveTeam(bookedCalls, benchmarks.avgCalls);
  const insights: ReportInsight[] = [];

  pushInsight(
    insights,
    significantlyBelow(creatorsSourced, benchmarks.avgCreatorsSourced)
      ? buildTemplateInsight("sourcingProblem", 97, [
          `Creators sourced: ${creatorsSourced.toLocaleString()}`,
          `Team average creators sourced: ${roundedAverage(benchmarks.avgCreatorsSourced)}`,
          `Contacted creators: ${contacted.toLocaleString()}`,
        ])
      : null,
  );

  pushInsight(
    insights,
    atOrAboveTeam(emailsSent, benchmarks.avgEmailsSent) &&
      belowTeam(replyRate, benchmarks.avgReplyRate)
      ? buildTemplateInsight("outreachQualityProblem", 94, [
          `Emails sent: ${emailsSent.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgEmailsSent)}.`,
          `Reply rate: ${replyRate}% versus team average ${Math.round(benchmarks.avgReplyRate)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    atOrAboveTeam(replies, benchmarks.avgReplies) && belowTeam(bookingRate, benchmarks.avgBookingRate)
      ? buildTemplateInsight("followUpBottleneck", 95, [
          `Replies: ${replies.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgReplies)}.`,
          `Booking rate: ${bookingRate}% versus team average ${Math.round(benchmarks.avgBookingRate)}%.`,
          `Calls booked: ${bookedCalls.toLocaleString()}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    atOrAboveTeam(bookedCalls, benchmarks.avgCalls) && significantlyBelow(signed, benchmarks.avgSigned)
      ? buildTemplateInsight("callConversionBottleneck", 96, [
          `Calls: ${bookedCalls.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgCalls)}.`,
          `Signed & Partnered: ${signed.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgSigned)}.`,
          `Call closing: ${callClosingRate}% versus team average ${Math.round(benchmarks.avgCallClosingRate)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    strongSourcing && strongReplies && strongCalls && weakRevenue
      ? buildTemplateInsight("pipelineHealth", 91, [
          `Creators sourced: ${creatorsSourced.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgCreatorsSourced)}.`,
          `Replies: ${replies.toLocaleString()} and calls: ${bookedCalls.toLocaleString()}.`,
          `Monthly commission progress: ${monthlyProgress}% versus team average ${Math.round(benchmarks.avgCommissionProgress)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    atOrAboveTeam(bookedCalls, benchmarks.avgCalls) && belowTeam(signed, benchmarks.avgSigned)
      ? buildTemplateInsight("hiddenPipeline", 84, [
          `Calls: ${bookedCalls.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgCalls)}.`,
          `Signed & Partnered: ${signed.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgSigned)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    exclusiveCreatorCount < exclusiveTarget && commissionGoalMissed
      ? buildTemplateInsight("creatorQuantityProblem", 90, [
          `Exclusive creator progress: ${exclusiveCreatorCount} / ${exclusiveTarget}.`,
          `Monthly commission progress: ${monthlyProgress}%.`,
          `Team average exclusive creators: ${roundedAverage(benchmarks.avgCreatorCount)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    exclusiveCreatorCount >= exclusiveTarget && commissionGoalMissed
      ? buildTemplateInsight("creatorQualityProblem", 89, [
          `Exclusive creator goal achieved: ${exclusiveCreatorCount} / ${exclusiveTarget}.`,
          `Monthly commission progress: ${monthlyProgress}%.`,
          revenueEfficiency === null
            ? "Revenue efficiency cannot be calculated yet."
            : `Revenue efficiency: ${formatMoney(revenueEfficiency)} versus team average ${formatMoney(benchmarks.avgCreatorEfficiency)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    exclusiveCreatorCount >= benchmarks.avgCreatorCount && liveDealCount < benchmarks.avgLiveDealCount
      ? buildTemplateInsight("creatorActivationProblem", 92, [
          `Exclusive creators: ${exclusiveCreatorCount} versus team average ${roundedAverage(benchmarks.avgCreatorCount)}.`,
          `Live deals: ${liveDealCount} versus team average ${roundedAverage(benchmarks.avgLiveDealCount)}.`,
          `Creators with no matched deal: ${inactiveCreatorCount}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    inactiveCreatorCount > 0
      ? buildTemplateInsight("underutilisedCreators", 76, [
          `Exclusive creators with no matched deal: ${inactiveCreatorCount}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    creatorRevenueShare > 50
      ? buildTemplateInsight("revenueConcentrationRisk", 74, [
          `Top creator revenue share: ${creatorRevenueShare}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    topThreeCreatorRevenueShare > 75 && exclusiveCreatorCount >= 3
      ? buildTemplateInsight("portfolioConcentration", 71, [
          `Top 3 creator revenue share: ${topThreeCreatorRevenueShare}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    revenueEfficiency !== null && significantlyAbove(revenueEfficiency, benchmarks.avgCreatorEfficiency)
      ? buildTemplateInsight("highRevenueEfficiency", 82, [
          `Revenue efficiency: ${formatMoney(revenueEfficiency)} per exclusive creator.`,
          `Team average revenue efficiency: ${formatMoney(benchmarks.avgCreatorEfficiency)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    revenueEfficiency !== null &&
      exclusiveCreatorCount >= benchmarks.avgCreatorCount &&
      belowTeam(revenueEfficiency, benchmarks.avgCreatorEfficiency)
      ? buildTemplateInsight("lowRevenueEfficiency", 83, [
          `Revenue efficiency: ${formatMoney(revenueEfficiency)} per exclusive creator.`,
          `Team average revenue efficiency: ${formatMoney(benchmarks.avgCreatorEfficiency)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    exclusiveCreatorCount > 0 && belowTeam(opportunityDensity, benchmarks.avgOpportunityDensity)
      ? buildTemplateInsight("opportunityDensity", 79, [
          `Deals per exclusive creator: ${opportunityDensity.toFixed(1)}.`,
          `Team average deals per exclusive creator: ${benchmarks.avgOpportunityDensity.toFixed(1)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    memberDealCount >= benchmarks.avgDealCount && avgDealValue < benchmarks.avgDealValue
      ? buildTemplateInsight("dealValueProblem", 86, [
          `Deals: ${memberDealCount} versus team average ${roundedAverage(benchmarks.avgDealCount)}.`,
          `Average deal value: ${formatMoney(avgDealValue)} versus team average ${formatMoney(benchmarks.avgDealValue)}.`,
          `Total deal value: ${formatMoney(totalDealValue)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    exclusiveCreatorCount >= benchmarks.avgCreatorCount && memberDealCount < benchmarks.avgDealCount
      ? buildTemplateInsight("brandConversionProblem", 85, [
          `Exclusive creators: ${exclusiveCreatorCount} versus team average ${roundedAverage(benchmarks.avgCreatorCount)}.`,
          `Deals: ${memberDealCount} versus team average ${roundedAverage(benchmarks.avgDealCount)}.`,
          `Live deals: ${liveDealCount}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    aboveTeam(replyRate, benchmarks.avgReplyRate)
      ? buildTemplateInsight("strongOutreachPerformer", 78, [
          `Reply rate: ${replyRate}% versus team average ${Math.round(benchmarks.avgReplyRate)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    aboveTeam(bookingRate, benchmarks.avgBookingRate)
      ? buildTemplateInsight("bestBooker", 77, [
          `Booking rate: ${bookingRate}% versus team average ${Math.round(benchmarks.avgBookingRate)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    aboveTeam(callClosingRate, benchmarks.avgCallClosingRate)
      ? buildTemplateInsight("bestCloser", 80, [
          `Call closing: ${callClosingRate}% versus team average ${Math.round(benchmarks.avgCallClosingRate)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    exclusiveCreatorCount > benchmarks.avgCreatorCount && exclusiveCreatorCount >= exclusiveTarget
      ? buildTemplateInsight("creatorAcquisitionSuperpower", 69, [
          `Exclusive creators: ${exclusiveCreatorCount} versus team average ${roundedAverage(benchmarks.avgCreatorCount)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    significantlyAbove(replyRate, benchmarks.avgReplyRate)
      ? buildTemplateInsight("outreachQualitySuperpower", 95, [
          `Reply rate: ${replyRate}% versus team average ${Math.round(benchmarks.avgReplyRate)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    significantlyAbove(bookingRate, benchmarks.avgBookingRate)
      ? buildTemplateInsight("meetingBookingSuperpower", 91, [
          `Booking rate: ${bookingRate}% versus team average ${Math.round(benchmarks.avgBookingRate)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    significantlyAbove(callClosingRate, benchmarks.avgCallClosingRate)
      ? buildTemplateInsight("closingConversationsSuperpower", 93, [
          `Call closing: ${callClosingRate}% versus team average ${Math.round(benchmarks.avgCallClosingRate)}%.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    significantlyAbove(totalDealValue, benchmarks.avgRevenue) ||
      significantlyAbove(avgDealValue, benchmarks.avgDealValue)
      ? buildTemplateInsight("creatorMonetisationSuperpower", 86, [
          `Total deal value: ${formatMoney(totalDealValue)} versus team average ${formatMoney(benchmarks.avgRevenue)}.`,
          `Average deal value: ${formatMoney(avgDealValue)} versus team average ${formatMoney(benchmarks.avgDealValue)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    revenueEfficiency !== null && significantlyAbove(revenueEfficiency, benchmarks.avgCreatorEfficiency)
      ? buildTemplateInsight("revenueEfficiencySuperpower", 89, [
          `Revenue efficiency: ${formatMoney(revenueEfficiency)} per exclusive creator.`,
          `Team average revenue efficiency: ${formatMoney(benchmarks.avgCreatorEfficiency)}.`,
        ])
      : null,
  );

  pushInsight(
    insights,
    atOrAboveTeam(signed, benchmarks.avgSigned) ||
      (atOrAboveTeam(replies, benchmarks.avgReplies) && atOrAboveTeam(bookedCalls, benchmarks.avgCalls))
      ? buildTemplateInsight("relationshipBuildingSuperpower", 64, [
          `Replies: ${replies.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgReplies)}.`,
          `Calls: ${bookedCalls.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgCalls)}.`,
          `Signed & Partnered: ${signed.toLocaleString()} versus team average ${roundedAverage(benchmarks.avgSigned)}.`,
        ])
      : null,
  );

  return insights.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function chooseReportInsights(insights: ReportInsight[]) {
  const sorted = [...insights].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const primary =
    sorted.find((insight) => insight.kind === "bottleneck") ??
    sorted.find((insight) => insight.kind === "supporting") ??
    fallbackInsight;
  const supporting =
    sorted.find((insight) => insight.id !== primary.id && insight.kind === "supporting") ??
    sorted.find((insight) => insight.id !== primary.id && insight.kind === "bottleneck") ??
    buildTemplateInsight("supportingBaseline", 1, [
      "No stronger secondary rule beat the primary bottleneck.",
    ]);
  const opportunity =
    sorted.find((insight) => insight.kind === "opportunity" && insight.id !== primary.id) ??
    buildTemplateInsight("opportunityBaseline", 1, [
      "No separate opportunity rule beat the benchmark fallback.",
    ]);
  const superpower =
    sorted.find((insight) => insight.kind === "superpower") ??
    buildTemplateInsight("relationshipBuildingSuperpower", 1, [
      "No single superpower is far above the team benchmark yet.",
    ]);

  return { primary, supporting, opportunity, superpower };
}

export const reportTemplateCount = Object.keys(REPORT_TEMPLATES).length;
