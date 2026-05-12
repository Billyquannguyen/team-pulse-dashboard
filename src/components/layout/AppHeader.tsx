import { Bell, Search } from "lucide-react";
import { team } from "@/data/team";

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search anything"
            className="h-11 w-64 rounded-2xl border border-border bg-card pl-9 pr-12 text-sm outline-none transition focus:ring-2 focus:ring-primary/30"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </span>
        </div>
        <button className="flex h-11 w-11 items-center justify-center rounded-2xl bg-card ring-1 ring-border transition hover:bg-accent">
          <Bell className="h-4 w-4" />
        </button>
        <div className="flex -space-x-2">
          {team.slice(0, 4).map((t, i) => (
            <div
              key={t.id}
              className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold ring-2 ring-background"
              style={{ background: ["var(--fun-lime)", "var(--fun-yellow)", "var(--fun-pink)", "var(--fun-purple)"][i] }}
            >
              {t.initials}
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
