import { createFileRoute } from "@tanstack/react-router";
import {
  Briefcase,
  CalendarDays,
  CircleDollarSign,
  CirclePercent,
  DollarSign,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/layout/AppHeader";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { GoalProgressCard } from "@/components/dashboard/GoalProgressCard";
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import { HomeGoalSnapshotCard } from "@/components/dashboard/HomeGoalSnapshotCard";
import { OutreachSummaryCard } from "@/components/dashboard/OutreachSummaryCard";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { useGoalSettings } from "@/lib/goal-settings";
import { getMemberProgressionGoal, getTeamMonthlyGoal } from "@/lib/goal-targets";
import {
  team as fallbackTeam,
  totalCommission,
  totalDealsClosed,
  totalMonthCommission,
} from "@/data/team";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Team Billion" },
      { name: "description", content: "Track team commissions, goals, and activity in real time." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useQuery(dashboardSheetQuery);
  const [settings] = useGoalSettings();
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const team = data?.team ?? (canUseLocalFallback ? fallbackTeam : []);
  const getProgressionGoal = (member: (typeof team)[number]) =>
    getMemberProgressionGoal(settings, member);
  const teamMonthlyGoal = getTeamMonthlyGoal(settings);
  const totals = data?.totals ?? {
    totalPaid: canUseLocalFallback ? totalCommission : 0,
    totalPaidCommission: 0,
    paidThisMonth: canUseLocalFallback ? totalMonthCommission : 0,
    pendingOwed: 0,
    dealsClosed: canUseLocalFallback ? totalDealsClosed : 0,
    totalPricing: 0,
    averageDealSize: 0,
    averageProfitMargin: 0,
    paidGoal: teamMonthlyGoal,
    dealsGoal: 0,
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Hi, Team Billion 👋"
        subtitle={
          isLoading
            ? "Loading live Google Sheets data..."
            : "Current-month commission, all-time commission, and deal value in one view."
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="All-time commission"
          value={`£${totals.totalPaid.toLocaleString()}`}
          icon={DollarSign}
          tone="lime"
        />
        <KpiCard
          label="Current month"
          value={`£${totals.paidThisMonth.toLocaleString()}`}
          icon={CalendarDays}
          tone="orange"
        />
        <KpiCard
          label="Total paid commission"
          value={`£${totals.totalPaidCommission.toLocaleString()}`}
          icon={CircleDollarSign}
          tone="yellow"
        />
        <KpiCard
          label="Deals closed"
          value={`${totals.dealsClosed}`}
          icon={Briefcase}
          tone="pink"
        />
        <KpiCard
          label="Avg deal value"
          value={`£${totals.averageDealSize.toLocaleString()}`}
          icon={DollarSign}
          tone="purple"
        />
        <KpiCard
          label="Avg profit margin"
          value={`${totals.averageProfitMargin}%`}
          icon={CirclePercent}
          tone="blue"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GoalProgressCard
            current={totals.paidThisMonth}
            target={teamMonthlyGoal}
            title="Team monthly goal"
            badge="Monthly"
            progressLabel="to monthly goal"
            paidThisMonth={totals.paidThisMonth}
            team={team}
          />
        </div>
        <LeaderboardCard team={team} getProgressionGoal={getProgressionGoal} />
      </section>

      <section>
        <HomeGoalSnapshotCard team={team} settings={settings} />
      </section>

      <section>
        <OutreachSummaryCard
          data={data}
          title="Outreach overview"
          subtitle="Team-level sourcing, replies, and signed or partnered creators."
          showTable={false}
          action={{ label: "View full outreach data", to: "/creators" }}
        />
      </section>
    </div>
  );
}
