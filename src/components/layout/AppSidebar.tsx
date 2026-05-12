import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Table2, Target, Trophy, LinkIcon, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/deals", label: "Deals", icon: Table2 },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/assets", label: "Team Assets", icon: LinkIcon },
] as const;

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="hidden md:flex md:w-64 lg:w-72 shrink-0 flex-col gap-2 p-5">
      <Link to="/" className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
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
                "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl",
                  active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:bg-accent"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-3xl bg-fun-lime/60 p-5 text-foreground">
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">This week</div>
        <div className="mt-1 text-2xl font-bold">Let's hit $60K 🎯</div>
        <div className="mt-1 text-xs opacity-70">You're 60% there. Keep pushing!</div>
      </div>
    </aside>
  );
}
