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
import { requireDashboardAuth } from "@/lib/auth";

type GoogleSheetsServer = typeof import("@/lib/google-sheets.server");
type GoogleSheetsConfig = ReturnType<GoogleSheetsServer["getGoogleSheetsConfig"]>;

type SheetRef = {
  memberName: string;
  sheetName: string;
  gid?: string;
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

const SUMMARY_LABELS = {
  pendingOwed: ["pending in gbp", "pending"],
  paidThisMonth: ["paid current month in gbp", "paid current month"],
  totalPaid: ["total paid in gbp", "total paid"],
};

const DEFAULT_REVENUE_GOAL = 300000;
const DEFAULT_DEALS_GOAL = 20;
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
): Promise<SheetRef[]> {
  const fallbackRefs = FALLBACK_MEMBER_SHEETS.map((sheet) => ({
    sheetName: sheet.name,
    memberName: sheet.name,
  }));
  const discovered = await discoverAllSheetRefs(config, spreadsheetId);
  const merged = new Map<string, SheetRef>();

  for (const sheet of fallbackRefs) {
    merged.set(sheet.memberName.toLowerCase(), sheet);
  }

  for (const sheet of discovered) {
    const memberName = cleanMemberName(sheet.memberName);
    if (!isLikelyMemberName(memberName)) continue;
    const key = memberName.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, {
        ...sheet,
        memberName,
      });
    }
  }

  return Array.from(merged.values());
}

async function discoverCreatorSourcingSheetRefs(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
): Promise<SheetRef[]> {
  const discovered = await discoverAllSheetRefs(config, spreadsheetId);
  const fallbackRefs = FALLBACK_MEMBER_SHEETS.map((sheet) => ({
    sheetName: sheet.name,
    memberName: sheet.name,
  }));
  const merged = new Map<string, SheetRef>();

  for (const sheet of fallbackRefs) {
    merged.set(canonicalMemberName(sheet.memberName).toLowerCase(), sheet);
  }

  for (const sheet of discovered) {
    const memberName = canonicalMemberName(sheet.memberName);
    if (!isOutreachWorksheetName(memberName) || isIgnoredOutreachSheet(sheet.sheetName ?? "")) {
      continue;
    }
    merged.set(memberName.toLowerCase(), {
      ...sheet,
      memberName,
    });
  }

  return Array.from(merged.values());
}

async function discoverSignedCreatorsSheetRef(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
): Promise<SheetRef> {
  const discovered = await discoverAllSheetRefs(config, spreadsheetId);
  const found = discovered.find((sheet) =>
    isSignedCreatorsSheet(sheet.sheetName ?? sheet.memberName),
  );

  return (
    found ?? {
      sheetName: SIGNED_CREATORS_TAB_NAME,
      memberName: cleanMemberName(SIGNED_CREATORS_TAB_NAME),
    }
  );
}

function getSummaryValue(rows: string[][], labels: string[]) {
  const row = rows.find((item) => {
    const label = item[17]?.toLowerCase().trim() ?? "";
    return labels.some((candidate) => label.includes(candidate));
  });
  return parseMoney(row?.[18] ?? "");
}

async function fetchSheetRowsFromApi(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  sheet: SheetRef,
) {
  const { fetchSheetRows } = await getGoogleSheetsServer();
  return fetchSheetRows(config, spreadsheetId, sheet);
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
) {
  const [outreachRefs, signedCreatorsRef] = await Promise.all([
    discoverCreatorSourcingSheetRefs(config, creatorSourcingSpreadsheetId),
    discoverSignedCreatorsSheetRef(config, creatorSourcingSpreadsheetId),
  ]);
  const [outreachSheets, signedCreatorsRows] = await Promise.all([
    Promise.all(
      outreachRefs.map(async (memberSheet) => ({
        memberName: memberSheet.memberName,
        ...(await fetchSheetRowsFromApi(config, creatorSourcingSpreadsheetId, memberSheet)),
      })),
    ),
    fetchSheetRowsFromApi(config, creatorSourcingSpreadsheetId, signedCreatorsRef),
  ]);

  const outreachRows = outreachSheets.flatMap(({ memberName, headers, rows }) =>
    normalizeMemberOutreachRows(memberName, [headers, ...rows]),
  );
  const creators = normalizeCreatorRows([signedCreatorsRows.headers, ...signedCreatorsRows.rows]);

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

async function readDashboardSheetData(config: GoogleSheetsConfig): Promise<DashboardSheetData> {
  const { makeSheetUrl } = await getGoogleSheetsServer();
  const links = {
    dealsSheetUrl: makeSheetUrl(config.teamSpreadsheetId),
    creatorSourcingSheetUrl: makeSheetUrl(config.creatorSourcingSpreadsheetId),
  };
  const sheetRefs = await discoverDealSheetRefs(config, config.teamSpreadsheetId);
  const readableSheets = await Promise.all(
    sheetRefs.map(async (memberSheet) => ({
      memberName: memberSheet.memberName,
      ...(await fetchSheetRowsFromApi(config, config.teamSpreadsheetId, memberSheet)),
    })),
  );
  const sheets = dedupeSheetsByContent(
    readableSheets.filter((sheet) => isDealWorksheet(sheet.headers)),
  );

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
  );
  const team = enrichTeamWithCreatorCounts(baseTeam, creatorData.creators);

  return {
    deals,
    team,
    creators: creatorData.creators,
    outreach: creatorData.outreach,
    totals: calculateTotals(team, deals),
    source: "google-sheet",
    links,
    updatedAt: new Date().toISOString(),
  };
}

export const fetchDashboardSheetData = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireDashboardAuth();
    const googleSheets = await getGoogleSheetsServer();
    const links = googleSheets.getOptionalSheetLinks();

    try {
      return await readDashboardSheetData(googleSheets.getGoogleSheetsConfig());
    } catch (error) {
      const message = getGoogleSheetsErrorMessage(error);
      console.error("Google Sheets dashboard access failed:", error);

      if (!googleSheets.isProductionRuntime()) {
        return fallbackDashboardData(message, links);
      }

      return emptyDashboardData(message, links);
    }
  },
);

export const dashboardSheetQuery = {
  queryKey: ["team-billion-dashboard-sheet", "creator-sourcing-v1"],
  queryFn: () => fetchDashboardSheetData(),
  refetchInterval: 60_000,
  staleTime: 30_000,
};
