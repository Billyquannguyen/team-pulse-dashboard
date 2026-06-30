import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Award,
  Check,
  ClipboardList,
  Copy,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { DashboardSelect } from "@/components/ui/dashboard-select";
import type { Teammate } from "@/data/team";
import type { GoalSettings } from "@/lib/goal-settings";
import type { DashboardSheetData } from "@/lib/sheets-public";
import {
  buildPersonalReport,
  formatMoney,
  roundedAverage,
  type PersonalReport,
} from "@/lib/personal-report-engine";

type AIPersonalReport = {
  summary: string;
  wins: string[];
  risks: string[];
  nextActions: string[];
  managerNote: string;
  modelUsed: string;
  warnings: string[];
};

function MetricPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-muted/50 px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  );
}

function InsightList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-2xl bg-muted/35 p-4">
      <h4 className="text-xs font-black uppercase tracking-wide text-muted-foreground">{title}</h4>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div
            key={item}
            className="rounded-xl bg-background/75 px-3 py-2 text-sm font-semibold leading-6"
          >
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

function getCurrentMonthLabel() {
  return new Date().toLocaleDateString([], { month: "long", year: "numeric" });
}

function buildStructuredReportData(
  report: PersonalReport,
  member: Teammate,
): Record<string, unknown> {
  const pendingContentDeals = Math.max(0, report.metrics.dealCount - report.metrics.liveDeals);

  return {
    member: {
      id: member.id,
      name: report.memberName,
    },
    snapshotDate: report.snapshotDate,
    dateRange: getCurrentMonthLabel(),
    commission: {
      currentMonthCommission: report.metrics.monthlyCurrent,
      currentMonthTarget: report.metrics.monthlyTarget,
      currentMonthProgressPercent: report.metrics.monthlyProgress,
      paidCommission: report.metrics.progressionCurrent,
      progressionTarget: report.metrics.progressionTarget,
      progressionProgressPercent: report.metrics.progressionProgress,
      totalClosedDealValue: report.metrics.totalDealValue,
      averageDealValue: report.metrics.avgDealValue,
      revenueEfficiencyPerExclusiveCreator: report.metrics.revenueEfficiency,
    },
    deals: {
      closedDeals: report.metrics.dealCount,
      postedDeals: report.metrics.liveDeals,
      pendingContentDeals,
      topBrands: report.metrics.topBrands,
      platformMix: report.metrics.platformMix.slice(0, 5),
    },
    creators: {
      exclusiveCreatorCount: report.metrics.exclusiveCreatorCount,
      exclusiveCreatorTarget: report.metrics.exclusiveTarget,
      exclusiveCreatorProgressPercent: report.metrics.exclusiveProgress,
      activeCreatorCount: report.metrics.activeCreatorCount,
      inactiveCreatorNames: report.metrics.inactiveCreators
        .slice(0, 8)
        .map((creator) => creator.displayName),
      lowContributionCreatorNames: report.metrics.lowContributionCreators
        .slice(0, 8)
        .map((creator) => creator.displayName),
    },
    outreach: {
      creatorsSourced: report.metrics.creatorsSourced,
      contacted: report.metrics.contacted,
      emailsSent: report.metrics.emailsSent,
      igOutreach: report.metrics.igOutreach,
      replies: report.metrics.replies,
      bookedCalls: report.metrics.bookedCalls,
      signed: report.metrics.signed,
      replyRate: report.metrics.replyRate,
      bookingRate: report.metrics.bookingRate,
      callClosingRate: report.metrics.callClosingRate,
      overallClosingRate: report.metrics.overallClosingRate,
      topNiche: report.metrics.topNiche,
    },
    ranking: {
      leaderboardPosition: report.metrics.teamRank,
      teamBenchmarks: {
        avgCreatorsSourced: roundedAverage(report.metrics.benchmarks.avgCreatorsSourced),
        avgReplyRate: roundedAverage(report.metrics.benchmarks.avgReplyRate),
        avgBookingRate: roundedAverage(report.metrics.benchmarks.avgBookingRate),
        avgCallClosingRate: roundedAverage(report.metrics.benchmarks.avgCallClosingRate),
        avgOverallClosingRate: roundedAverage(report.metrics.benchmarks.avgOverallClosingRate),
        avgDealCount: roundedAverage(report.metrics.benchmarks.avgDealCount),
        avgDealValue: roundedAverage(report.metrics.benchmarks.avgDealValue),
      },
    },
    existingRuleBasedReport: {
      bottleneck: report.bottleneck,
      recommendation: report.recommendation,
      positives: report.positives,
      evidence: report.evidence,
      observation: report.observation,
      priorities: report.priorities,
      extraInsights: report.extraInsights.slice(0, 10),
      missingDataWarnings: report.diagnostics.missingDataWarnings,
    },
  };
}

function formatAIReportForClipboard(memberName: string, report: AIPersonalReport) {
  return [
    `Billy GPT Personal Report: ${memberName}`,
    "",
    "Short performance summary",
    report.summary,
    "",
    "Key wins",
    ...report.wins.map((item) => `- ${item}`),
    "",
    "Risks / weak spots",
    ...report.risks.map((item) => `- ${item}`),
    "",
    "Suggested next actions",
    ...report.nextActions.map((item) => `- ${item}`),
    "",
    "Manager note",
    report.managerNote,
  ].join("\n");
}

function AIReportList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-black uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl bg-background/75 px-4 py-3 text-sm font-semibold">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PersonalReportPanel({
  members,
  data,
  settings,
  isAdmin,
}: {
  members: Teammate[];
  data: DashboardSheetData | undefined;
  settings: GoalSettings;
  isAdmin: boolean;
}) {
  const [memberName, setMemberName] = useState("");
  const [draftMemberName, setDraftMemberName] = useState(members[0]?.name ?? "");
  const [isPickerOpen, setIsPickerOpen] = useState(true);
  const member = memberName ? (members.find((item) => item.name === memberName) ?? null) : null;
  const report = useMemo(
    () => (member ? buildPersonalReport(data, members, member, settings) : null),
    [data, member, members, settings],
  );
  const hasMembers = members.length > 0;
  const pickerOpen = hasMembers && (!memberName || isPickerOpen);
  const [aiReport, setAiReport] = useState<AIPersonalReport | null>(null);
  const [aiError, setAiError] = useState("");
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [copiedAIReport, setCopiedAIReport] = useState(false);
  const autoGeneratedReportKey = useRef("");
  const aiRequestKey =
    member && report
      ? [
          member.id,
          report.snapshotDate,
          report.metrics.monthlyCurrent,
          report.metrics.progressionCurrent,
          report.metrics.dealCount,
          report.metrics.creatorsSourced,
        ].join(":")
      : "";

  useEffect(() => {
    if (!members.some((item) => item.name === draftMemberName) && members[0]?.name) {
      setDraftMemberName(members[0].name);
    }
  }, [draftMemberName, members]);

  useEffect(() => {
    if (memberName && !members.some((item) => item.name === memberName)) {
      setMemberName("");
      setIsPickerOpen(true);
    }
  }, [memberName, members]);

  useEffect(() => {
    setAiReport(null);
    setAiError("");
    setCopiedAIReport(false);
    autoGeneratedReportKey.current = "";
  }, [aiRequestKey]);

  const showReportForDraftMember = () => {
    if (!draftMemberName) return;
    setMemberName(draftMemberName);
    setIsPickerOpen(false);
  };

  const generateAIReport = useCallback(async () => {
    if (!member || !report) return;

    setIsGeneratingAI(true);
    setAiError("");
    setCopiedAIReport(false);

    try {
      const response = await fetch("/api/ai/personal-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: member.id,
          memberName: member.name,
          dateRange: getCurrentMonthLabel(),
          structuredReportData: buildStructuredReportData(report, member),
          tone: "practical, direct, manager-friendly",
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        report?: AIPersonalReport;
        error?: string;
      } | null;

      if (!response.ok || !payload?.ok || !payload.report) {
        throw new Error(payload?.error || "AI report could not be generated.");
      }

      setAiReport(payload.report);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI report could not be generated.");
    } finally {
      setIsGeneratingAI(false);
    }
  }, [member, report]);

  useEffect(() => {
    if (!member || !report || !aiRequestKey || pickerOpen) return;
    if (autoGeneratedReportKey.current === aiRequestKey) return;

    autoGeneratedReportKey.current = aiRequestKey;
    void generateAIReport();
  }, [aiRequestKey, generateAIReport, member, pickerOpen, report]);

  const copyAIReport = async () => {
    if (!aiReport || !memberName) return;

    try {
      await navigator.clipboard.writeText(formatAIReportForClipboard(memberName, aiReport));
      setCopiedAIReport(true);
      window.setTimeout(() => setCopiedAIReport(false), 1800);
    } catch {
      setCopiedAIReport(false);
      setAiError("Could not copy the AI report. You can still select and copy it manually.");
    }
  };

  const pickerCard = (
    <section className="w-full max-w-md rounded-3xl border border-border bg-background p-5 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="tb-hover-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fun-blue">
          <UserRound className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-black">Choose report member</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Personal reports are private. Pick the member first, then Billy will show that report
            only.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <span className="text-xs font-bold text-muted-foreground">Member name</span>
        <DashboardSelect
          value={draftMemberName}
          onChange={setDraftMemberName}
          options={members.map((memberOption) => ({
            value: memberOption.name,
            label: memberOption.name,
          }))}
          triggerClassName="h-12 px-4 text-sm font-bold"
        />
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {memberName && (
          <button
            type="button"
            onClick={() => setIsPickerOpen(false)}
            className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-muted px-5 text-sm font-bold hover:bg-accent"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={showReportForDraftMember}
          disabled={!draftMemberName}
          className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Show report
        </button>
      </div>
    </section>
  );

  return (
    <div className="relative space-y-5">
      {pickerOpen && !memberName && <div className="flex justify-center">{pickerCard}</div>}

      {pickerOpen && memberName && (
        <div className="absolute inset-x-0 top-0 z-20 flex justify-center rounded-3xl border border-border bg-background/90 p-4 shadow-lg backdrop-blur-sm">
          {pickerCard}
        </div>
      )}

      {memberName && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-background/75 p-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Personal report
            </div>
            <div className="mt-1 text-sm font-black">{memberName}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {report ? (
              <button
                type="button"
                onClick={generateAIReport}
                disabled={isGeneratingAI}
                className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGeneratingAI ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isGeneratingAI
                  ? "Generating..."
                  : aiReport
                    ? "Regenerate AI report"
                    : "Generate AI report"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setDraftMemberName(memberName);
                setIsPickerOpen(true);
              }}
              className="tb-action inline-flex h-10 items-center justify-center rounded-2xl bg-muted px-4 text-sm font-bold hover:bg-accent"
            >
              Change member
            </button>
          </div>
        </div>
      )}

      {report ? (
        <div className="space-y-5">
          {(aiReport || aiError || isGeneratingAI) && (
            <section className="rounded-3xl border border-border bg-fun-blue/20 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="tb-hover-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fun-blue">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black">AI Personal Report</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Generated from this member's dashboard summary only. The original report below
                      stays available as fallback.
                    </p>
                  </div>
                </div>
                {aiReport && (
                  <button
                    type="button"
                    onClick={copyAIReport}
                    className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-background px-4 text-sm font-bold hover:bg-accent"
                  >
                    {copiedAIReport ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedAIReport ? "Copied" : "Copy report"}
                  </button>
                )}
              </div>

              {isGeneratingAI && (
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-background/70 px-4 py-3 text-sm font-bold text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating a manager-ready report from the dashboard data...
                </div>
              )}

              {aiError && (
                <div className="mt-4 flex items-start gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{aiError} The non-AI report below is still available.</span>
                </div>
              )}

              {aiReport && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl bg-background/75 px-4 py-3">
                    <div className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                      Short performance summary
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-7">{aiReport.summary}</p>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <AIReportList title="Key wins" items={aiReport.wins} />
                    <AIReportList title="Risks / weak spots" items={aiReport.risks} />
                  </div>

                  <AIReportList title="Suggested next actions" items={aiReport.nextActions} />

                  <div className="rounded-2xl bg-background/75 px-4 py-3">
                    <div className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                      Plain-English manager note
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-7">{aiReport.managerNote}</p>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] font-bold text-muted-foreground">
                    <span className="rounded-full bg-background/75 px-3 py-1">
                      Model: {aiReport.modelUsed}
                    </span>
                    {aiReport.warnings.map((warning) => (
                      <span key={warning} className="rounded-full bg-background/75 px-3 py-1">
                        {warning}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="rounded-3xl border border-border bg-background/75 p-5">
            <div className="mb-4 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-black">Performance Snapshot</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricPill
                label="Monthly commission"
                value={`${report.metrics.monthlyProgress}% · ${formatMoney(report.metrics.monthlyCurrent)} / ${formatMoney(report.metrics.monthlyTarget)}`}
              />
              <MetricPill
                label="Long-term progression"
                value={`${report.metrics.progressionProgress}% · ${formatMoney(report.metrics.progressionCurrent)} / ${formatMoney(report.metrics.progressionTarget)}`}
              />
              <MetricPill
                label="Exclusive goal"
                value={`${report.metrics.exclusiveProgress}% · ${report.metrics.exclusiveCreatorCount} / ${report.metrics.exclusiveTarget}`}
              />
              <MetricPill
                label="Team rank"
                value={report.metrics.teamRank ? `#${report.metrics.teamRank}` : "Not enough data"}
              />
              <MetricPill
                label="Revenue efficiency"
                value={
                  report.metrics.revenueEfficiency === null
                    ? "Not enough creator data yet"
                    : `${formatMoney(report.metrics.revenueEfficiency)} / creator`
                }
              />
            </div>
            <div className="mt-3 text-xs font-semibold text-muted-foreground">
              Snapshot date: {report.snapshotDate} · Member: {report.memberName}
            </div>
            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-3 text-xs font-black uppercase tracking-wide text-muted-foreground">
                Outreach pipeline
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <MetricPill label="Creators sourced" value={report.metrics.creatorsSourced} />
                <MetricPill
                  label="Reply rate"
                  value={`${report.metrics.replyRate}% · avg ${Math.round(report.metrics.benchmarks.avgReplyRate)}%`}
                />
                <MetricPill
                  label="Booking rate"
                  value={`${report.metrics.bookingRate}% · avg ${Math.round(report.metrics.benchmarks.avgBookingRate)}%`}
                />
                <MetricPill
                  label="Call closing"
                  value={`${report.metrics.callClosingRate}% · avg ${Math.round(report.metrics.benchmarks.avgCallClosingRate)}%`}
                />
                <MetricPill label="Top niche" value={report.metrics.topNiche || "-"} />
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="rounded-3xl border border-border bg-fun-lime/30 p-5">
              <h3 className="text-sm font-black">What You’re Doing Well</h3>
              <div className="mt-3 space-y-2">
                {report.positives.map((insight) => (
                  <div
                    key={insight}
                    className="rounded-2xl bg-background/75 px-4 py-3 text-sm font-semibold"
                  >
                    {insight}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-fun-yellow/30 p-5">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-black">Main Bottleneck</h3>
              </div>
              <div className="mt-3 text-xl font-black">{report.bottleneck}</div>
              <p className="mt-2 text-sm font-semibold text-muted-foreground">
                Recommendation: {report.recommendation}
              </p>
            </section>
          </div>

          <section className="rounded-3xl border border-border bg-background/75 p-5">
            <h3 className="text-sm font-black">Why Billy Thinks This</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {report.evidence.map((item) => (
                <div key={item} className="rounded-2xl bg-muted/45 px-4 py-3 text-sm font-semibold">
                  {item}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-fun-pink/25 p-5">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-black">Your Superpower</h3>
            </div>
            <div className="mt-3 text-xl font-black">{report.superpowerInsight.title}</div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              {report.superpowerInsight.observation}
            </p>
          </section>

          <section className="rounded-3xl border border-border bg-background/75 p-5">
            <h3 className="text-sm font-black">Billy’s Observation</h3>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{report.observation}</p>
          </section>

          <section className="rounded-3xl border border-border bg-background/75 p-5">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-black">This Week’s Priorities</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {report.priorities.map((priority, index) => (
                <div
                  key={priority}
                  className="rounded-2xl bg-muted/45 p-4 text-sm font-semibold leading-6"
                >
                  <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">
                    {index + 1}
                  </span>
                  <div>{priority}</div>
                </div>
              ))}
            </div>
          </section>

          <details className="rounded-3xl border border-border bg-background/75 p-5">
            <summary className="cursor-pointer text-sm font-black">See More Insights</summary>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <InsightList title="Extra analysis" items={report.extraInsights} />
              <InsightList
                title="Selected supporting insight"
                items={
                  report.supportingInsight
                    ? [
                        `${report.supportingInsight.title}: ${report.supportingInsight.observation}`,
                        `Recommended focus: ${report.supportingInsight.recommendation ?? report.supportingInsight.actions[0]}`,
                      ]
                    : ["No secondary issue is stronger than the main finding right now."]
                }
              />
              <InsightList
                title="Selected opportunity insight"
                items={
                  report.opportunityInsight
                    ? [
                        `${report.opportunityInsight.title}: ${report.opportunityInsight.observation}`,
                        `Opportunity: ${report.opportunityInsight.recommendation ?? report.opportunityInsight.actions[0]}`,
                      ]
                    : ["No separate opportunity insight is strong enough yet."]
                }
              />
              <InsightList
                title="Top brands"
                items={
                  report.metrics.topBrands.length > 0
                    ? report.metrics.topBrands.map(
                        (brand) =>
                          `${brand.brand}: ${formatMoney(brand.value)} from ${brand.deals} deal${brand.deals === 1 ? "" : "s"}`,
                      )
                    : ["No brand value data yet."]
                }
              />
              <InsightList
                title="Platform mix"
                items={
                  report.metrics.platformMix.length > 0
                    ? report.metrics.platformMix.map(
                        (platform) =>
                          `${platform.platform}: ${formatMoney(platform.value)} from ${platform.count} deal${platform.count === 1 ? "" : "s"}`,
                      )
                    : ["No platform mix data yet."]
                }
              />
              <InsightList
                title="Outreach metrics"
                items={[
                  `Creators sourced: ${report.metrics.creatorsSourced} vs team average ${roundedAverage(report.metrics.benchmarks.avgCreatorsSourced)}.`,
                  `Emails sent: ${report.metrics.emailsSent} and IG outreach: ${report.metrics.igOutreach}.`,
                  `Replies: ${report.metrics.replies}, calls: ${report.metrics.bookedCalls}, signed/partnered: ${report.metrics.signed}.`,
                  `Overall closing: ${report.metrics.overallClosingRate}% vs team average ${Math.round(report.metrics.benchmarks.avgOverallClosingRate)}%.`,
                ]}
              />
              <InsightList
                title="Underused creators"
                items={
                  report.metrics.inactiveCreators.length > 0
                    ? report.metrics.inactiveCreators
                        .slice(0, 6)
                        .map(
                          (creator) => `${creator.displayName}: no matched deal contribution yet.`,
                        )
                    : ["No inactive exclusive creators detected from the matched data."]
                }
              />
            </div>
          </details>

          {isAdmin && (
            <details className="rounded-3xl border border-dashed border-border bg-muted/30 p-5">
              <summary className="cursor-pointer text-sm font-black">Admin diagnostics</summary>
              <div className="mt-4 grid gap-3 text-xs font-semibold text-muted-foreground md:grid-cols-2">
                <MetricPill label="Member selected" value={report.diagnostics.memberSelected} />
                <MetricPill label="Deals matched" value={report.diagnostics.dealsMatchedToMember} />
                <MetricPill
                  label="Exclusive creators"
                  value={report.diagnostics.exclusiveCreatorsMatchedToMember}
                />
                <MetricPill
                  label="Fuzzy matches"
                  value={report.diagnostics.fuzzyMatchesUsed.length}
                />
                <MetricPill label="Superpower" value={report.superpowerInsight.title} />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <InsightList
                  title="Creators with no deal match"
                  items={
                    report.diagnostics.creatorsWithNoDealMatch.length > 0
                      ? report.diagnostics.creatorsWithNoDealMatch
                      : ["None flagged."]
                  }
                />
                <InsightList
                  title="Missing data warnings"
                  items={
                    report.diagnostics.missingDataWarnings.length > 0
                      ? report.diagnostics.missingDataWarnings
                      : ["No missing data warnings."]
                  }
                />
                <InsightList
                  title="Fuzzy matches used"
                  items={
                    report.diagnostics.fuzzyMatchesUsed.length > 0
                      ? report.diagnostics.fuzzyMatchesUsed.map(
                          (match) =>
                            `${match.dealCreator} → ${match.matchedCreator} · ${match.brand} · ${match.confidence}%`,
                        )
                      : ["No fuzzy matches used."]
                  }
                />
                <InsightList
                  title="Triggered rule scores"
                  items={
                    report.diagnostics.triggeredRules.length > 0
                      ? report.diagnostics.triggeredRules
                      : [
                          "No scored rule was triggered, so Billy used the baseline activity fallback.",
                        ]
                  }
                />
                <InsightList
                  title="Outreach parser metrics"
                  items={[
                    `Creators sourced: ${report.diagnostics.outreachMetrics.creatorsSourced}`,
                    `Contacted: ${report.diagnostics.outreachMetrics.contacted}`,
                    `Emails sent: ${report.diagnostics.outreachMetrics.emailsSent}`,
                    `IG outreach: ${report.diagnostics.outreachMetrics.igOutreach}`,
                    `Reply / booking / call closing: ${report.diagnostics.outreachMetrics.replyRate}% / ${report.diagnostics.outreachMetrics.bookingRate}% / ${report.diagnostics.outreachMetrics.callClosingRate}%`,
                  ]}
                />
                <InsightList
                  title="Unmatched exclusive creators"
                  items={
                    report.diagnostics.unmatchedCreators.length > 0
                      ? report.diagnostics.unmatchedCreators.map((creator) => creator.creator)
                      : ["None flagged."]
                  }
                />
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="rounded-3xl border border-border bg-background/75 p-6 text-sm font-bold text-muted-foreground">
          No member data available yet.
        </div>
      )}
    </div>
  );
}
