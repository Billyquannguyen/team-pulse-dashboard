import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, Loader2, RefreshCw, Sparkles, UserRound } from "lucide-react";
import Loader from "@/components/ui/loader";
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
    ruleBasedSignals: {
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

function AnalysisFact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-background/70 px-4 py-3 text-left">
      <div className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  );
}

function AIReportLoadingState({
  memberName,
  report,
}: {
  memberName: string;
  report: PersonalReport;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-background/75 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Billy GPT Personal Report
          </div>
          <h3 className="mt-2 text-2xl font-black">Analyzing {memberName}</h3>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
            Reading the dashboard summary, checking progress, wins, risks, and next actions.
          </p>
        </div>
        <div className="rounded-full bg-fun-blue/35 px-4 py-2 text-xs font-black text-foreground">
          {getCurrentMonthLabel()}
        </div>
      </div>

      <div className="relative my-4 min-h-[260px] rounded-3xl bg-muted/25">
        <Loader />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AnalysisFact
          label="Current month closed"
          value={formatMoney(report.metrics.monthlyCurrent)}
        />
        <AnalysisFact label="Closed deals" value={report.metrics.dealCount} />
        <AnalysisFact label="Creators sourced" value={report.metrics.creatorsSourced} />
        <AnalysisFact label="Replies" value={report.metrics.replies} />
      </div>
    </section>
  );
}

function AIReportErrorState({
  error,
  onRetry,
  isGenerating,
}: {
  error: string;
  onRetry: () => void;
  isGenerating: boolean;
}) {
  return (
    <section className="rounded-3xl border border-destructive/25 bg-destructive/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-background/80">
            <AlertCircle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h3 className="text-sm font-black text-destructive">AI report could not generate</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-destructive/85">{error}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
              The dashboard data is still safe. Fix the OpenRouter model or credits, then retry.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={isGenerating}
          className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Retry AI report
        </button>
      </div>
    </section>
  );
}

export function PersonalReportPanel({
  members,
  data,
  settings,
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
            Pick the member first. Billy GPT will analyze their dashboard data automatically.
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
          Generate report
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
            {report && aiReport ? (
              <button
                type="button"
                onClick={generateAIReport}
                disabled={isGeneratingAI}
                className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGeneratingAI ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Regenerate AI report
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

      {report && isGeneratingAI ? (
        <AIReportLoadingState memberName={memberName} report={report} />
      ) : null}

      {report && !isGeneratingAI && aiError ? (
        <AIReportErrorState
          error={aiError}
          onRetry={generateAIReport}
          isGenerating={isGeneratingAI}
        />
      ) : null}

      {report && !isGeneratingAI && aiReport ? (
        <section className="rounded-3xl border border-border bg-fun-blue/20 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="tb-hover-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fun-blue">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black">AI Personal Report</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Generated from this member's dashboard summary only.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={copyAIReport}
              className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-background px-4 text-sm font-bold hover:bg-accent"
            >
              {copiedAIReport ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedAIReport ? "Copied" : "Copy report"}
            </button>
          </div>

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
        </section>
      ) : null}

      {memberName && !report ? (
        <div className="rounded-3xl border border-border bg-background/75 p-6 text-sm font-bold text-muted-foreground">
          No member data available yet.
        </div>
      ) : null}
    </div>
  );
}
