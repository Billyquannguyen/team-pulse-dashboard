import { createFileRoute } from "@tanstack/react-router";
import { DollarSign, TrendingUp, Briefcase, Target } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { GoalProgressCard } from "@/components/dashboard/GoalProgressCard";
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import { RecentDealsCard } from "@/components/dashboard/RecentDealsCard";
import { ActivitySummaryCard } from "@/components/dashboard/ActivitySummaryCard";
import { EditableGoalsCard } from "@/components/dashboard/EditableGoalsCard";
import { totalMonthCommission, totalWeekCommission, totalDealsThisWeek } from "@/data/team";

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
  const avg = Math.round(totalWeekCommission / Math.max(1, totalDealsThisWeek));
  return (
    <div className="space-y-6">
      <AppHeader title="Hi, Team Billion 👋" subtitle="Here's how this week is shaping up." />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Team commission MTD" value={`$${totalMonthCommission.toLocaleString()}`} delta={12} icon={DollarSign} tone="lime" emoji="💰" />
        <KpiCard label="This week" value={`$${totalWeekCommission.toLocaleString()}`} delta={8} icon={TrendingUp} tone="yellow" emoji="🔥" />
        <KpiCard label="Deals closed" value={`${totalDealsThisWeek}`} delta={5} icon={Briefcase} tone="pink" emoji="🤝" />
        <KpiCard label="Avg deal size" value={`$${avg.toLocaleString()}`} delta={-3} icon={Target} tone="purple" />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><GoalProgressCard current={36450} target={60000} /></div>
        <LeaderboardCard />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><RecentDealsCard /></div>
        <EditableGoalsCard />
      </section>

      <section><ActivitySummaryCard /></section>
    </div>
  );
}
