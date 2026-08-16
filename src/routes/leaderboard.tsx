import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { team as fallbackTeam } from "@/data/team";
import { deals as fallbackDeals, isActiveDashboardDeal } from "@/data/deals";
import {
  dashboardSheetQuery,
  leaderboardQuery,
  type LeaderboardMemberData,
} from "@/lib/sheets-public";
import { canonicalMemberName } from "@/lib/sheet-normalizer";
import { BarChart3, Trophy } from "lucide-react";
import { TeamAvatar } from "@/components/ui/team-avatar";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — Team Billion" },
      { name: "description", content: "Team commission leaderboard." },
    ],
  }),
  component: LeaderboardPage,
});

const palette = [
  "var(--fun-lime)",
  "var(--fun-yellow)",
  "var(--fun-pink)",
  "var(--fun-purple)",
  "var(--fun-blue)",
  "var(--fun-orange)",
];

function formatCurrency(value: number) {
  return `£${value.toLocaleString()}`;
}

function formatCompactCurrency(value: number) {
  if (value >= 1000) return `£${Math.round(value / 1000)}k`;
  return `£${value.toLocaleString()}`;
}

type LeaderboardCategory = {
  key: keyof Pick<
    LeaderboardMemberData,
    | "monthCommission"
    | "dealsClosed"
    | "dealValue"
    | "profit"
    | "averageDealValue"
    | "exclusiveCreators"
    | "contacted"
    | "replies"
    | "bookedCalls"
    | "signed"
    | "replyRate"
    | "bookingRate"
    | "closingRate"
  >;
  label: string;
  shortLabel: string;
  description: string;
  format: "money" | "count" | "percent";
  minimum?: (member: LeaderboardMemberData) => boolean;
};

const categories: LeaderboardCategory[] = [
  { key: "monthCommission", label: "Monthly commission", shortLabel: "Commission", description: "Current-month closed commission.", format: "money" },
  { key: "dealsClosed", label: "Deals closed", shortLabel: "Deals", description: "Valid closed deals recorded for each member.", format: "count" },
  { key: "dealValue", label: "Total deal value", shortLabel: "Deal value", description: "Total pricing across active deal rows.", format: "money" },
  { key: "profit", label: "Profit generated", shortLabel: "Profit", description: "Total pricing minus creator cost.", format: "money" },
  { key: "averageDealValue", label: "Average deal value", shortLabel: "Avg deal", description: "Average value across active deal rows.", format: "money" },
  { key: "exclusiveCreators", label: "Exclusive creators", shortLabel: "Exclusive", description: "Exclusive creators assigned to each member.", format: "count" },
  { key: "contacted", label: "Creators contacted", shortLabel: "Contacted", description: "Outreach contacts recorded in member sourcing tabs.", format: "count" },
  { key: "replies", label: "Replies", shortLabel: "Replies", description: "Replies recorded from outreach activity.", format: "count" },
  { key: "bookedCalls", label: "Booked calls", shortLabel: "Calls", description: "Calls booked from outreach activity.", format: "count" },
  { key: "signed", label: "Creators signed", shortLabel: "Signed", description: "Signed or partnered creators from outreach.", format: "count" },
  { key: "replyRate", label: "Reply rate", shortLabel: "Reply rate", description: "Requires at least 20 contacted creators for a fair comparison.", format: "percent", minimum: (member) => member.contacted >= 20 },
  { key: "bookingRate", label: "Booking rate", shortLabel: "Booking rate", description: "Requires at least 20 contacted creators for a fair comparison.", format: "percent", minimum: (member) => member.contacted >= 20 },
  { key: "closingRate", label: "Overall closing rate", shortLabel: "Closing rate", description: "Requires at least 20 contacted creators for a fair comparison.", format: "percent", minimum: (member) => member.contacted >= 20 },
];

function formatMetric(value: number, format: LeaderboardCategory["format"]) {
  if (format === "money") return formatCurrency(value);
  if (format === "percent") return `${value}%`;
  return value.toLocaleString();
}

function getDealProfit(deal: { totalPricingGbp: number; creatorTotalGbp: number }) {
  return Math.max(0, deal.totalPricingGbp - deal.creatorTotalGbp);
}

function MetricTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  format: LeaderboardCategory["format"];
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold">{label}</div>
      <div className="mt-1 space-y-1">
        {payload.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-5">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: item.color ?? "var(--primary)" }}
              />
              {item.name}
            </span>
            <span className="font-semibold">{formatMetric(Number(item.value ?? 0), format)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeaderboardPage() {
  const { data } = useQuery(dashboardSheetQuery);
  const { data: leaderboardData } = useQuery(leaderboardQuery);
  const [categoryKey, setCategoryKey] = useState<LeaderboardCategory["key"]>("monthCommission");
  const category = categories.find((item) => item.key === categoryKey) ?? categories[0];
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const fallbackLeaderboard: LeaderboardMemberData[] = fallbackTeam.map((member) => ({
    id: member.id,
    name: member.name,
    initials: member.initials,
    avatarUrl: member.avatarUrl,
    monthCommission: member.monthCommission,
    paidCommission: member.paidCommission,
    dealsClosed: member.dealsClosed,
    dealValue: member.revenue,
    profit: 0,
    averageDealValue: member.dealsClosed ? Math.round(member.revenue / member.dealsClosed) : 0,
    exclusiveCreators: member.exclusiveCreators,
    contacted: 0,
    replies: 0,
    bookedCalls: 0,
    signed: member.exclusiveCreators + member.nonExclusiveCreators,
    replyRate: 0,
    bookingRate: 0,
    closingRate: 0,
  }));
  const members = leaderboardData?.members ?? (canUseLocalFallback ? fallbackLeaderboard : []);
  const sorted = useMemo(
    () =>
      [...members].sort((a, b) => {
        const aEligible = category.minimum ? category.minimum(a) : true;
        const bEligible = category.minimum ? category.minimum(b) : true;
        if (aEligible !== bEligible) return Number(bEligible) - Number(aEligible);
        return Number(b[category.key]) - Number(a[category.key]) || a.name.localeCompare(b.name);
      }),
    [category, members],
  );
  const chartData = sorted.map((member) => ({
    name: member.name,
    value: category.minimum && !category.minimum(member) ? 0 : Number(member[category.key]),
  }));
  const podiumMembers = sorted
    .filter((member) => (category.minimum ? category.minimum(member) : true))
    .slice(0, 3);
  const deals = data?.deals ?? (canUseLocalFallback ? fallbackDeals : []);
  const activeMemberNames = new Set(members.map((member) => canonicalMemberName(member.name)));
  const activeDeals = deals.filter(
    (deal) =>
      isActiveDashboardDeal(deal) && activeMemberNames.has(canonicalMemberName(deal.manager)),
  );
  const topDeals = [...activeDeals]
    .sort((a, b) => b.totalPricingGbp - a.totalPricingGbp)
    .slice(0, 5);
  const topProfitDeals = [...activeDeals]
    .sort((a, b) => getDealProfit(b) - getDealProfit(a))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <AppHeader
        title="Leaderboard"
        subtitle="Compare team performance across commission, deals, outreach, and creator growth."
      />

      <div className="rounded-3xl bg-card p-3 ring-1 ring-border">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Leaderboard category">
          {categories.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={item.key === category.key}
              onClick={() => setCategoryKey(item.key)}
              className={`tb-action shrink-0 rounded-2xl px-4 py-2.5 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                item.key === category.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {item.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {podiumMembers.map((t, i) => (
          <div
            key={t.id}
            className="tb-hover-lift tb-stat-tile overflow-hidden rounded-3xl p-6 ring-1 ring-border"
            style={{ background: palette[i] }}
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-70">
              <Trophy className="h-3.5 w-3.5" /> #{i + 1}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <TeamAvatar
                name={t.name}
                initials={t.initials}
                avatarUrl={t.avatarUrl}
                className="h-14 w-14"
                fallbackClassName="bg-white/70 text-lg font-bold"
              />
              <div>
                <div className="text-lg font-bold">{t.name}</div>
                <div className="text-xs opacity-70">Team member</div>
              </div>
            </div>
            <div className="mt-4 text-3xl font-bold">
              {formatMetric(Number(t[category.key]), category.format)}
            </div>
            <div className="text-xs opacity-70">
              {category.label} · {t.dealsClosed} deals
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-3xl bg-card ring-1 ring-border">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold">Full ranking</h3>
          <p className="mt-1 text-xs text-muted-foreground">{category.description}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Rank</th>
                <th className="px-5 py-3 text-left font-medium">Member</th>
                <th className="px-5 py-3 text-right font-medium">{category.label}</th>
                <th className="px-5 py-3 text-right font-medium">Sample</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((member, index) => {
                const eligible = category.minimum ? category.minimum(member) : true;
                return (
                  <tr key={member.id} className="border-t border-border/60 hover:bg-muted/40">
                    <td className="px-5 py-3 font-black">{eligible ? `#${index + 1}` : "-"}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <TeamAvatar
                          name={member.name}
                          initials={member.initials}
                          avatarUrl={member.avatarUrl}
                          className="h-8 w-8"
                          fallbackClassName="bg-fun-blue text-xs"
                        />
                        <span className="font-semibold">{member.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-black">
                      {eligible
                        ? formatMetric(Number(member[category.key]), category.format)
                        : "Not enough data"}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">
                      {member.contacted.toLocaleString()} contacted
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{category.label} by member</h3>
            <p className="text-xs text-muted-foreground">
              {category.description}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            {category.format === "money" ? "GBP" : category.format === "percent" ? "%" : "Count"}
          </div>
        </div>
        <div className="mt-5 h-[340px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 12, left: 6, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="4 4" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis
                width={56}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  category.format === "money"
                    ? formatCompactCurrency(Number(value))
                    : category.format === "percent"
                      ? `${value}%`
                      : Number(value).toLocaleString()
                }
              />
              <Tooltip content={<MetricTooltip format={category.format} />} cursor={{ fill: "hsl(var(--muted))" }} />
              <Bar
                dataKey="value"
                name={category.label}
                fill="var(--fun-blue)"
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Top 5 deals by total pricing</h3>
            <p className="text-xs text-muted-foreground">
              Highest revenue rows from the live deal sheet.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">#</th>
                <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                <th className="px-3 py-2.5 text-left font-medium">Creator</th>
                <th className="px-3 py-2.5 text-left font-medium">Member</th>
                <th className="px-3 py-2.5 text-right font-medium">Total pricing</th>
                <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                <th className="px-3 py-2.5 text-right font-medium">Profit</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {topDeals.map((deal, index) => (
                <tr
                  key={deal.id}
                  className="tb-row-hover border-t border-border/60 hover:bg-muted/40"
                >
                  <td className="px-3 py-3 font-semibold">{index + 1}</td>
                  <td className="px-3 py-3 font-medium">{deal.brand}</td>
                  <td className="px-3 py-3 text-muted-foreground">{deal.creator}</td>
                  <td className="px-3 py-3">{deal.manager}</td>
                  <td className="px-3 py-3 text-right font-semibold">
                    {formatCurrency(deal.totalPricingGbp)}
                  </td>
                  <td className="px-3 py-3 text-right">{deal.profitMargin || "-"}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(getDealProfit(deal))}</td>
                  <td className="px-3 py-3">{deal.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Top 5 deals by profit</h3>
            <p className="text-xs text-muted-foreground">
              Profit is calculated as total pricing minus creator total.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">#</th>
                <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                <th className="px-3 py-2.5 text-left font-medium">Creator</th>
                <th className="px-3 py-2.5 text-left font-medium">Member</th>
                <th className="px-3 py-2.5 text-right font-medium">Profit</th>
                <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                <th className="px-3 py-2.5 text-right font-medium">Total pricing</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {topProfitDeals.map((deal, index) => (
                <tr
                  key={deal.id}
                  className="tb-row-hover border-t border-border/60 hover:bg-muted/40"
                >
                  <td className="px-3 py-3 font-semibold">{index + 1}</td>
                  <td className="px-3 py-3 font-medium">{deal.brand}</td>
                  <td className="px-3 py-3 text-muted-foreground">{deal.creator}</td>
                  <td className="px-3 py-3">{deal.manager}</td>
                  <td className="px-3 py-3 text-right font-semibold">
                    {formatCurrency(getDealProfit(deal))}
                  </td>
                  <td className="px-3 py-3 text-right">{deal.profitMargin || "-"}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(deal.totalPricingGbp)}</td>
                  <td className="px-3 py-3">{deal.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
