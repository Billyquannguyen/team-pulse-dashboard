import { Link } from "@tanstack/react-router";
import { team as fallbackTeam, type Teammate } from "@/data/team";
import { DEFAULT_GOAL_SETTINGS } from "@/lib/goal-settings";
import { Trophy } from "lucide-react";

const palette = [
  "var(--fun-lime)",
  "var(--fun-yellow)",
  "var(--fun-pink)",
  "var(--fun-purple)",
  "var(--fun-blue)",
];

export function LeaderboardCard({
  limit = 5,
  team = fallbackTeam,
  getProgressionGoal = () => DEFAULT_GOAL_SETTINGS.progressionGoal,
}: {
  limit?: number;
  team?: Teammate[];
  getProgressionGoal?: (member: Teammate) => number;
}) {
  const sorted = [...team].sort((a, b) => b.commission - a.commission).slice(0, limit);
  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-fun-orange" />
          <h3 className="text-base font-semibold">Commission leaderboard</h3>
        </div>
        <Link
          to="/leaderboard"
          className="tb-action text-xs font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      <ul className="mt-4 space-y-2">
        {sorted.map((t, i) => {
          const progressionGoal = getProgressionGoal(t);
          const pct = Math.min(100, Math.round((t.commission / progressionGoal) * 100));
          return (
            <li
              key={t.id}
              className="tb-row-hover flex items-center gap-3 rounded-2xl bg-muted/40 p-3"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-xs font-bold ring-1 ring-border">
                {i + 1}
              </span>
              <div
                className="tb-hover-icon flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: palette[i % palette.length] }}
              >
                {t.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t.dealsClosed} deals · {pct}% progression goal
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold">£{t.commission.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">
                  / £{progressionGoal.toLocaleString()}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
