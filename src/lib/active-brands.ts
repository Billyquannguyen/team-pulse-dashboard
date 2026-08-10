import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";

type GoogleSheetsConfig = {
  serviceAccountEmail: string;
  privateKey: string;
  teamSpreadsheetId: string;
  creatorSourcingSpreadsheetId: string;
};

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

export type CreatorSourcingBrief = {
  platforms: string;
  creatorSize: string;
  location: string;
  language: string;
  creatorAge: string;
  gender: string;
  niches: string;
  creatorStyle: string;
  audience: string;
  briefDate: string;
  sourceAgency: string;
  sourceEmail: string;
};

export type ActiveBrandContact = {
  contact: string;
  lastActiveDate: string;
  notes: string;
};

export type ActiveBrandAgency = {
  name: string;
  topContact: string;
  topContactLastActiveDate: string;
  contacts: ActiveBrandContact[];
};

export type ActiveBrand = {
  name: string;
  niche: string;
  bestActiveDate: string;
  brief: CreatorSourcingBrief;
  agencies: ActiveBrandAgency[];
};

export type ActiveBrandsSheetData = {
  headers: string[];
  rows: string[][];
  brands: ActiveBrand[];
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
export const ACTIVE_BRANDS_AGENCIES_TAB_NAME = "Agencies";
export const ACTIVE_BRANDS_CONTACTS_TAB_NAME = "Contacts";
export const ACTIVE_BRANDS_BRIEFS_TAB_NAME = "Briefs";
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

const getGoogleSheetsServer = createServerOnlyFn(async () => import("@/lib/google-sheets.server"));

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

type SheetTable = ReturnType<typeof trimEmptyTrailingColumns>;

function columnIndex(table: SheetTable, header: string) {
  const wanted = normalizeKey(header);
  return table.headers.findIndex((value) => normalizeKey(value) === wanted);
}

function tableValue(table: SheetTable, row: string[], header: string) {
  const index = columnIndex(table, header);
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function dateScore(value: string) {
  const score = Date.parse(value);
  return Number.isFinite(score) ? score : 0;
}

function latestDate(values: string[]) {
  return values.filter(Boolean).sort((left, right) => dateScore(right) - dateScore(left))[0] ?? "";
}

function emptyBrief(): CreatorSourcingBrief {
  return {
    platforms: "",
    creatorSize: "",
    location: "",
    language: "",
    creatorAge: "",
    gender: "",
    niches: "",
    creatorStyle: "",
    audience: "",
    briefDate: "",
    sourceAgency: "",
    sourceEmail: "",
  };
}

function sameKey(left: string, right: string) {
  return normalizeKey(left) === normalizeKey(right);
}

function shapeActiveBrands(
  active: SheetTable,
  agencies: SheetTable,
  contacts: SheetTable,
  briefs: SheetTable,
): ActiveBrand[] {
  const brandRows = active.rows.filter(
    (row) => tableValue(active, row, "Record Type").toLowerCase() === "brand",
  );

  return brandRows
    .map((brandRow) => {
      const name = tableValue(active, brandRow, "Brand") || brandRow[0]?.trim() || "";
      const brandContacts = contacts.rows
        .filter((row) => sameKey(tableValue(contacts, row, "Brand"), name))
        .map((row) => ({
          agency: tableValue(contacts, row, "Agency"),
          contact: tableValue(contacts, row, "Contact Email / WhatsApp"),
          lastActiveDate: tableValue(contacts, row, "Last Active Date"),
          notes: tableValue(contacts, row, "Notes"),
        }));
      const agencyRows = agencies.rows.filter((row) =>
        sameKey(tableValue(agencies, row, "Brand"), name),
      );
      const uniqueAgencyNames = Array.from(
        new Set([
          ...agencyRows.map((row) => tableValue(agencies, row, "Agency")),
          ...brandContacts.map((contact) => contact.agency),
        ]),
      );
      const briefRow = briefs.rows.find((row) => sameKey(tableValue(briefs, row, "Brand"), name));
      const brief = briefRow
        ? {
            platforms: tableValue(briefs, briefRow, "Platforms"),
            creatorSize: tableValue(briefs, briefRow, "Creator Size"),
            location: tableValue(briefs, briefRow, "Location"),
            language: tableValue(briefs, briefRow, "Language"),
            creatorAge: tableValue(briefs, briefRow, "Creator Age"),
            gender: tableValue(briefs, briefRow, "Gender"),
            niches: tableValue(briefs, briefRow, "Niches"),
            creatorStyle: tableValue(briefs, briefRow, "Creator Style"),
            audience: tableValue(briefs, briefRow, "Audience"),
            briefDate: tableValue(briefs, briefRow, "Brief Date"),
            sourceAgency: tableValue(briefs, briefRow, "Source Agency"),
            sourceEmail: tableValue(briefs, briefRow, "Source Email"),
          }
        : emptyBrief();

      const shapedAgencies = uniqueAgencyNames
        .map((agencyName) => {
          const agencyRow = agencyRows.find((row) =>
            sameKey(tableValue(agencies, row, "Agency"), agencyName),
          );
          const agencyContacts = brandContacts
            .filter((contact) => sameKey(contact.agency, agencyName))
            .map(({ contact, lastActiveDate, notes }) => ({ contact, lastActiveDate, notes }))
            .sort(
              (left, right) => dateScore(right.lastActiveDate) - dateScore(left.lastActiveDate),
            );
          const topContact =
            (agencyRow && tableValue(agencies, agencyRow, "Top Contact Email / WhatsApp")) ||
            agencyContacts[0]?.contact ||
            "";
          const topContactLastActiveDate =
            (agencyRow && tableValue(agencies, agencyRow, "Contact Active Date")) ||
            agencyContacts.find((contact) => contact.contact === topContact)?.lastActiveDate ||
            agencyContacts[0]?.lastActiveDate ||
            "";

          return {
            name: agencyName,
            topContact,
            topContactLastActiveDate,
            contacts: agencyContacts,
          };
        })
        .sort(
          (left, right) =>
            dateScore(right.topContactLastActiveDate) - dateScore(left.topContactLastActiveDate) ||
            left.name.localeCompare(right.name),
        );

      return {
        name,
        niche: tableValue(active, brandRow, "Niche"),
        bestActiveDate:
          latestDate(brandContacts.map((contact) => contact.lastActiveDate)) ||
          tableValue(active, brandRow, "Best / Last Active"),
        brief,
        agencies: shapedAgencies,
      };
    })
    .filter((brand) => brand.name)
    .sort(
      (left, right) =>
        dateScore(right.bestActiveDate) - dateScore(left.bestActiveDate) ||
        left.name.localeCompare(right.name),
    );
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
  const requiredTabNames = [
    ACTIVE_CONTACTS_TAB_NAME,
    ACTIVE_BRANDS_AGENCIES_TAB_NAME,
    ACTIVE_BRANDS_CONTACTS_TAB_NAME,
    ACTIVE_BRANDS_BRIEFS_TAB_NAME,
  ] as const;
  const matchedTabs = requiredTabNames.map((requiredName) =>
    tabs.find((tab) => normalizeSheetKey(tab.sheetName) === normalizeSheetKey(requiredName)),
  );
  const matchedTab = matchedTabs[0];

  if (matchedTabs.some((tab) => !tab)) {
    const missing = requiredTabNames.filter((_, index) => !matchedTabs[index]);
    throw new Error(
      `Could not find required worksheet tab${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    );
  }

  debug.foundTabName = matchedTab?.sheetName ?? null;
  const sheetResults = await googleSheets.fetchSheetRowsBatch(
    config,
    spreadsheetId,
    requiredTabNames.map((memberName, index) => ({
      memberName,
      sheetName: matchedTabs[index]!.sheetName,
      gid: matchedTabs[index]!.gid,
    })),
  );
  const [activeResult, agenciesResult, contactsResult, briefsResult] = sheetResults;
  const shaped = trimEmptyTrailingColumns(activeResult?.headers ?? [], activeResult?.rows ?? []);
  const agencyTable = trimEmptyTrailingColumns(
    agenciesResult?.headers ?? [],
    agenciesResult?.rows ?? [],
  );
  const contactTable = trimEmptyTrailingColumns(
    contactsResult?.headers ?? [],
    contactsResult?.rows ?? [],
  );
  const briefTable = trimEmptyTrailingColumns(
    briefsResult?.headers ?? [],
    briefsResult?.rows ?? [],
  );
  const brands = shapeActiveBrands(shaped, agencyTable, contactTable, briefTable);
  const recordedUpdatedAt = shaped.rows
    .map((row) => tableValue(shaped, row, "Data Last Updated"))
    .find(Boolean);
  debug.headerCount = shaped.headers.length;
  debug.rowCount = shaped.rows.length;

  if (shaped.headers.length === 0) {
    debug.warnings.push(`The "${ACTIVE_CONTACTS_TAB_NAME}" tab has no header row.`);
  }

  logActiveBrands("active brands loaded from google sheets", {
    sheetName: matchedTab!.sheetName,
    headerCount: shaped.headers.length,
    rowCount: shaped.rows.length,
    brandCount: brands.length,
  });

  return {
    headers: shaped.headers,
    rows: shaped.rows,
    brands,
    source: "google-sheet",
    links,
    updatedAt:
      recordedUpdatedAt && Number.isFinite(Date.parse(recordedUpdatedAt))
        ? new Date(recordedUpdatedAt).toISOString()
        : new Date().toISOString(),
  };
}

function fallbackActiveBrandsData(
  error: string,
  links: ActiveBrandsSheetData["links"],
): ActiveBrandsSheetData {
  return {
    headers: [],
    rows: [],
    brands: [],
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
    brands: [],
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
  const { requireDashboardAuth } = await import("@/lib/auth.server");
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

    if (result.data.source === "error" || result.data.brands.length === 0) {
      return [];
    }

    return result.data.brands
      .map((brand) => {
        const brief = brand.brief;
        const contactText = brand.agencies
          .flatMap((agency) =>
            agency.contacts.map(
              (contact) =>
                `${agency.name || "Agency not identified"}: ${contact.contact} (${contact.lastActiveDate})`,
            ),
          )
          .join(" | ");
        const briefText = [
          brief.platforms && `Platforms: ${brief.platforms}`,
          brief.creatorSize && `Creator size: ${brief.creatorSize}`,
          brief.location && `Location: ${brief.location}`,
          brief.language && `Language: ${brief.language}`,
          brief.creatorAge && `Creator age: ${brief.creatorAge}`,
          brief.gender && `Gender: ${brief.gender}`,
          brief.niches && `Niches: ${brief.niches}`,
          brief.creatorStyle && `Creator style: ${brief.creatorStyle}`,
          brief.audience && `Audience: ${brief.audience}`,
        ]
          .filter(Boolean)
          .join(" | ");
        const text = [
          `Brand: ${brand.name}`,
          `Niche: ${brand.niche}`,
          `Best active date: ${brand.bestActiveDate}`,
          briefText,
          contactText,
        ]
          .filter(Boolean)
          .join(" | ");
        const normalizedText = normalizeKey(text);
        const score = queryTerms.reduce(
          (total, term) => total + (normalizedText.includes(term) ? 1 : 0),
          0,
        );

        return {
          source: "sheets" as const,
          title: brand.name,
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
  queryKey: ["team-billion-active-brands", "active-contacts-v2"],
  queryFn: () => fetchActiveBrandsData(),
  refetchInterval: QUERY_REFETCH_INTERVAL_MS,
  staleTime: QUERY_STALE_TIME_MS,
};
