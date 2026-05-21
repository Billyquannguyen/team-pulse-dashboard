import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  LinkIcon,
  Sparkles,
  Store,
  Table2,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { totalPendingOwed } from "@/data/team";
import { useGoalSettings } from "@/lib/goal-settings";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { TeamMonthlyGoalCard } from "@/components/ui/team-monthly-goal-card";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/deals", label: "Deals", icon: Table2 },
  { to: "/creators", label: "Creators", icon: Users },
  { to: "/active-brands", label: "Active Brands", icon: Store },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/assets", label: "Team Assets", icon: LinkIcon },
] as const;

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data } = useQuery(dashboardSheetQuery);
  const [settings] = useGoalSettings();
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const pendingOwed = data?.totals.pendingOwed ?? (canUseLocalFallback ? totalPendingOwed : 0);
  const showGoalCard = !path.startsWith("/goals");

  return (
    <aside className="hidden lg:flex lg:w-72 shrink-0 flex-col gap-2 p-5">
      <Link to="/" className="group flex items-center gap-2 px-3 py-2">
        <div className="tb-hover-icon flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <div className="text-base font-bold leading-tight">Team Billion</div>
          <div className="text-xs text-muted-foreground">Influencer HQ</div>
        </div>
      </Link>
      <nav className="mt-4 flex flex-col gap-1">
        {items.map((it) => {
          const active = it.to === "/" ? path === "/" : path.startsWith(it.to);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "tb-action group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "tb-hover-icon flex h-9 w-9 items-center justify-center rounded-xl",
                  active
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground group-hover:bg-accent",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              {it.label}
            </Link>
          );
        })}
      </nav>
      {showGoalCard && (
        <Link
          to="/goals"
          className="mt-auto block outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TeamMonthlyGoalCard current={pendingOwed} target={settings.teamMonthlyGoal} />
        </Link>
      )}
    </aside>
  );
}
