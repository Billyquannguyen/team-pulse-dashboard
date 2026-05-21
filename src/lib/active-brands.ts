import { createServerFn } from "@tanstack/react-start";
import { requireDashboardAuth } from "@/lib/auth";

type GoogleSheetsServer = typeof import("@/lib/google-sheets.server");
type GoogleSheetsConfig = ReturnType<GoogleSheetsServer["getGoogleSheetsConfig"]>;

type ActiveBrandsCacheStatus = "hit" | "miss" | "stale" | "refreshing";

type ActiveBrandsReadDebug = {
  envVar: typeof ACTIVE_BRANDS_SPREADSHEET_ENV;
  configured: boolean;
  availableTabs: string[];
  expectedTabName: typeof ACTIVE_CONTACTS_TAB_NAME;
  foundTabName: string | null;
  headerCount: number;
  rowCount: number;
  warnings: string[];
};

type ActiveBrandsCacheEntry = {
  data: ActiveBrandsSheetData;
  debug: ActiveBrandsReadDebug;
  cachedAt: number;
  expiresAt: number;
};

type ActiveBrandsReadResult = {
  data: ActiveBrandsSheetData;
  debug: ActiveBrandsReadDebug;
  cacheStatus: ActiveBrandsCacheStatus;
  cacheExpiresAt: string | null;
};

export type ActiveBrandsKnowledgeMatch = {
  source: "sheets";
  title: string;
  text: string;
  score: number;
};

export type ActiveBrandsSheetData = {
  headers: string[];
  rows: string[][];
  source: "google-sheet" | "fallback" | "error";
  error?: string;
  warning?: string;
  links: {
    activeBrandsSheetUrl?: string;
  };
  updatedAt: string;
};

export type ActiveBrandsDataFlowDiagnostics = {
  checkedAt: string;
  source: ActiveBrandsSheetData["source"];
  fallbackActive: boolean;
  fallbackReason: string | null;
  spreadsheet: {
    envVar: typeof ACTIVE_BRANDS_SPREADSHEET_ENV;
    configured: boolean;
    readable: boolean;
    link: string | null;
  };
  tab: {
    expectedName: typeof ACTIVE_CONTACTS_TAB_NAME;
    found: boolean;
    sheetName: string | null;
    availableTabs: string[];
  };
  counts: {
    headers: number;
    rows: number;
  };
  cache: {
    queryStaleTimeMs: number;
    queryRefetchIntervalMs: number;
    serverCacheTtlMs: number;
    serverCacheStatus: ActiveBrandsCacheStatus;
    serverCacheExpiresAt: string | null;
    googleFetchCache: "no-store";
  };
  warnings: string[];
};

export const ACTIVE_CONTACTS_TAB_NAME = "Active Contacts";
export const ACTIVE_BRANDS_SPREADSHEET_ENV = "ACTIVE_BRANDS_SPREADSHEET_ID";

const ACTIVE_BRANDS_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_STALE_TIME_MS = ACTIVE_BRANDS_CACHE_TTL_MS;
const QUERY_REFETCH_INTERVAL_MS = ACTIVE_BRANDS_CACHE_TTL_MS;

let activeBrandsCache: ActiveBrandsCacheEntry | null = null;
let activeBrandsRefreshPromise: Promise<ActiveBrandsCacheEntry> | null = null;

function logActiveBrands(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:active-brands]", message, details ?? {});
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRateLimitError(error: unknown) {
  return (
    error instanceof Error && /Google Sheets API failed \(429\)|Quota exceeded/i.test(error.message)
  );
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return (
    normalizeKey(value)
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.filter((term) => !["the", "and", "for", "with", "this", "that"].includes(term)) ?? []
  );
}

function normalizeSheetKey(value: string) {
  return normalizeKey(value).replace(/\s/g, "");
}

function cacheExpiresAtLabel(entry: ActiveBrandsCacheEntry | null) {
  return entry ? new Date(entry.expiresAt).toISOString() : null;
}

function cloneDebug(debug: ActiveBrandsReadDebug): ActiveBrandsReadDebug {
  return {
    ...debug,
    availableTabs: [...debug.availableTabs],
    warnings: [...debug.warnings],
  };
}

function withActiveBrandsWarning(
  data: ActiveBrandsSheetData,
  warning: string,
): ActiveBrandsSheetData {
  return {
    ...data,
    warning: data.warning ? `${data.warning} ${warning}` : warning,
  };
}

function emptyDebug(): ActiveBrandsReadDebug {
  return {
    envVar: ACTIVE_BRANDS_SPREADSHEET_ENV,
    configured: Boolean(process.env[ACTIVE_BRANDS_SPREADSHEET_ENV]?.trim()),
    availableTabs: [],
    expectedTabName: ACTIVE_CONTACTS_TAB_NAME,
    foundTabName: null,
    headerCount: 0,
    rowCount: 0,
    warnings: [],
  };
}

async function getGoogleSheetsServer() {
  return import("@/lib/google-sheets.server");
}

function getActiveBrandsSpreadsheetId() {
  return process.env[ACTIVE_BRANDS_SPREADSHEET_ENV]?.trim() ?? "";
}

async function getActiveBrandsLinks(spreadsheetId: string) {
  if (!spreadsheetId) return {};
  const googleSheets = await getGoogleSheetsServer();
  return {
    activeBrandsSheetUrl: googleSheets.makeSheetUrl(spreadsheetId),
  };
}

function trimEmptyTrailingColumns(headers: string[], rows: string[][]) {
  let lastUsedIndex = headers.length - 1;

  rows.forEach((row) => {
    row.forEach((cell, index) => {
      if (cell.trim()) {
        lastUsedIndex = Math.max(lastUsedIndex, index);
      }
    });
  });

  const width = Math.max(0, lastUsedIndex + 1);

  return {
    headers: headers.slice(0, width),
    rows: rows.map((row) => row.slice(0, width)),
  };
}

async function readActiveBrandsSheetData(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  debug: ActiveBrandsReadDebug,
): Promise<ActiveBrandsSheetData> {
  const googleSheets = await getGoogleSheetsServer();
  const links = await getActiveBrandsLinks(spreadsheetId);

  if (!spreadsheetId) {
    throw new Error(`Missing required Google Sheets env var: ${ACTIVE_BRANDS_SPREADSHEET_ENV}`);
  }

  debug.configured = true;
  const tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
  debug.availableTabs = tabs.map((tab) => tab.sheetName);
  const expectedKey = normalizeSheetKey(ACTIVE_CONTACTS_TAB_NAME);
  const matchedTab = tabs.find((tab) => normalizeSheetKey(tab.sheetName) === expectedKey);

  if (!matchedTab) {
    throw new Error(
      `Could not find a worksheet tab named "${ACTIVE_CONTACTS_TAB_NAME}" in ${ACTIVE_BRANDS_SPREADSHEET_ENV}.`,
    );
  }

  debug.foundTabName = matchedTab.sheetName;
  const [sheetRows] = await googleSheets.fetchSheetRowsBatch(config, spreadsheetId, [
    {
      memberName: ACTIVE_CONTACTS_TAB_NAME,
      sheetName: matchedTab.sheetName,
      gid: matchedTab.gid,
    },
  ]);
  const shaped = trimEmptyTrailingColumns(sheetRows?.headers ?? [], sheetRows?.rows ?? []);
  debug.headerCount = shaped.headers.length;
  debug.rowCount = shaped.rows.length;

  if (shaped.headers.length === 0) {
    debug.warnings.push(`The "${ACTIVE_CONTACTS_TAB_NAME}" tab has no header row.`);
  }

  logActiveBrands("active brands loaded from google sheets", {
    sheetName: matchedTab.sheetName,
    headerCount: shaped.headers.length,
    rowCount: shaped.rows.length,
  });

  return {
    headers: shaped.headers,
    rows: shaped.rows,
    source: "google-sheet",
    links,
    updatedAt: new Date().toISOString(),
  };
}

function fallbackActiveBrandsData(
  error: string,
  links: ActiveBrandsSheetData["links"],
): ActiveBrandsSheetData {
  return {
    headers: [],
    rows: [],
    source: "fallback",
    error,
    warning: "Local development fallback: Active Brands could not be loaded from Google Sheets.",
    links,
    updatedAt: new Date().toISOString(),
  };
}

function emptyActiveBrandsData(
  error: string,
  links: ActiveBrandsSheetData["links"],
): ActiveBrandsSheetData {
  return {
    headers: [],
    rows: [],
    source: "error",
    error,
    links,
    updatedAt: new Date().toISOString(),
  };
}

async function refreshActiveBrandsCache(
  config: GoogleSheetsConfig,
): Promise<ActiveBrandsCacheEntry> {
  const debug = emptyDebug();
  const spreadsheetId = getActiveBrandsSpreadsheetId();
  const data = await readActiveBrandsSheetData(config, spreadsheetId, debug);
  const entry = {
    data,
    debug,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ACTIVE_BRANDS_CACHE_TTL_MS,
  };

  activeBrandsCache = entry;
  logActiveBrands("active brands server cache refreshed", {
    expiresAt: new Date(entry.expiresAt).toISOString(),
    rows: data.rows.length,
  });

  return entry;
}

async function getActiveBrandsWithServerCache(
  config: GoogleSheetsConfig,
  options: { allowStaleCache?: boolean } = {},
): Promise<ActiveBrandsReadResult> {
  const currentCache = activeBrandsCache;

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
      data: withActiveBrandsWarning(
        currentCache.data,
        "Showing cached Active Brands data to avoid extra diagnostic reads.",
      ),
      debug: cloneDebug(currentCache.debug),
      cacheStatus: "stale",
      cacheExpiresAt: cacheExpiresAtLabel(currentCache),
    };
  }

  try {
    if (!activeBrandsRefreshPromise) {
      logActiveBrands("active brands server cache miss; refreshing");
      activeBrandsRefreshPromise = refreshActiveBrandsCache(config).finally(() => {
        activeBrandsRefreshPromise = null;
      });
    } else {
      logActiveBrands("active brands server cache refresh already in flight");
    }

    const entry = await activeBrandsRefreshPromise;

    return {
      data: entry.data,
      debug: cloneDebug(entry.debug),
      cacheStatus: "miss",
      cacheExpiresAt: cacheExpiresAtLabel(entry),
    };
  } catch (error) {
    if (isRateLimitError(error) && activeBrandsCache) {
      const warning =
        "Google Sheets rate limit was hit, so Active Brands is showing the last cached data.";

      logActiveBrands("google sheets rate limited; serving cached active brands", {
        expiredAt: cacheExpiresAtLabel(activeBrandsCache),
        reason: errorMessage(error),
      });

      return {
        data: withActiveBrandsWarning(activeBrandsCache.data, warning),
        debug: cloneDebug(activeBrandsCache.debug),
        cacheStatus: "stale",
        cacheExpiresAt: cacheExpiresAtLabel(activeBrandsCache),
      };
    }

    throw error;
  }
}

export async function getActiveBrandsDataFlowDiagnostics(): Promise<ActiveBrandsDataFlowDiagnostics> {
  const googleSheets = await getGoogleSheetsServer();
  const productionRuntime = googleSheets.isProductionRuntime();
  const spreadsheetId = getActiveBrandsSpreadsheetId();
  const links = await getActiveBrandsLinks(spreadsheetId);
  const makeCacheDiagnostics = (
    cacheStatus: ActiveBrandsCacheStatus,
    cacheExpiresAt: string | null,
  ) => ({
    queryStaleTimeMs: QUERY_STALE_TIME_MS,
    queryRefetchIntervalMs: QUERY_REFETCH_INTERVAL_MS,
    serverCacheTtlMs: ACTIVE_BRANDS_CACHE_TTL_MS,
    serverCacheStatus: cacheStatus,
    serverCacheExpiresAt: cacheExpiresAt,
    googleFetchCache: "no-store" as const,
  });

  try {
    const result = await getActiveBrandsWithServerCache(googleSheets.getGoogleSheetsConfig(), {
      allowStaleCache: true,
    });
    const debug = result.debug;

    return {
      checkedAt: new Date().toISOString(),
      source: result.data.source,
      fallbackActive: result.data.source === "fallback",
      fallbackReason: result.data.source === "fallback" ? (result.data.error ?? null) : null,
      spreadsheet: {
        envVar: ACTIVE_BRANDS_SPREADSHEET_ENV,
        configured: debug.configured,
        readable: result.data.source === "google-sheet",
        link: links.activeBrandsSheetUrl ?? null,
      },
      tab: {
        expectedName: ACTIVE_CONTACTS_TAB_NAME,
        found: Boolean(debug.foundTabName),
        sheetName: debug.foundTabName,
        availableTabs: debug.availableTabs,
      },
      counts: {
        headers: debug.headerCount,
        rows: debug.rowCount,
      },
      cache: makeCacheDiagnostics(result.cacheStatus, result.cacheExpiresAt),
      warnings: debug.warnings,
    };
  } catch (error) {
    const debug = activeBrandsCache ? cloneDebug(activeBrandsCache.debug) : emptyDebug();
    const message = `${errorMessage(error)}. Check ${ACTIVE_BRANDS_SPREADSHEET_ENV}, the "${ACTIVE_CONTACTS_TAB_NAME}" tab, and whether the Sheet is shared with the service account email.`;

    return {
      checkedAt: new Date().toISOString(),
      source: productionRuntime ? "error" : "fallback",
      fallbackActive: !productionRuntime,
      fallbackReason: productionRuntime ? message : `Local development fallback: ${message}`,
      spreadsheet: {
        envVar: ACTIVE_BRANDS_SPREADSHEET_ENV,
        configured: Boolean(spreadsheetId),
        readable: false,
        link: links.activeBrandsSheetUrl ?? null,
      },
      tab: {
        expectedName: ACTIVE_CONTACTS_TAB_NAME,
        found: Boolean(debug.foundTabName),
        sheetName: debug.foundTabName,
        availableTabs: debug.availableTabs,
      },
      counts: {
        headers: debug.headerCount,
        rows: debug.rowCount,
      },
      cache: makeCacheDiagnostics(
        activeBrandsCache ? "stale" : "miss",
        cacheExpiresAtLabel(activeBrandsCache),
      ),
      warnings: [...debug.warnings, message],
    };
  }
}

export const fetchActiveBrandsData = createServerFn({ method: "GET" }).handler(async () => {
  await requireDashboardAuth();
  const googleSheets = await getGoogleSheetsServer();
  const productionRuntime = googleSheets.isProductionRuntime();
  const spreadsheetId = getActiveBrandsSpreadsheetId();
  const links = await getActiveBrandsLinks(spreadsheetId);

  try {
    const result = await getActiveBrandsWithServerCache(googleSheets.getGoogleSheetsConfig());
    return result.data;
  } catch (error) {
    const message = `${errorMessage(error)}. Check ${ACTIVE_BRANDS_SPREADSHEET_ENV}, the "${ACTIVE_CONTACTS_TAB_NAME}" tab, and whether the Sheet is shared with the service account email.`;
    console.error("Google Sheets Active Brands access failed:", error);
    logActiveBrands("active brands google sheets load failed", {
      productionRuntime,
      fallbackActive: !productionRuntime,
      reason: message,
    });

    if (!productionRuntime) {
      return fallbackActiveBrandsData(message, links);
    }

    return emptyActiveBrandsData(message, links);
  }
});

export async function getActiveBrandsKnowledgeMatches(
  question: string,
): Promise<ActiveBrandsKnowledgeMatch[]> {
  const googleSheets = await getGoogleSheetsServer();
  const queryTerms = Array.from(new Set(tokenize(question)));

  if (queryTerms.length === 0) return [];

  try {
    const result = await getActiveBrandsWithServerCache(googleSheets.getGoogleSheetsConfig(), {
      allowStaleCache: true,
    });

    if (result.data.source === "error" || result.data.rows.length === 0) {
      return [];
    }

    return result.data.rows
      .map((row) => {
        const labelledCells = result.data.headers
          .map((header, index) => {
            const value = row[index]?.trim();
            return value ? `${header || `Column ${index + 1}`}: ${value}` : "";
          })
          .filter(Boolean);
        const text = labelledCells.join(" | ");
        const normalizedText = normalizeKey(text);
        const score = queryTerms.reduce(
          (total, term) => total + (normalizedText.includes(term) ? 1 : 0),
          0,
        );
        const title = row.find((cell) => cell.trim())?.trim() || "Active brand row";

        return {
          source: "sheets" as const,
          title,
          text,
          score,
        };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
  } catch (error) {
    logActiveBrands("active brands knowledge lookup failed", {
      reason: errorMessage(error),
    });
    return [];
  }
}

export const activeBrandsQuery = {
  queryKey: ["team-billion-active-brands", "active-contacts-v1"],
  queryFn: () => fetchActiveBrandsData(),
  refetchInterval: QUERY_REFETCH_INTERVAL_MS,
  staleTime: QUERY_STALE_TIME_MS,
};
