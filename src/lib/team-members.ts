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
  shortCode: string;
  worksheetName: string;
  status: TeamMemberStatus;
  role: string;
  color: string;
  sortOrder: number;
  joinedMonth: string;
  createdAt: string;
  updatedAt: string;
  rowNumber?: number;
};

type TeamMemberField =
  | "id"
  | "displayName"
  | "shortCode"
  | "worksheetName"
  | "status"
  | "role"
  | "color"
  | "sortOrder"
  | "joinedMonth"
  | "createdAt"
  | "updatedAt";

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
  worksheetName: string;
  displayName: string;
  shortCode: string;
  reason: string;
};

export const TEAM_MEMBERS_TAB_NAME = "TeamMembers";

export const TEAM_MEMBERS_HEADERS: TeamMemberField[] = [
  "id",
  "displayName",
  "shortCode",
  "worksheetName",
  "status",
  "role",
  "color",
  "sortOrder",
  "joinedMonth",
  "createdAt",
  "updatedAt",
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

const TEAM_MEMBERS_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_STALE_TIME_MS = TEAM_MEMBERS_CACHE_TTL_MS;
const QUERY_REFETCH_INTERVAL_MS = TEAM_MEMBERS_CACHE_TTL_MS;

const TEAM_MEMBER_COLUMN_ALIASES: Record<TeamMemberField, string[]> = {
  id: ["id", "member id", "slug"],
  displayName: ["display name", "displayname", "name", "member", "member name"],
  shortCode: ["short code", "shortcode", "initials", "code"],
  worksheetName: ["worksheet name", "worksheetname", "worksheet", "sheet", "tab", "tab name"],
  status: ["status", "active status"],
  role: ["role", "position"],
  color: ["color", "colour", "hex"],
  sortOrder: ["sort order", "sortorder", "order", "position"],
  joinedMonth: ["joined month", "joinedmonth", "join month", "joined", "start month"],
  createdAt: ["created at", "createdat", "created"],
  updatedAt: ["updated at", "updatedat", "updated"],
};

const DEFAULT_COLORS = ["#A3E635", "#FACC15", "#F9A8D4", "#C4B5FD", "#7DD3FC", "#FDBA74"];

const teamMemberInput = z.object({
  id: z.string().trim().max(80).optional().default(""),
  displayName: z.string().trim().min(1).max(80),
  shortCode: z.string().trim().max(12).optional().default(""),
  worksheetName: z.string().trim().max(120).optional().default(""),
  status: z.enum(["active", "offboarded"]).default("active"),
  role: z.string().trim().max(80).optional().default("Closer"),
  color: z.string().trim().max(40).optional().default(""),
  sortOrder: z.number().finite().optional().default(100),
  joinedMonth: z.string().trim().max(20).optional().default(""),
});

const updateTeamMemberInput = teamMemberInput.extend({
  rowNumber: z.number().int().min(2),
});

const offboardTeamMemberInput = z.object({
  rowNumber: z.number().int().min(2),
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

function slugify(value: string, fallback: string) {
  return normalizeKey(value).replace(/\s+/g, "-").replace(/^-|-$/g, "") || fallback;
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

function parseSortOrder(value: string, index: number) {
  const number = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : (index + 1) * 10;
}

function parseStatus(value: string): TeamMemberStatus {
  const normalized = normalizeKey(value);
  if (["offboarded", "offboard", "former", "inactive", "left"].includes(normalized)) {
    return "offboarded";
  }
  return "active";
}

function normalizeColor(value: string, index: number) {
  const cleaned = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(cleaned)) return cleaned;
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function buildColumnLookup(headers: string[]): HeaderLookup<TeamMemberField> {
  return createHeaderLookup(headers, TEAM_MEMBER_COLUMN_ALIASES);
}

function getCell(row: string[], lookup: HeaderLookup<TeamMemberField>, field: TeamMemberField) {
  return getHeaderCell(row, lookup, field);
}

function hasMinimumTeamMemberHeaders(headers: string[]) {
  const lookup = buildColumnLookup(headers);
  return lookup.displayName !== undefined && lookup.displayName >= 0;
}

function getTeamMembersSheetUrl(spreadsheetId: string) {
  if (!spreadsheetId) return {};
  return {
    teamMembersSheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

function buildSuggestions(tabs: GoogleSheetRef[], existingMembers: TeamMemberConfig[]) {
  const existingWorksheetKeys = new Set(
    existingMembers.map((member) => normalizeSheetKey(member.worksheetName || member.displayName)),
  );

  return tabs
    .filter((tab) => !isSystemMemberTabName(tab.sheetName))
    .filter((tab) => !existingWorksheetKeys.has(normalizeSheetKey(tab.sheetName)))
    .map((tab) => {
      const displayName = cleanValue(tab.sheetName);
      return {
        worksheetName: displayName,
        displayName,
        shortCode: getInitialsFromName(displayName),
        reason:
          "Possible member worksheet. Add it only if this is a real active or offboarded person.",
      };
    });
}

function normalizeTeamMemberRows(headers: string[], rows: string[][]) {
  const lookup = buildColumnLookup(headers);

  return rows
    .map((row, index): TeamMemberConfig | null => {
      const displayName = cleanValue(getCell(row, lookup, "displayName"));
      if (!displayName) return null;

      const id = slugify(getCell(row, lookup, "id") || displayName, `member-${index + 1}`);
      const shortCode =
        cleanValue(getCell(row, lookup, "shortCode")) || getInitialsFromName(displayName);
      const worksheetName = cleanValue(getCell(row, lookup, "worksheetName")) || displayName;
      const sortOrder = parseSortOrder(getCell(row, lookup, "sortOrder"), index);

      return {
        id,
        displayName,
        shortCode,
        worksheetName,
        status: parseStatus(getCell(row, lookup, "status")),
        role: cleanValue(getCell(row, lookup, "role")) || "Closer",
        color: normalizeColor(getCell(row, lookup, "color"), index),
        sortOrder,
        joinedMonth: cleanValue(getCell(row, lookup, "joinedMonth")),
        createdAt: cleanValue(getCell(row, lookup, "createdAt")),
        updatedAt: cleanValue(getCell(row, lookup, "updatedAt")),
        rowNumber: index + 2,
      };
    })
    .filter((member): member is TeamMemberConfig => member !== null)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName),
    );
}

function getKnownFallback(member: TeamMemberConfig, index: number): Teammate {
  const known = fallbackTeam.find(
    (item) => normalizeKey(item.name) === normalizeKey(member.displayName),
  );

  return {
    ...(known ?? {
      id: member.id,
      name: member.displayName,
      initials: member.shortCode,
      role: member.role,
      commission: 0,
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
    initials: member.shortCode || getInitialsFromName(member.displayName),
    role: member.role || known?.role || "Closer",
    worksheetName: member.worksheetName,
    status: member.status,
    color: member.color,
    sortOrder: member.sortOrder,
    joinedMonth: member.joinedMonth,
  };
}

export function teamMemberConfigToTeammate(member: TeamMemberConfig, index: number) {
  return getKnownFallback(member, index);
}

async function getTeamMembersTabs(config: GoogleSheetsConfig) {
  const googleSheets = await getGoogleSheetsServer();
  return googleSheets.fetchSpreadsheetTabs(config, config.teamSpreadsheetId);
}

async function loadTeamMembersWorksheet(
  config: GoogleSheetsConfig,
  options: { createIfMissing?: boolean; ensureHeaders?: boolean } = {},
): Promise<TeamMembersWorksheet> {
  const googleSheets = await getGoogleSheetsServer();
  let tabs = await googleSheets.fetchSpreadsheetTabs(config, config.teamSpreadsheetId);
  const expectedKey = normalizeSheetKey(TEAM_MEMBERS_TAB_NAME);
  let matchedTab = tabs.find((tab) => normalizeSheetKey(tab.sheetName) === expectedKey);

  if (!matchedTab && options.createIfMissing) {
    await googleSheets.createSheetTab(config, config.teamSpreadsheetId, TEAM_MEMBERS_TAB_NAME);
    tabs = await googleSheets.fetchSpreadsheetTabs(config, config.teamSpreadsheetId);
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
  let [sheetRows] = await googleSheets.fetchSheetRowsBatch(config, config.teamSpreadsheetId, [
    sheet,
  ]);

  if (options.ensureHeaders && !hasMinimumTeamMemberHeaders(sheetRows?.headers ?? [])) {
    await googleSheets.updateSheetRow(
      config,
      config.teamSpreadsheetId,
      sheet,
      1,
      TEAM_MEMBERS_HEADERS,
    );
    sheetRows = { headers: TEAM_MEMBERS_HEADERS, rows: sheetRows?.rows ?? [] };
  }

  return {
    sheet,
    availableTabs: tabs.map((tab) => tab.sheetName),
    headers: sheetRows?.headers ?? [],
    rows: sheetRows?.rows ?? [],
  };
}

async function readTeamMembersSheetData(config: GoogleSheetsConfig): Promise<TeamMembersSheetData> {
  const googleSheets = await getGoogleSheetsServer();
  const tabs = await getTeamMembersTabs(config);
  const links = getTeamMembersSheetUrl(config.teamSpreadsheetId);
  const warnings: string[] = [];

  try {
    const worksheet = await loadTeamMembersWorksheet(config);

    if (!hasMinimumTeamMemberHeaders(worksheet.headers)) {
      warnings.push(
        `${TEAM_MEMBERS_TAB_NAME} exists, but it needs a displayName column before it can control the dashboard.`,
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
    warnings.push(
      `${TEAM_MEMBERS_TAB_NAME} is missing. Create it, then add real members. Worksheet tabs are suggestions only.`,
    );

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
      warning: warnings[0],
      warnings,
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

function buildTeamMemberWriteRow(
  headers: string[],
  existingRow: string[],
  input: z.infer<typeof teamMemberInput>,
  options: { fallbackId: string; now: string; createdAt?: string },
) {
  const lookup = buildColumnLookup(headers);
  const row = [...existingRow];
  while (row.length < headers.length) row.push("");

  const id = slugify(input.id || input.displayName, options.fallbackId);
  const values: Record<TeamMemberField, string> = {
    id,
    displayName: cleanValue(input.displayName),
    shortCode: cleanValue(input.shortCode) || getInitialsFromName(input.displayName),
    worksheetName: cleanValue(input.worksheetName) || cleanValue(input.displayName),
    status: input.status,
    role: cleanValue(input.role) || "Closer",
    color: normalizeColor(input.color, 0),
    sortOrder: String(input.sortOrder),
    joinedMonth: cleanValue(input.joinedMonth),
    createdAt: options.createdAt || options.now,
    updatedAt: options.now,
  };

  TEAM_MEMBERS_HEADERS.forEach((field) => {
    const index = lookup[field];
    if (index !== undefined && index >= 0) {
      row[index] = values[field];
    }
  });

  return row;
}

function nextMemberSortOrder(rows: string[][], headers: string[]) {
  const lookup = buildColumnLookup(headers);
  const index = lookup.sortOrder;
  const highest = rows.reduce((max, row, rowIndex) => {
    const raw = index === undefined || index < 0 ? "" : row[index];
    return Math.max(max, parseSortOrder(raw ?? "", rowIndex));
  }, 0);

  return highest + 10 || 10;
}

export const fetchTeamMembersData = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  return getTeamMembersDataForServer();
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
    const now = new Date().toISOString();
    const nextSortOrderValue =
      data.sortOrder || nextMemberSortOrder(worksheet.rows, worksheet.headers);
    const row = buildTeamMemberWriteRow(
      worksheet.headers,
      [],
      {
        ...data,
        sortOrder: nextSortOrderValue,
      },
      {
        fallbackId: `member-${worksheet.rows.length + 1}`,
        now,
      },
    );

    await googleSheets.appendSheetRow(config, config.teamSpreadsheetId, worksheet.sheet, row);
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
    const existingRow = worksheet.rows[data.rowNumber - 2];

    if (!existingRow) {
      throw new Error(`Could not find TeamMembers row ${data.rowNumber}. Refresh and try again.`);
    }

    const lookup = buildColumnLookup(worksheet.headers);
    const createdAt = getCell(existingRow, lookup, "createdAt");
    const row = buildTeamMemberWriteRow(worksheet.headers, existingRow, data, {
      fallbackId: `member-${data.rowNumber - 1}`,
      now: new Date().toISOString(),
      createdAt,
    });

    await googleSheets.updateSheetRow(
      config,
      config.teamSpreadsheetId,
      worksheet.sheet,
      data.rowNumber,
      row,
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
    const existingRow = worksheet.rows[data.rowNumber - 2];

    if (!existingRow) {
      throw new Error(`Could not find TeamMembers row ${data.rowNumber}. Refresh and try again.`);
    }

    const lookup = buildColumnLookup(worksheet.headers);
    const row = [...existingRow];
    while (row.length < worksheet.headers.length) row.push("");
    const statusIndex = lookup.status;
    const updatedAtIndex = lookup.updatedAt;
    if (statusIndex !== undefined && statusIndex >= 0) row[statusIndex] = "offboarded";
    if (updatedAtIndex !== undefined && updatedAtIndex >= 0) {
      row[updatedAtIndex] = new Date().toISOString();
    }

    await googleSheets.updateSheetRow(
      config,
      config.teamSpreadsheetId,
      worksheet.sheet,
      data.rowNumber,
      row,
    );
    await invalidateRelatedCaches();

    return { ok: true as const };
  });

export const teamMembersQuery = {
  queryKey: ["team-billion-team-members", "google-sheet-v1"],
  queryFn: () => fetchTeamMembersData(),
  refetchInterval: QUERY_REFETCH_INTERVAL_MS,
  staleTime: QUERY_STALE_TIME_MS,
};
