import { useEffect, useState } from "react";
import { Award, ClipboardList, Target, TrendingUp } from "lucide-react";
import { DashboardSelect } from "@/components/ui/dashboard-select";
import type { Teammate } from "@/data/team";
import type { GoalSettings } from "@/lib/goal-settings";
import type { DashboardSheetData } from "@/lib/sheets-public";
import {
  buildPersonalReport,
  formatMoney,
  roundedAverage,
} from "@/lib/personal-report-engine";

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
  const [memberName, setMemberName] = useState(members[0]?.name ?? "");
  const member = members.find((item) => item.name === memberName) ?? members[0] ?? null;
  const report = buildPersonalReport(data, members, member, settings);

  useEffect(() => {
    if (!memberName && members[0]?.name) {
      setMemberName(members[0].name);
    }
  }, [memberName, members]);

  return (
    <div className="space-y-5">
      <div className="block max-w-sm">
        <span className="text-xs font-bold text-muted-foreground">Member name</span>
        <DashboardSelect
          value={memberName}
          onChange={setMemberName}
          options={members.map((memberOption) => ({
            value: memberOption.name,
            label: memberOption.name,
          }))}
          triggerClassName="h-12 px-4 text-sm font-bold"
        />
      </div>

      {report ? (
        <div className="space-y-5">
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
                        .map((creator) => `${creator.displayName}: no matched deal contribution yet.`)
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
                      : ["No scored rule was triggered, so Billy used the baseline activity fallback."]
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
