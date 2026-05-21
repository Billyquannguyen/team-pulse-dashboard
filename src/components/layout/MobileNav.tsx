import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, LinkIcon, Table2, Target, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/deals", label: "Deals", icon: Table2 },
  { to: "/creators", label: "Creators", icon: Users },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/assets", label: "Links", icon: LinkIcon },
] as const;

export function MobileNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="lg:hidden fixed bottom-3 left-3 right-3 z-40 flex items-center justify-between rounded-3xl bg-card/95 p-2 shadow-lg ring-1 ring-border backdrop-blur">
      {items.map((it) => {
        const active = it.to === "/" ? path === "/" : path.startsWith(it.to);
        const Icon = it.icon;
        return (
          <Link
            key={it.to}
            to={it.to}
            className={cn(
              "tb-action flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] font-medium",
              active ? "bg-primary/15 text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
