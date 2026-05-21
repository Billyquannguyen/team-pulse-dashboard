import { createFileRoute } from "@tanstack/react-router";
import {
  Briefcase,
  CalendarDays,
  CirclePercent,
  DollarSign,
  Target,
  WalletCards,
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
import {
  team as fallbackTeam,
  totalCommission,
  totalDealsClosed,
  totalMonthCommission,
  totalPendingOwed,
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
  const { data } = useQuery(dashboardSheetQuery);
  const [settings] = useGoalSettings();
  const team = data?.team ?? fallbackTeam;
  const getProgressionGoal = (member: (typeof team)[number]) =>
    settings.customProgressionGoals[member.id] ?? settings.progressionGoal;
  const progressionGoalTotal = team.reduce((sum, member) => sum + getProgressionGoal(member), 0);
  const totals = data?.totals ?? {
    totalPaid: totalCommission,
    paidThisMonth: totalMonthCommission,
    pendingOwed: totalPendingOwed,
    dealsClosed: totalDealsClosed,
    totalPricing: 0,
    averageDealSize: 0,
    averageProfitMargin: 0,
    paidGoal: progressionGoalTotal,
    dealsGoal: 0,
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Hi, Team Billion 👋"
        subtitle="Paid commission, pending commission, and deal value in one view."
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="Total paid commission"
          value={`£${totals.totalPaid.toLocaleString()}`}
          icon={DollarSign}
          tone="lime"
        />
        <KpiCard
          label="Paid this month"
          value={`£${totals.paidThisMonth.toLocaleString()}`}
          icon={CalendarDays}
          tone="orange"
        />
        <KpiCard
          label="Pending commission"
          value={`£${totals.pendingOwed.toLocaleString()}`}
          icon={WalletCards}
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
          icon={Target}
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
            current={totals.totalPaid}
            target={progressionGoalTotal}
            paidThisMonth={totals.paidThisMonth}
            pendingOwed={totals.pendingOwed}
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
