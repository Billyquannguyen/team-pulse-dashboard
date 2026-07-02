import { createServerFn } from "@tanstack/react-start";
import { IGNORED_OUTREACH_TAB_NAMES, SIGNED_CREATORS_TAB_NAME } from "@/data/sheetConfig";
import { team as fallbackTeam, type Teammate } from "@/data/team";
import {
  deals as fallbackDeals,
  getDealRowExclusionReason,
  isActiveDashboardDeal,
  isClosedCommissionDeal,
  isPaidCommissionDeal,
  isPostedCommissionDeal,
  type Deal,
  type DealExclusionReason,
} from "@/data/deals";
import { creators as fallbackCreators, type Creator } from "@/data/creators";
import {
  canonicalMemberName,
  cleanSheetName,
  getMissingCreatorHeaders,
  getMissingDealHeaders,
  getMissingOutreachHeaders,
  getCurrentDealMonthKey,
  isDealWorksheetHeader,
  isOutreachWorksheetHeader,
  normalizeDealMonthKey,
  normalizeCreatorRows,
  normalizeMemberDealRows,
  normalizeMemberOutreachRows,
  type OutreachRow,
} from "@/lib/sheet-normalizer";
import { normalizeSheetHeader } from "@/lib/sheet-headers";
import {
  getSystemMemberTabSkipReason,
  getTeamMembersDataForServer,
  isSystemMemberTabName,
  teamMemberConfigToTeammate,
  type TeamMemberConfig,
} from "@/lib/team-members";

type GoogleSheetsConfig = {
  serviceAccountEmail: string;
  privateKey: string;
  teamSpreadsheetId: string;
  creatorSourcingSpreadsheetId: string;
};

type SheetRef = {
  memberName: string;
  sheetName: string;
  gid?: string;
};

type ReadableMemberSheet = {
  memberName: string;
  sheetName: string;
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

type SignedCreatorsDiscoveryResult = {
  ref: SheetRef | null;
  diagnostics: SignedCreatorsTabDiagnostic;
};

type DashboardReadDebug = {
  dealTabs?: TabMatchDiagnostic;
  outreachTabs?: TabMatchDiagnostic;
  signedCreatorsTab?: SignedCreatorsTabDiagnostic;
  teamMembers?: {
    configured: number;
    active: number;
    offboarded: number;
    setupNeeded: boolean;
    suggestions: string[];
    warnings: string[];
  };
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
    totalPaidCommission: number;
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
  avatarUrl?: string;
  totalCreators: number;
  contacted: number;
  emailed: number;
  igOutreach: number;
  replies: number;
  bookedCalls: number;
  signed: number;
  ended: number;
  replyRate: number;
  bookingRate: number;
  callClosingRate: number;
  overallClosingRate: number;
  conversionRate: number;
  topNiche: string;
};

export type OutreachDashboardData = {
  members: OutreachMemberStats[];
  totals: Omit<OutreachMemberStats, "memberName" | "initials" | "avatarUrl" | "topNiche"> & {
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
    teamMembers: DashboardReadDebug["teamMembers"] | null;
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

export function invalidateDashboardSheetCache() {
  dashboardCache = null;
  dashboardRefreshPromise = null;
}

function parseMoney(value: string) {
  const number = Number(value.replace(/[$£,%A-Z\s,]/gi, ""));
  return Number.isFinite(number) ? number : 0;
}

function logDashboardDataFlow(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:data-flow]", message, details ?? {});
}

function isRateLimitError(error: unknown) {
  return (
    error instanceof Error && /Google Sheets API failed \(429\)|Quota exceeded/i.test(error.message)
  );
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

function getSystemTabSkipReason(sheetName: string) {
  if (isIgnoredOutreachSheet(sheetName) || isSignedCreatorsSheet(sheetName)) {
    return "Ignored creator sourcing system tab.";
  }

  return getSystemMemberTabSkipReason(sheetName);
}

function memberMatchKey(value: string) {
  return canonicalMemberName(value).toLowerCase();
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

function getSheetSignature(headers: string[], rows: string[][]) {
  return JSON.stringify([
    headers.map(normalizeSheetHeader),
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
    paidCommission: 0,
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

function getSummaryValue(rows: string[][], labels: string[]) {
  const normalizedLabels = labels.map((label) => normalizeSheetLabel(label));

  for (const row of rows) {
    for (let index = 0; index < row.length; index += 1) {
      const label = normalizeSheetLabel(row[index] ?? "");
      const matchesLabel = normalizedLabels.some((candidate) => label.includes(candidate));

      if (!matchesLabel) continue;

      const valueCells = row.slice(index + 1, index + 4);
      const value = valueCells.map(parseMoney).find((candidate) => candidate > 0);
      return value ?? 0;
    }
  }

  return 0;
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
      sheetName: sheet.sheetName,
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

function findConfiguredSheetRef(discovered: SheetRef[], member: TeamMemberConfig): SheetRef | null {
  const worksheetName = cleanMemberName(member.id);
  if (!worksheetName) return null;

  return (
    discovered.find(
      (sheet) => normalizeSheetLabel(sheet.sheetName) === normalizeSheetLabel(worksheetName),
    ) ?? null
  );
}

async function readConfiguredDealMemberSheets(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  members: TeamMemberConfig[],
  debug?: DashboardReadDebug,
): Promise<ReadableMemberSheet[]> {
  const discovered = await discoverAllSheetRefs(config, spreadsheetId);
  const availableTabs = discovered.map((sheet) => sheet.sheetName);
  const skippedTabs: TabMatchDiagnostic["skippedTabs"] = [];
  const expectedMembers = members.map((member) => member.displayName);
  const missingExpectedMembers: string[] = [];
  const configuredRefs: SheetRef[] = [];

  for (const sheet of discovered) {
    const skipReason = getSystemTabSkipReason(sheet.sheetName);
    if (skipReason) {
      skippedTabs.push({ sheetName: sheet.sheetName, reason: skipReason });
    }
  }

  for (const member of members) {
    const worksheetName = cleanMemberName(member.id);

    if (!worksheetName) {
      missingExpectedMembers.push(member.displayName);
      skippedTabs.push({
        sheetName: member.displayName,
        reason: "Configured member has no ID.",
      });
      continue;
    }

    if (isSystemMemberTabName(worksheetName)) {
      missingExpectedMembers.push(member.displayName);
      skippedTabs.push({
        sheetName: worksheetName,
        reason: "Configured member ID points to a protected system tab.",
      });
      continue;
    }

    const matchedRef = findConfiguredSheetRef(discovered, member);

    if (!matchedRef) {
      missingExpectedMembers.push(member.displayName);
      skippedTabs.push({
        sheetName: worksheetName,
        reason: `Configured worksheet for ${member.displayName} was not found.`,
      });
      continue;
    }

    configuredRefs.push({
      ...matchedRef,
      memberName: member.displayName,
    });
  }

  const candidateSheets = await fetchMemberSheetsRowsBatchSafely(
    config,
    spreadsheetId,
    configuredRefs,
    debug,
  );
  const readableSheets: ReadableMemberSheet[] = [];

  for (const sheet of candidateSheets) {
    const memberName = cleanMemberName(sheet.memberName);
    const missingHeaders = getMissingDealHeaders(sheet.headers);

    if (sheet.headers.length === 0) {
      skippedTabs.push({ sheetName: sheet.sheetName, reason: "No header row found." });
      readableSheets.push(sheet);
      continue;
    }

    if (!isDealWorksheetHeader(sheet.headers)) {
      skippedTabs.push({
        sheetName: sheet.sheetName,
        reason: `Missing required deal headers: ${missingHeaders.join(", ")}.`,
      });
      readableSheets.push(sheet);
      continue;
    }

    readableSheets.push({
      ...sheet,
      memberName,
    });
  }

  const diagnostics: TabMatchDiagnostic = {
    spreadsheet: "deals",
    availableTabs,
    expectedMembers,
    matchedMembers: readableSheets.map((sheet) => ({
      memberName: sheet.memberName,
      sheetName: sheet.sheetName,
    })),
    missingExpectedMembers,
    skippedTabs,
    warnings: [],
  };

  if (members.length === 0) {
    diagnostics.warnings.push("No active TeamMembers rows are configured.");
  } else if (readableSheets.length === 0) {
    diagnostics.warnings.push("No configured member deal worksheets could be read.");
  }

  if (debug) {
    debug.dealTabs = diagnostics;
  }
  debug?.warnings.push(...diagnostics.warnings);

  logDashboardDataFlow("deal member tabs read from TeamMembers config", {
    availableTabs,
    expectedMembers,
    matchedMembers: diagnostics.matchedMembers,
    missingExpectedMembers,
    skippedTabs,
  });

  return readableSheets;
}

function buildMemberSummary(tabName: string, rows: string[][], deals: Deal[], fallback: Teammate) {
  const currentMonthKey = getCurrentDealMonthKey();
  const pendingOwed = getSummaryValue(rows, SUMMARY_LABELS.pendingOwed);
  const memberDeals = deals.filter(
    (deal) => deal.manager === tabName && isClosedCommissionDeal(deal),
  );
  const paidDeals = deals.filter((deal) => deal.manager === tabName && isPaidCommissionDeal(deal));
  const allTimeCommission = memberDeals.reduce((sum, deal) => sum + deal.managerTotalGbp, 0);
  const paidCommission = paidDeals.reduce((sum, deal) => sum + deal.managerTotalGbp, 0);
  const currentMonthCommission = memberDeals
    .filter((deal) => normalizeDealMonthKey(deal.month) === currentMonthKey)
    .reduce((sum, deal) => sum + deal.managerTotalGbp, 0);
  const totalPricing = memberDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);

  return {
    ...fallback,
    name: tabName,
    initials: getInitials(tabName),
    commission: allTimeCommission,
    paidCommission,
    monthCommission: currentMonthCommission,
    pendingOwed,
    dealsClosed: memberDeals.length,
    revenue: totalPricing,
  };
}

function logCommissionDebug(team: Teammate[], deals: Deal[]) {
  const reasonCounts: Record<DealExclusionReason, number> = {
    Cancelled: 0,
    "Blank status": 0,
    "Blank/filler row": 0,
    "Zero/invalid commission": 0,
    "Other status": 0,
  };
  const closedCommissionByMember: Record<string, number> = Object.fromEntries(
    team.map((member) => [member.name, 0]),
  );
  let rowsCountedForClosedCommission = 0;

  for (const deal of deals) {
    const reason = getDealRowExclusionReason(deal);

    if (reason) {
      reasonCounts[reason] += 1;
      continue;
    }

    rowsCountedForClosedCommission += 1;

    closedCommissionByMember[deal.manager] =
      (closedCommissionByMember[deal.manager] ?? 0) + deal.managerTotalGbp;
  }

  console.info("[team-billion:commission-debug]", {
    totalRowsProcessed: deals.length,
    rowsCountedForClosedCommission,
    rowsExcluded: deals.length - rowsCountedForClosedCommission,
    exclusionReasonCounts: reasonCounts,
    closedCommissionByMember: closedCommissionByMember,
    postedCommission: deals
      .filter(isPostedCommissionDeal)
      .reduce((sum, deal) => sum + deal.managerTotalGbp, 0),
  });
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
    bookingRate: 0,
    callClosingRate: 0,
    overallClosingRate: 0,
    conversionRate: 0,
    topNiche: "-",
  };
}

function fallbackOutreachData(team: Teammate[] = fallbackTeam): OutreachDashboardData {
  return {
    members: team.map((member) => ({
      memberName: member.name,
      initials: member.initials,
      avatarUrl: member.avatarUrl,
      totalCreators: 0,
      contacted: 0,
      emailed: 0,
      igOutreach: 0,
      replies: 0,
      bookedCalls: 0,
      signed: member.exclusiveCreators + member.nonExclusiveCreators,
      ended: 0,
      replyRate: 0,
      bookingRate: 0,
      callClosingRate: 0,
      overallClosingRate: 0,
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

  let totalCallConversions = 0;

  const members = team.map((member) => {
    const memberName = canonicalMemberName(member.name);
    const rows = outreachRows.filter((row) => canonicalMemberName(row.memberName) === memberName);
    const contacted = rows.filter((row) => row.emailed || row.igOutreach).length;
    const emailed = rows.filter((row) => row.emailed).length;
    const igOutreach = rows.filter((row) => row.igOutreach).length;
    const replies = rows.filter((row) => row.replied).length;
    const bookedCalls = rows.filter((row) => row.bookedCall).length;
    const signedFromStatus = rows.filter((row) => row.signedFromStatus).length;
    const callConversions = rows.filter((row) => row.bookedCall && row.signedFromStatus).length;
    const hasOutcomeData = rows.some((row) => row.finalStatus.trim());
    const signed = hasOutcomeData ? signedFromStatus : (signedByMember.get(memberName) ?? 0);
    const ended = rows.filter((row) => row.ended).length;
    const overallClosingRate = percentage(signed, contacted);
    totalCallConversions += callConversions;

    return {
      memberName: member.name,
      initials: member.initials,
      avatarUrl: member.avatarUrl,
      totalCreators: rows.length,
      contacted,
      emailed,
      igOutreach,
      replies,
      bookedCalls,
      signed,
      ended,
      replyRate: percentage(replies, contacted),
      bookingRate: percentage(bookedCalls, contacted),
      callClosingRate: percentage(callConversions, bookedCalls),
      overallClosingRate,
      conversionRate: overallClosingRate,
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
      bookingRate: 0,
      callClosingRate: 0,
      overallClosingRate: 0,
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
      bookingRate: percentage(totalsBase.bookedCalls, totalsBase.contacted),
      callClosingRate: percentage(totalCallConversions, totalsBase.bookedCalls),
      overallClosingRate: percentage(totalsBase.signed, totalsBase.contacted),
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
  activeMembers: TeamMemberConfig[],
  debug?: DashboardReadDebug,
) {
  logDashboardDataFlow("loading creator sourcing data", {
    teamMembers: team.length,
  });

  const discoveredCreatorTabs = await discoverAllSheetRefs(config, creatorSourcingSpreadsheetId);
  const availableTabs = discoveredCreatorTabs.map((sheet) => sheet.sheetName);
  const skippedOutreachTabs: TabMatchDiagnostic["skippedTabs"] = [];
  const signedCreatorsFound = discoveredCreatorTabs.find((sheet) =>
    isSignedCreatorsSheet(sheet.sheetName ?? sheet.memberName),
  );
  const expectedMembers = activeMembers.map((member) => member.displayName);
  const missingExpectedMembers: string[] = [];

  discoveredCreatorTabs.forEach((sheet) => {
    const skipReason = getSystemTabSkipReason(sheet.sheetName);

    if (skipReason) {
      skippedOutreachTabs.push({ sheetName: sheet.sheetName, reason: skipReason });
    }
  });

  const outreachCandidateRefs = activeMembers.flatMap((member) => {
    const worksheetName = cleanMemberName(member.id);

    if (!worksheetName) {
      missingExpectedMembers.push(member.displayName);
      skippedOutreachTabs.push({
        sheetName: member.displayName,
        reason: "Configured member has no ID.",
      });
      return [];
    }

    if (isSystemMemberTabName(worksheetName)) {
      missingExpectedMembers.push(member.displayName);
      skippedOutreachTabs.push({
        sheetName: worksheetName,
        reason: "Configured member ID points to a protected system tab.",
      });
      return [];
    }

    const matchedRef = findConfiguredSheetRef(discoveredCreatorTabs, member);

    if (!matchedRef) {
      missingExpectedMembers.push(member.displayName);
      skippedOutreachTabs.push({
        sheetName: worksheetName,
        reason: `Configured outreach worksheet for ${member.displayName} was not found.`,
      });
      return [];
    }

    return [
      {
        ...matchedRef,
        memberName: member.displayName,
      },
    ];
  });
  const signedCreatorsDiscovery: SignedCreatorsDiscoveryResult = {
    ref: signedCreatorsFound
      ? {
          ...signedCreatorsFound,
          memberName: cleanMemberName(SIGNED_CREATORS_TAB_NAME),
        }
      : null,
    diagnostics: {
      availableTabs,
      expectedName: cleanMemberName(SIGNED_CREATORS_TAB_NAME),
      found: Boolean(signedCreatorsFound),
      sheetName: signedCreatorsFound?.sheetName ?? null,
      warning: signedCreatorsFound
        ? null
        : "Signed creators tab was not found, so creator roster rows were skipped.",
    },
  };
  const signedCreatorsRef = signedCreatorsDiscovery.ref;

  logDashboardDataFlow("creator sourcing sheet refs discovered", {
    outreachCandidateCount: outreachCandidateRefs.length,
    outreachCandidates: outreachCandidateRefs.map((sheet) => sheet.sheetName),
    signedCreatorsSheet: signedCreatorsRef?.sheetName ?? null,
  });

  const creatorSheetRefs = signedCreatorsRef
    ? [...outreachCandidateRefs, signedCreatorsRef]
    : outreachCandidateRefs;
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

  const outreachDiagnostics: TabMatchDiagnostic = {
    spreadsheet: "creator-sourcing",
    availableTabs,
    expectedMembers,
    matchedMembers: [],
    missingExpectedMembers,
    skippedTabs: skippedOutreachTabs,
    warnings: [],
  };
  const readableOutreachSheets: ReadableMemberSheet[] = [];

  outreachCandidateRefs.forEach((sheet, index) => {
    const memberName = cleanMemberName(sheet.memberName);
    const headers = creatorSheetRows[index]?.headers ?? [];
    const rows = creatorSheetRows[index]?.rows ?? [];
    const missingHeaders = getMissingOutreachHeaders(headers);

    if (headers.length === 0) {
      outreachDiagnostics.skippedTabs.push({
        sheetName: sheet.sheetName,
        reason: "No header row found.",
      });
      return;
    }

    if (!isOutreachWorksheetHeader(headers)) {
      outreachDiagnostics.skippedTabs.push({
        sheetName: sheet.sheetName,
        reason:
          missingHeaders.length > 0
            ? `Missing outreach headers: ${missingHeaders.join(", ")}.`
            : "Does not match the outreach worksheet structure.",
      });
      return;
    }

    outreachDiagnostics.matchedMembers.push({
      memberName,
      sheetName: sheet.sheetName,
    });

    if (missingHeaders.length > 0) {
      outreachDiagnostics.warnings.push(
        `${memberName} outreach sheet is missing headers used by dashboard metrics: ${missingHeaders.join(", ")}.`,
      );
    }

    readableOutreachSheets.push({
      memberName,
      sheetName: sheet.sheetName,
      headers,
      rows,
    });
  });

  if (readableOutreachSheets.length === 0) {
    outreachDiagnostics.warnings.push(
      activeMembers.length === 0
        ? "No active TeamMembers rows are configured for outreach."
        : "No configured member outreach worksheets could be read.",
    );
  }

  if (debug) {
    debug.outreachTabs = outreachDiagnostics;
    debug.signedCreatorsTab = signedCreatorsDiscovery.diagnostics;
    debug.warnings.push(...outreachDiagnostics.warnings);
    if (signedCreatorsDiscovery.diagnostics.warning) {
      debug.warnings.push(signedCreatorsDiscovery.diagnostics.warning);
    }
  }

  const signedCreatorsRows =
    signedCreatorsRef && creatorSheetRows[outreachCandidateRefs.length]
      ? creatorSheetRows[outreachCandidateRefs.length]
      : { headers: [], rows: [] };
  const missingCreatorHeaders = getMissingCreatorHeaders(signedCreatorsRows.headers);
  if (signedCreatorsRows.headers.length > 0 && missingCreatorHeaders.length > 0) {
    const warning = `Signed creators tab is missing headers used by creator metrics: ${missingCreatorHeaders.join(", ")}.`;
    debug?.warnings.push(warning);
    signedCreatorsDiscovery.diagnostics.warning =
      signedCreatorsDiscovery.diagnostics.warning ?? warning;
  }

  logDashboardDataFlow("creator sourcing tabs read from TeamMembers config", {
    expectedMembers,
    matchedMembers: outreachDiagnostics.matchedMembers,
    missingExpectedMembers,
    skippedTabs: outreachDiagnostics.skippedTabs,
    warnings: outreachDiagnostics.warnings,
  });

  const outreachRows = readableOutreachSheets.flatMap(({ memberName, headers, rows }) =>
    normalizeMemberOutreachRows(memberName, [headers, ...rows]),
  );
  const activeMemberNames = new Set(team.map((member) => canonicalMemberName(member.name)));
  const creators = normalizeCreatorRows([
    signedCreatorsRows.headers,
    ...signedCreatorsRows.rows,
  ]).filter((creator) => activeMemberNames.has(canonicalMemberName(creator.owner)));

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
  const closedDeals = deals.filter(isClosedCommissionDeal);
  logCommissionDebug(team, deals);

  const totalPaid = closedDeals.reduce((sum, deal) => sum + deal.managerTotalGbp, 0);
  const totalPaidCommission = deals
    .filter(isPaidCommissionDeal)
    .reduce((sum, deal) => sum + deal.managerTotalGbp, 0);
  const paidThisMonth = team.reduce((sum, member) => sum + member.monthCommission, 0);
  const pendingOwed = team.reduce((sum, member) => sum + member.pendingOwed, 0);
  const dealsClosed = closedDeals.length;
  const totalPricing = closedDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);
  const pricedDeals = closedDeals.filter((deal) => deal.totalPricingGbp > 0);
  const marginValues = closedDeals
    .map((deal) => parsePercent(deal.profitMargin))
    .filter((margin) => margin > 0);

  return {
    totalPaid,
    totalPaidCommission,
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
      totalPaidCommission: 0,
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
  const activeFallbackDeals = fallbackDeals.filter(isActiveDashboardDeal);

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
  const teamMembersData = await getTeamMembersDataForServer();
  const activeMembers = teamMembersData.activeMembers;
  const dealHistoryMembers = teamMembersData.members;

  if (debug) {
    debug.teamMembers = {
      configured: teamMembersData.members.length,
      active: activeMembers.length,
      offboarded: teamMembersData.offboardedMembers.length,
      setupNeeded: teamMembersData.setupNeeded,
      suggestions: teamMembersData.suggestions.map((suggestion) => suggestion.id),
      warnings: teamMembersData.warnings,
    };
    debug.warnings.push(...teamMembersData.warnings);
    if (teamMembersData.warning) debug.warnings.push(teamMembersData.warning);
  }

  const sheets = await readConfiguredDealMemberSheets(
    config,
    config.teamSpreadsheetId,
    dealHistoryMembers,
    debug,
  );
  logDashboardDataFlow("deal sheet rows returned", {
    sheets: sheets.map((sheet) => ({
      memberName: sheet.memberName,
      headerCount: sheet.headers.length,
      rowCount: sheet.rows.length,
      expectedDealHeaders: isDealWorksheetHeader(sheet.headers),
    })),
  });

  logDashboardDataFlow("deal sheets after expected-header filter", {
    validDealSheetCount: sheets.length,
    validDealSheets: sheets.map((sheet) => ({
      memberName: sheet.memberName,
      rowCount: sheet.rows.length,
    })),
  });

  const validDealSheets = sheets.filter((sheet) => isDealWorksheetHeader(sheet.headers));

  const deals = validDealSheets.flatMap(({ memberName, headers, rows }) =>
    normalizeMemberDealRows(memberName, [headers, ...rows]),
  );
  const sheetsByMember = new Map(
    sheets.map((sheet) => [normalizeSheetLabel(sheet.memberName), sheet]),
  );
  const baseTeam = activeMembers.map((member, index) => {
    const sheet = sheetsByMember.get(normalizeSheetLabel(member.displayName));
    return buildMemberSummary(
      member.displayName,
      sheet?.rows ?? [],
      deals,
      teamMemberConfigToTeammate(member, index),
    );
  });
  const creatorData = await readCreatorSourcingData(
    config,
    config.creatorSourcingSpreadsheetId,
    baseTeam,
    activeMembers,
    debug,
  );
  const team = enrichTeamWithCreatorCounts(baseTeam, creatorData.creators);
  const totals = calculateTotals(team, deals);

  logDashboardDataFlow("dashboard data loaded from google sheets", {
    teamMembers: team.length,
    dealHistoryMembers: dealHistoryMembers.length,
    deals: deals.length,
    creators: creatorData.creators.length,
    outreachMembers: creatorData.outreach.members.length,
    outreachCreators: creatorData.outreach.totals.totalCreators,
    allTimeCommission: totals.totalPaid,
    currentMonthCommission: totals.paidThisMonth,
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
    note: "Dashboard data is loaded by a TanStack server function after login. The parsed Google Sheets result is cached server-side for 5 minutes, Google API fetches use no-store, and the client query also stays fresh for 5 minutes.",
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
      fallbackReason: data.source === "fallback" ? (data.error ?? "Unknown fallback reason") : null,
      counts: {
        teamMembers: data.team.length,
        deals: data.deals.length,
        creators: data.creators.length,
        outreachMembers: data.outreach.members.length,
        outreachCreators: data.outreach.totals.totalCreators,
      },
      tabs: {
        teamMembers: debug.teamMembers ?? null,
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
        teamMembers: debug.teamMembers ?? null,
        deals: debug.dealTabs ?? null,
        outreach: debug.outreachTabs ?? null,
        signedCreators: debug.signedCreatorsTab ?? null,
        warnings: debug.warnings,
      },
      cache: makeCacheDiagnostics(
        dashboardCache ? "stale" : "miss",
        cacheExpiresAtLabel(dashboardCache),
      ),
    };
  }
}

export const fetchDashboardSheetData = createServerFn({ method: "GET" }).handler(async () => {
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
});

export const dashboardSheetQuery = {
  queryKey: ["team-billion-dashboard-sheet", "universal-header-parser-v1"],
  queryFn: () => fetchDashboardSheetData(),
  refetchInterval: QUERY_REFETCH_INTERVAL_MS,
  staleTime: QUERY_STALE_TIME_MS,
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
};
