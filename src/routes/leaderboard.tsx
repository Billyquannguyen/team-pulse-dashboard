import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/layout/AppHeader";
import { team } from "@/data/team";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — Team Billion" }, { name: "description", content: "Team commission leaderboard." }] }),
  component: LeaderboardPage,
});

const palette = ["var(--fun-lime)", "var(--fun-yellow)", "var(--fun-pink)", "var(--fun-purple)", "var(--fun-blue)", "var(--fun-orange)"];

function LeaderboardPage() {
  const sorted = [...team].sort((a, b) => b.weekCommission - a.weekCommission);
  return (
    <div className="space-y-6">
      <AppHeader title="Leaderboard 🏆" subtitle="Who's bringing the heat this week." />
      <div className="grid gap-4 md:grid-cols-3">
        {sorted.slice(0, 3).map((t, i) => (
          <div key={t.id} className="rounded-3xl p-6 ring-1 ring-border" style={{ background: palette[i] }}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-70">
              <Trophy className="h-3.5 w-3.5" /> #{i + 1}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/70 text-lg font-bold">{t.initials}</div>
              <div>
                <div className="text-lg font-bold">{t.name}</div>
                <div className="text-xs opacity-70">{t.role}</div>
              </div>
            </div>
            <div className="mt-4 text-3xl font-bold">${t.weekCommission.toLocaleString()}</div>
            <div className="text-xs opacity-70">{t.dealsClosed} deals this week</div>
          </div>
        ))}
      </div>
      <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-right font-medium">Deals</th>
              <th className="px-3 py-2 text-right font-medium">Week</th>
              <th className="px-3 py-2 text-right font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">% to goal</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => (
              <tr key={t.id} className="border-t border-border/60">
                <td className="px-3 py-3 font-semibold">{i + 1}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold" style={{ background: palette[i % palette.length] }}>
                      {t.initials}
                    </div>
                    <span className="font-medium">{t.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-muted-foreground">{t.role}</td>
                <td className="px-3 py-3 text-right">{t.dealsClosed}</td>
                <td className="px-3 py-3 text-right font-semibold">${t.weekCommission.toLocaleString()}</td>
                <td className="px-3 py-3 text-right">${t.monthCommission.toLocaleString()}</td>
                <td className="px-3 py-3 text-right">{Math.round((t.weekCommission / t.weeklyGoal) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
