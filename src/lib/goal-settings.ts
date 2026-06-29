import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createHeaderLookup, getHeaderCell, type HeaderLookup } from "@/lib/sheet-headers";

export const GOAL_SETTINGS_KEY = "tb_goal_settings_v1";
export const GOAL_SETTINGS_EVENT = "tb_goal_settings_updated";
export const GOAL_SETTINGS_TAB_NAME = "Goal Settings";
export const GOAL_SETTINGS_SPREADSHEET_ENV = "TEAM_ASSETS_SPREADSHEET_ID";

const GOAL_SETTINGS_ROW_ID = "dashboard-goals";
const GOAL_SETTINGS_CACHE_TTL_MS = 30 * 1000;
const GOAL_SETTINGS_QUERY_STALE_TIME_MS = GOAL_SETTINGS_CACHE_TTL_MS;
const GOAL_SETTINGS_SAVE_DEBOUNCE_MS = 600;

type GoogleSheetsConfig = {
  serviceAccountEmail: string;
  privateKey: string;
  teamSpreadsheetId: string;
  creatorSourcingSpreadsheetId: string;
};

type GoogleSheetRef = {
  memberName: string;
  sheetName: string;
  gid?: string;
};

type GoalSettingsField =
  | "id"
  | "teamMonthlyGoal"
  | "memberMonthlyGoal"
  | "progressionGoal"
  | "teamExclusiveCreatorGoal"
  | "memberExclusiveCreatorGoal"
  | "customMemberMonthlyGoals"
  | "customProgressionGoals"
  | "customExclusiveCreatorGoals"
  | "createdAt"
  | "updatedAt";

type GoalSettingsWorksheet = {
  sheet: GoogleSheetRef;
  availableTabs: string[];
  headers: string[];
  rows: string[][];
};

type GoalSettingsCacheEntry = {
  data: GoalSettingsReadResult;
  expiresAt: number;
};

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

export type GoalSettingsReadResult = {
  settings: GoalSettings;
  source: "google-sheet" | "default" | "error";
  hasStoredSettings: boolean;
  error?: string;
  warning?: string;
  links: {
    goalSettingsSheetUrl?: string;
  };
  updatedAt: string;
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

const GOAL_SETTINGS_HEADERS = [
  "ID",
  "Team Monthly Goal",
  "Member Monthly Goal",
  "Long-Term Progression Goal",
  "Team Exclusive Creator Goal",
  "Member Exclusive Creator Goal",
  "Custom Member Monthly Goals",
  "Custom Progression Goals",
  "Custom Exclusive Creator Goals",
  "Created At",
  "Updated At",
] as const;

const GOAL_SETTINGS_FIELDS: GoalSettingsField[] = [
  "id",
  "teamMonthlyGoal",
  "memberMonthlyGoal",
  "progressionGoal",
  "teamExclusiveCreatorGoal",
  "memberExclusiveCreatorGoal",
  "customMemberMonthlyGoals",
  "customProgressionGoals",
  "customExclusiveCreatorGoals",
  "createdAt",
  "updatedAt",
];

const GOAL_SETTINGS_COLUMN_ALIASES: Record<GoalSettingsField, string[]> = {
  id: ["id", "setting id", "settings id"],
  teamMonthlyGoal: ["team monthly goal", "teammonthlygoal", "monthly team goal"],
  memberMonthlyGoal: ["member monthly goal", "membermonthlygoal", "individual monthly goal"],
  progressionGoal: [
    "long-term progression goal",
    "long term progression goal",
    "progression goal",
    "progressiongoal",
  ],
  teamExclusiveCreatorGoal: [
    "team exclusive creator goal",
    "teamexclusivecreatorgoal",
    "team creator signing goal",
  ],
  memberExclusiveCreatorGoal: [
    "member exclusive creator goal",
    "memberexclusivecreatorgoal",
    "individual creator signing goal",
  ],
  customMemberMonthlyGoals: [
    "custom member monthly goals",
    "custommembermonthlygoals",
    "member monthly overrides",
  ],
  customProgressionGoals: [
    "custom progression goals",
    "customprogressiongoals",
    "progression overrides",
  ],
  customExclusiveCreatorGoals: [
    "custom exclusive creator goals",
    "customexclusivecreatorgoals",
    "exclusive creator overrides",
  ],
  createdAt: ["created at", "createdat", "created"],
  updatedAt: ["updated at", "updatedat", "updated"],
};

const goalSettingsInput = z.object({
  teamMonthlyGoal: z.number().finite().positive(),
  memberMonthlyGoal: z.number().finite().positive(),
  progressionGoal: z.number().finite().positive(),
  teamExclusiveCreatorGoal: z.number().finite().positive(),
  memberExclusiveCreatorGoal: z.number().finite().positive(),
  customMemberMonthlyGoals: z.record(z.number().finite().positive()).default({}),
  customProgressionGoals: z.record(z.number().finite().positive()).default({}),
  customExclusiveCreatorGoals: z.record(z.number().finite().positive()).default({}),
});

let goalSettingsCache: GoalSettingsCacheEntry | null = null;
let goalSettingsRefreshPromise: Promise<GoalSettingsCacheEntry> | null = null;

const getGoogleSheetsServer = createServerOnlyFn(async () => import("@/lib/google-sheets.server"));

function logGoalSettings(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:goal-settings]", message, details ?? {});
}

function positiveGoal(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function parsePositiveGoal(value: string, fallback: number) {
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return positiveGoal(parsed, fallback);
}

function normalizeGoalMap(value: unknown) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, target]) => [key, positiveGoal(target, 0)] as const)
      .filter(([, target]) => target > 0),
  );
}

function parseGoalMap(value: string) {
  if (!value.trim()) return {};

  try {
    return normalizeGoalMap(JSON.parse(value));
  } catch {
    return {};
  }
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

function settingsSignature(settings: GoalSettings) {
  return JSON.stringify(normalizeSettings(settings));
}

function hasLocalGoalSettingsOverride(settings: GoalSettings) {
  return settingsSignature(settings) !== settingsSignature(DEFAULT_GOAL_SETTINGS);
}

function readStoredGoalSettings() {
  if (typeof window === "undefined") return DEFAULT_GOAL_SETTINGS;
  const raw = localStorage.getItem(GOAL_SETTINGS_KEY);
  if (!raw) return DEFAULT_GOAL_SETTINGS;

  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_GOAL_SETTINGS;
  }
}

function writeStoredGoalSettings(settings: GoalSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GOAL_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(GOAL_SETTINGS_EVENT));
}

function normalizeSheetKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[_–—-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "");
}

function buildColumnLookup(headers: string[]): HeaderLookup<GoalSettingsField> {
  return createHeaderLookup(headers, GOAL_SETTINGS_COLUMN_ALIASES);
}

function getCell(row: string[], lookup: HeaderLookup<GoalSettingsField>, field: GoalSettingsField) {
  return getHeaderCell(row, lookup, field);
}

function hasMinimumGoalSettingsHeaders(headers: string[]) {
  const lookup = buildColumnLookup(headers);
  return (
    lookup.teamMonthlyGoal !== undefined &&
    lookup.teamMonthlyGoal >= 0 &&
    lookup.memberMonthlyGoal !== undefined &&
    lookup.memberMonthlyGoal >= 0 &&
    lookup.progressionGoal !== undefined &&
    lookup.progressionGoal >= 0
  );
}

function getGoalSettingsSpreadsheetId() {
  const spreadsheetId = process.env[GOAL_SETTINGS_SPREADSHEET_ENV]?.trim();
  if (!spreadsheetId) {
    throw new Error(`Missing required Google Sheets env var: ${GOAL_SETTINGS_SPREADSHEET_ENV}`);
  }
  return spreadsheetId;
}

function getGoalSettingsSheetUrl(spreadsheetId: string) {
  return {
    goalSettingsSheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

function findStoredGoalSettingsRow(worksheet: GoalSettingsWorksheet) {
  const lookup = buildColumnLookup(worksheet.headers);
  const idIndex = lookup.id;

  const matched = worksheet.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .find(({ row }) => {
      const rowId = idIndex !== undefined && idIndex >= 0 ? getCell(row, lookup, "id") : "";
      return normalizeSheetKey(rowId) === normalizeSheetKey(GOAL_SETTINGS_ROW_ID);
    });

  if (matched) return matched;
  const firstNonEmpty = worksheet.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .find(({ row }) => row.some((cell) => cell.trim()));

  return firstNonEmpty ?? null;
}

function normalizeGoalSettingsRow(headers: string[], row: string[]) {
  const lookup = buildColumnLookup(headers);

  return normalizeSettings({
    teamMonthlyGoal: parsePositiveGoal(
      getCell(row, lookup, "teamMonthlyGoal"),
      DEFAULT_GOAL_SETTINGS.teamMonthlyGoal,
    ),
    memberMonthlyGoal: parsePositiveGoal(
      getCell(row, lookup, "memberMonthlyGoal"),
      DEFAULT_GOAL_SETTINGS.memberMonthlyGoal,
    ),
    progressionGoal: parsePositiveGoal(
      getCell(row, lookup, "progressionGoal"),
      DEFAULT_GOAL_SETTINGS.progressionGoal,
    ),
    teamExclusiveCreatorGoal: parsePositiveGoal(
      getCell(row, lookup, "teamExclusiveCreatorGoal"),
      DEFAULT_GOAL_SETTINGS.teamExclusiveCreatorGoal,
    ),
    memberExclusiveCreatorGoal: parsePositiveGoal(
      getCell(row, lookup, "memberExclusiveCreatorGoal"),
      DEFAULT_GOAL_SETTINGS.memberExclusiveCreatorGoal,
    ),
    customMemberMonthlyGoals: parseGoalMap(getCell(row, lookup, "customMemberMonthlyGoals")),
    customProgressionGoals: parseGoalMap(getCell(row, lookup, "customProgressionGoals")),
    customExclusiveCreatorGoals: parseGoalMap(getCell(row, lookup, "customExclusiveCreatorGoals")),
  });
}

function buildGoalSettingsWriteRow(
  settings: GoalSettings,
  existingRow?: string[],
  existingLookup?: HeaderLookup<GoalSettingsField>,
) {
  const existing = (field: GoalSettingsField) =>
    existingRow && existingLookup ? getCell(existingRow, existingLookup, field).trim() : "";
  const now = new Date().toISOString();

  return GOAL_SETTINGS_FIELDS.map((field) => {
    if (field === "id") return existing("id") || GOAL_SETTINGS_ROW_ID;
    if (field === "teamMonthlyGoal") return String(settings.teamMonthlyGoal);
    if (field === "memberMonthlyGoal") return String(settings.memberMonthlyGoal);
    if (field === "progressionGoal") return String(settings.progressionGoal);
    if (field === "teamExclusiveCreatorGoal") return String(settings.teamExclusiveCreatorGoal);
    if (field === "memberExclusiveCreatorGoal") return String(settings.memberExclusiveCreatorGoal);
    if (field === "customMemberMonthlyGoals") {
      return JSON.stringify(settings.customMemberMonthlyGoals);
    }
    if (field === "customProgressionGoals") {
      return JSON.stringify(settings.customProgressionGoals);
    }
    if (field === "customExclusiveCreatorGoals") {
      return JSON.stringify(settings.customExclusiveCreatorGoals);
    }
    if (field === "createdAt") return existing("createdAt") || now;
    return now;
  });
}

async function loadGoalSettingsWorksheet(
  config: GoogleSheetsConfig,
  options: { createIfMissing?: boolean; ensureHeaders?: boolean } = {},
): Promise<GoalSettingsWorksheet> {
  const googleSheets = await getGoogleSheetsServer();
  const spreadsheetId = getGoalSettingsSpreadsheetId();
  let tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
  const expectedKey = normalizeSheetKey(GOAL_SETTINGS_TAB_NAME);
  let matchedTab = tabs.find((tab) => normalizeSheetKey(tab.sheetName) === expectedKey);

  if (!matchedTab && options.createIfMissing) {
    await googleSheets.createSheetTab(config, spreadsheetId, GOAL_SETTINGS_TAB_NAME);
    tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
    matchedTab = tabs.find((tab) => normalizeSheetKey(tab.sheetName) === expectedKey);
  }

  if (!matchedTab) {
    throw new Error(`Could not find a worksheet tab named "${GOAL_SETTINGS_TAB_NAME}".`);
  }

  const sheet = {
    memberName: GOAL_SETTINGS_TAB_NAME,
    sheetName: matchedTab.sheetName,
    gid: matchedTab.gid,
  };
  let [sheetRows] = await googleSheets.fetchSheetRowsBatch(config, spreadsheetId, [sheet]);

  if (options.ensureHeaders) {
    await googleSheets.updateSheetRow(config, spreadsheetId, sheet, 1, [...GOAL_SETTINGS_HEADERS]);
    sheetRows = {
      headers: [...GOAL_SETTINGS_HEADERS],
      rows: sheetRows?.rows ?? [],
    };
  }

  return {
    sheet,
    availableTabs: tabs.map((tab) => tab.sheetName),
    headers: sheetRows?.headers ?? [],
    rows: sheetRows?.rows ?? [],
  };
}

async function readGoalSettingsFromSheet(
  config: GoogleSheetsConfig,
): Promise<GoalSettingsReadResult> {
  let links: GoalSettingsReadResult["links"] = {};

  try {
    const spreadsheetId = getGoalSettingsSpreadsheetId();
    links = getGoalSettingsSheetUrl(spreadsheetId);
    const worksheet = await loadGoalSettingsWorksheet(config);

    if (!hasMinimumGoalSettingsHeaders(worksheet.headers)) {
      return {
        settings: DEFAULT_GOAL_SETTINGS,
        source: "default",
        hasStoredSettings: false,
        warning: `${GOAL_SETTINGS_TAB_NAME} needs goal columns before it can control the dashboard.`,
        links,
        updatedAt: new Date().toISOString(),
      };
    }

    const storedRow = findStoredGoalSettingsRow(worksheet);

    if (!storedRow) {
      return {
        settings: DEFAULT_GOAL_SETTINGS,
        source: "default",
        hasStoredSettings: false,
        warning: `${GOAL_SETTINGS_TAB_NAME} has no saved goal settings row yet.`,
        links,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      settings: normalizeGoalSettingsRow(worksheet.headers, storedRow.row),
      source: "google-sheet",
      hasStoredSettings: true,
      links,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logGoalSettings("shared goal settings unavailable", {
      reason: message,
    });

    return {
      settings: DEFAULT_GOAL_SETTINGS,
      source: "default",
      hasStoredSettings: false,
      warning: message,
      links,
      updatedAt: new Date().toISOString(),
    };
  }
}

async function refreshGoalSettingsCache(
  config: GoogleSheetsConfig,
): Promise<GoalSettingsCacheEntry> {
  const data = await readGoalSettingsFromSheet(config);
  const entry = {
    data,
    expiresAt: Date.now() + GOAL_SETTINGS_CACHE_TTL_MS,
  };

  goalSettingsCache = entry;
  return entry;
}

async function getGoalSettingsWithServerCache(config: GoogleSheetsConfig) {
  if (goalSettingsCache && goalSettingsCache.expiresAt > Date.now()) {
    return goalSettingsCache.data;
  }

  if (!goalSettingsRefreshPromise) {
    goalSettingsRefreshPromise = refreshGoalSettingsCache(config).finally(() => {
      goalSettingsRefreshPromise = null;
    });
  }

  const entry = await goalSettingsRefreshPromise;
  return entry.data;
}

function invalidateGoalSettingsCache() {
  goalSettingsCache = null;
  goalSettingsRefreshPromise = null;
}

export const fetchGoalSettingsData = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();

  return getGoalSettingsWithServerCache(config);
});

export const saveGoalSettings = createServerFn({ method: "POST" })
  .inputValidator(goalSettingsInput)
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const spreadsheetId = getGoalSettingsSpreadsheetId();
    const normalized = normalizeSettings(data);
    const worksheet = await loadGoalSettingsWorksheet(config, {
      createIfMissing: true,
      ensureHeaders: true,
    });
    const existing = findStoredGoalSettingsRow(worksheet);
    const lookup = buildColumnLookup(worksheet.headers);

    if (existing) {
      await googleSheets.updateSheetRow(
        config,
        spreadsheetId,
        worksheet.sheet,
        existing.rowNumber,
        buildGoalSettingsWriteRow(normalized, existing.row, lookup),
      );
    } else {
      await googleSheets.appendSheetRow(
        config,
        spreadsheetId,
        worksheet.sheet,
        buildGoalSettingsWriteRow(normalized),
      );
    }

    invalidateGoalSettingsCache();

    return {
      ok: true as const,
      settings: normalized,
    };
  });

export const goalSettingsQuery = {
  queryKey: ["team-billion-goal-settings", "team-assets-spreadsheet-v1"],
  queryFn: () => fetchGoalSettingsData(),
  refetchInterval: GOAL_SETTINGS_QUERY_STALE_TIME_MS,
  staleTime: GOAL_SETTINGS_QUERY_STALE_TIME_MS,
};

export function useGoalSettings() {
  const [settings, setSettings] = useState<GoalSettings>(() => readStoredGoalSettings());
  const queryClient = useQueryClient();
  const localMigrationAttemptedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastQueuedSaveRef = useRef("");
  const { data } = useQuery(goalSettingsQuery);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshSettings = () => setSettings(readStoredGoalSettings());

    refreshSettings();
    window.addEventListener("storage", refreshSettings);
    window.addEventListener(GOAL_SETTINGS_EVENT, refreshSettings);

    return () => {
      window.removeEventListener("storage", refreshSettings);
      window.removeEventListener(GOAL_SETTINGS_EVENT, refreshSettings);
    };
  }, []);

  useEffect(() => {
    if (!data) return;

    const localSettings = readStoredGoalSettings();
    const shouldSeedSharedSheet =
      !data.hasStoredSettings &&
      hasLocalGoalSettingsOverride(localSettings) &&
      !localMigrationAttemptedRef.current;

    if (shouldSeedSharedSheet) {
      localMigrationAttemptedRef.current = true;
      setSettings(localSettings);
      void saveGoalSettings({ data: localSettings })
        .then((result) => {
          writeStoredGoalSettings(result.settings);
          queryClient.setQueryData(goalSettingsQuery.queryKey, {
            ...data,
            settings: result.settings,
            source: "google-sheet",
            hasStoredSettings: true,
            updatedAt: new Date().toISOString(),
          });
        })
        .catch((error) => {
          logGoalSettings("local goal settings migration skipped", {
            reason: error instanceof Error ? error.message : String(error),
          });
          setSettings(data.settings);
          writeStoredGoalSettings(data.settings);
        });
      return;
    }

    setSettings(data.settings);
    writeStoredGoalSettings(data.settings);
  }, [data, queryClient]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const updateSettings = (next: GoalSettings) => {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    writeStoredGoalSettings(normalized);

    if (typeof window === "undefined") return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const signature = settingsSignature(normalized);
      if (signature === lastQueuedSaveRef.current) return;
      lastQueuedSaveRef.current = signature;

      void saveGoalSettings({ data: normalized })
        .then((result) => {
          writeStoredGoalSettings(result.settings);
          queryClient.setQueryData(goalSettingsQuery.queryKey, {
            settings: result.settings,
            source: "google-sheet",
            hasStoredSettings: true,
            links: data?.links ?? {},
            updatedAt: new Date().toISOString(),
          } satisfies GoalSettingsReadResult);
        })
        .catch((error) => {
          lastQueuedSaveRef.current = "";
          logGoalSettings("shared goal settings save failed", {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
    }, GOAL_SETTINGS_SAVE_DEBOUNCE_MS);
  };

  return [settings, updateSettings] as const;
}
