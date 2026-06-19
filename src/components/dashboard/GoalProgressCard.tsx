import { team as fallbackTeam, type Teammate } from "@/data/team";
import { Target } from "lucide-react";

export function GoalProgressCard({
  current,
  target,
  title = "Team monthly goal",
  badge = "Monthly",
  progressLabel = "there",
  paidThisMonth,
  team = fallbackTeam,
}: {
  current: number;
  target: number;
  title?: string;
  badge?: string;
  progressLabel?: string;
  paidThisMonth?: number;
  team?: Teammate[];
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const remaining = Math.max(0, target - current);
  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          <div className="mt-1 text-2xl font-bold">
            £{current.toLocaleString()}{" "}
            <span className="text-base font-medium text-muted-foreground">
              / £{target.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-fun-yellow/60 px-3 py-1 text-xs font-medium">
          <Target className="h-3 w-3" /> {badge}
        </div>
      </div>
      <div className="mt-5 h-4 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-fun-lime via-fun-yellow to-fun-orange"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="font-semibold text-foreground">
          {pct}% {progressLabel}
        </span>
        <span className="text-muted-foreground">£{remaining.toLocaleString()} left</span>
      </div>
      {paidThisMonth !== undefined && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="tb-hover-lift rounded-2xl bg-muted/50 p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Current month commission
            </div>
            <div className="mt-1 text-lg font-bold">£{(paidThisMonth ?? 0).toLocaleString()}</div>
          </div>
          <div className="tb-hover-lift rounded-2xl bg-muted/50 p-3">
            <div className="text-xs font-medium text-muted-foreground">Goal left</div>
            <div className="mt-1 text-lg font-bold">£{remaining.toLocaleString()}</div>
          </div>
        </div>
      )}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div className="flex -space-x-2">
          {team.slice(0, 6).map((t, i) => (
            <div
              key={t.id}
              className="tb-hover-icon flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ring-2 ring-card hover:z-10"
              style={{
                background: [
                  "var(--fun-lime)",
                  "var(--fun-yellow)",
                  "var(--fun-pink)",
                  "var(--fun-purple)",
                  "var(--fun-blue)",
                  "var(--fun-orange)",
                ][i],
              }}
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
