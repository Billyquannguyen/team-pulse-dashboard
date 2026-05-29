import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/layout/AppHeader";
import { team as fallbackTeam } from "@/data/team";
import { deals as fallbackDeals } from "@/data/deals";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { BarChart3, Trophy } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

function getDealProfit(deal: { totalPricingGbp: number; creatorTotalGbp: number }) {
  return Math.max(0, deal.totalPricingGbp - deal.creatorTotalGbp);
}

function MoneyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
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
            <span className="font-semibold">{formatCurrency(Number(item.value ?? 0))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeaderboardPage() {
  const { data } = useQuery(dashboardSheetQuery);
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const team = data?.team ?? (canUseLocalFallback ? fallbackTeam : []);
  const sorted = [...team].sort((a, b) => b.commission - a.commission);
  const chartData = sorted.map((member) => ({
    name: member.name,
    paid: member.commission,
    paidThisMonth: member.monthCommission,
    pending: member.pendingOwed,
  }));
  const deals = data?.deals ?? (canUseLocalFallback ? fallbackDeals : []);
  const activeDeals = deals.filter((deal) => deal.status !== "Cancelled");
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
        subtitle="Paid total, pending payouts, and the highest-value deals."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {sorted.slice(0, 3).map((t, i) => (
          <div
            key={t.id}
            className="tb-hover-lift tb-stat-tile overflow-hidden rounded-3xl p-6 ring-1 ring-border"
            style={{ background: palette[i] }}
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-70">
              <Trophy className="h-3.5 w-3.5" /> #{i + 1}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="tb-hover-icon flex h-14 w-14 items-center justify-center rounded-full bg-white/70 text-lg font-bold">
                {t.initials}
              </div>
              <div>
                <div className="text-lg font-bold">{t.name}</div>
                <div className="text-xs opacity-70">{t.role}</div>
              </div>
            </div>
            <div className="mt-4 text-3xl font-bold">£{t.commission.toLocaleString()}</div>
            <div className="text-xs opacity-70">{t.dealsClosed} deals closed</div>
          </div>
        ))}
      </div>

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Paid, monthly paid, and pending by member</h3>
            <p className="text-xs text-muted-foreground">
              Total paid, this month's paid commission, and pending commission.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            GBP
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
                tickFormatter={(value) => formatCompactCurrency(Number(value))}
              />
              <Tooltip content={<MoneyTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
              <Legend />
              <Bar dataKey="paid" name="Paid total" fill="var(--fun-lime)" radius={[8, 8, 0, 0]} />
              <Bar
                dataKey="paidThisMonth"
                name="Paid this month"
                fill="var(--fun-blue)"
                radius={[8, 8, 0, 0]}
              />
              <Bar
                dataKey="pending"
                name="Pending owed"
                fill="var(--fun-pink)"
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
