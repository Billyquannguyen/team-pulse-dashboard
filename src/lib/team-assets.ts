import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fallbackAssetLinks,
  type AssetColorName,
  type AssetIconName,
  type AssetLink,
} from "@/data/assets";
import { createHeaderLookup, getHeaderCell, type HeaderLookup } from "@/lib/sheet-headers";

type GoogleSheetsConfig = {
  serviceAccountEmail: string;
  privateKey: string;
  teamSpreadsheetId: string;
  creatorSourcingSpreadsheetId: string;
};

type TeamAssetsCacheStatus = "hit" | "miss" | "stale" | "refreshing";

type TeamAssetsCacheEntry = {
  data: TeamAssetsSheetData;
  debug: TeamAssetsReadDebug;
  cachedAt: number;
  expiresAt: number;
};

type TeamAssetsReadDebug = {
  envVar: typeof TEAM_ASSETS_SPREADSHEET_ENV;
  configured: boolean;
  availableTabs: string[];
  expectedTabName: typeof TEAM_ASSETS_TAB_NAME;
  foundTabName: string | null;
  headerCount: number;
  rowCount: number;
  enabledRows: number;
  assetCount: number;
  warnings: string[];
};

type TeamAssetsReadResult = {
  data: TeamAssetsSheetData;
  debug: TeamAssetsReadDebug;
  cacheStatus: TeamAssetsCacheStatus;
  cacheExpiresAt: string | null;
};

type TeamAssetField =
  | "title"
  | "subtitle"
  | "url"
  | "icon"
  | "color"
  | "category"
  | "enabled"
  | "sortOrder";

type TeamAssetsWorksheet = {
  sheet: {
    memberName: string;
    sheetName: string;
    gid?: string;
  };
  availableTabs: string[];
  headers: string[];
  rows: string[][];
};

export type TeamAssetsSheetData = {
  assets: AssetLink[];
  source: "google-sheet" | "fallback" | "error";
  error?: string;
  warning?: string;
  links: {
    teamAssetsSheetUrl?: string;
  };
  updatedAt: string;
};

export type TeamAssetsDataFlowDiagnostics = {
  checkedAt: string;
  source: TeamAssetsSheetData["source"];
  fallbackActive: boolean;
  fallbackReason: string | null;
  spreadsheet: {
    envVar: typeof TEAM_ASSETS_SPREADSHEET_ENV;
    configured: boolean;
    readable: boolean;
    writable: boolean;
    link: string | null;
  };
  tab: {
    expectedName: typeof TEAM_ASSETS_TAB_NAME;
    found: boolean;
    sheetName: string | null;
    availableTabs: string[];
  };
  counts: {
    headers: number;
    rows: number;
    enabledRows: number;
    assets: number;
  };
  cache: {
    queryStaleTimeMs: number;
    queryRefetchIntervalMs: number;
    serverCacheTtlMs: number;
    serverCacheStatus: TeamAssetsCacheStatus;
    serverCacheExpiresAt: string | null;
    googleFetchCache: "no-store";
  };
  warnings: string[];
};

export const TEAM_ASSETS_TAB_NAME = "Team Assets";
export const TEAM_ASSETS_SPREADSHEET_ENV = "TEAM_ASSETS_SPREADSHEET_ID";

const TEAM_ASSETS_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_STALE_TIME_MS = TEAM_ASSETS_CACHE_TTL_MS;
const QUERY_REFETCH_INTERVAL_MS = TEAM_ASSETS_CACHE_TTL_MS;

const TEAM_ASSET_COLUMN_ALIASES: Record<TeamAssetField, string[]> = {
  title: ["title", "name", "resource", "asset", "link title"],
  subtitle: ["subtitle", "description", "desc", "details"],
  url: ["url", "link", "href"],
  icon: ["icon", "icon name"],
  color: ["color", "colour", "accent"],
  category: ["category", "type", "group"],
  enabled: ["enabled", "active", "show", "visible", "status"],
  sortOrder: ["sort_order", "sort order", "order", "sort", "position"],
};

const ICON_ALIASES: Record<string, AssetIconName> = {
  asset: "folder",
  assets: "folder",
  book: "book",
  calendar: "calendar",
  database: "database",
  db: "database",
  discord: "discord",
  doc: "document",
  docs: "document",
  document: "document",
  drive: "drive",
  file: "document",
  folder: "folder",
  handbook: "book",
  hash: "slack",
  link: "link",
  notion: "notion",
  sheet: "spreadsheet",
  sheets: "spreadsheet",
  slack: "slack",
  spreadsheet: "spreadsheet",
  url: "link",
};

const COLOR_ACCENTS = {
  amber: "from-amber-500/20 to-orange-500/20",
  blue: "from-indigo-500/20 to-blue-500/20",
  green: "from-emerald-500/20 to-lime-500/20",
  pink: "from-pink-500/20 to-fuchsia-500/20",
  purple: "from-purple-500/20 to-fuchsia-500/20",
  rose: "from-rose-500/20 to-pink-500/20",
  slate: "from-slate-500/20 to-zinc-500/20",
  yellow: "from-yellow-500/20 to-amber-500/20",
} as const;

const ASSET_ICON_NAMES = [
  "book",
  "calendar",
  "database",
  "discord",
  "document",
  "drive",
  "folder",
  "link",
  "notion",
  "slack",
  "spreadsheet",
] as const;

const ASSET_COLOR_NAMES = [
  "amber",
  "blue",
  "green",
  "pink",
  "purple",
  "rose",
  "slate",
  "yellow",
] as const;

export const assetIconOptions = [...ASSET_ICON_NAMES];
export const assetColorOptions = [...ASSET_COLOR_NAMES];

const DEFAULT_COLOR_SEQUENCE = [
  COLOR_ACCENTS.purple,
  COLOR_ACCENTS.blue,
  COLOR_ACCENTS.slate,
  COLOR_ACCENTS.amber,
  COLOR_ACCENTS.rose,
  COLOR_ACCENTS.green,
  COLOR_ACCENTS.yellow,
  COLOR_ACCENTS.pink,
];

const teamAssetInput = z.object({
  title: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(1000),
});

const fullTeamAssetInput = teamAssetInput.extend({
  subtitle: z.string().trim().max(240).optional().default(""),
  icon: z.enum(ASSET_ICON_NAMES).default("link"),
  color: z.enum(ASSET_COLOR_NAMES).default("purple"),
  category: z.string().trim().max(80).optional().default("Team"),
  enabled: z.boolean().default(true),
  sortOrder: z.number().finite().default(100),
});

const updateTeamAssetInput = teamAssetInput.extend({
  rowNumber: z.number().int().min(2),
});

const removeTeamAssetInput = z.object({
  rowNumber: z.number().int().min(2),
});

type TeamAssetInput = z.infer<typeof fullTeamAssetInput>;

let teamAssetsCache: TeamAssetsCacheEntry | null = null;
let teamAssetsRefreshPromise: Promise<TeamAssetsCacheEntry> | null = null;

function logTeamAssets(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:team-assets]", message, details ?? {});
}

function isRateLimitError(error: unknown) {
  return (
    error instanceof Error && /Google Sheets API failed \(429\)|Quota exceeded/i.test(error.message)
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cacheExpiresAtLabel(entry: TeamAssetsCacheEntry | null) {
  return entry ? new Date(entry.expiresAt).toISOString() : null;
}

function cloneDebug(debug: TeamAssetsReadDebug): TeamAssetsReadDebug {
  return {
    ...debug,
    availableTabs: [...debug.availableTabs],
    warnings: [...debug.warnings],
  };
}

function withTeamAssetsWarning(data: TeamAssetsSheetData, warning: string): TeamAssetsSheetData {
  return {
    ...data,
    warning: data.warning ? `${data.warning} ${warning}` : warning,
  };
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSheetKey(value: string) {
  return normalizeKey(value).replace(/\s/g, "");
}

function slugify(value: string, index: number) {
  const slug = normalizeKey(value).replace(/\s+/g, "-");
  return slug || `asset-${index + 1}`;
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[\p{L}\p{N}]/gu, (letter) => letter.toUpperCase());
}

function buildColumnLookup(headers: string[]): HeaderLookup<TeamAssetField> {
  return createHeaderLookup(headers, TEAM_ASSET_COLUMN_ALIASES);
}

function getCell(row: string[], lookup: HeaderLookup<TeamAssetField>, field: TeamAssetField) {
  return getHeaderCell(row, lookup, field);
}

function cleanAssetUrl(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  if (/^(javascript|data|vbscript):/i.test(raw)) return "";
  return raw;
}

function domainFromUrl(value: string) {
  const raw = cleanAssetUrl(value);
  if (!raw || /^mailto:/i.test(raw)) return "";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(candidate);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeIcon(value: string): AssetIconName {
  return ICON_ALIASES[normalizeKey(value)] ?? "link";
}

function normalizeColor(value: string, index: number): AssetColorName {
  const normalized = normalizeKey(value) as AssetColorName;
  return ASSET_COLOR_NAMES.includes(normalized)
    ? normalized
    : ASSET_COLOR_NAMES[index % ASSET_COLOR_NAMES.length];
}

function normalizeAccent(value: string, index: number) {
  return (
    COLOR_ACCENTS[normalizeColor(value, index)] ??
    DEFAULT_COLOR_SEQUENCE[index % DEFAULT_COLOR_SEQUENCE.length]
  );
}

function parseEnabled(value: string) {
  const normalized = normalizeKey(value);
  if (!normalized) return true;
  return !["0", "disabled", "false", "hidden", "inactive", "no", "off"].includes(normalized);
}

function parseSortOrder(value: string, index: number) {
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : (index + 1) * 10;
}

function emptyDebug(): TeamAssetsReadDebug {
  return {
    envVar: TEAM_ASSETS_SPREADSHEET_ENV,
    configured: Boolean(process.env[TEAM_ASSETS_SPREADSHEET_ENV]?.trim()),
    availableTabs: [],
    expectedTabName: TEAM_ASSETS_TAB_NAME,
    foundTabName: null,
    headerCount: 0,
    rowCount: 0,
    enabledRows: 0,
    assetCount: 0,
    warnings: [],
  };
}

function normalizeAssetRows(headers: string[], rows: string[][], debug: TeamAssetsReadDebug) {
  const lookup = buildColumnLookup(headers);
  const missingRequired = (["title", "url"] as const).filter(
    (field) => lookup[field] === undefined || lookup[field] < 0,
  );

  debug.headerCount = headers.length;
  debug.rowCount = rows.length;

  if (missingRequired.length > 0) {
    throw new Error(
      `${TEAM_ASSETS_TAB_NAME} tab is missing required column(s): ${missingRequired.join(", ")}`,
    );
  }

  const assets: AssetLink[] = [];

  rows.forEach((row, index) => {
    const title = toTitleCase(getCell(row, lookup, "title"));
    const url = cleanAssetUrl(getCell(row, lookup, "url"));
    const enabled = parseEnabled(getCell(row, lookup, "enabled"));

    if (title || url) {
      debug.enabledRows += enabled ? 1 : 0;
    }

    if (!enabled || !title || !url) {
      if (title || url) {
        debug.warnings.push(
          `Skipped row ${index + 2}: ${!enabled ? "disabled" : "missing title or url"}.`,
        );
      }
      return;
    }

    assets.push({
      id: `${index + 2}-${slugify(title, index)}`,
      title,
      description: getCell(row, lookup, "subtitle") || "Team resource",
      url,
      icon: normalizeIcon(getCell(row, lookup, "icon")),
      color: normalizeColor(getCell(row, lookup, "color"), index),
      accent: normalizeAccent(getCell(row, lookup, "color"), index),
      category: getCell(row, lookup, "category") || "Team",
      enabled,
      sortOrder: parseSortOrder(getCell(row, lookup, "sortOrder"), index),
      sourceRowNumber: index + 2,
    });
  });

  assets.sort(
    (left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title),
  );

  debug.assetCount = assets.length;
  return assets;
}

const getGoogleSheetsServer = createServerOnlyFn(async () => import("@/lib/google-sheets.server"));

function getTeamAssetsSpreadsheetId() {
  return process.env[TEAM_ASSETS_SPREADSHEET_ENV]?.trim() ?? "";
}

async function getTeamAssetsLinks(spreadsheetId: string) {
  if (!spreadsheetId) return {};
  const googleSheets = await getGoogleSheetsServer();
  return {
    teamAssetsSheetUrl: googleSheets.makeSheetUrl(spreadsheetId),
  };
}

async function loadTeamAssetsWorksheet(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
): Promise<TeamAssetsWorksheet> {
  const googleSheets = await getGoogleSheetsServer();

  if (!spreadsheetId) {
    throw new Error(`Missing required Google Sheets env var: ${TEAM_ASSETS_SPREADSHEET_ENV}`);
  }

  const tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
  const expectedKey = normalizeSheetKey(TEAM_ASSETS_TAB_NAME);
  const matchedTab = tabs.find((tab) => normalizeSheetKey(tab.sheetName) === expectedKey);

  if (!matchedTab) {
    throw new Error(
      `Could not find a worksheet tab named "${TEAM_ASSETS_TAB_NAME}" in ${TEAM_ASSETS_SPREADSHEET_ENV}.`,
    );
  }

  const sheet = {
    memberName: TEAM_ASSETS_TAB_NAME,
    sheetName: matchedTab.sheetName,
    gid: matchedTab.gid,
  };
  const [sheetRows] = await googleSheets.fetchSheetRowsBatch(config, spreadsheetId, [sheet]);

  return {
    sheet,
    availableTabs: tabs.map((tab) => tab.sheetName),
    headers: sheetRows?.headers ?? [],
    rows: sheetRows?.rows ?? [],
  };
}

function getWriteValue(field: TeamAssetField, input: TeamAssetInput) {
  if (field === "title") return toTitleCase(input.title);
  if (field === "subtitle") return input.subtitle ?? "";
  if (field === "url") return cleanAssetUrl(input.url);
  if (field === "icon") return input.icon;
  if (field === "color") return input.color;
  if (field === "category") return input.category || "Team";
  if (field === "enabled") return input.enabled ? "TRUE" : "FALSE";
  return String(input.sortOrder);
}

function buildTeamAssetWriteRow(headers: string[], existingRow: string[], input: TeamAssetInput) {
  const lookup = buildColumnLookup(headers);
  const missingRequired = (["title", "url"] as const).filter(
    (field) => lookup[field] === undefined || lookup[field] < 0,
  );
  const url = cleanAssetUrl(input.url);

  if (missingRequired.length > 0) {
    throw new Error(
      `${TEAM_ASSETS_TAB_NAME} tab is missing required column(s): ${missingRequired.join(", ")}`,
    );
  }

  if (!url) {
    throw new Error("Enter a valid http, https, or mailto URL.");
  }

  const row = [...existingRow];
  while (row.length < headers.length) row.push("");

  (Object.keys(TEAM_ASSET_COLUMN_ALIASES) as TeamAssetField[]).forEach((field) => {
    const index = lookup[field];
    if (index !== undefined && index >= 0) {
      row[index] = field === "url" ? url : getWriteValue(field, input);
    }
  });

  return row;
}

function nextSortOrder(headers: string[], rows: string[][]) {
  const lookup = buildColumnLookup(headers);
  const orderIndex = lookup.sortOrder;
  const highest = rows.reduce((max, row, index) => {
    const raw = orderIndex === undefined || orderIndex < 0 ? "" : (row[orderIndex] ?? "");
    return Math.max(max, parseSortOrder(raw, index));
  }, 0);

  return highest + 10 || 10;
}

function teamAssetDefaults(input: z.infer<typeof teamAssetInput>, worksheet: TeamAssetsWorksheet) {
  const domain = domainFromUrl(input.url);

  return {
    title: input.title,
    subtitle: domain ? `Open ${domain}` : "",
    url: input.url,
    icon: "link",
    color: "purple",
    category: "General",
    enabled: true,
    sortOrder: nextSortOrder(worksheet.headers, worksheet.rows),
  } satisfies TeamAssetInput;
}

function buildTeamAssetNameLinkRow(
  headers: string[],
  existingRow: string[],
  input: z.infer<typeof updateTeamAssetInput>,
) {
  const lookup = buildColumnLookup(headers);
  const titleIndex = lookup.title;
  const urlIndex = lookup.url;
  const url = cleanAssetUrl(input.url);

  if (
    titleIndex === undefined ||
    titleIndex < 0 ||
    urlIndex === undefined ||
    urlIndex < 0
  ) {
    throw new Error(`${TEAM_ASSETS_TAB_NAME} tab is missing required title or url column.`);
  }

  if (!url) {
    throw new Error("Enter a valid card link.");
  }

  const row = [...existingRow];
  while (row.length < headers.length) row.push("");
  row[titleIndex] = toTitleCase(input.title);
  row[urlIndex] = url;

  return row;
}

function buildDisabledRow(headers: string[], existingRow: string[]) {
  const lookup = buildColumnLookup(headers);
  const enabledIndex = lookup.enabled;

  if (enabledIndex === undefined || enabledIndex < 0) {
    throw new Error(`${TEAM_ASSETS_TAB_NAME} tab needs an enabled column to remove links.`);
  }

  const row = [...existingRow];
  while (row.length < headers.length) row.push("");
  row[enabledIndex] = "FALSE";

  return row;
}

function invalidateTeamAssetsCache() {
  teamAssetsCache = null;
  teamAssetsRefreshPromise = null;
}

async function checkTeamAssetsWriteAccess(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  worksheet: TeamAssetsWorksheet,
) {
  const googleSheets = await getGoogleSheetsServer();

  if (worksheet.headers.length === 0) return false;

  await googleSheets.updateSheetRow(config, spreadsheetId, worksheet.sheet, 1, worksheet.headers);
  return true;
}

async function readTeamAssetsSheetData(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  debug: TeamAssetsReadDebug,
): Promise<TeamAssetsSheetData> {
  const links = await getTeamAssetsLinks(spreadsheetId);

  debug.configured = true;
  const worksheet = await loadTeamAssetsWorksheet(config, spreadsheetId);
  debug.availableTabs = worksheet.availableTabs;
  debug.foundTabName = worksheet.sheet.sheetName;
  const assets = normalizeAssetRows(worksheet.headers, worksheet.rows, debug);

  logTeamAssets("team assets loaded from google sheets", {
    sheetName: worksheet.sheet.sheetName,
    rowCount: debug.rowCount,
    assetCount: assets.length,
  });

  return {
    assets,
    source: "google-sheet",
    links,
    updatedAt: new Date().toISOString(),
  };
}

function fallbackTeamAssetsData(
  error: string,
  links: TeamAssetsSheetData["links"],
): TeamAssetsSheetData {
  return {
    assets: fallbackAssetLinks,
    source: "fallback",
    error,
    warning: "Local development fallback: Team Assets could not be loaded from Google Sheets.",
    links,
    updatedAt: new Date().toISOString(),
  };
}

function emptyTeamAssetsData(
  error: string,
  links: TeamAssetsSheetData["links"],
): TeamAssetsSheetData {
  return {
    assets: [],
    source: "error",
    error,
    links,
    updatedAt: new Date().toISOString(),
  };
}

async function refreshTeamAssetsCache(config: GoogleSheetsConfig): Promise<TeamAssetsCacheEntry> {
  const debug = emptyDebug();
  const spreadsheetId = getTeamAssetsSpreadsheetId();
  const data = await readTeamAssetsSheetData(config, spreadsheetId, debug);
  const entry = {
    data,
    debug,
    cachedAt: Date.now(),
    expiresAt: Date.now() + TEAM_ASSETS_CACHE_TTL_MS,
  };

  teamAssetsCache = entry;
  logTeamAssets("team assets server cache refreshed", {
    expiresAt: new Date(entry.expiresAt).toISOString(),
    assetCount: data.assets.length,
  });

  return entry;
}

async function getTeamAssetsWithServerCache(
  config: GoogleSheetsConfig,
  options: { allowStaleCache?: boolean } = {},
): Promise<TeamAssetsReadResult> {
  const currentCache = teamAssetsCache;

  if (currentCache && currentCache.expiresAt > Date.now()) {
    return {
      data: currentCache.data,
      debug: cloneDebug(currentCache.debug),
      cacheStatus: "hit",
      cacheExpiresAt: cacheExpiresAtLabel(currentCache),
    };
  }

  if (options.allowStaleCache && currentCache) {
    return {
      data: withTeamAssetsWarning(
        currentCache.data,
        "Showing cached Team Assets data to avoid extra diagnostic reads.",
      ),
      debug: cloneDebug(currentCache.debug),
      cacheStatus: "stale",
      cacheExpiresAt: cacheExpiresAtLabel(currentCache),
    };
  }

  try {
    if (!teamAssetsRefreshPromise) {
      logTeamAssets("team assets server cache miss; refreshing");
      teamAssetsRefreshPromise = refreshTeamAssetsCache(config).finally(() => {
        teamAssetsRefreshPromise = null;
      });
    } else {
      logTeamAssets("team assets server cache refresh already in flight");
    }

    const entry = await teamAssetsRefreshPromise;

    return {
      data: entry.data,
      debug: cloneDebug(entry.debug),
      cacheStatus: "miss",
      cacheExpiresAt: cacheExpiresAtLabel(entry),
    };
  } catch (error) {
    if (isRateLimitError(error) && teamAssetsCache) {
      const warning =
        "Google Sheets rate limit was hit, so Team Assets is showing the last cached data.";

      logTeamAssets("google sheets rate limited; serving cached team assets", {
        expiredAt: cacheExpiresAtLabel(teamAssetsCache),
        reason: errorMessage(error),
      });

      return {
        data: withTeamAssetsWarning(teamAssetsCache.data, warning),
        debug: cloneDebug(teamAssetsCache.debug),
        cacheStatus: "stale",
        cacheExpiresAt: cacheExpiresAtLabel(teamAssetsCache),
      };
    }

    throw error;
  }
}

export async function getTeamAssetsDataFlowDiagnostics(): Promise<TeamAssetsDataFlowDiagnostics> {
  const googleSheets = await getGoogleSheetsServer();
  const productionRuntime = googleSheets.isProductionRuntime();
  const spreadsheetId = getTeamAssetsSpreadsheetId();
  const links = await getTeamAssetsLinks(spreadsheetId);
  const makeCacheDiagnostics = (
    cacheStatus: TeamAssetsCacheStatus,
    cacheExpiresAt: string | null,
  ) => ({
    queryStaleTimeMs: QUERY_STALE_TIME_MS,
    queryRefetchIntervalMs: QUERY_REFETCH_INTERVAL_MS,
    serverCacheTtlMs: TEAM_ASSETS_CACHE_TTL_MS,
    serverCacheStatus: cacheStatus,
    serverCacheExpiresAt: cacheExpiresAt,
    googleFetchCache: "no-store" as const,
  });

  try {
    const result = await getTeamAssetsWithServerCache(googleSheets.getGoogleSheetsConfig(), {
      allowStaleCache: true,
    });
    const debug = result.debug;
    let writable = false;

    try {
      const worksheet = await loadTeamAssetsWorksheet(
        googleSheets.getGoogleSheetsConfig(),
        spreadsheetId,
      );
      writable = await checkTeamAssetsWriteAccess(
        googleSheets.getGoogleSheetsConfig(),
        spreadsheetId,
        worksheet,
      );
    } catch (error) {
      debug.warnings.push(`Team Assets write access check failed: ${errorMessage(error)}`);
    }

    return {
      checkedAt: new Date().toISOString(),
      source: result.data.source,
      fallbackActive: result.data.source === "fallback",
      fallbackReason: result.data.source === "fallback" ? (result.data.error ?? null) : null,
      spreadsheet: {
        envVar: TEAM_ASSETS_SPREADSHEET_ENV,
        configured: debug.configured,
        readable: result.data.source === "google-sheet",
        writable,
        link: links.teamAssetsSheetUrl ?? null,
      },
      tab: {
        expectedName: TEAM_ASSETS_TAB_NAME,
        found: Boolean(debug.foundTabName),
        sheetName: debug.foundTabName,
        availableTabs: debug.availableTabs,
      },
      counts: {
        headers: debug.headerCount,
        rows: debug.rowCount,
        enabledRows: debug.enabledRows,
        assets: debug.assetCount,
      },
      cache: makeCacheDiagnostics(result.cacheStatus, result.cacheExpiresAt),
      warnings: debug.warnings,
    };
  } catch (error) {
    const debug = teamAssetsCache ? cloneDebug(teamAssetsCache.debug) : emptyDebug();
    const message = `${errorMessage(error)}. Check ${TEAM_ASSETS_SPREADSHEET_ENV}, the "${TEAM_ASSETS_TAB_NAME}" tab, and whether the Sheet is shared with the service account email.`;

    return {
      checkedAt: new Date().toISOString(),
      source: productionRuntime ? "error" : "fallback",
      fallbackActive: !productionRuntime,
      fallbackReason: productionRuntime ? message : `Local development fallback: ${message}`,
      spreadsheet: {
        envVar: TEAM_ASSETS_SPREADSHEET_ENV,
        configured: Boolean(spreadsheetId),
        readable: false,
        writable: false,
        link: links.teamAssetsSheetUrl ?? null,
      },
      tab: {
        expectedName: TEAM_ASSETS_TAB_NAME,
        found: Boolean(debug.foundTabName),
        sheetName: debug.foundTabName,
        availableTabs: debug.availableTabs,
      },
      counts: {
        headers: debug.headerCount,
        rows: debug.rowCount,
        enabledRows: debug.enabledRows,
        assets: debug.assetCount,
      },
      cache: makeCacheDiagnostics(
        teamAssetsCache ? "stale" : "miss",
        cacheExpiresAtLabel(teamAssetsCache),
      ),
      warnings: [...debug.warnings, message],
    };
  }
}

export async function getTeamAssetsDataForServer(): Promise<TeamAssetsSheetData> {
  const googleSheets = await getGoogleSheetsServer();
  const productionRuntime = googleSheets.isProductionRuntime();
  const spreadsheetId = getTeamAssetsSpreadsheetId();
  const links = await getTeamAssetsLinks(spreadsheetId);

  try {
    const result = await getTeamAssetsWithServerCache(googleSheets.getGoogleSheetsConfig());
    return result.data;
  } catch (error) {
    const message = `${errorMessage(error)}. Check ${TEAM_ASSETS_SPREADSHEET_ENV}, the "${TEAM_ASSETS_TAB_NAME}" tab, and whether the Sheet is shared with the service account email.`;
    console.error("Google Sheets Team Assets access failed:", error);
    logTeamAssets("team assets google sheets load failed", {
      productionRuntime,
      fallbackActive: !productionRuntime,
      reason: message,
    });

    if (!productionRuntime) {
      return fallbackTeamAssetsData(message, links);
    }

    return emptyTeamAssetsData(message, links);
  }
}

export const fetchTeamAssetsData = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  return getTeamAssetsDataForServer();
});

export const addTeamAssetLink = createServerFn({ method: "POST" })
  .inputValidator(teamAssetInput)
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const spreadsheetId = getTeamAssetsSpreadsheetId();
    const worksheet = await loadTeamAssetsWorksheet(config, spreadsheetId);
    const row = buildTeamAssetWriteRow(worksheet.headers, [], teamAssetDefaults(data, worksheet));

    await googleSheets.appendSheetRow(config, spreadsheetId, worksheet.sheet, row);
    invalidateTeamAssetsCache();

    return { ok: true as const };
  });

export const updateTeamAssetLink = createServerFn({ method: "POST" })
  .inputValidator(updateTeamAssetInput)
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const spreadsheetId = getTeamAssetsSpreadsheetId();
    const worksheet = await loadTeamAssetsWorksheet(config, spreadsheetId);
    const existingRow = worksheet.rows[data.rowNumber - 2];

    if (!existingRow) {
      throw new Error(`Could not find Team Assets row ${data.rowNumber}. Refresh and try again.`);
    }

    const row = buildTeamAssetNameLinkRow(worksheet.headers, existingRow, data);

    await googleSheets.updateSheetRow(config, spreadsheetId, worksheet.sheet, data.rowNumber, row);
    invalidateTeamAssetsCache();

    return { ok: true as const };
  });

export const removeTeamAssetLink = createServerFn({ method: "POST" })
  .inputValidator(removeTeamAssetInput)
  .handler(async ({ data }) => {
    const { requireAdminAuth } = await import("@/lib/auth.server");
    await requireAdminAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const spreadsheetId = getTeamAssetsSpreadsheetId();
    const worksheet = await loadTeamAssetsWorksheet(config, spreadsheetId);
    const existingRow = worksheet.rows[data.rowNumber - 2];

    if (!existingRow) {
      throw new Error(`Could not find Team Assets row ${data.rowNumber}. Refresh and try again.`);
    }

    const row = buildDisabledRow(worksheet.headers, existingRow);

    await googleSheets.updateSheetRow(config, spreadsheetId, worksheet.sheet, data.rowNumber, row);
    invalidateTeamAssetsCache();

    return { ok: true as const };
  });

export const teamAssetsQuery = {
  queryKey: ["team-billion-team-assets", "google-sheet-v1"],
  queryFn: () => fetchTeamAssetsData(),
  refetchInterval: QUERY_REFETCH_INTERVAL_MS,
  staleTime: QUERY_STALE_TIME_MS,
};
