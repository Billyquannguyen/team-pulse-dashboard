import type { Teammate } from "@/data/team";
import type { GoalSettings } from "@/lib/goal-settings";

export function getTeamMonthlyGoal(settings: GoalSettings) {
  return settings.teamMonthlyGoal;
}

export function getMemberMonthlyGoal(settings: GoalSettings, member: Teammate) {
  return settings.customMemberMonthlyGoals[member.id] ?? settings.memberMonthlyGoal;
}

export function getMemberProgressionGoal(settings: GoalSettings, member: Teammate) {
  return settings.customProgressionGoals[member.id] ?? settings.progressionGoal;
}

export function getTeamProgressionGoal(settings: GoalSettings, members: Teammate[]) {
  return members.reduce((sum, member) => sum + getMemberProgressionGoal(settings, member), 0);
}

export function getTeamExclusiveCreatorGoal(settings: GoalSettings) {
  return settings.teamExclusiveCreatorGoal;
}

export function getMemberExclusiveCreatorGoal(settings: GoalSettings, member: Teammate) {
  return settings.customExclusiveCreatorGoals[member.id] ?? settings.memberExclusiveCreatorGoal;
}
