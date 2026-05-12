import { team } from "@/data/team";
import { Calendar } from "lucide-react";

export function GoalProgressCard({ current, target }: { current: number; target: number }) {
  const pct = Math.min(100, Math.round((current / target) * 100));
  const remaining = Math.max(0, target - current);
  return (
    <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Weekly team goal</div>
          <div className="mt-1 text-2xl font-bold">${current.toLocaleString()} <span className="text-base font-medium text-muted-foreground">/ ${target.toLocaleString()}</span></div>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-fun-yellow/60 px-3 py-1 text-xs font-medium">
          <Calendar className="h-3 w-3" /> 3 days left
        </div>
      </div>
      <div className="mt-5 h-4 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-fun-lime via-fun-yellow to-fun-orange"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="font-semibold text-foreground">{pct}% there</span>
        <span className="text-muted-foreground">${remaining.toLocaleString()} to go</span>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div className="flex -space-x-2">
          {team.slice(0, 6).map((t, i) => (
            <div
              key={t.id}
              className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ring-2 ring-card"
              style={{ background: ["var(--fun-lime)", "var(--fun-yellow)", "var(--fun-pink)", "var(--fun-purple)", "var(--fun-blue)", "var(--fun-orange)"][i] }}
            >
              {t.initials}
            </div>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{team.length} teammates contributing</span>
      </div>
    </div>
  );
}
