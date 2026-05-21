import {
  team as fallbackTeam,
  totalCommission,
  totalDealsClosed,
  totalMonthCommission,
  totalPendingOwed,
} from "@/data/team";
import type { DashboardSheetData } from "@/lib/sheets-public";
import { Briefcase, CalendarDays, CircleDollarSign, WalletCards } from "lucide-react";

export function ActivitySummaryCard({ data }: { data?: DashboardSheetData }) {
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const team = data?.team ?? (canUseLocalFallback ? fallbackTeam : []);
  const totals = data?.totals ?? {
    totalPaid: canUseLocalFallback ? totalCommission : 0,
    paidThisMonth: canUseLocalFallback ? totalMonthCommission : 0,
    pendingOwed: canUseLocalFallback ? totalPendingOwed : 0,
    dealsClosed: canUseLocalFallback ? totalDealsClosed : 0,
  };
  const stats = [
    {
      label: "Total paid",
      value: `£${totals.totalPaid.toLocaleString()}`,
      icon: CircleDollarSign,
      tone: "var(--fun-lime)",
    },
    {
      label: "Paid this month",
      value: `£${totals.paidThisMonth.toLocaleString()}`,
      icon: CalendarDays,
      tone: "var(--fun-yellow)",
    },
    {
      label: "Pending owed",
      value: `£${totals.pendingOwed.toLocaleString()}`,
      icon: WalletCards,
      tone: "var(--fun-pink)",
    },
    {
      label: "Deals closed",
      value: totals.dealsClosed.toLocaleString(),
      icon: Briefcase,
      tone: "var(--fun-purple)",
    },
  ];

  return (
    <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Member payout summary</h3>
          <p className="text-xs text-muted-foreground">
            Team totals are calculated from each member sheet.
          </p>
        </div>
        <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          Member totals
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-2xl p-3" style={{ background: stat.tone }}>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/60">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-xs font-medium opacity-80">{stat.label}</div>
              </div>
              <div className="mt-2 text-xl font-bold">{stat.value}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Member</th>
              <th className="px-3 py-2.5 text-right font-medium">Total paid</th>
              <th className="px-3 py-2.5 text-right font-medium">Paid this month</th>
              <th className="px-3 py-2.5 text-right font-medium">Pending owed</th>
              <th className="px-3 py-2.5 text-right font-medium">Deals</th>
            </tr>
          </thead>
          <tbody>
            {team.map((member) => (
              <tr key={member.id} className="border-t border-border/60 hover:bg-muted/40">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-fun-blue text-xs font-semibold">
                      {member.initials}
                    </div>
                    <div>
                      <div className="font-medium">{member.name}</div>
                      <div className="text-xs text-muted-foreground">{member.role}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-semibold">
                  £{member.commission.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right">£{member.monthCommission.toLocaleString()}</td>
                <td className="px-3 py-3 text-right">£{member.pendingOwed.toLocaleString()}</td>
                <td className="px-3 py-3 text-right">{member.dealsClosed.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
