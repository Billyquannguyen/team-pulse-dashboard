import {
  CREATOR_COLUMN_ALIASES,
  DEAL_COLUMN_ALIASES,
  OUTREACH_COLUMN_ALIASES,
  type DashboardCreatorField,
  type DashboardDealField,
  type OutreachField,
} from "@/data/sheetConfig";
import type { Creator, CreatorRelationship, CreatorStatus } from "@/data/creators";
import type { Deal, DealStatus, Platform } from "@/data/deals";

type SheetRow = string[];

export type OutreachRow = {
  id: string;
  memberName: string;
  outreachType: string;
  name: string;
  tiktokLink?: string;
  instagramLink?: string;
  youtubeLink?: string;
  email?: string;
  niche: string;
  mainPlatform: Platform;
  emailed: boolean;
  igOutreach: boolean;
  replied: boolean;
  finalStatus: string;
  bookedCall: boolean;
  signedFromStatus: boolean;
  ended: boolean;
  timeLog?: string;
  notes?: string;
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createColumnLookup<TField extends string>(
  headers: string[],
  aliases: Record<TField, string[]>,
) {
  const normalizedHeaders = headers.map(normalizeHeader);

  const entries = Object.entries(aliases) as Array<[TField, string[]]>;

  return Object.fromEntries(
    entries.map(([field, names]) => {
      const normalizedNames = names.map(normalizeHeader);
      const index = normalizedHeaders.findIndex((header) => normalizedNames.includes(header));
      return [field, index];
    }),
  ) as Record<TField, number>;
}

function getCell<TField extends string>(
  row: SheetRow,
  lookup: Record<TField, number>,
  field: TField,
) {
  const index = lookup[field];
  if (index === undefined || index < 0) return "";
  return row[index]?.trim() ?? "";
}

function parseMoney(value: string) {
  const number = Number(value.replace(/[$£,%\s,]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parseInteger(value: string) {
  const number = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function parseDealStatus(value: string): DealStatus {
  const normalized = value.toLowerCase();
  if (normalized.includes("cancel")) return "Cancelled";
  if (normalized.includes("overdue") || normalized.includes("late")) return "Overdue";
  if (normalized.includes("paid")) return "Paid";
  if (normalized.includes("posted") || normalized.includes("live")) return "Posted";
  return "Pending";
}

function parseBoolean(value: string) {
  const normalized = value.toLowerCase().trim();
  return ["true", "yes", "y", "1", "paid", "done"].includes(normalized);
}

function parseCreatorStatus(value: string): CreatorStatus {
  const normalized = value.toLowerCase();
  if (normalized.includes("follow")) return "Needs follow-up";
  if (normalized.includes("pause")) return "Paused";
  if (normalized.includes("prospect")) return "Prospect";
  return "Active";
}

function parseRelationship(value: string): CreatorRelationship {
  const normalized = value.toLowerCase();
  if (normalized.includes("non") || normalized.includes("partner")) return "Non-exclusive";
  return "Exclusive";
}

function parsePlatform(value: string): Platform {
  const normalized = value.toLowerCase();
  if (normalized.includes("tiktok")) return "TikTok";
  if (normalized.includes("youtube")) return "YouTube";
  if (normalized.includes("twitch")) return "Twitch";
  if (normalized === "x" || normalized.includes("twitter")) return "X";
  return "Instagram";
}

function normalizeVietnamese(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function cleanSheetName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function canonicalMemberName(value: string) {
  const cleaned = cleanSheetName(value);
  const normalized = normalizeVietnamese(cleaned).replace(/[^a-z0-9]/g, "");

  if (!normalized) return cleaned;
  if (normalized === "ktrang" || normalized.includes("kimtrang")) return "KTrang";
  if (normalized === "lngoc" || normalized.includes("linhngoc")) return "LNgoc";
  if (normalized === "hyen" || normalized.includes("hoangyen") || normalized.includes("huyen")) {
    return "HYen";
  }
  if (normalized === "bngan" || normalized.includes("baongan") || normalized.includes("ngan")) {
    return "BNgan";
  }

  return cleaned;
}

function hasUsefulOutreachContact(row: SheetRow, lookup: Record<OutreachField, number>) {
  return Boolean(
    getCell(row, lookup, "name") ||
    getCell(row, lookup, "email") ||
    getCell(row, lookup, "tiktokLink") ||
    getCell(row, lookup, "instagramLink") ||
    getCell(row, lookup, "youtubeLink"),
  );
}

function getFallbackCell(row: SheetRow, lookupIndex: number, fallbackIndex: number) {
  if (lookupIndex >= 0) return row[lookupIndex]?.trim() ?? "";
  return row[fallbackIndex]?.trim() ?? "";
}

function isBookedCallStatus(value: string) {
  const normalized = value.toLowerCase();
  return ["book", "call", "meeting", "scheduled"].some((word) => normalized.includes(word));
}

function isSignedStatus(value: string) {
  const normalized = value.toLowerCase();
  return ["exclusive", "non-exclusive", "non exclusive", "signed", "partner"].some((word) =>
    normalized.includes(word),
  );
}

function isEndedStatus(value: string) {
  const normalized = value.toLowerCase();
  return ["ended", "rejected", "not interested", "passed", "declined", "no"].some((word) =>
    normalized.includes(word),
  );
}

export function normalizeMemberDealRows(tabName: string, rows: SheetRow[]): Deal[] {
  const [headers, ...body] = rows;
  if (!headers) return [];

  const lookup = createColumnLookup<DashboardDealField>(headers, DEAL_COLUMN_ALIASES);

  return body
    .filter((row) => {
      const brand = getCell(row, lookup, "brand");
      const creator = getCell(row, lookup, "creator");
      const totalPricing = parseMoney(getCell(row, lookup, "totalPricingGbp"));
      return Boolean(brand || creator || totalPricing);
    })
    .map((row, index) => {
      const totalPricingGbp = parseMoney(getCell(row, lookup, "totalPricingGbp"));
      const creatorTotalGbp = parseMoney(getCell(row, lookup, "creatorTotalGbp"));
      const managerTotalGbp = parseMoney(getCell(row, lookup, "managerTotalGbp"));
      const profitMargin = getCell(row, lookup, "profitMargin");

      return {
        id: `${tabName}-${index + 1}`,
        rowNumber: getCell(row, lookup, "rowNumber") || `${index + 1}`,
        manager: tabName,
        brand: getCell(row, lookup, "brand"),
        creator: getCell(row, lookup, "creator"),
        platform: parsePlatform(getCell(row, lookup, "platform")),
        contractLink: getCell(row, lookup, "contractLink") || undefined,
        liveLink: getCell(row, lookup, "liveLink") || undefined,
        totalPricingGbp,
        creatorTotalGbp,
        profitMargin,
        managerTotalGbp,
        vnd: parseMoney(getCell(row, lookup, "vnd")),
        netTerms: getCell(row, lookup, "netTerms"),
        managerTotalPaid: parseBoolean(getCell(row, lookup, "managerTotalPaid")),
        managerPaidCurrentMonth: parseBoolean(getCell(row, lookup, "managerPaidCurrentMonth")),
        status: parseDealStatus(getCell(row, lookup, "status")),
        notes: getCell(row, lookup, "notes") || undefined,
      };
    })
    .filter((deal) => deal.status !== "Cancelled");
}

export function normalizeCreatorRows(rows: SheetRow[]): Creator[] {
  const [headers, ...body] = rows;
  if (!headers) return [];

  const lookup = createColumnLookup<DashboardCreatorField>(headers, CREATOR_COLUMN_ALIASES);

  return body
    .filter((row) => row.some(Boolean))
    .map((row, index) => ({
      id: `creator-${index + 1}`,
      handle: getCell(row, lookup, "handle"),
      owner: canonicalMemberName(getCell(row, lookup, "owner")),
      platform: parsePlatform(getCell(row, lookup, "platform")),
      niche: getCell(row, lookup, "niche"),
      base: getCell(row, lookup, "base") || undefined,
      email: getCell(row, lookup, "email") || undefined,
      tiktokLink: getCell(row, lookup, "tiktokLink") || undefined,
      instagramLink: getCell(row, lookup, "instagramLink") || undefined,
      youtubeLink: getCell(row, lookup, "youtubeLink") || undefined,
      estimatedRate: getCell(row, lookup, "estimatedRate") || undefined,
      songPromoRate: getCell(row, lookup, "songPromoRate") || undefined,
      followers: parseInteger(getCell(row, lookup, "followers")),
      relationship: parseRelationship(getCell(row, lookup, "relationship")),
      status: parseCreatorStatus(getCell(row, lookup, "status")) || "Active",
      activeDeals: parseInteger(getCell(row, lookup, "activeDeals")),
      revenue: parseMoney(getCell(row, lookup, "revenue")),
      notes: getCell(row, lookup, "notes") || undefined,
    }));
}

export function normalizeMemberOutreachRows(tabName: string, rows: SheetRow[]): OutreachRow[] {
  const [headers, ...body] = rows;
  if (!headers) return [];

  const lookup = createColumnLookup<OutreachField>(headers, OUTREACH_COLUMN_ALIASES);
  const memberName = canonicalMemberName(tabName);

  return body
    .filter((row) => hasUsefulOutreachContact(row, lookup))
    .map((row, index) => {
      const finalStatus = getCell(row, lookup, "finalStatus");
      const notes = getFallbackCell(row, lookup.notes, 13);

      return {
        id: `${memberName}-outreach-${index + 1}`,
        memberName,
        outreachType: getCell(row, lookup, "outreachType"),
        name: getCell(row, lookup, "name"),
        tiktokLink: getCell(row, lookup, "tiktokLink") || undefined,
        instagramLink: getCell(row, lookup, "instagramLink") || undefined,
        youtubeLink: getCell(row, lookup, "youtubeLink") || undefined,
        email: getCell(row, lookup, "email") || undefined,
        niche: getCell(row, lookup, "niche"),
        mainPlatform: parsePlatform(getCell(row, lookup, "mainPlatform")),
        emailed: parseBoolean(getCell(row, lookup, "emailed")),
        igOutreach: parseBoolean(getCell(row, lookup, "igOutreach")),
        replied: parseBoolean(getCell(row, lookup, "replied")),
        finalStatus,
        bookedCall: isBookedCallStatus(finalStatus),
        signedFromStatus: isSignedStatus(finalStatus),
        ended: isEndedStatus(finalStatus),
        timeLog: getCell(row, lookup, "timeLog") || undefined,
        notes: notes || undefined,
      };
    });
}
