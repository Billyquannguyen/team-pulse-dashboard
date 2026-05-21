import { useEffect, useState } from "react";

export const GOAL_SETTINGS_KEY = "tb_goal_settings_v1";

export type GoalSettings = {
  teamMonthlyGoal: number;
  memberMonthlyGoal: number;
  progressionGoal: number;
  teamExclusiveCreatorGoal: number;
  memberExclusiveCreatorGoal: number;
  customMemberMonthlyGoals: Record<string, number>;
  customProgressionGoals: Record<string, number>;
  customExclusiveCreatorGoals: Record<string, number>;
};

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
  teamMonthlyGoal: 5000,
  memberMonthlyGoal: 1250,
  progressionGoal: 10000,
  teamExclusiveCreatorGoal: 20,
  memberExclusiveCreatorGoal: 5,
  customMemberMonthlyGoals: {},
  customProgressionGoals: {},
  customExclusiveCreatorGoals: {},
};

function positiveGoal(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeGoalMap(value: unknown) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, target]) => [key, positiveGoal(target, 0)] as const)
      .filter(([, target]) => target > 0),
  );
}

export function normalizeSettings(raw: unknown): GoalSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_GOAL_SETTINGS;
  const parsed = raw as Partial<GoalSettings>;

  return {
    teamMonthlyGoal: positiveGoal(parsed.teamMonthlyGoal, DEFAULT_GOAL_SETTINGS.teamMonthlyGoal),
    memberMonthlyGoal: positiveGoal(
      parsed.memberMonthlyGoal,
      DEFAULT_GOAL_SETTINGS.memberMonthlyGoal,
    ),
    progressionGoal: positiveGoal(parsed.progressionGoal, DEFAULT_GOAL_SETTINGS.progressionGoal),
    teamExclusiveCreatorGoal: positiveGoal(
      parsed.teamExclusiveCreatorGoal,
      DEFAULT_GOAL_SETTINGS.teamExclusiveCreatorGoal,
    ),
    memberExclusiveCreatorGoal: positiveGoal(
      parsed.memberExclusiveCreatorGoal,
      DEFAULT_GOAL_SETTINGS.memberExclusiveCreatorGoal,
    ),
    customMemberMonthlyGoals: normalizeGoalMap(parsed.customMemberMonthlyGoals),
    customProgressionGoals: normalizeGoalMap(parsed.customProgressionGoals),
    customExclusiveCreatorGoals: normalizeGoalMap(parsed.customExclusiveCreatorGoals),
  };
}

export function useGoalSettings() {
  const [settings, setSettings] = useState<GoalSettings>(DEFAULT_GOAL_SETTINGS);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(GOAL_SETTINGS_KEY);
    if (!raw) return;

    try {
      setSettings(normalizeSettings(JSON.parse(raw)));
    } catch {
      setSettings(DEFAULT_GOAL_SETTINGS);
    }
  }, []);

  const updateSettings = (next: GoalSettings) => {
    setSettings(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(GOAL_SETTINGS_KEY, JSON.stringify(next));
    }
  };

  return [settings, updateSettings] as const;
}
