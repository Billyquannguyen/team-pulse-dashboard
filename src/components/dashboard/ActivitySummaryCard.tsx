import { weeklyActivity, activityTotals } from "@/data/activity";
import { Mail, MessageSquare, PhoneCall, FileSignature } from "lucide-react";

const max = Math.max(...weeklyActivity.map((d) => d.outreach));

export function ActivitySummaryCard() {
  const stats = [
    { label: "Outreach", value: activityTotals.outreach, icon: Mail, tone: "var(--fun-lime)" },
    { label: "Replies", value: activityTotals.replies, icon: MessageSquare, tone: "var(--fun-yellow)" },
    { label: "Calls", value: activityTotals.calls, icon: PhoneCall, tone: "var(--fun-pink)" },
    { label: "Contracts", value: activityTotals.contracts, icon: FileSignature, tone: "var(--fun-purple)" },
  ];
  return (
    <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Weekly activity</h3>
        <span className="text-xs text-muted-foreground">Last 7 days</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-2xl p-3" style={{ background: s.tone }}>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/60">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-xs font-medium opacity-80">{s.label}</div>
              </div>
              <div className="mt-2 text-xl font-bold">{s.value}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex h-40 items-end gap-3">
        {weeklyActivity.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-full w-full items-end">
              <div
                className="w-full rounded-t-2xl bg-gradient-to-t from-primary to-fun-orange transition-all"
                style={{ height: `${(d.outreach / max) * 100}%` }}
                title={`${d.outreach} outreach`}
              />
            </div>
            <span className="text-xs text-muted-foreground">{d.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
