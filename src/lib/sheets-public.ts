import { createServerFn } from "@tanstack/react-start";
import {
  FALLBACK_MEMBER_SHEETS,
  IGNORED_OUTREACH_TAB_NAMES,
  SIGNED_CREATORS_TAB_NAME,
} from "@/data/sheetConfig";
import { team as fallbackTeam, type Teammate } from "@/data/team";
import { deals as fallbackDeals, type Deal } from "@/data/deals";
import { creators as fallbackCreators, type Creator } from "@/data/creators";
import {
  canonicalMemberName,
  cleanSheetName,
  normalizeCreatorRows,
  normalizeMemberDealRows,
  normalizeMemberOutreachRows,
  type OutreachRow,
} from "@/lib/sheet-normalizer";

type GoogleSheetsServer = typeof import("@/lib/google-sheets.server");
type GoogleSheetsConfig = ReturnType<GoogleSheetsServer["getGoogleSheetsConfig"]>;

type SheetRef = {
  memberName: string;
  sheetName: string;
  gid?: string;
};

type ReadableMemberSheet = {
  memberName: string;
  headers: string[];
  rows: string[][];
};

export type TabMatchDiagnostic = {
  spreadsheet: "deals" | "creator-sourcing";
  availableTabs: string[];
  expectedMembers: string[];
  matchedMembers: Array<{
    memberName: string;
    sheetName: string;
  }>;
  missingExpectedMembers: string[];
  skippedTabs: Array<{
    sheetName: string;
    reason: string;
  }>;
  warnings: string[];
};

export type SignedCreatorsTabDiagnostic = {
  availableTabs: string[];
  expectedName: string;
  found: boolean;
  sheetName: string | null;
  warning: string | null;
};

type SheetDiscoveryResult = {
  refs: SheetRef[];
  diagnostics: TabMatchDiagnostic;
};

type SignedCreatorsDiscoveryResult = {
  ref: SheetRef | null;
  diagnostics: SignedCreatorsTabDiagnostic;
};

type DashboardReadDebug = {
  dealTabs?: TabMatchDiagnostic;
  outreachTabs?: TabMatchDiagnostic;
  signedCreatorsTab?: SignedCreatorsTabDiagnostic;
  warnings: string[];
};

type DashboardCacheStatus = "hit" | "miss" | "stale" | "refreshing";

type DashboardReadResult = {
  data: DashboardSheetData;
  debug: DashboardReadDebug;
  cacheStatus: DashboardCacheStatus;
  cacheExpiresAt: string | null;
};

type DashboardCacheEntry = {
  data: DashboardSheetData;
  debug: DashboardReadDebug;
  cachedAt: number;
  expiresAt: number;
};

type SpreadsheetLinks = {
  dealsSheetUrl?: string;
  creatorSourcingSheetUrl?: string;
};

export type DashboardSheetData = {
  deals: Deal[];
  team: Teammate[];
  creators: Creator[];
  outreach: OutreachDashboardData;
  totals: {
    totalPaid: number;
    paidThisMonth: number;
    pendingOwed: number;
    dealsClosed: number;
    totalPricing: number;
    averageDealSize: number;
    averageProfitMargin: number;
    paidGoal: number;
    dealsGoal: number;
  };
  source: "google-sheet" | "fallback" | "error";
  error?: string;
  warning?: string;
  links: SpreadsheetLinks;
  updatedAt: string;
};

export type OutreachMemberStats = {
  memberName: string;
  initials: string;
  totalCreators: number;
  contacted: number;
  emailed: number;
  igOutreach: number;
  replies: number;
  bookedCalls: number;
  signed: number;
  ended: number;
  replyRate: number;
  conversionRate: number;
  topNiche: string;
};

export type OutreachDashboardData = {
  members: OutreachMemberStats[];
  totals: Omit<OutreachMemberStats, "memberName" | "initials" | "topNiche"> & {
    topNiche: string;
  };
  source: "google-sheet" | "fallback";
};

export type DashboardDataFlowDiagnostics = {
  checkedAt: string;
  runtime: {
    nodeEnv: string;
    vercel: boolean;
    productionRuntime: boolean;
  };
  source: DashboardSheetData["source"];
  fallbackActive: boolean;
  fallbackReason: string | null;
  counts: {
    teamMembers: number;
    deals: number;
    creators: number;
    outreachMembers: number;
    outreachCreators: number;
  };
  tabs: {
    deals: TabMatchDiagnostic | null;
    outreach: TabMatchDiagnostic | null;
    signedCreators: SignedCreatorsTabDiagnostic | null;
    warnings: string[];
  };
  cache: {
    queryStaleTimeMs: number;
    queryRefetchIntervalMs: number;
    serverCacheTtlMs: number;
    serverCacheStatus: DashboardCacheStatus;
    serverCacheExpiresAt: string | null;
    googleFetchCache: "no-store";
    staticRenderingLikely: boolean;
    note: string;
  };
};

const SUMMARY_LABELS = {
  pendingOwed: ["pending in gbp", "pending"],
  paidThisMonth: ["paid current month in gbp", "paid current month"],
  totalPaid: ["total paid in gbp", "total paid"],
};

const DEFAULT_REVENUE_GOAL = 300000;
const DEFAULT_DEALS_GOAL = 20;
const SERVER_DATA_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_STALE_TIME_MS = SERVER_DATA_CACHE_TTL_MS;
const QUERY_REFETCH_INTERVAL_MS = SERVER_DATA_CACHE_TTL_MS;
let dashboardCache: DashboardCacheEntry | null = null;
let dashboardRefreshPromise: Promise<DashboardCacheEntry> | null = null;
const BLOCKED_TAB_NAME_WORDS = [
  "archive",
  "asset",
  "creator",
  "dashboard",
  "database",
  "deal",
  "google",
  "gstatic",
  "outreach",
  "setting",
  "sheet",
  "summary",
  "template",
];

function parseMoney(value: string) {
  const number = Number(value.replace(/[$£,%A-Z\s,]/gi, ""));
  return Number.isFinite(number) ? number : 0;
}

function logDashboardDataFlow(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:data-flow]", message, details ?? {});
}

function isRateLimitError(error: unknown) {
  return error instanceof Error && /Google Sheets API failed \(429\)|Quota exceeded/i.test(error.message);
}

function cacheExpiresAtLabel(entry: DashboardCacheEntry | null) {
  return entry ? new Date(entry.expiresAt).toISOString() : null;
}

function cloneDebug(debug: DashboardReadDebug): DashboardReadDebug {
  return {
    dealTabs: debug.dealTabs,
    outreachTabs: debug.outreachTabs,
    signedCreatorsTab: debug.signedCreatorsTab,
    warnings: [...debug.warnings],
  };
}

function withDashboardWarning(data: DashboardSheetData, warning: string): DashboardSheetData {
  return {
    ...data,
    warning: data.warning ? `${data.warning} ${warning}` : warning,
  };
}

function parsePercent(value: string) {
  const number = Number(value.replace(/[%\s,]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cleanMemberName(value: string) {
  return cleanSheetName(value);
}

function isLikelyMemberName(value: string) {
  const name = cleanMemberName(value);
  const lowerName = name.toLowerCase();

  if (!name || name.length > 32) return false;
  if (!/^[\p{L}][\p{L}\p{N} '\-_]*$/u.test(name)) return false;
  if (BLOCKED_TAB_NAME_WORDS.some((word) => lowerName.includes(word))) return false;

  return true;
}

function normalizeSheetLabel(value: string) {
  return cleanSheetName(value).toLowerCase();
}

function isIgnoredOutreachSheet(value: string) {
  const normalized = normalizeSheetLabel(value);

  return IGNORED_OUTREACH_TAB_NAMES.some((tabName) =>
    normalized.includes(normalizeSheetLabel(tabName)),
  );
}

function isSignedCreatorsSheet(value: string) {
  return normalizeSheetLabel(value).includes("signed creators");
}

function isOutreachWorksheetName(value: string) {
  return isLikelyMemberName(value) && !isIgnoredOutreachSheet(value);
}

function expectedMemberNames() {
  return Array.from(new Set(FALLBACK_MEMBER_SHEETS.map((sheet) => canonicalMemberName(sheet.name))));
}

function memberMatchKey(value: string) {
  return canonicalMemberName(value).toLowerCase();
}

function createSheetDiscoveryResult({
  spreadsheet,
  discovered,
  includeSheet,
}: {
  spreadsheet: TabMatchDiagnostic["spreadsheet"];
  discovered: SheetRef[];
  includeSheet: (sheet: SheetRef, memberName: string) => string | null;
}): SheetDiscoveryResult {
  const expectedMembers = expectedMemberNames();
  const availableTabs = discovered.map((sheet) => sheet.sheetName);
  const skippedTabs: TabMatchDiagnostic["skippedTabs"] = [];
  const warnings: string[] = [];
  const byMember = new Map<string, SheetRef>();

  for (const sheet of discovered) {
    const rawSheetName = sheet.sheetName || sheet.memberName;
    const memberName = canonicalMemberName(rawSheetName);
    const skipReason = includeSheet(sheet, memberName);

    if (skipReason) {
      skippedTabs.push({ sheetName: rawSheetName, reason: skipReason });
      continue;
    }

    const key = memberMatchKey(memberName);
    if (byMember.has(key)) {
      skippedTabs.push({
        sheetName: rawSheetName,
        reason: `Duplicate member tab for ${memberName}; using ${byMember.get(key)?.sheetName}.`,
      });
      continue;
    }

    byMember.set(key, {
      ...sheet,
      memberName,
      sheetName: rawSheetName,
    });
  }

  const orderedRefs: SheetRef[] = [];
  const matchedMembers: TabMatchDiagnostic["matchedMembers"] = [];
  const missingExpectedMembers: string[] = [];

  for (const memberName of expectedMembers) {
    const ref = byMember.get(memberMatchKey(memberName));
    if (!ref) {
      missingExpectedMembers.push(memberName);
      continue;
    }

    matchedMembers.push({ memberName, sheetName: ref.sheetName });
    orderedRefs.push(ref);
  }

  for (const ref of byMember.values()) {
    if (expectedMembers.some((memberName) => memberMatchKey(memberName) === memberMatchKey(ref.memberName))) {
      continue;
    }
    orderedRefs.push(ref);
    matchedMembers.push({ memberName: ref.memberName, sheetName: ref.sheetName });
  }

  if (missingExpectedMembers.length > 0) {
    warnings.push(
      `Missing expected member tabs: ${missingExpectedMembers.join(", ")}. Those members were skipped.`,
    );
  }

  logDashboardDataFlow(`${spreadsheet} tab metadata matched`, {
    availableTabs,
    matchedMembers,
    missingExpectedMembers,
    skippedTabs,
  });

  return {
    refs: orderedRefs,
    diagnostics: {
      spreadsheet,
      availableTabs,
      expectedMembers,
      matchedMembers,
      missingExpectedMembers,
      skippedTabs,
      warnings,
    },
  };
}

function getInitials(name: string) {
  const parts = cleanMemberName(name).split(" ").filter(Boolean);

  if (parts.length > 1) {
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  return cleanMemberName(name).slice(0, 2).toUpperCase();
}

function makeMemberId(name: string, index: number) {
  return (
    cleanMemberName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `member-${index + 1}`
  );
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasHeader(headers: string[], candidates: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);
  return candidates.some((candidate) => normalizedHeaders.includes(normalizeHeader(candidate)));
}

function isDealWorksheet(headers: string[]) {
  return (
    hasHeader(headers, ["creator"]) &&
    hasHeader(headers, ["brand name", "brand"]) &&
    hasHeader(headers, ["status"]) &&
    hasHeader(headers, ["total pricing", "total pricing (£)"]) &&
    hasHeader(headers, ["manager total"])
  );
}

function getSheetSignature(headers: string[], rows: string[][]) {
  return JSON.stringify([
    headers.map(normalizeHeader),
    rows.slice(0, 30).map((row) => row.slice(0, 16)),
  ]);
}

function dedupeSheetsByContent<TSheet extends { headers: string[]; rows: string[][] }>(
  sheets: TSheet[],
) {
  const seen = new Set<string>();

  return sheets.filter((sheet) => {
    const signature = getSheetSignature(sheet.headers, sheet.rows);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function getKnownFallback(name: string, index: number): Teammate {
  const cleanedName = cleanMemberName(name);
  const byName = fallbackTeam.find(
    (member) => cleanMemberName(member.name).toLowerCase() === cleanedName.toLowerCase(),
  );

  if (byName) return byName;

  return {
    id: makeMemberId(cleanedName, index),
    name: cleanedName,
    initials: getInitials(cleanedName),
    role: "Closer",
    commission: 0,
    monthCommission: 0,
    pendingOwed: 0,
    dealsClosed: 0,
    revenue: 0,
    revenueGoal: DEFAULT_REVENUE_GOAL,
    dealsGoal: DEFAULT_DEALS_GOAL,
    exclusiveCreators: 0,
    nonExclusiveCreators: 0,
  };
}

async function getGoogleSheetsServer() {
  return import("@/lib/google-sheets.server");
}

async function discoverAllSheetRefs(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
): Promise<SheetRef[]> {
  const { fetchSpreadsheetTabs } = await getGoogleSheetsServer();
  const tabs = await fetchSpreadsheetTabs(config, spreadsheetId);

  return tabs.map((tab) => ({
    ...tab,
    memberName: cleanMemberName(tab.memberName),
  }));
}

async function discoverDealSheetRefs(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
): Promise<SheetDiscoveryResult> {
  const discovered = await discoverAllSheetRefs(config, spreadsheetId);

  return createSheetDiscoveryResult({
    spreadsheet: "deals",
    discovered,
    includeSheet: (sheet, memberName) => {
      if (!isLikelyMemberName(memberName)) {
        return "Tab name does not look like a member name.";
      }
      if (isIgnoredOutreachSheet(sheet.sheetName)) {
        return "Tab is reserved for creator sourcing, not deals.";
      }
      return null;
    },
  });
}

function getSummaryValue(rows: string[][], labels: string[]) {
  const row = rows.find((item) => {
    const label = item[17]?.toLowerCase().trim() ?? "";
    return labels.some((candidate) => label.includes(candidate));
  });
  return parseMoney(row?.[18] ?? "");
}

async function fetchSheetRowsBatchFromApi(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  sheets: SheetRef[],
) {
  const { fetchSheetRowsBatch } = await getGoogleSheetsServer();
  return fetchSheetRowsBatch(config, spreadsheetId, sheets);
}

async function fetchMemberSheetsRowsBatchSafely(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  sheets: SheetRef[],
  debug?: DashboardReadDebug,
): Promise<ReadableMemberSheet[]> {
  if (sheets.length === 0) return [];

  try {
    const rows = await fetchSheetRowsBatchFromApi(config, spreadsheetId, sheets);

    return sheets.map((sheet, index) => ({
      memberName: sheet.memberName,
      headers: rows[index]?.headers ?? [],
      rows: rows[index]?.rows ?? [],
    }));
  } catch (error) {
    if (isRateLimitError(error)) throw error;

    const message = error instanceof Error ? error.message : String(error);
    const warning = `Skipped ${sheets.length} tabs after batch read failed: ${message}`;

    debug?.warnings.push(warning);
    logDashboardDataFlow("batch member tab read failed", {
      spreadsheetIdPresent: Boolean(spreadsheetId),
      sheetCount: sheets.length,
      sheets: sheets.map((sheet) => sheet.sheetName),
      reason: message,
    });

    return [];
  }
}

function buildMemberSummary(tabName: string, rows: string[][], deals: Deal[], fallback: Teammate) {
  const totalPaid = getSummaryValue(rows, SUMMARY_LABELS.totalPaid);
  const paidThisMonth = getSummaryValue(rows, SUMMARY_LABELS.paidThisMonth);
  const pendingOwed = getSummaryValue(rows, SUMMARY_LABELS.pendingOwed);
  const memberDeals = deals.filter((deal) => deal.manager === tabName);
  const totalPricing = memberDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);

  return {
    ...fallback,
    name: tabName,
    initials: getInitials(tabName),
    commission: totalPaid,
    monthCommission: paidThisMonth,
    pendingOwed,
    dealsClosed: memberDeals.length,
    revenue: totalPricing,
  };
}

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values.map(cleanSheetName).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
}

function getCreatorCountsByMember(creators: Creator[]) {
  const counts = new Map<string, { exclusiveCreators: number; nonExclusiveCreators: number }>();

  for (const creator of creators) {
    const memberName = canonicalMemberName(creator.owner);
    const current = counts.get(memberName) ?? {
      exclusiveCreators: 0,
      nonExclusiveCreators: 0,
    };

    if (creator.relationship === "Exclusive") {
      current.exclusiveCreators += 1;
    } else {
      current.nonExclusiveCreators += 1;
    }

    counts.set(memberName, current);
  }

  return counts;
}

function enrichTeamWithCreatorCounts(team: Teammate[], creators: Creator[]) {
  const counts = getCreatorCountsByMember(creators);

  return team.map((member) => {
    const memberCounts = counts.get(canonicalMemberName(member.name));
    if (!memberCounts) return member;

    return {
      ...member,
      exclusiveCreators: memberCounts.exclusiveCreators,
      nonExclusiveCreators: memberCounts.nonExclusiveCreators,
    };
  });
}

function emptyOutreachTotals(): OutreachDashboardData["totals"] {
  return {
    totalCreators: 0,
    contacted: 0,
    emailed: 0,
    igOutreach: 0,
    replies: 0,
    bookedCalls: 0,
    signed: 0,
    ended: 0,
    replyRate: 0,
    conversionRate: 0,
    topNiche: "-",
  };
}

function fallbackOutreachData(team: Teammate[] = fallbackTeam): OutreachDashboardData {
  return {
    members: team.map((member) => ({
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
    })),
    totals: emptyOutreachTotals(),
    source: "fallback",
  };
}

function buildOutreachDashboardData(
  outreachRows: OutreachRow[],
  creators: Creator[],
  team: Teammate[],
): OutreachDashboardData {
  const signedByMember = new Map<string, number>();

  for (const creator of creators) {
    const memberName = canonicalMemberName(creator.owner);
    signedByMember.set(memberName, (signedByMember.get(memberName) ?? 0) + 1);
  }

  const members = team.map((member) => {
    const memberName = canonicalMemberName(member.name);
    const rows = outreachRows.filter((row) => canonicalMemberName(row.memberName) === memberName);
    const contacted = rows.filter((row) => row.emailed || row.igOutreach).length;
    const emailed = rows.filter((row) => row.emailed).length;
    const igOutreach = rows.filter((row) => row.igOutreach).length;
    const replies = rows.filter((row) => row.replied).length;
    const bookedCalls = rows.filter((row) => row.bookedCall).length;
    const signedFromStatus = rows.filter((row) => row.signedFromStatus).length;
    const signed = Math.max(signedFromStatus, signedByMember.get(memberName) ?? 0);
    const ended = rows.filter((row) => row.ended).length;

    return {
      memberName: member.name,
      initials: member.initials,
      totalCreators: rows.length,
      contacted,
      emailed,
      igOutreach,
      replies,
      bookedCalls,
      signed,
      ended,
      replyRate: percentage(replies, contacted),
      conversionRate: percentage(signed, contacted),
      topNiche: mostCommon(rows.map((row) => row.niche)),
    };
  });

  const totalsBase = members.reduce(
    (acc, member) => ({
      totalCreators: acc.totalCreators + member.totalCreators,
      contacted: acc.contacted + member.contacted,
      emailed: acc.emailed + member.emailed,
      igOutreach: acc.igOutreach + member.igOutreach,
      replies: acc.replies + member.replies,
      bookedCalls: acc.bookedCalls + member.bookedCalls,
      signed: acc.signed + member.signed,
      ended: acc.ended + member.ended,
      replyRate: 0,
      conversionRate: 0,
      topNiche: "-",
    }),
    emptyOutreachTotals(),
  );

  return {
    members,
    totals: {
      ...totalsBase,
      replyRate: percentage(totalsBase.replies, totalsBase.contacted),
      conversionRate: percentage(totalsBase.signed, totalsBase.contacted),
      topNiche: mostCommon(outreachRows.map((row) => row.niche)),
    },
    source: "google-sheet",
  };
}

async function readCreatorSourcingData(
  config: GoogleSheetsConfig,
  creatorSourcingSpreadsheetId: string,
  team: Teammate[],
  debug?: DashboardReadDebug,
) {
  logDashboardDataFlow("loading creator sourcing data", {
    teamMembers: team.length,
  });

  const discoveredCreatorTabs = await discoverAllSheetRefs(config, creatorSourcingSpreadsheetId);
  const outreachDiscovery = createSheetDiscoveryResult({
    spreadsheet: "creator-sourcing",
    discovered: discoveredCreatorTabs,
    includeSheet: (sheet, memberName) => {
      if (isIgnoredOutreachSheet(sheet.sheetName ?? "")) {
        return "Ignored creator sourcing system tab.";
      }
      if (!isOutreachWorksheetName(memberName)) {
        return "Tab name does not look like a member outreach tab.";
      }
      return null;
    },
  });
  const signedCreatorsFound = discoveredCreatorTabs.find((sheet) =>
    isSignedCreatorsSheet(sheet.sheetName ?? sheet.memberName),
  );
  const signedCreatorsDiscovery: SignedCreatorsDiscoveryResult = {
    ref: signedCreatorsFound
      ? {
          ...signedCreatorsFound,
          memberName: cleanMemberName(SIGNED_CREATORS_TAB_NAME),
        }
      : null,
    diagnostics: {
      availableTabs: discoveredCreatorTabs.map((sheet) => sheet.sheetName),
      expectedName: cleanMemberName(SIGNED_CREATORS_TAB_NAME),
      found: Boolean(signedCreatorsFound),
      sheetName: signedCreatorsFound?.sheetName ?? null,
      warning: signedCreatorsFound
        ? null
        : "Signed creators tab was not found, so creator roster rows were skipped.",
    },
  };
  const outreachRefs = outreachDiscovery.refs;
  const signedCreatorsRef = signedCreatorsDiscovery.ref;

  if (debug) {
    debug.outreachTabs = outreachDiscovery.diagnostics;
    debug.signedCreatorsTab = signedCreatorsDiscovery.diagnostics;
    debug.warnings.push(...outreachDiscovery.diagnostics.warnings);
    if (signedCreatorsDiscovery.diagnostics.warning) {
      debug.warnings.push(signedCreatorsDiscovery.diagnostics.warning);
    }
  }

  logDashboardDataFlow("creator sourcing sheet refs discovered", {
    outreachRefCount: outreachRefs.length,
    outreachRefs: outreachRefs.map((sheet) => sheet.sheetName),
    signedCreatorsSheet: signedCreatorsRef?.sheetName ?? null,
  });

  const creatorSheetRefs = signedCreatorsRef ? [...outreachRefs, signedCreatorsRef] : outreachRefs;
  const creatorSheetRows = await fetchSheetRowsBatchFromApi(
    config,
    creatorSourcingSpreadsheetId,
    creatorSheetRefs,
  ).catch((error) => {
    if (isRateLimitError(error)) throw error;

    const message = error instanceof Error ? error.message : String(error);
    const warning = `Skipped creator sourcing rows after batch read failed: ${message}`;
    debug?.warnings.push(warning);
    logDashboardDataFlow("creator sourcing batch read failed", {
      sheetCount: creatorSheetRefs.length,
      sheets: creatorSheetRefs.map((sheet) => sheet.sheetName),
      reason: message,
    });
    return [];
  });
  const readableOutreachSheets = outreachRefs.map((sheet, index) => ({
    memberName: sheet.memberName,
    headers: creatorSheetRows[index]?.headers ?? [],
    rows: creatorSheetRows[index]?.rows ?? [],
  }));
  const signedCreatorsRows =
    signedCreatorsRef && creatorSheetRows[outreachRefs.length]
      ? creatorSheetRows[outreachRefs.length]
      : { headers: [], rows: [] };

  const outreachRows = readableOutreachSheets.flatMap(({ memberName, headers, rows }) =>
    normalizeMemberOutreachRows(memberName, [headers, ...rows]),
  );
  const creators = normalizeCreatorRows([signedCreatorsRows.headers, ...signedCreatorsRows.rows]);

  logDashboardDataFlow("creator sourcing rows normalized", {
    outreachSheets: readableOutreachSheets.map((sheet) => ({
      memberName: sheet.memberName,
      headerCount: sheet.headers.length,
      rowCount: sheet.rows.length,
    })),
    signedCreatorsHeaderCount: signedCreatorsRows.headers.length,
    signedCreatorsRowCount: signedCreatorsRows.rows.length,
    normalizedOutreachRows: outreachRows.length,
    normalizedCreators: creators.length,
  });

  return {
    creators,
    outreach: buildOutreachDashboardData(outreachRows, creators, team),
  };
}

function calculateTotals(team: Teammate[], deals: Deal[]) {
  const totalPaid = team.reduce((sum, member) => sum + member.commission, 0);
  const paidThisMonth = team.reduce((sum, member) => sum + member.monthCommission, 0);
  const pendingOwed = team.reduce((sum, member) => sum + member.pendingOwed, 0);
  const dealsClosed = deals.length;
  const totalPricing = deals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);
  const pricedDeals = deals.filter((deal) => deal.totalPricingGbp > 0);
  const marginValues = deals
    .map((deal) => parsePercent(deal.profitMargin))
    .filter((margin) => margin > 0);

  return {
    totalPaid,
    paidThisMonth,
    pendingOwed,
    dealsClosed,
    totalPricing,
    averageDealSize: Math.round(totalPricing / Math.max(1, pricedDeals.length)),
    averageProfitMargin: Math.round(average(marginValues) * 10) / 10,
    paidGoal: team.reduce((sum, member) => sum + member.revenueGoal, 0),
    dealsGoal: team.reduce((sum, member) => sum + member.dealsGoal, 0),
  };
}

function emptyDashboardData(error: string, links: SpreadsheetLinks): DashboardSheetData {
  return {
    deals: [],
    team: [],
    creators: [],
    outreach: {
      members: [],
      totals: emptyOutreachTotals(),
      source: "fallback",
    },
    totals: {
      totalPaid: 0,
      paidThisMonth: 0,
      pendingOwed: 0,
      dealsClosed: 0,
      totalPricing: 0,
      averageDealSize: 0,
      averageProfitMargin: 0,
      paidGoal: 0,
      dealsGoal: 0,
    },
    source: "error",
    error,
    links,
    updatedAt: new Date().toISOString(),
  };
}

function fallbackDashboardData(error: string, links: SpreadsheetLinks): DashboardSheetData {
  const activeFallbackDeals = fallbackDeals.filter((deal) => deal.status !== "Cancelled");

  return {
    deals: activeFallbackDeals,
    team: fallbackTeam,
    creators: fallbackCreators,
    outreach: fallbackOutreachData(fallbackTeam),
    totals: calculateTotals(fallbackTeam, activeFallbackDeals),
    source: "fallback",
    error,
    links,
    updatedAt: new Date().toISOString(),
  };
}

function getGoogleSheetsErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `${message}. Check Vercel env vars, Google Sheets API access, and whether both Sheets are shared with the service account email.`;
}

async function readDashboardSheetData(
  config: GoogleSheetsConfig,
  debug?: DashboardReadDebug,
): Promise<DashboardSheetData> {
  const { makeSheetUrl } = await getGoogleSheetsServer();
  logDashboardDataFlow("loading dashboard data from google sheets", {
    productionRuntime: (await getGoogleSheetsServer()).isProductionRuntime(),
  });
  const links = {
    dealsSheetUrl: makeSheetUrl(config.teamSpreadsheetId),
    creatorSourcingSheetUrl: makeSheetUrl(config.creatorSourcingSpreadsheetId),
  };
  const dealDiscovery = await discoverDealSheetRefs(config, config.teamSpreadsheetId);
  const sheetRefs = dealDiscovery.refs;
  if (debug) {
    debug.dealTabs = dealDiscovery.diagnostics;
    debug.warnings.push(...dealDiscovery.diagnostics.warnings);
  }
  logDashboardDataFlow("deal sheet refs discovered", {
    sheetRefCount: sheetRefs.length,
    sheetRefs: sheetRefs.map((sheet) => sheet.sheetName),
  });
  const readableSheets = await fetchMemberSheetsRowsBatchSafely(
    config,
    config.teamSpreadsheetId,
    sheetRefs,
    debug,
  );
  logDashboardDataFlow("deal sheet rows returned", {
    sheets: readableSheets.map((sheet) => ({
      memberName: sheet.memberName,
      headerCount: sheet.headers.length,
      rowCount: sheet.rows.length,
      expectedDealHeaders: isDealWorksheet(sheet.headers),
    })),
  });
  const sheets = dedupeSheetsByContent(
    readableSheets.filter((sheet) => isDealWorksheet(sheet.headers)),
  );

  logDashboardDataFlow("deal sheets after expected-header filter", {
    validDealSheetCount: sheets.length,
    validDealSheets: sheets.map((sheet) => ({
      memberName: sheet.memberName,
      rowCount: sheet.rows.length,
    })),
  });

  if (!sheets.some((sheet) => sheet.headers.length > 0)) {
    throw new Error("No Google Sheet tabs with the expected deal headers could be read");
  }

  const deals = sheets.flatMap(({ memberName, headers, rows }) =>
    normalizeMemberDealRows(memberName, [headers, ...rows]),
  );
  const baseTeam = sheets.map(({ memberName, rows }, index) =>
    buildMemberSummary(memberName, rows, deals, getKnownFallback(memberName, index)),
  );
  const creatorData = await readCreatorSourcingData(
    config,
    config.creatorSourcingSpreadsheetId,
    baseTeam,
    debug,
  );
  const team = enrichTeamWithCreatorCounts(baseTeam, creatorData.creators);
  const totals = calculateTotals(team, deals);

  logDashboardDataFlow("dashboard data loaded from google sheets", {
    teamMembers: team.length,
    deals: deals.length,
    creators: creatorData.creators.length,
    outreachMembers: creatorData.outreach.members.length,
    outreachCreators: creatorData.outreach.totals.totalCreators,
    totalPaid: totals.totalPaid,
    pendingOwed: totals.pendingOwed,
  });

  return {
    deals,
    team,
    creators: creatorData.creators,
    outreach: creatorData.outreach,
    totals,
    source: "google-sheet",
    links,
    updatedAt: new Date().toISOString(),
  };
}

async function refreshDashboardCache(config: GoogleSheetsConfig): Promise<DashboardCacheEntry> {
  const debug: DashboardReadDebug = { warnings: [] };
  const data = await readDashboardSheetData(config, debug);
  const entry = {
    data,
    debug,
    cachedAt: Date.now(),
    expiresAt: Date.now() + SERVER_DATA_CACHE_TTL_MS,
  };

  dashboardCache = entry;
  logDashboardDataFlow("dashboard server cache refreshed", {
    expiresAt: new Date(entry.expiresAt).toISOString(),
    deals: data.deals.length,
    creators: data.creators.length,
  });

  return entry;
}

async function getDashboardDataWithServerCache(
  config: GoogleSheetsConfig,
  options: { allowStaleCache?: boolean } = {},
): Promise<DashboardReadResult> {
  const currentCache = dashboardCache;

  if (currentCache && currentCache.expiresAt > Date.now()) {
    logDashboardDataFlow("dashboard server cache hit", {
      expiresAt: cacheExpiresAtLabel(currentCache),
    });

    return {
      data: currentCache.data,
      debug: cloneDebug(currentCache.debug),
      cacheStatus: "hit",
      cacheExpiresAt: cacheExpiresAtLabel(currentCache),
    };
  }

  if (options.allowStaleCache && currentCache) {
    logDashboardDataFlow("dashboard stale cache reused for diagnostics", {
      expiredAt: cacheExpiresAtLabel(currentCache),
    });

    return {
      data: withDashboardWarning(
        currentCache.data,
        "Showing cached Google Sheets data to avoid extra diagnostic reads.",
      ),
      debug: cloneDebug(currentCache.debug),
      cacheStatus: "stale",
      cacheExpiresAt: cacheExpiresAtLabel(currentCache),
    };
  }

  try {
    if (!dashboardRefreshPromise) {
      logDashboardDataFlow("dashboard server cache miss; refreshing");
      dashboardRefreshPromise = refreshDashboardCache(config).finally(() => {
        dashboardRefreshPromise = null;
      });
    } else {
      logDashboardDataFlow("dashboard server cache refresh already in flight");
    }

    const entry = await dashboardRefreshPromise;

    return {
      data: entry.data,
      debug: cloneDebug(entry.debug),
      cacheStatus: "miss",
      cacheExpiresAt: cacheExpiresAtLabel(entry),
    };
  } catch (error) {
    if (isRateLimitError(error) && dashboardCache) {
      const warning =
        "Google Sheets rate limit was hit, so this dashboard is showing the last cached data.";

      logDashboardDataFlow("google sheets rate limited; serving cached dashboard data", {
        expiredAt: cacheExpiresAtLabel(dashboardCache),
        reason: error instanceof Error ? error.message : String(error),
      });

      return {
        data: withDashboardWarning(dashboardCache.data, warning),
        debug: cloneDebug(dashboardCache.debug),
        cacheStatus: "stale",
        cacheExpiresAt: cacheExpiresAtLabel(dashboardCache),
      };
    }

    throw error;
  }
}

export async function getDashboardDataFlowDiagnostics(): Promise<DashboardDataFlowDiagnostics> {
  const googleSheets = await getGoogleSheetsServer();
  const productionRuntime = googleSheets.isProductionRuntime();
  const makeCacheDiagnostics = (
    cacheStatus: DashboardCacheStatus,
    cacheExpiresAt: string | null,
  ) => ({
    queryStaleTimeMs: QUERY_STALE_TIME_MS,
    queryRefetchIntervalMs: QUERY_REFETCH_INTERVAL_MS,
    serverCacheTtlMs: SERVER_DATA_CACHE_TTL_MS,
    serverCacheStatus: cacheStatus,
    serverCacheExpiresAt: cacheExpiresAt,
    googleFetchCache: "no-store" as const,
    staticRenderingLikely: false,
    note:
      "Dashboard data is loaded by a TanStack server function after login. The parsed Google Sheets result is cached server-side for 5 minutes, Google API fetches use no-store, and the client query also stays fresh for 5 minutes.",
  });

  try {
    const result = await getDashboardDataWithServerCache(googleSheets.getGoogleSheetsConfig(), {
      allowStaleCache: true,
    });
    const data = result.data;
    const debug = result.debug;

    return {
      checkedAt: new Date().toISOString(),
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? "missing",
        vercel: process.env.VERCEL === "1",
        productionRuntime,
      },
      source: data.source,
      fallbackActive: data.source === "fallback",
      fallbackReason: data.source === "fallback" ? data.error ?? "Unknown fallback reason" : null,
      counts: {
        teamMembers: data.team.length,
        deals: data.deals.length,
        creators: data.creators.length,
        outreachMembers: data.outreach.members.length,
        outreachCreators: data.outreach.totals.totalCreators,
      },
      tabs: {
        deals: debug.dealTabs ?? null,
        outreach: debug.outreachTabs ?? null,
        signedCreators: debug.signedCreatorsTab ?? null,
        warnings: debug.warnings,
      },
      cache: makeCacheDiagnostics(result.cacheStatus, result.cacheExpiresAt),
    };
  } catch (error) {
    const message = getGoogleSheetsErrorMessage(error);
    const debug: DashboardReadDebug = { warnings: [] };

    return {
      checkedAt: new Date().toISOString(),
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? "missing",
        vercel: process.env.VERCEL === "1",
        productionRuntime,
      },
      source: productionRuntime ? "error" : "fallback",
      fallbackActive: !productionRuntime,
      fallbackReason: productionRuntime ? message : `Local development fallback: ${message}`,
      counts: {
        teamMembers: 0,
        deals: 0,
        creators: 0,
        outreachMembers: 0,
        outreachCreators: 0,
      },
      tabs: {
        deals: debug.dealTabs ?? null,
        outreach: debug.outreachTabs ?? null,
        signedCreators: debug.signedCreatorsTab ?? null,
        warnings: debug.warnings,
      },
      cache: makeCacheDiagnostics(dashboardCache ? "stale" : "miss", cacheExpiresAtLabel(dashboardCache)),
    };
  }
}

export const fetchDashboardSheetData = createServerFn({ method: "GET" }).handler(
  async () => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    logDashboardDataFlow("dashboard server function called");
    await requireDashboardAuth();
    const googleSheets = await getGoogleSheetsServer();
    const links = googleSheets.getOptionalSheetLinks();
    const productionRuntime = googleSheets.isProductionRuntime();

    logDashboardDataFlow("dashboard auth passed", {
      productionRuntime,
    });

    try {
      const result = await getDashboardDataWithServerCache(googleSheets.getGoogleSheetsConfig());
      return result.data;
    } catch (error) {
      const message = getGoogleSheetsErrorMessage(error);
      console.error("Google Sheets dashboard access failed:", error);
      logDashboardDataFlow("dashboard google sheets load failed", {
        productionRuntime,
        fallbackActive: !productionRuntime,
        reason: message,
      });

      if (!productionRuntime) {
        logDashboardDataFlow("using local fallback data", {
          reason: message,
        });
        return fallbackDashboardData(message, links);
      }

      logDashboardDataFlow("production fallback disabled; returning visible error", {
        reason: message,
      });
      return emptyDashboardData(message, links);
    }
  },
);

export const dashboardSheetQuery = {
  queryKey: ["team-billion-dashboard-sheet", "creator-sourcing-v3"],
  queryFn: () => fetchDashboardSheetData(),
  refetchInterval: QUERY_REFETCH_INTERVAL_MS,
  staleTime: QUERY_STALE_TIME_MS,
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
};
