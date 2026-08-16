import { Link, useRouterState } from "@tanstack/react-router";
import {
  FileSpreadsheet,
  LayoutDashboard,
  LinkIcon,
  MailPlus,
  SearchCheck,
  Settings2,
  Store,
  Table2,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/deals", label: "Deals", icon: Table2 },
  { to: "/creators", label: "Team Creators", icon: Users },
  { to: "/active-brands", label: "Brands", icon: Store },
  { to: "/brand-finder", label: "Finder", icon: SearchCheck },
  { to: "/bulk-sender", label: "Sender", icon: MailPlus },
  { to: "/pitching-sheets", label: "Pitching", icon: FileSpreadsheet },
  { to: "/goals", label: "Analytics", icon: Target },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/assets", label: "Links", icon: LinkIcon },
  { to: "/team-members", label: "Members", icon: Settings2 },
] as const;

export function MobileNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="lg:hidden fixed bottom-3 left-3 right-3 z-40 flex items-center overflow-x-auto rounded-3xl bg-card/95 p-2 shadow-lg ring-1 ring-border backdrop-blur">
      {items.map((it) => {
        const active = it.to === "/" ? path === "/" : path.startsWith(it.to);
        const Icon = it.icon;
        return (
          <Link
            key={it.to}
            to={it.to}
            className={cn(
              "tb-action flex min-w-16 flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] font-medium",
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
