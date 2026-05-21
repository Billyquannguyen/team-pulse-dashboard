import { createServerFn } from "@tanstack/react-start";
import {
  CREATOR_SOURCING_SPREADSHEET_ID,
  FALLBACK_MEMBER_SHEETS,
  IGNORED_OUTREACH_TAB_NAMES,
  SIGNED_CREATORS_TAB_NAME,
  TEAM_BILLION_SPREADSHEET_ID,
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

type GvizCell = {
  v?: string | number | boolean;
  f?: string;
};

type GvizResponse = {
  table: {
    cols: { label?: string }[];
    rows: { c?: (GvizCell | null)[] }[];
  };
};

type WorksheetFeedResponse = {
  feed?: {
    entry?: Array<{
      title?: {
        $t?: string;
      };
    }>;
  };
};

type SheetRef = {
  memberName: string;
  sheetName?: string;
  gid?: string;
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
  source: "google-sheet" | "fallback";
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

function parseGvizJson(raw: string): GvizResponse {
  const match = raw.match(/google\.visualization\.Query\.setResponse\((.*)\);?$/s);
  if (!match) throw new Error("Google Sheets response was not valid GViz JSON.");
  return JSON.parse(match[1]) as GvizResponse;
}

function cellToText(cell: GvizCell | null | undefined) {
  if (!cell) return "";
  const value = cell.f ?? cell.v ?? "";
  return String(value);
}

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

function parseJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

async function discoverSheetsFromWorksheetFeed(spreadsheetId: string): Promise<SheetRef[]> {
  const url = new URL(
    `https://spreadsheets.google.com/feeds/worksheets/${spreadsheetId}/public/basic`,
  );
  url.searchParams.set("alt", "json");

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Could not discover worksheets: ${response.status}`);

  const parsed = (await response.json()) as WorksheetFeedResponse;
  const entries = parsed.feed?.entry ?? [];

  return entries
    .map((entry) => entry.title?.$t ?? "")
    .map((sheetName) => ({
      sheetName,
      memberName: cleanMemberName(sheetName),
    }));
}

function parseSheetsFromHtml(html: string): SheetRef[] {
  const sheets = new Map<string, SheetRef>();
  const pairPattern = /\[(\d{1,12}),"((?:\\.|[^"\\]){1,80})"/g;
  const objectPattern =
    /"sheetId"\s*:\s*(\d{1,12})[\s\S]{0,400}?"title"\s*:\s*"((?:\\.|[^"\\]){1,80})"/g;

  const addSheet = (gid: string, rawName: string) => {
    const sheetName = parseJsonString(rawName);
    const memberName = cleanMemberName(sheetName);
    sheets.set(gid, { gid, sheetName, memberName });
  };

  for (const match of html.matchAll(pairPattern)) {
    addSheet(match[1], match[2]);
  }

  for (const match of html.matchAll(objectPattern)) {
    addSheet(match[1], match[2]);
  }

  return Array.from(sheets.values());
}

async function discoverSheetsFromHtml(spreadsheetId: string): Promise<SheetRef[]> {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
  url.searchParams.set("usp", "sharing");

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Could not discover worksheets from HTML: ${response.status}`);

  return parseSheetsFromHtml(await response.text());
}

async function discoverAllSheetRefs(spreadsheetId: string): Promise<SheetRef[]> {
  return (
    (await discoverSheetsFromWorksheetFeed(spreadsheetId).catch(() =>
      discoverSheetsFromHtml(spreadsheetId).catch(() => []),
    )) ?? []
  );
}

async function discoverDealSheetRefs(): Promise<SheetRef[]> {
  const fallbackRefs = FALLBACK_MEMBER_SHEETS.map((sheet) => ({
    gid: sheet.gid,
    memberName: sheet.name,
  }));
  const discovered = await discoverAllSheetRefs(TEAM_BILLION_SPREADSHEET_ID);
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

async function discoverCreatorSourcingSheetRefs(): Promise<SheetRef[]> {
  const discovered = await discoverAllSheetRefs(CREATOR_SOURCING_SPREADSHEET_ID);
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

async function discoverSignedCreatorsSheetRef(): Promise<SheetRef> {
  const discovered = await discoverAllSheetRefs(CREATOR_SOURCING_SPREADSHEET_ID);
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

async function fetchSheetRows(spreadsheetId: string, sheet: SheetRef) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:json");
  if (sheet.gid) {
    url.searchParams.set("gid", sheet.gid);
  } else if (sheet.sheetName) {
    url.searchParams.set("sheet", sheet.sheetName);
  } else {
    throw new Error(`No sheet identifier for ${sheet.memberName}`);
  }

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Could not read ${sheet.memberName}: ${response.status}`);

  const parsed = parseGvizJson(await response.text());
  const headers = parsed.table.cols.map((column) => column.label ?? "");
  const rows = parsed.table.rows.map((row) =>
    parsed.table.cols.map((_, index) => cellToText(row.c?.[index])),
  );

  return { headers, rows };
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

async function readCreatorSourcingData(team: Teammate[]) {
  try {
    const [outreachRefs, signedCreatorsRef] = await Promise.all([
      discoverCreatorSourcingSheetRefs(),
      discoverSignedCreatorsSheetRef(),
    ]);
    const [outreachSheets, signedCreatorsRows] = await Promise.all([
      Promise.all(
        outreachRefs.map(async (memberSheet) => {
          try {
            return {
              memberName: memberSheet.memberName,
              ...(await fetchSheetRows(CREATOR_SOURCING_SPREADSHEET_ID, memberSheet)),
            };
          } catch (error) {
            console.error(`Could not read outreach tab ${memberSheet.memberName}`, error);
            return {
              memberName: memberSheet.memberName,
              headers: [] as string[],
              rows: [] as string[][],
            };
          }
        }),
      ),
      fetchSheetRows(CREATOR_SOURCING_SPREADSHEET_ID, signedCreatorsRef),
    ]);

    const outreachRows = outreachSheets.flatMap(({ memberName, headers, rows }) =>
      normalizeMemberOutreachRows(memberName, [headers, ...rows]),
    );
    const creators = normalizeCreatorRows([signedCreatorsRows.headers, ...signedCreatorsRows.rows]);

    return {
      creators,
      outreach: buildOutreachDashboardData(outreachRows, creators, team),
    };
  } catch (error) {
    console.error("Could not read creator sourcing sheet", error);
    return {
      creators: fallbackCreators,
      outreach: fallbackOutreachData(team),
    };
  }
}

async function readDashboardSheetData(): Promise<DashboardSheetData> {
  try {
    const sheetRefs = await discoverDealSheetRefs();
    const readableSheets = await Promise.all(
      sheetRefs.map(async (memberSheet) => {
        try {
          return {
            memberName: memberSheet.memberName,
            ...(await fetchSheetRows(TEAM_BILLION_SPREADSHEET_ID, memberSheet)),
          };
        } catch (error) {
          console.error(`Could not read member tab ${memberSheet.memberName}`, error);
          return {
            memberName: memberSheet.memberName,
            headers: [] as string[],
            rows: [] as string[][],
          };
        }
      }),
    );
    const sheets = dedupeSheetsByContent(
      readableSheets.filter((sheet) => isDealWorksheet(sheet.headers)),
    );

    if (!sheets.some((sheet) => sheet.headers.length > 0)) {
      throw new Error("No Google Sheet tabs could be read.");
    }

    const deals = sheets.flatMap(({ memberName, headers, rows }) =>
      normalizeMemberDealRows(memberName, [headers, ...rows]),
    );
    const baseTeam = sheets.map(({ memberName, rows }, index) =>
      buildMemberSummary(memberName, rows, deals, getKnownFallback(memberName, index)),
    );
    const creatorData = await readCreatorSourcingData(baseTeam);
    const team =
      creatorData.outreach.source === "google-sheet"
        ? enrichTeamWithCreatorCounts(baseTeam, creatorData.creators)
        : baseTeam;
    const totalPaid = team.reduce((sum, member) => sum + member.commission, 0);
    const paidThisMonth = team.reduce((sum, member) => sum + member.monthCommission, 0);
    const pendingOwed = team.reduce((sum, member) => sum + member.pendingOwed, 0);
    const dealsClosed = deals.length;
    const totalPricing = deals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);
    const pricedDeals = deals.filter((deal) => deal.totalPricingGbp > 0);
    const marginValues = deals
      .map((deal) => parsePercent(deal.profitMargin))
      .filter((margin) => margin > 0);
    const paidGoal = team.reduce((sum, member) => sum + member.revenueGoal, 0);
    const dealsGoal = team.reduce((sum, member) => sum + member.dealsGoal, 0);

    return {
      deals,
      team,
      creators: creatorData.creators,
      outreach: creatorData.outreach,
      totals: {
        totalPaid,
        paidThisMonth,
        pendingOwed,
        dealsClosed,
        totalPricing,
        averageDealSize: Math.round(totalPricing / Math.max(1, pricedDeals.length)),
        averageProfitMargin: Math.round(average(marginValues) * 10) / 10,
        paidGoal,
        dealsGoal,
      },
      source: "google-sheet",
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(error);
    const totalPaid = fallbackTeam.reduce((sum, member) => sum + member.commission, 0);
    const paidThisMonth = fallbackTeam.reduce((sum, member) => sum + member.monthCommission, 0);
    const pendingOwed = fallbackTeam.reduce((sum, member) => sum + member.pendingOwed, 0);
    const activeFallbackDeals = fallbackDeals.filter((deal) => deal.status !== "Cancelled");
    const dealsClosed = activeFallbackDeals.length;
    const totalPricing = activeFallbackDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);
    const pricedFallbackDeals = activeFallbackDeals.filter((deal) => deal.totalPricingGbp > 0);
    const fallbackMarginValues = activeFallbackDeals
      .map((deal) => parsePercent(deal.profitMargin))
      .filter((margin) => margin > 0);

    return {
      deals: activeFallbackDeals,
      team: fallbackTeam,
      creators: fallbackCreators,
      outreach: fallbackOutreachData(fallbackTeam),
      totals: {
        totalPaid,
        paidThisMonth,
        pendingOwed,
        dealsClosed,
        totalPricing,
        averageDealSize: Math.round(totalPricing / Math.max(1, pricedFallbackDeals.length)),
        averageProfitMargin: Math.round(average(fallbackMarginValues) * 10) / 10,
        paidGoal: fallbackTeam.reduce((sum, member) => sum + member.revenueGoal, 0),
        dealsGoal: fallbackTeam.reduce((sum, member) => sum + member.dealsGoal, 0),
      },
      source: "fallback",
      updatedAt: new Date().toISOString(),
    };
  }
}

export const fetchDashboardSheetData = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireDashboardAuth();
    return readDashboardSheetData();
  },
);

export const dashboardSheetQuery = {
  queryKey: ["team-billion-dashboard-sheet", "creator-sourcing-v1"],
  queryFn: () => fetchDashboardSheetData(),
  refetchInterval: 60_000,
  staleTime: 30_000,
};
