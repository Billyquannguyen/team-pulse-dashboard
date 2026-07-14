import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { team as fallbackTeam, type Teammate } from "@/data/team";
import { createHeaderLookup, getHeaderCell, type HeaderLookup } from "@/lib/sheet-headers";
import { cleanSheetName } from "@/lib/sheet-normalizer";

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

export type TeamMemberStatus = "active" | "offboarded";

export type TeamMemberConfig = {
  id: string;
  displayName: string;
  status: TeamMemberStatus;
  joinedMonth: string;
  avatarUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  websiteUrl: string;
  gmailLabel: string;
  discordUserId: string;
  weeklyReportEnabled: boolean;
  teamDepartment: string;
  rowNumber?: number;
};

type TeamMemberField =
  | "displayName"
  | "id"
  | "joinedMonth"
  | "status"
  | "avatarUrl"
  | "instagramUrl"
  | "tiktokUrl"
  | "youtubeUrl"
  | "websiteUrl"
  | "gmailLabel"
  | "discordUserId"
  | "weeklyReportEnabled"
  | "teamDepartment";

type TeamMembersCacheEntry = {
  data: TeamMembersSheetData;
  cachedAt: number;
  expiresAt: number;
};

type TeamMembersWorksheet = {
  sheet: GoogleSheetRef;
  availableTabs: string[];
  headers: string[];
  rows: string[][];
};

export type TeamMembersSheetData = {
  members: TeamMemberConfig[];
  activeMembers: TeamMemberConfig[];
  offboardedMembers: TeamMemberConfig[];
  suggestions: TeamMemberSuggestion[];
  source: "google-sheet" | "fallback" | "error";
  setupNeeded: boolean;
  error?: string;
  warning?: string;
  warnings: string[];
  links: {
    teamMembersSheetUrl?: string;
  };
  updatedAt: string;
};

export type TeamMemberSuggestion = {
  id: string;
  displayName: string;
  joinedMonth: string;
  reason: string;
};

export const TEAM_MEMBERS_TAB_NAME = "TeamMembers";
export const TEAM_MEMBERS_SPREADSHEET_ENV = "TEAM_ASSETS_SPREADSHEET_ID";

export const TEAM_MEMBERS_HEADERS = [
  "Name",
  "ID",
  "Joined Month",
  "Status",
  "Avatar",
  "Instagram",
  "TikTok",
  "YouTube",
  "Website",
  "Gmail Label",
  "Discord User ID",
  "Weekly Report Enabled",
  "Team or Department",
] as const;

const TEAM_MEMBER_FIELDS: TeamMemberField[] = [
  "displayName",
  "id",
  "joinedMonth",
  "status",
  "avatarUrl",
  "instagramUrl",
  "tiktokUrl",
  "youtubeUrl",
  "websiteUrl",
  "gmailLabel",
  "discordUserId",
  "weeklyReportEnabled",
  "teamDepartment",
];

export const SYSTEM_MEMBER_TAB_NAMES = [
  "Comm Tracking",
  "Goals",
  "Analytics",
  "Contact Database",
  "Active Brands",
  "Active Contacts",
  "Brand Finder",
  "Team Assets",
  "Calendly Reminders",
  "Settings",
  "Signed creators",
  "Ex-managers",
  TEAM_MEMBERS_TAB_NAME,
];

const SYSTEM_MEMBER_TAB_WORDS = [
  "archive",
  "asset",
  "company database",
  "config",
  "contact",
  "dashboard",
  "database",
  "diagnostic",
  "ex-manager",
  "ex managers",
  "instruction",
  "links",
  "setting",
  "summary",
  "template",
];

const DEFAULT_SEED_MEMBERS: TeamMemberSuggestion[] = [
  {
    displayName: "Kim Trang",
    id: "KTrang",
    joinedMonth: "2024-08",
    reason: "Suggested current dashboard member.",
  },
  {
    displayName: "Hoang Yen",
    id: "HYen",
    joinedMonth: "2025-01",
    reason: "Suggested current dashboard member.",
  },
  {
    displayName: "Linh Ngoc",
    id: "LNgoc",
    joinedMonth: "2025-03",
    reason: "Suggested current dashboard member.",
  },
];

const TEAM_MEMBERS_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_STALE_TIME_MS = TEAM_MEMBERS_CACHE_TTL_MS;
const QUERY_REFETCH_INTERVAL_MS = TEAM_MEMBERS_CACHE_TTL_MS;

const TEAM_MEMBER_COLUMN_ALIASES: Record<TeamMemberField, string[]> = {
  displayName: ["name", "display name", "displayname", "member", "member name"],
  id: ["id", "member id", "worksheet", "worksheet name", "tab", "tab name"],
  joinedMonth: ["joined month", "joinedmonth", "join month", "joined", "start month"],
  status: ["status", "active status"],
  avatarUrl: ["avatar", "avatar url", "photo", "profile photo", "image"],
  instagramUrl: ["instagram", "instagram url", "ig", "ig url"],
  tiktokUrl: ["tiktok", "tiktok url", "tik tok", "tik tok url"],
  youtubeUrl: ["youtube", "youtube url", "yt", "yt url"],
  websiteUrl: ["website", "website url", "site", "link"],
  gmailLabel: ["gmail label", "gmail", "email label", "mail label"],
  discordUserId: ["discord user id", "discord id", "discord", "discord snowflake"],
  weeklyReportEnabled: [
    "weekly report enabled",
    "include in weekly report",
    "weekly report",
    "report enabled",
    "include weekly",
  ],
  teamDepartment: [
    "team or department",
    "team / department",
    "team department",
    "team",
    "department",
    "dept",
    "role",
  ],
};

const teamMemberInput = z.object({
  displayName: z.string().trim().min(1).max(80),
  id: z.string().trim().min(1).max(80),
  joinedMonth: z.string().trim().max(20).optional().default(""),
  status: z.enum(["active", "offboarded"]).default("active"),
  avatarUrl: z.string().max(50000).optional(),
  instagramUrl: z.string().trim().max(500).optional(),
  tiktokUrl: z.string().trim().max(500).optional(),
  youtubeUrl: z.string().trim().max(500).optional(),
  websiteUrl: z.string().trim().max(500).optional(),
  gmailLabel: z.string().trim().max(200).optional(),
  discordUserId: z.string().trim().max(80).optional(),
  weeklyReportEnabled: z.boolean().optional(),
  teamDepartment: z.string().trim().max(80).optional(),
});

const updateTeamMemberInput = teamMemberInput.extend({
  rowNumber: z.number().int().min(2),
  originalId: z.string().trim().min(1).max(80).optional(),
});

const offboardTeamMemberInput = z.object({
  rowNumber: z.number().int().min(2),
});

const teamMemberProfileInput = z.object({
  rowNumber: z.number().int().min(2),
  originalId: z.string().trim().min(1).max(80),
  avatarUrl: z.string().max(50000).optional().default(""),
  instagramUrl: z.string().trim().max(500).optional().default(""),
  tiktokUrl: z.string().trim().max(500).optional().default(""),
  youtubeUrl: z.string().trim().max(500).optional().default(""),
  websiteUrl: z.string().trim().max(500).optional().default(""),
});

let teamMembersCache: TeamMembersCacheEntry | null = null;
let teamMembersRefreshPromise: Promise<TeamMembersCacheEntry> | null = null;

const getGoogleSheetsServer = createServerOnlyFn(async () => import("@/lib/google-sheets.server"));

function logTeamMembers(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:team-members]", message, details ?? {});
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[_–—-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSheetKey(value: string) {
  return normalizeKey(value).replace(/\s/g, "");
}

export function isSystemMemberTabName(value: string) {
  const normalized = normalizeKey(value);
  const compact = normalizeSheetKey(value);

  if (!normalized) return true;

  if (
    SYSTEM_MEMBER_TAB_NAMES.some(
      (tabName) => normalizeKey(tabName) === normalized || normalizeSheetKey(tabName) === compact,
    )
  ) {
    return true;
  }

  return SYSTEM_MEMBER_TAB_WORDS.some((word) => normalized.includes(normalizeKey(word)));
}

export function getSystemMemberTabSkipReason(value: string) {
  return isSystemMemberTabName(value)
    ? "Ignored system tab. Team members must come from TeamMembers."
    : null;
}

function cleanValue(value: string) {
  return cleanSheetName(value);
}

export function getInitialsFromName(name: string) {
  const cleaned = cleanValue(name);
  const parts = cleaned.split(" ").filter(Boolean);

  if (parts.length > 1) {
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  return cleaned.slice(0, 2).toUpperCase();
}

function parseStatus(value: string): TeamMemberStatus {
  const normalized = normalizeKey(value);
  if (["offboarded", "offboard", "former", "inactive", "left"].includes(normalized)) {
    return "offboarded";
  }
  return "active";
}

function formatStatus(status: TeamMemberStatus) {
  return status === "offboarded" ? "Offboarded" : "Active";
}

function parseBoolean(value: string) {
  const normalized = normalizeKey(value);
  return ["true", "yes", "y", "1", "enabled", "include", "included", "on"].includes(normalized);
}

function formatBoolean(value: boolean) {
  return value ? "TRUE" : "FALSE";
}

function isWeeklyOutreachDepartment(value: string) {
  const normalized = normalizeKey(value);
  return normalized === "creator" || normalized === "outreach";
}

function buildColumnLookup(headers: string[]): HeaderLookup<TeamMemberField> {
  return createHeaderLookup(headers, TEAM_MEMBER_COLUMN_ALIASES);
}

function getCell(row: string[], lookup: HeaderLookup<TeamMemberField>, field: TeamMemberField) {
  return getHeaderCell(row, lookup, field);
}

function hasMinimumTeamMemberHeaders(headers: string[]) {
  const lookup = buildColumnLookup(headers);
  return (
    lookup.displayName !== undefined &&
    lookup.displayName >= 0 &&
    lookup.id !== undefined &&
    lookup.id >= 0
  );
}

function hasCanonicalTeamMemberHeaders(headers: string[]) {
  return TEAM_MEMBERS_HEADERS.every(
    (header, index) => normalizeKey(headers[index] ?? "") === normalizeKey(header),
  );
}

function getTeamMembersSheetUrl(spreadsheetId: string) {
  if (!spreadsheetId) return {};
  return {
    teamMembersSheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

function getTeamMembersSpreadsheetId() {
  const spreadsheetId = process.env[TEAM_MEMBERS_SPREADSHEET_ENV]?.trim();
  if (!spreadsheetId) {
    throw new Error(`Missing required Google Sheets env var: ${TEAM_MEMBERS_SPREADSHEET_ENV}`);
  }
  return spreadsheetId;
}

function buildSuggestions(tabs: GoogleSheetRef[], existingMembers: TeamMemberConfig[]) {
  const existingIds = new Set(existingMembers.map((member) => normalizeSheetKey(member.id)));
  const visibleMemberTabs = tabs
    .filter((tab) => !isSystemMemberTabName(tab.sheetName))
    .filter((tab) => !existingIds.has(normalizeSheetKey(tab.sheetName)));
  const visibleTabKeys = new Set(visibleMemberTabs.map((tab) => normalizeSheetKey(tab.sheetName)));
  const seedSuggestions = DEFAULT_SEED_MEMBERS.filter(
    (seed) => !existingIds.has(normalizeSheetKey(seed.id)),
  );

  const likelySeedSuggestions = seedSuggestions.filter((seed) =>
    visibleTabKeys.has(normalizeSheetKey(seed.id)),
  );

  const worksheetSuggestions = visibleMemberTabs
    .filter(
      (tab) =>
        !DEFAULT_SEED_MEMBERS.some(
          (seed) => normalizeSheetKey(seed.id) === normalizeSheetKey(tab.sheetName),
        ),
    )
    .map((tab) => {
      const id = cleanValue(tab.sheetName);
      return {
        id,
        displayName: id,
        joinedMonth: "",
        reason: "Possible member worksheet. Add it only if this is a real active person.",
      };
    });

  return [...likelySeedSuggestions, ...worksheetSuggestions];
}

function normalizeTeamMemberRows(headers: string[], rows: string[][]) {
  const lookup = buildColumnLookup(headers);

  return rows
    .map((row, index): TeamMemberConfig | null => {
      const displayName = cleanValue(getCell(row, lookup, "displayName"));
      const id = cleanValue(getCell(row, lookup, "id"));
      if (!displayName || !id) return null;

      return {
        id,
        displayName,
        status: parseStatus(getCell(row, lookup, "status")),
        joinedMonth: cleanValue(getCell(row, lookup, "joinedMonth")),
        avatarUrl: getCell(row, lookup, "avatarUrl").trim(),
        instagramUrl: getCell(row, lookup, "instagramUrl").trim(),
        tiktokUrl: getCell(row, lookup, "tiktokUrl").trim(),
        youtubeUrl: getCell(row, lookup, "youtubeUrl").trim(),
        websiteUrl: getCell(row, lookup, "websiteUrl").trim(),
        gmailLabel: getCell(row, lookup, "gmailLabel").trim(),
        discordUserId: getCell(row, lookup, "discordUserId").trim(),
        weeklyReportEnabled: parseBoolean(getCell(row, lookup, "weeklyReportEnabled")),
        teamDepartment: cleanValue(getCell(row, lookup, "teamDepartment")),
        rowNumber: index + 2,
      };
    })
    .filter((member): member is TeamMemberConfig => member !== null);
}

function getKnownFallback(member: TeamMemberConfig, index: number): Teammate {
  const known = fallbackTeam.find(
    (item) =>
      normalizeSheetKey(item.id) === normalizeSheetKey(member.id) ||
      normalizeSheetKey(item.name) === normalizeSheetKey(member.displayName) ||
      normalizeSheetKey(item.worksheetName ?? "") === normalizeSheetKey(member.id),
  );

  return {
    ...(known ?? {
      id: member.id,
      name: member.displayName,
      initials: getInitialsFromName(member.displayName),
      role: "Closer",
      commission: 0,
      paidCommission: 0,
      monthCommission: 0,
      pendingOwed: 0,
      dealsClosed: 0,
      revenue: 0,
      revenueGoal: 300000,
      dealsGoal: 20,
      exclusiveCreators: 0,
      nonExclusiveCreators: 0,
    }),
    id: member.id || known?.id || `member-${index + 1}`,
    name: member.displayName,
    initials: getInitialsFromName(member.displayName),
    role: known?.role || "Closer",
    worksheetName: member.id,
    status: member.status,
    joinedMonth: member.joinedMonth,
    avatarUrl: member.avatarUrl,
    instagramUrl: member.instagramUrl,
    tiktokUrl: member.tiktokUrl,
    youtubeUrl: member.youtubeUrl,
    websiteUrl: member.websiteUrl,
  };
}

export function teamMemberConfigToTeammate(member: TeamMemberConfig, index: number) {
  return getKnownFallback(member, index);
}

async function getTeamMembersTabs(config: GoogleSheetsConfig) {
  const googleSheets = await getGoogleSheetsServer();
  return googleSheets.fetchSpreadsheetTabs(config, getTeamMembersSpreadsheetId());
}

async function loadTeamMembersWorksheet(
  config: GoogleSheetsConfig,
  options: { createIfMissing?: boolean; ensureHeaders?: boolean } = {},
): Promise<TeamMembersWorksheet> {
  const googleSheets = await getGoogleSheetsServer();
  const spreadsheetId = getTeamMembersSpreadsheetId();
  let tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
  const expectedKey = normalizeSheetKey(TEAM_MEMBERS_TAB_NAME);
  let matchedTab = tabs.find((tab) => normalizeSheetKey(tab.sheetName) === expectedKey);

  if (!matchedTab && options.createIfMissing) {
    await googleSheets.createSheetTab(config, spreadsheetId, TEAM_MEMBERS_TAB_NAME);
    tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
    matchedTab = tabs.find((tab) => normalizeSheetKey(tab.sheetName) === expectedKey);
  }

  if (!matchedTab) {
    throw new Error(`Could not find a worksheet tab named "${TEAM_MEMBERS_TAB_NAME}".`);
  }

  const sheet = {
    memberName: TEAM_MEMBERS_TAB_NAME,
    sheetName: matchedTab.sheetName,
    gid: matchedTab.gid,
  };
  let [sheetRows] = await googleSheets.fetchSheetRowsBatch(config, spreadsheetId, [sheet]);

  if (options.ensureHeaders) {
    const currentHeaders = sheetRows?.headers ?? [];
    const currentRows = sheetRows?.rows ?? [];
    const shouldMigrateRows =
      currentRows.length > 0 &&
      hasMinimumTeamMemberHeaders(currentHeaders) &&
      !hasCanonicalTeamMemberHeaders(currentHeaders);
    const migratedRows = shouldMigrateRows
      ? normalizeTeamMemberRows(currentHeaders, currentRows)
      : [];

    if (!hasCanonicalTeamMemberHeaders(currentHeaders)) {
      await googleSheets.updateSheetRow(config, spreadsheetId, sheet, 1, [...TEAM_MEMBERS_HEADERS]);

      for (const member of migratedRows) {
        if (!member.rowNumber) continue;
        await googleSheets.updateSheetRow(
          config,
          spreadsheetId,
          sheet,
          member.rowNumber,
          buildTeamMemberWriteRow(member),
        );
      }

      sheetRows = {
        headers: [...TEAM_MEMBERS_HEADERS],
        rows: shouldMigrateRows
          ? migratedRows.map((member) => buildTeamMemberWriteRow(member))
          : currentRows,
      };
    }
  }

  return {
    sheet,
    availableTabs: tabs.map((tab) => tab.sheetName),
    headers: sheetRows?.headers ?? [],
    rows: sheetRows?.rows ?? [],
  };
}

async function readTeamMembersSheetData(config: GoogleSheetsConfig): Promise<TeamMembersSheetData> {
  const spreadsheetId = getTeamMembersSpreadsheetId();
  const tabs = await getTeamMembersTabs(config);
  const links = getTeamMembersSheetUrl(spreadsheetId);
  const warnings: string[] = [];

  try {
    let worksheet: TeamMembersWorksheet;

    try {
      worksheet = await loadTeamMembersWorksheet(config, { ensureHeaders: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Could not add missing TeamMembers reporting columns: ${message}`);
      worksheet = await loadTeamMembersWorksheet(config);
    }

    if (!hasMinimumTeamMemberHeaders(worksheet.headers)) {
      warnings.push(
        `${TEAM_MEMBERS_TAB_NAME} needs Name and ID columns before it can control the dashboard.`,
      );
    }

    const members = hasMinimumTeamMemberHeaders(worksheet.headers)
      ? normalizeTeamMemberRows(worksheet.headers, worksheet.rows)
      : [];
    const activeMembers = members.filter((member) => member.status === "active");
    const offboardedMembers = members.filter((member) => member.status === "offboarded");
    const suggestions = buildSuggestions(tabs, members);

    return {
      members,
      activeMembers,
      offboardedMembers,
      suggestions,
      source: "google-sheet",
      setupNeeded: false,
      warning:
        activeMembers.length === 0
          ? "No active TeamMembers rows found. Add active members to show dashboard data."
          : undefined,
      warnings,
      links,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logTeamMembers("team members setup needed", {
      reason: message,
    });

    return {
      members: [],
      activeMembers: [],
      offboardedMembers: [],
      suggestions: buildSuggestions(tabs, []),
      source: "google-sheet",
      setupNeeded: true,
      error: message,
      warning: `${TEAM_MEMBERS_TAB_NAME} sheet is missing.`,
      warnings: [],
      links,
      updatedAt: new Date().toISOString(),
    };
  }
}

function cacheExpiresAtLabel(entry: TeamMembersCacheEntry | null) {
  return entry ? new Date(entry.expiresAt).toISOString() : null;
}

async function refreshTeamMembersCache(config: GoogleSheetsConfig): Promise<TeamMembersCacheEntry> {
  const data = await readTeamMembersSheetData(config);
  const entry = {
    data,
    cachedAt: Date.now(),
    expiresAt: Date.now() + TEAM_MEMBERS_CACHE_TTL_MS,
  };

  teamMembersCache = entry;
  return entry;
}

async function getTeamMembersWithServerCache(config: GoogleSheetsConfig) {
  if (teamMembersCache && teamMembersCache.expiresAt > Date.now()) {
    return teamMembersCache.data;
  }

  if (!teamMembersRefreshPromise) {
    teamMembersRefreshPromise = refreshTeamMembersCache(config).finally(() => {
      teamMembersRefreshPromise = null;
    });
  }

  const entry = await teamMembersRefreshPromise;
  logTeamMembers("team members loaded", {
    activeMembers: entry.data.activeMembers.length,
    offboardedMembers: entry.data.offboardedMembers.length,
    suggestions: entry.data.suggestions.length,
    cacheExpiresAt: cacheExpiresAtLabel(entry),
  });
  return entry.data;
}

export function invalidateTeamMembersCache() {
  teamMembersCache = null;
  teamMembersRefreshPromise = null;
}

async function invalidateRelatedCaches() {
  invalidateTeamMembersCache();
  try {
    const dashboard = await import("@/lib/sheets-public");
    dashboard.invalidateDashboardSheetCache();
  } catch {
    // Dashboard cache invalidation is best-effort to avoid import cycles during tests.
  }
}

export async function getTeamMembersDataForServer() {
  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();

  return getTeamMembersWithServerCache(config);
}

export async function getActiveTeamMemberConfigsForServer() {
  const data = await getTeamMembersDataForServer();
  return data.activeMembers;
}

export async function getActiveTeammatesForServer() {
  const members = await getActiveTeamMemberConfigsForServer();
  return members.map(teamMemberConfigToTeammate);
}

export async function getWeeklyOutreachReportMembers() {
  const data = await getTeamMembersDataForServer();

  return data.activeMembers.filter(
    (member) => member.weeklyReportEnabled && isWeeklyOutreachDepartment(member.teamDepartment),
  );
}

function buildTeamMemberWriteRow(
  input: z.infer<typeof teamMemberInput> &
    Partial<
      Pick<
        TeamMemberConfig,
        | "avatarUrl"
        | "instagramUrl"
        | "tiktokUrl"
        | "youtubeUrl"
        | "websiteUrl"
        | "gmailLabel"
        | "discordUserId"
        | "weeklyReportEnabled"
        | "teamDepartment"
      >
    >,
  existingRow?: string[],
  existingLookup?: HeaderLookup<TeamMemberField>,
) {
  const existing = (field: TeamMemberField) =>
    existingRow && existingLookup ? getCell(existingRow, existingLookup, field).trim() : "";
  const weeklyReportEnabled =
    input.weeklyReportEnabled ?? parseBoolean(existing("weeklyReportEnabled"));

  return [
    cleanValue(input.displayName),
    cleanValue(input.id),
    cleanValue(input.joinedMonth),
    formatStatus(input.status),
    input.avatarUrl ?? existing("avatarUrl"),
    input.instagramUrl ?? existing("instagramUrl"),
    input.tiktokUrl ?? existing("tiktokUrl"),
    input.youtubeUrl ?? existing("youtubeUrl"),
    input.websiteUrl ?? existing("websiteUrl"),
    input.gmailLabel ?? existing("gmailLabel"),
    input.discordUserId ?? existing("discordUserId"),
    formatBoolean(weeklyReportEnabled),
    cleanValue(input.teamDepartment ?? existing("teamDepartment")),
  ];
}

function findTeamMemberRowNumber(
  worksheet: TeamMembersWorksheet,
  input: { id: string; originalId?: string; rowNumber: number },
) {
  const lookup = buildColumnLookup(worksheet.headers);
  const originalKey = normalizeSheetKey(input.originalId ?? "");
  const currentKey = normalizeSheetKey(input.id);

  const match = worksheet.rows
    .map((row, index) => ({
      row,
      rowNumber: index + 2,
    }))
    .find(({ row }) => {
      const rowKey = normalizeSheetKey(getCell(row, lookup, "id"));
      if (!rowKey) return false;
      return rowKey === originalKey || rowKey === currentKey;
    });

  return match?.rowNumber ?? input.rowNumber;
}

function chooseSeedMembers(availableTabs: string[]) {
  const tabKeys = new Set(availableTabs.map(normalizeSheetKey));
  const matchingSeeds = DEFAULT_SEED_MEMBERS.filter((seed) =>
    tabKeys.has(normalizeSheetKey(seed.id)),
  );

  return matchingSeeds.length > 0 ? matchingSeeds : DEFAULT_SEED_MEMBERS;
}

export const fetchTeamMembersData = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  return getTeamMembersDataForServer();
});

export const createTeamMembersSheet = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdminAuth } = await import("@/lib/auth.server");
  await requireAdminAuth();
  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();
  const worksheet = await loadTeamMembersWorksheet(config, {
    createIfMissing: true,
    ensureHeaders: true,
  });
  const spreadsheetId = getTeamMembersSpreadsheetId();

  if (worksheet.rows.length === 0) {
    const seeds = chooseSeedMembers(worksheet.availableTabs);
    for (const seed of seeds) {
      await googleSheets.appendSheetRow(
        config,
        spreadsheetId,
        worksheet.sheet,
        buildTeamMemberWriteRow({
          displayName: seed.displayName,
          id: seed.id,
          joinedMonth: seed.joinedMonth,
          status: "active",
        }),
      );
    }
  }

  await invalidateRelatedCaches();
  return { ok: true as const };
});

export const addTeamMember = createServerFn({ method: "POST" })
  .inputValidator(teamMemberInput)
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const worksheet = await loadTeamMembersWorksheet(config, {
      createIfMissing: true,
      ensureHeaders: true,
    });
    const spreadsheetId = getTeamMembersSpreadsheetId();

    await googleSheets.appendSheetRow(
      config,
      spreadsheetId,
      worksheet.sheet,
      buildTeamMemberWriteRow(data),
    );
    await invalidateRelatedCaches();

    return { ok: true as const };
  });

export const updateTeamMember = createServerFn({ method: "POST" })
  .inputValidator(updateTeamMemberInput)
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const worksheet = await loadTeamMembersWorksheet(config, {
      createIfMissing: true,
      ensureHeaders: true,
    });
    const spreadsheetId = getTeamMembersSpreadsheetId();
    const rowNumber = findTeamMemberRowNumber(worksheet, data);
    const existingRow = worksheet.rows[rowNumber - 2];
    const lookup = buildColumnLookup(worksheet.headers);

    if (!existingRow) {
      throw new Error(`Could not find TeamMembers row ${rowNumber}. Refresh and try again.`);
    }

    await googleSheets.updateSheetRow(
      config,
      spreadsheetId,
      worksheet.sheet,
      rowNumber,
      buildTeamMemberWriteRow(data, existingRow, lookup),
    );
    await invalidateRelatedCaches();

    return { ok: true as const };
  });

export const offboardTeamMember = createServerFn({ method: "POST" })
  .inputValidator(offboardTeamMemberInput)
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const worksheet = await loadTeamMembersWorksheet(config, {
      createIfMissing: true,
      ensureHeaders: true,
    });
    const spreadsheetId = getTeamMembersSpreadsheetId();
    const existingRow = worksheet.rows[data.rowNumber - 2];

    if (!existingRow) {
      throw new Error(`Could not find TeamMembers row ${data.rowNumber}. Refresh and try again.`);
    }

    const lookup = buildColumnLookup(worksheet.headers);
    const row = [...existingRow];
    while (row.length < TEAM_MEMBERS_HEADERS.length) row.push("");
    const statusIndex = lookup.status;
    if (statusIndex !== undefined && statusIndex >= 0) {
      row[statusIndex] = "Offboarded";
    }

    await googleSheets.updateSheetRow(
      config,
      spreadsheetId,
      worksheet.sheet,
      data.rowNumber,
      TEAM_MEMBER_FIELDS.map((field) =>
        field === "status" ? "Offboarded" : getCell(row, lookup, field),
      ),
    );
    await invalidateRelatedCaches();

    return { ok: true as const };
  });

export const updateTeamMemberProfile = createServerFn({ method: "POST" })
  .inputValidator(teamMemberProfileInput)
  .handler(async ({ data }) => {
    const { requireWritableDashboardAuth } = await import("@/lib/auth.server");
    await requireWritableDashboardAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const worksheet = await loadTeamMembersWorksheet(config, {
      createIfMissing: true,
      ensureHeaders: true,
    });
    const spreadsheetId = getTeamMembersSpreadsheetId();
    const rowNumber = findTeamMemberRowNumber(worksheet, {
      rowNumber: data.rowNumber,
      id: data.originalId,
      originalId: data.originalId,
    });
    const existingRow = worksheet.rows[rowNumber - 2];

    if (!existingRow) {
      throw new Error(`Could not find TeamMembers row ${rowNumber}. Refresh and try again.`);
    }

    const lookup = buildColumnLookup(worksheet.headers);
    const existingMember = normalizeTeamMemberRows(worksheet.headers, [existingRow])[0];

    if (!existingMember) {
      throw new Error("Could not read this TeamMembers row. Refresh and try again.");
    }

    await googleSheets.updateSheetRow(
      config,
      spreadsheetId,
      worksheet.sheet,
      rowNumber,
      buildTeamMemberWriteRow(
        {
          displayName: existingMember.displayName,
          id: existingMember.id,
          joinedMonth: existingMember.joinedMonth,
          status: existingMember.status,
          avatarUrl: data.avatarUrl,
          instagramUrl: data.instagramUrl,
          tiktokUrl: data.tiktokUrl,
          youtubeUrl: data.youtubeUrl,
          websiteUrl: data.websiteUrl,
        },
        existingRow,
        lookup,
      ),
    );
    await invalidateRelatedCaches();

    return { ok: true as const };
  });

export const teamMembersQuery = {
  queryKey: ["team-billion-team-members", "team-assets-spreadsheet-v1"],
  queryFn: () => fetchTeamMembersData(),
  refetchInterval: QUERY_REFETCH_INTERVAL_MS,
  staleTime: QUERY_STALE_TIME_MS,
};
