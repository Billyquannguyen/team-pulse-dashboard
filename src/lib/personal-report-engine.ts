import type { Deal } from "@/data/deals";
import type { Teammate } from "@/data/team";
import {
  buildExclusiveCreatorPerformance,
  type CreatorPerformance,
} from "@/lib/exclusive-creator-performance";
import type { GoalSettings } from "@/lib/goal-settings";
import {
  getMemberExclusiveCreatorGoal,
  getMemberMonthlyGoal,
  getMemberProgressionGoal,
} from "@/lib/goal-targets";
import type { DashboardSheetData, OutreachMemberStats } from "@/lib/sheets-public";
import {
  chooseReportInsights,
  evaluatePersonalReportRules,
  formatMoney,
  roundedAverage,
  type PersonalReportBenchmarks,
  type ReportInsight,
} from "@/lib/personal-report-rules";

export { formatMoney, roundedAverage };

export type PersonalReport = {
  snapshotDate: string;
  memberName: string;
  bottleneck: string;
  recommendation: string;
  primaryInsight: ReportInsight;
  supportingInsight: ReportInsight;
  opportunityInsight: ReportInsight;
  superpowerInsight: ReportInsight;
  positives: string[];
  evidence: string[];
  observation: string;
  priorities: [string, string, string];
  extraInsights: string[];
  metrics: {
    monthlyProgress: number;
    monthlyCurrent: number;
    monthlyTarget: number;
    progressionProgress: number;
    progressionCurrent: number;
    progressionTarget: number;
    exclusiveProgress: number;
    exclusiveCreatorCount: number;
    exclusiveTarget: number;
    teamRank: number | null;
    revenueEfficiency: number | null;
    totalDealValue: number;
    avgDealValue: number;
    activeCreatorCount: number;
    liveDealValue: number;
    liveDeals: number;
    dealCount: number;
    topBrands: Array<{ brand: string; value: number; deals: number }>;
    platformMix: CreatorPerformance["platformMix"];
    inactiveCreators: CreatorPerformance[];
    lowContributionCreators: CreatorPerformance[];
    hiddenOpportunity: CreatorPerformance | null;
    creatorsSourced: number;
    contacted: number;
    emailsSent: number;
    igOutreach: number;
    replies: number;
    bookedCalls: number;
    signed: number;
    replyRate: number;
    bookingRate: number;
    callClosingRate: number;
    overallClosingRate: number;
    topNiche: string;
    benchmarks: PersonalReportBenchmarks;
  };
  diagnostics: {
    memberSelected: string;
    dealsMatchedToMember: number;
    exclusiveCreatorsMatchedToMember: number;
    unmatchedCreators: Array<{ creator: string; aliases: string[] }>;
    creatorsWithNoDealMatch: string[];
    fuzzyMatchesUsed: Array<{
      dealCreator: string;
      matchedCreator: string;
      brand: string;
      confidence: number;
    }>;
    missingDataWarnings: string[];
    triggeredRules: string[];
    outreachMetrics: {
      creatorsSourced: number;
      contacted: number;
      emailsSent: number;
      igOutreach: number;
      replies: number;
      bookedCalls: number;
      signed: number;
      replyRate: number;
      bookingRate: number;
      callClosingRate: number;
      overallClosingRate: number;
    };
  };
};

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function progressPct(current: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(999, Math.round((current / target) * 100));
}

function average(values: number[]) {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  if (cleanValues.length === 0) return 0;
  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
}

function formatSnapshotDate(value?: string) {
  if (!value) return "Current dashboard snapshot";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString([], { dateStyle: "medium" });
}

function getMemberOutreach(data: DashboardSheetData | undefined, memberName: string) {
  return data?.outreach.members.find((member) => member.memberName === memberName) ?? null;
}

function getMemberExclusiveCreators(data: DashboardSheetData | undefined, memberName: string) {
  return (
    data?.creators.filter(
      (creator) => creator.owner === memberName && creator.relationship === "Exclusive",
    ) ?? []
  );
}

function getMemberDeals(data: DashboardSheetData | undefined, memberName: string) {
  return data?.deals.filter((deal) => deal.manager === memberName) ?? [];
}

function getTeamRank(
  members: Teammate[],
  data: DashboardSheetData | undefined,
  memberName: string,
) {
  const ranked = members
    .map((member) => ({
      name: member.name,
      value: getMemberDeals(data, member.name).reduce((sum, deal) => sum + deal.totalPricingGbp, 0),
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  const index = ranked.findIndex((item) => item.name === memberName);
  return index >= 0 ? index + 1 : null;
}

function getTopRevenueShare(items: Array<{ value: number }>) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const top = [...items].sort((a, b) => b.value - a.value)[0]?.value ?? 0;
  return {
    total,
    top,
    share: percentage(top, total),
  };
}

function getTopNRevenueShare(items: Array<{ value: number }>, count: number) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const top = [...items]
    .sort((a, b) => b.value - a.value)
    .slice(0, count)
    .reduce((sum, item) => sum + item.value, 0);

  return {
    total,
    top,
    share: percentage(top, total),
  };
}

function getTeamBenchmarks(
  members: Teammate[],
  data: DashboardSheetData | undefined,
  settings: GoalSettings,
): PersonalReportBenchmarks {
  const profiles = members.map((member) => {
    const memberDeals = getMemberDeals(data, member.name);
    const liveDeals = memberDeals.filter((deal) => deal.status === "Posted");
    const exclusiveCreators = getMemberExclusiveCreators(data, member.name);
    const outreach = getMemberOutreach(data, member.name);
    const revenue = memberDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);

    return {
      dealCount: memberDeals.length,
      liveDealCount: liveDeals.length,
      revenue,
      creatorCount: exclusiveCreators.length,
      creatorEfficiency: exclusiveCreators.length > 0 ? revenue / exclusiveCreators.length : 0,
      opportunityDensity:
        exclusiveCreators.length > 0 ? memberDeals.length / exclusiveCreators.length : 0,
      avgDealValue: memberDeals.length > 0 ? revenue / memberDeals.length : 0,
      commissionProgress: progressPct(member.pendingOwed, getMemberMonthlyGoal(settings, member)),
      creatorsSourced: outreach?.totalCreators ?? 0,
      contacted: outreach?.contacted ?? 0,
      emailsSent: outreach?.emailed ?? 0,
      igOutreach: outreach?.igOutreach ?? 0,
      replies: outreach?.replies ?? 0,
      calls: outreach?.bookedCalls ?? 0,
      signed: outreach?.signed ?? 0,
      replyRate: outreach?.replyRate ?? 0,
      bookingRate: outreach?.bookingRate ?? 0,
      callClosingRate: outreach?.callClosingRate ?? 0,
      overallClosingRate: outreach?.overallClosingRate ?? 0,
    };
  });

  return {
    avgDealCount: average(profiles.map((profile) => profile.dealCount)),
    avgLiveDealCount: average(profiles.map((profile) => profile.liveDealCount)),
    avgRevenue: average(profiles.map((profile) => profile.revenue)),
    avgCreatorCount: average(profiles.map((profile) => profile.creatorCount)),
    avgCreatorEfficiency: average(
      profiles
        .filter((profile) => profile.creatorCount > 0)
        .map((profile) => profile.creatorEfficiency),
    ),
    avgOpportunityDensity: average(
      profiles
        .filter((profile) => profile.creatorCount > 0)
        .map((profile) => profile.opportunityDensity),
    ),
    avgDealValue: average(
      profiles.filter((profile) => profile.dealCount > 0).map((profile) => profile.avgDealValue),
    ),
    avgCommissionProgress: average(profiles.map((profile) => profile.commissionProgress)),
    avgCreatorsSourced: average(profiles.map((profile) => profile.creatorsSourced)),
    avgContacted: average(profiles.map((profile) => profile.contacted)),
    avgEmailsSent: average(profiles.map((profile) => profile.emailsSent)),
    avgIgOutreach: average(profiles.map((profile) => profile.igOutreach)),
    avgReplies: average(profiles.map((profile) => profile.replies)),
    avgCalls: average(profiles.map((profile) => profile.calls)),
    avgSigned: average(profiles.map((profile) => profile.signed)),
    avgReplyRate: average(profiles.map((profile) => profile.replyRate)),
    avgBookingRate: average(profiles.map((profile) => profile.bookingRate)),
    avgCallClosingRate: average(profiles.map((profile) => profile.callClosingRate)),
    avgOverallClosingRate: average(profiles.map((profile) => profile.overallClosingRate)),
  };
}

function getCreatorRevenueRisk(performance: CreatorPerformance[]) {
  const creatorsWithRevenue = performance
    .filter((creator) => creator.totalDealValue > 0)
    .map((creator) => ({ label: creator.displayName, value: creator.totalDealValue }));

  return getTopRevenueShare(creatorsWithRevenue);
}

function getCreatorPortfolioRevenueRisk(performance: CreatorPerformance[]) {
  const creatorsWithRevenue = performance
    .filter((creator) => creator.totalDealValue > 0)
    .map((creator) => ({ label: creator.displayName, value: creator.totalDealValue }));

  return getTopNRevenueShare(creatorsWithRevenue, 3);
}

function getBrandRevenueRisk(memberDeals: Deal[]) {
  const brandMap = new Map<string, { brand: string; value: number; deals: number }>();

  for (const deal of memberDeals) {
    const brand = deal.brand || "Unknown brand";
    const current = brandMap.get(brand) ?? { brand, value: 0, deals: 0 };
    current.value += deal.totalPricingGbp;
    current.deals += 1;
    brandMap.set(brand, current);
  }

  const topBrands = [...brandMap.values()]
    .sort((a, b) => b.value - a.value || b.deals - a.deals)
    .slice(0, 3);
  const risk = getTopRevenueShare(topBrands);

  return { topBrands, risk };
}

function getStrongestPlatform(platformMix: CreatorPerformance["platformMix"]) {
  return [...platformMix].sort((a, b) => b.value - a.value || b.count - a.count)[0] ?? null;
}

function combinePlatformMix(performance: CreatorPerformance[]) {
  return performance
    .flatMap((creator) => creator.platformMix)
    .reduce<CreatorPerformance["platformMix"]>((acc, item) => {
      const existing = acc.find((platform) => platform.platform === item.platform);
      if (existing) {
        existing.count += item.count;
        existing.value += item.value;
      } else {
        acc.push({ ...item });
      }
      return acc;
    }, [])
    .sort((a, b) => b.value - a.value || b.count - a.count);
}

function getOutreachMetricFallback(
  outreach: OutreachMemberStats | null,
  member: Teammate,
) {
  return {
    creatorsSourced: outreach?.totalCreators ?? 0,
    contacted: outreach?.contacted ?? 0,
    emailsSent: outreach?.emailed ?? 0,
    igOutreach: outreach?.igOutreach ?? 0,
    replies: outreach?.replies ?? 0,
    bookedCalls: outreach?.bookedCalls ?? 0,
    signed: outreach?.signed ?? member.exclusiveCreators + member.nonExclusiveCreators,
    replyRate: outreach?.replyRate ?? 0,
    bookingRate: outreach?.bookingRate ?? 0,
    callClosingRate: outreach?.callClosingRate ?? 0,
    overallClosingRate: outreach?.overallClosingRate ?? 0,
    topNiche: outreach?.topNiche ?? "-",
  };
}

export function buildPersonalReport(
  data: DashboardSheetData | undefined,
  members: Teammate[],
  member: Teammate | null,
  settings: GoalSettings,
): PersonalReport | null {
  if (!member) return null;

  const outreach = getMemberOutreach(data, member.name);
  const memberDeals = getMemberDeals(data, member.name);
  const liveDeals = memberDeals.filter((deal) => deal.status === "Posted");
  const memberCreators = getMemberExclusiveCreators(data, member.name);
  const creatorPerformance = buildExclusiveCreatorPerformance(memberCreators, memberDeals);
  const totalDealValue = memberDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);
  const liveDealValue = liveDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);
  const exclusiveCreatorCount = memberCreators.length || member.exclusiveCreators;
  const monthlyTarget = getMemberMonthlyGoal(settings, member);
  const progressionTarget = getMemberProgressionGoal(settings, member);
  const exclusiveTarget = getMemberExclusiveCreatorGoal(settings, member);
  const monthlyProgress = progressPct(member.pendingOwed, monthlyTarget);
  const progressionProgress = progressPct(member.commission, progressionTarget);
  const exclusiveProgress = progressPct(exclusiveCreatorCount, exclusiveTarget);
  const avgDealValue = memberDeals.length > 0 ? Math.round(totalDealValue / memberDeals.length) : 0;
  const revenueEfficiency =
    exclusiveCreatorCount > 0 ? Math.round(totalDealValue / exclusiveCreatorCount) : null;
  const benchmarks = getTeamBenchmarks(members, data, settings);
  const teamRank = getTeamRank(members, data, member.name);
  const outreachMetrics = getOutreachMetricFallback(outreach, member);
  const activeCreatorCount = creatorPerformance.all.filter((creator) => creator.totalDeals > 0).length;
  const inactiveCreators = creatorPerformance.all.filter((creator) => creator.totalDeals === 0);
  const lowContributionCreators = creatorPerformance.all.filter(
    (creator) => creator.totalDeals > 0 && creator.totalDealValue < Math.max(500, avgDealValue * 0.35),
  );
  const hiddenOpportunity =
    [...creatorPerformance.all]
      .filter((creator) => creator.totalDeals > 0 && creator.totalDeals <= 2)
      .sort((a, b) => b.avgDealValue - a.avgDealValue)[0] ?? null;
  const creatorRisk = getCreatorRevenueRisk(creatorPerformance.all);
  const creatorPortfolioRisk = getCreatorPortfolioRevenueRisk(creatorPerformance.all);
  const brandData = getBrandRevenueRisk(memberDeals);
  const platformMix = combinePlatformMix(creatorPerformance.all);
  const strongestPlatform = getStrongestPlatform(platformMix);
  const commissionGoalMissed = member.pendingOwed < monthlyTarget;
  const opportunityDensity =
    exclusiveCreatorCount > 0 ? memberDeals.length / exclusiveCreatorCount : 0;
  const insights = evaluatePersonalReportRules({
    exclusiveCreatorCount,
    exclusiveTarget,
    monthlyProgress,
    commissionGoalMissed,
    totalDealValue,
    avgDealValue,
    revenueEfficiency,
    memberDealCount: memberDeals.length,
    liveDealCount: liveDeals.length,
    inactiveCreatorCount: inactiveCreators.length,
    creatorRevenueShare: creatorRisk.share,
    topThreeCreatorRevenueShare: creatorPortfolioRisk.share,
    opportunityDensity,
    ...outreachMetrics,
    benchmarks,
  });
  const { primary, supporting, opportunity, superpower } = chooseReportInsights(insights);

  const positives = [
    superpower.observation,
    opportunity?.observation ?? null,
  ].filter(Boolean).slice(0, 2) as string[];

  if (positives.length === 0) {
    positives.push(
      outreachMetrics.contacted > 0
        ? `You already have activity in the funnel with ${outreachMetrics.contacted} contacted creators.`
        : "This is still early enough to shape the week properly.",
    );
  }

  const evidence = [
    ...primary.evidence,
    `Selected bottleneck category: ${primary.category}.`,
  ].filter(Boolean).slice(0, 4) as string[];

  const extraInsights = [
    supporting ? `Supporting insight: ${supporting.title}: ${supporting.observation}` : null,
    supporting?.diagnosis ? `Supporting diagnosis: ${supporting.diagnosis}` : null,
    opportunity ? `Opportunity insight: ${opportunity.title}: ${opportunity.observation}` : null,
    `Superpower selected: ${superpower.title}.`,
  ].filter(Boolean).slice(0, 4) as string[];
  const expandedInsights = [
    ...extraInsights,
    creatorRisk.share > 50
      ? `Revenue concentration risk: ${creatorRisk.share}% of matched creator revenue comes from one creator. Build the second and third strongest creators.`
      : null,
    creatorPortfolioRisk.share > 75
      ? `Portfolio concentration: ${creatorPortfolioRisk.share}% of matched creator revenue comes from the top 3 creators.`
      : null,
    brandData.risk.share > 60
      ? `Brand concentration risk: ${brandData.risk.share}% of value comes from the top brand. Diversify brand relationships.`
      : null,
    inactiveCreators.length > 0
      ? `${inactiveCreators.length} exclusive creator${inactiveCreators.length === 1 ? "" : "s"} have no matched deals yet.`
      : null,
    hiddenOpportunity
      ? `${hiddenOpportunity.displayName} has low volume but strong average deal value at ${formatMoney(hiddenOpportunity.avgDealValue)}.`
      : null,
    strongestPlatform
      ? `${strongestPlatform.platform} leads platform mix with ${formatMoney(strongestPlatform.value)} from ${strongestPlatform.count} deal${strongestPlatform.count === 1 ? "" : "s"}.`
      : null,
    memberDeals.length > benchmarks.avgDealCount
      ? `Deal count is above team average: ${memberDeals.length} versus ${Math.round(benchmarks.avgDealCount)}.`
      : `Deal count is at ${memberDeals.length} versus team average ${Math.round(benchmarks.avgDealCount)}.`,
    `Deals per exclusive creator: ${opportunityDensity.toFixed(1)} versus team average ${benchmarks.avgOpportunityDensity.toFixed(1)}.`,
    `Outreach snapshot: ${outreachMetrics.creatorsSourced} sourced, ${outreachMetrics.contacted} contacted, ${outreachMetrics.emailsSent} emails, ${outreachMetrics.igOutreach} IG outreach, ${outreachMetrics.replies} replies, ${outreachMetrics.bookedCalls} calls, ${outreachMetrics.signed} signed/partnered.`,
    `Outreach rates: ${outreachMetrics.replyRate}% reply, ${outreachMetrics.bookingRate}% booking, ${outreachMetrics.callClosingRate}% call closing, ${outreachMetrics.overallClosingRate}% overall closing.`,
  ].filter(Boolean) as string[];

  const warnings = [
    !data ? "Dashboard data is still loading or unavailable." : null,
    memberCreators.length === 0 ? "No exclusive creators found for this member in Signed & Partnered." : null,
    memberDeals.length === 0 ? "No deal rows found for this member." : null,
    !outreach ? "No outreach pipeline row found for this member." : null,
    creatorPerformance.diagnostics.dealCreatorsWithoutExclusiveMatch.length > 0
      ? "Some deal creators could not be matched to exclusive creators."
      : null,
  ].filter(Boolean) as string[];

  return {
    snapshotDate: formatSnapshotDate(data?.updatedAt),
    memberName: member.name,
    bottleneck: primary.title,
    recommendation: primary.recommendation ?? primary.actions[0],
    primaryInsight: primary,
    supportingInsight: supporting,
    opportunityInsight: opportunity,
    superpowerInsight: superpower,
    positives,
    evidence,
    observation: primary.observation,
    priorities: primary.actions,
    extraInsights: expandedInsights,
    metrics: {
      monthlyProgress,
      monthlyCurrent: member.pendingOwed,
      monthlyTarget,
      progressionProgress,
      progressionCurrent: member.commission,
      progressionTarget,
      exclusiveProgress,
      exclusiveCreatorCount,
      exclusiveTarget,
      teamRank,
      revenueEfficiency,
      totalDealValue,
      avgDealValue,
      activeCreatorCount,
      liveDealValue,
      liveDeals: liveDeals.length,
      dealCount: memberDeals.length,
      topBrands: brandData.topBrands,
      platformMix,
      inactiveCreators,
      lowContributionCreators,
      hiddenOpportunity,
      ...outreachMetrics,
      benchmarks,
    },
    diagnostics: {
      memberSelected: member.name,
      dealsMatchedToMember: memberDeals.length,
      exclusiveCreatorsMatchedToMember: exclusiveCreatorCount,
      unmatchedCreators: creatorPerformance.diagnostics.unmatchedExclusiveCreators,
      creatorsWithNoDealMatch: inactiveCreators.map((creator) => creator.displayName).slice(0, 12),
      fuzzyMatchesUsed: creatorPerformance.diagnostics.fuzzyMatchedDeals,
      missingDataWarnings: warnings,
      triggeredRules: insights.map(
        (insight) => `${insight.title} (${insight.kind}, ${insight.category}, ${insight.priority})`,
      ),
      outreachMetrics,
    },
  };
}
