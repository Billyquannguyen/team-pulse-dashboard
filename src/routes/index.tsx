import { createFileRoute } from "@tanstack/react-router";
import { Briefcase, CalendarDays, CircleDollarSign, CirclePercent, DollarSign } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/layout/AppHeader";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { GoalProgressCard } from "@/components/dashboard/GoalProgressCard";
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import { HomeGoalSnapshotCard } from "@/components/dashboard/HomeGoalSnapshotCard";
import { OutreachSummaryCard } from "@/components/dashboard/OutreachSummaryCard";
import { dashboardSheetQuery, leaderboardQuery } from "@/lib/sheets-public";
import { useGoalSettings } from "@/lib/goal-settings";
import {
  getMemberMonthlyGoal,
  getMemberProgressionGoal,
  getTeamMonthlyGoal,
} from "@/lib/goal-targets";
import { getRouteApi } from "@tanstack/react-router";
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
const rootRoute = getRouteApi("__root__");

function Dashboard() {
  const auth = rootRoute.useLoaderData();
  const { data, isLoading } = useQuery(dashboardSheetQuery);
  const { data: leaderboardData } = useQuery(leaderboardQuery);
  const [settings] = useGoalSettings();
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const team = data?.team ?? (canUseLocalFallback ? fallbackTeam : []);
  const getProgressionGoal = (member: (typeof team)[number]) =>
    getMemberProgressionGoal(settings, member);
  const teamMonthlyGoal = auth.isAdmin
    ? getTeamMonthlyGoal(settings)
    : team[0]
      ? getMemberMonthlyGoal(settings, team[0])
      : 0;
  const leaderboardTeam = auth.isAdmin
    ? team
    : (leaderboardData?.members ?? []).map((member) => ({
        id: member.id,
        name: member.name,
        initials: member.initials,
        role: "Member",
        avatarUrl: member.avatarUrl,
        commission: member.paidCommission,
        paidCommission: member.paidCommission,
        monthCommission: member.monthCommission,
        pendingOwed: 0,
        dealsClosed: member.dealsClosed,
        revenue: member.dealValue,
        revenueGoal: 0,
        dealsGoal: 0,
        exclusiveCreators: member.exclusiveCreators,
        nonExclusiveCreators: 0,
      }));
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
        title={auth.isAdmin ? "Hi, Team Billion 👋" : `Hi, ${team[0]?.name ?? auth.user?.displayName ?? "there"} 👋`}
        subtitle={
          isLoading
            ? "Loading live Google Sheets data..."
            : "Closed commission, paid commission, and deal value in one view."
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="All-time closed commission"
          value={`£${totals.totalPaid.toLocaleString()}`}
          icon={DollarSign}
          tone="lime"
        />
        <KpiCard
          label="Current month closed"
          value={`£${totals.paidThisMonth.toLocaleString()}`}
          icon={CalendarDays}
          tone="orange"
        />
        <KpiCard
          label="Paid commission"
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
            title={auth.isAdmin ? "Team monthly goal" : "My monthly goal"}
            badge="Monthly"
            progressLabel="to monthly goal"
            paidThisMonth={totals.paidThisMonth}
            team={auth.isAdmin ? team : team.slice(0, 1)}
          />
        </div>
        <LeaderboardCard team={leaderboardTeam} getProgressionGoal={getProgressionGoal} />
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
