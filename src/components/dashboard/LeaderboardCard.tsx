import { Link } from "@tanstack/react-router";
import { team } from "@/data/team";
import { Trophy } from "lucide-react";

const palette = ["var(--fun-lime)", "var(--fun-yellow)", "var(--fun-pink)", "var(--fun-purple)", "var(--fun-blue)"];

export function LeaderboardCard({ limit = 5 }: { limit?: number }) {
  const sorted = [...team].sort((a, b) => b.weekCommission - a.weekCommission).slice(0, limit);
  return (
    <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-fun-orange" />
          <h3 className="text-base font-semibold">Top closers this week</h3>
        </div>
        <Link to="/leaderboard" className="text-xs font-medium text-primary hover:underline">
          View all
        </Link>
      </div>
      <ul className="mt-4 space-y-2">
        {sorted.map((t, i) => {
          const pct = Math.round((t.weekCommission / t.weeklyGoal) * 100);
          return (
            <li key={t.id} className="flex items-center gap-3 rounded-2xl bg-muted/40 p-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-xs font-bold ring-1 ring-border">
                {i + 1}
              </span>
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: palette[i % palette.length] }}
              >
                {t.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.dealsClosed} deals · {pct}% of goal</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold">${t.weekCommission.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">{t.role}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
