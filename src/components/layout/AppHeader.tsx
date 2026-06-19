import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { team as fallbackTeam } from "@/data/team";
import { logoutFromDashboard } from "@/lib/auth";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { TeamAvatar } from "@/components/ui/team-avatar";

const rootRoute = getRouteApi("__root__");

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = rootRoute.useLoaderData();
  const { data } = useQuery(dashboardSheetQuery);
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const team = data?.team ?? (canUseLocalFallback ? fallbackTeam : []);

  const handleLogout = async () => {
    await logoutFromDashboard();
    queryClient.clear();
    await router.invalidate();
  };

  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-2xl bg-card px-3 py-2 text-xs font-bold ring-1 ring-border sm:inline-flex">
          {auth.role === "admin" ? (
            <ShieldCheck className="h-4 w-4 text-primary" />
          ) : (
            <UserRound className="h-4 w-4 text-muted-foreground" />
          )}
          {auth.role === "admin" ? "Admin" : "Team"}
        </div>
        <NotificationBell />
        <button
          type="button"
          onClick={handleLogout}
          className="tb-action flex h-11 items-center justify-center gap-2 rounded-2xl bg-card px-3 text-sm font-semibold ring-1 ring-border transition hover:bg-accent"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Log out</span>
        </button>
        <div className="flex -space-x-2">
          {team.slice(0, 4).map((t, i) => (
            <TeamAvatar
              key={t.id}
              name={t.name}
              initials={t.initials}
              avatarUrl={t.avatarUrl}
              className="h-10 w-10 ring-2 ring-background hover:z-10"
              fallbackClassName="bg-transparent text-xs"
              style={{
                background:
                  t.color ??
                  ["var(--fun-lime)", "var(--fun-yellow)", "var(--fun-pink)", "var(--fun-purple)"][
                    i
                  ],
              }}
            />
          ))}
        </div>
      </div>
    </header>
  );
}
