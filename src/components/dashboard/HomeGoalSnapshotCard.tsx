import { Link } from "@tanstack/react-router";
import { Target, UserCheck } from "lucide-react";
import { team as fallbackTeam, type Teammate } from "@/data/team";
import type { GoalSettings } from "@/lib/goal-settings";
import {
  getMemberExclusiveCreatorGoal,
  getMemberMonthlyGoal,
  getTeamExclusiveCreatorGoal,
  getTeamMonthlyGoal,
} from "@/lib/goal-targets";
import { cn } from "@/lib/utils";

function formatMoney(value: number) {
  return `£${Math.round(value).toLocaleString()}`;
}

function getPct(current: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function GoalMiniRow({
  name,
  current,
  target,
  mode,
}: {
  name: string;
  current: number;
  target: number;
  mode: "money" | "count";
}) {
  const pct = getPct(current, target);
  const format = mode === "money" ? formatMoney : (value: number) => Math.round(value).toString();

  return (
    <div className="tb-hover-lift rounded-2xl bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">{name}</span>
        <span className="text-xs font-semibold text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-card">
        <div
          className={cn(
            "h-full rounded-full",
            mode === "money"
              ? "bg-gradient-to-r from-fun-lime to-fun-yellow"
              : "bg-gradient-to-r from-fun-pink to-fun-purple",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{format(current)}</span> / {format(target)}
      </div>
    </div>
  );
}

export function HomeGoalSnapshotCard({
  team = fallbackTeam,
  settings,
}: {
  team?: Teammate[];
  settings: GoalSettings;
}) {
  const teamPending = team.reduce((sum, member) => sum + member.pendingOwed, 0);
  const teamExclusiveCreators = team.reduce((sum, member) => sum + member.exclusiveCreators, 0);

  const teamMonthlyGoal = getTeamMonthlyGoal(settings);
  const teamExclusiveCreatorGoal = getTeamExclusiveCreatorGoal(settings);

  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Goal progress</h3>
          <p className="text-xs text-muted-foreground">
            Read-only snapshot from the Goals page settings.
          </p>
        </div>
        <Link to="/goals" className="tb-action text-xs font-semibold text-primary hover:underline">
          View goals
        </Link>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="tb-hover-lift rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2">
            <div className="tb-hover-icon flex h-9 w-9 items-center justify-center rounded-xl bg-fun-lime">
              <Target className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Monthly commission goal</div>
              <div className="text-xs text-muted-foreground">Pending commission vs target</div>
            </div>
          </div>

          <div className="tb-hover-lift mt-4 rounded-2xl bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Team
                </div>
                <div className="mt-1 text-2xl font-bold">{formatMoney(teamPending)}</div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                / {formatMoney(teamMonthlyGoal)}
              </div>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-card">
              <div
                className="h-full rounded-full bg-gradient-to-r from-fun-lime to-fun-yellow"
                style={{ width: `${getPct(teamPending, teamMonthlyGoal)}%` }}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {team.map((member) => (
              <GoalMiniRow
                key={member.id}
                name={member.name}
                current={member.pendingOwed}
                target={getMemberMonthlyGoal(settings, member)}
                mode="money"
              />
            ))}
          </div>
        </div>

        <div className="tb-hover-lift rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2">
            <div className="tb-hover-icon flex h-9 w-9 items-center justify-center rounded-xl bg-fun-pink">
              <UserCheck className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Exclusive signing goal</div>
              <div className="text-xs text-muted-foreground">Exclusive creators from roster</div>
            </div>
          </div>

          <div className="tb-hover-lift mt-4 rounded-2xl bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Team
                </div>
                <div className="mt-1 text-2xl font-bold">{teamExclusiveCreators}</div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                / {teamExclusiveCreatorGoal}
              </div>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-card">
              <div
                className="h-full rounded-full bg-gradient-to-r from-fun-pink to-fun-purple"
                style={{
                  width: `${getPct(teamExclusiveCreators, teamExclusiveCreatorGoal)}%`,
                }}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {team.map((member) => (
              <GoalMiniRow
                key={member.id}
                name={member.name}
                current={member.exclusiveCreators}
                target={getMemberExclusiveCreatorGoal(settings, member)}
                mode="count"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
