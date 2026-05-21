import { Link } from "@tanstack/react-router";
import {
  AtSign,
  Instagram,
  MessageCircle,
  PhoneCall,
  Percent,
  UserCheck,
  Users,
} from "lucide-react";
import { team as fallbackTeam } from "@/data/team";
import type { DashboardSheetData, OutreachDashboardData } from "@/lib/sheets-public";

function fallbackOutreach(): OutreachDashboardData {
  const members = fallbackTeam.map((member) => ({
    memberName: member.name,
    initials: member.initials,
    totalCreators: 0,
    contacted: 0,
    emailed: 0,
    igOutreach: 0,
    replies: 0,
    bookedCalls: 0,
    signed: member.exclusiveCreators + member.nonExclusiveCreators,
    ended: 0,
    replyRate: 0,
    conversionRate: 0,
    topNiche: "-",
  }));

  return {
    members,
    totals: {
      totalCreators: 0,
      contacted: 0,
      emailed: 0,
      igOutreach: 0,
      replies: 0,
      bookedCalls: 0,
      signed: members.reduce((sum, member) => sum + member.signed, 0),
      ended: 0,
      replyRate: 0,
      conversionRate: 0,
      topNiche: "-",
    },
    source: "fallback",
  };
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function OutreachSummaryCard({
  data,
  title = "Outreach pipeline",
  subtitle = "Member-based creator outreach totals from the sourcing sheet.",
  showTable = true,
  action,
}: {
  data?: DashboardSheetData;
  title?: string;
  subtitle?: string;
  showTable?: boolean;
  action?: {
    label: string;
    to: string;
  };
}) {
  const outreach = data?.outreach ?? fallbackOutreach();
  const totals = outreach.totals;
  const stats = [
    {
      label: "Creators sourced",
      value: totals.totalCreators.toLocaleString(),
      icon: Users,
      tone: "var(--fun-blue)",
    },
    {
      label: "Emails sent",
      value: totals.emailed.toLocaleString(),
      icon: AtSign,
      tone: "var(--fun-lime)",
    },
    {
      label: "IG outreach",
      value: totals.igOutreach.toLocaleString(),
      icon: Instagram,
      tone: "var(--fun-pink)",
    },
    {
      label: "Replies",
      value: totals.replies.toLocaleString(),
      icon: MessageCircle,
      tone: "var(--fun-yellow)",
    },
    {
      label: "Signed & partnered",
      value: totals.signed.toLocaleString(),
      icon: UserCheck,
      tone: "var(--fun-purple)",
    },
    {
      label: "Conversion",
      value: formatPercent(totals.conversionRate),
      icon: Percent,
      tone: "var(--fun-orange)",
    },
  ];

  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {outreach.source === "google-sheet" ? "Live sourcing sheet" : "Demo fallback"}
          </div>
          {action && (
            <Link
              to={action.to}
              className="tb-action inline-flex h-8 items-center justify-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              {action.label}
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="tb-hover-lift tb-stat-tile overflow-hidden rounded-2xl p-3"
              style={{ background: stat.tone }}
            >
              <div className="flex items-center gap-2">
                <div className="tb-hover-icon flex h-8 w-8 items-center justify-center rounded-xl bg-white/60">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-xs font-medium opacity-80">{stat.label}</div>
              </div>
              <div className="mt-2 text-xl font-bold">{stat.value}</div>
            </div>
          );
        })}
      </div>

      {showTable && (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Member</th>
                <th className="px-3 py-2.5 text-right font-medium">Creators</th>
                <th className="px-3 py-2.5 text-right font-medium">Contacted</th>
                <th className="px-3 py-2.5 text-right font-medium">Emails</th>
                <th className="px-3 py-2.5 text-right font-medium">IG</th>
                <th className="px-3 py-2.5 text-right font-medium">Replies</th>
                <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                <th className="px-3 py-2.5 text-right font-medium">Signed & partnered</th>
                <th className="px-3 py-2.5 text-right font-medium">Reply rate</th>
                <th className="px-3 py-2.5 text-right font-medium">Conversion</th>
                <th className="px-3 py-2.5 text-left font-medium">Top niche</th>
              </tr>
            </thead>
            <tbody>
              {outreach.members.map((member) => (
                <tr
                  key={member.memberName}
                  className="tb-row-hover border-t border-border/60 hover:bg-muted/40"
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="tb-hover-icon flex h-8 w-8 items-center justify-center rounded-full bg-fun-blue text-xs font-semibold">
                        {member.initials}
                      </div>
                      <div className="font-medium">{member.memberName}</div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">{member.totalCreators.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right">{member.contacted.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right">{member.emailed.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right">{member.igOutreach.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right font-semibold">
                    {member.replies.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      <PhoneCall className="h-3.5 w-3.5 text-muted-foreground" />
                      {member.bookedCalls.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold">
                    {member.signed.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right">{formatPercent(member.replyRate)}</td>
                  <td className="px-3 py-3 text-right">{formatPercent(member.conversionRate)}</td>
                  <td className="px-3 py-3 text-muted-foreground">{member.topNiche}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
