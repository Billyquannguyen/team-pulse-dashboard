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
import {
  createHeaderLookup,
  getHeaderCell,
  getMissingHeaders,
  hasAnyHeaderAlias,
  hasHeaderAlias,
} from "@/lib/sheet-headers";

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

const REQUIRED_OUTREACH_FIELDS: OutreachField[] = [
  "emailed",
  "igOutreach",
  "replied",
  "bookedCall",
  "finalStatus",
];

const REQUIRED_DEAL_FIELDS: DashboardDealField[] = [
  "brand",
  "creator",
  "status",
  "totalPricingGbp",
  "managerTotalGbp",
];

const REQUIRED_CREATOR_FIELDS: DashboardCreatorField[] = ["handle", "owner", "relationship"];

const DEAL_FIELD_LABELS: Record<DashboardDealField, string> = {
  rowNumber: "No.",
  brand: "Brand name",
  creator: "Creator",
  platform: "Platform",
  contractLink: "Contract link",
  status: "Status",
  liveLink: "Live link",
  totalPricingGbp: "Total pricing",
  creatorTotalGbp: "Creator total",
  profitMargin: "Profit margin",
  managerTotalGbp: "Manager total",
  vnd: "VND",
  netTerms: "Net terms",
  managerTotalPaid: "Manager total paid",
  managerPaidCurrentMonth: "Manager paid current month",
  notes: "Notes",
};

const CREATOR_FIELD_LABELS: Record<DashboardCreatorField, string> = {
  handle: "Creator",
  base: "Base",
  owner: "Owner",
  tiktokLink: "TikTok link",
  instagramLink: "Instagram link",
  youtubeLink: "YouTube link",
  email: "Email",
  platform: "Platform",
  niche: "Niche",
  followers: "Followers",
  relationship: "Relationship",
  estimatedRate: "Estimated rate",
  songPromoRate: "Song promo rate",
  activeDeals: "Active deals",
  revenue: "Revenue",
  status: "Status",
  notes: "Notes",
};

const OUTREACH_FIELD_LABELS: Record<OutreachField, string> = {
  outreachType: "Outreach type",
  name: "Name",
  tiktokLink: "TikTok link",
  instagramLink: "Instagram link",
  youtubeLink: "YouTube link",
  email: "Email",
  niche: "Niche",
  mainPlatform: "Main platform",
  emailed: "Emailed",
  igOutreach: "IG outreach",
  replied: "Replied",
  bookedCall: "Booked call",
  finalStatus: "Final status",
  timeLog: "Time log",
  notes: "Notes",
};

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
  return ["true", "yes", "y", "1", "paid", "done", "checked", "x", "✓"].includes(normalized);
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
    getHeaderCell(row, lookup, "name") ||
    getHeaderCell(row, lookup, "email") ||
    getHeaderCell(row, lookup, "tiktokLink") ||
    getHeaderCell(row, lookup, "instagramLink") ||
    getHeaderCell(row, lookup, "youtubeLink"),
  );
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
  return ["ended", "rejected", "not interested", "passed", "declined", "no response"].some((word) =>
    normalized.includes(word),
  );
}

function isBookedCallActivity(bookedCallValue: string, finalStatus: string, replied: boolean) {
  if (parseBoolean(bookedCallValue)) return true;
  if (isBookedCallStatus(finalStatus) || isSignedStatus(finalStatus)) return true;

  // In the sourcing sheet, Ended is a post-conversation outcome, not "no call happened".
  return replied && isEndedStatus(finalStatus);
}

export function getMissingOutreachHeaders(headers: string[]) {
  return getMissingHeaders(
    headers,
    OUTREACH_COLUMN_ALIASES,
    REQUIRED_OUTREACH_FIELDS,
    OUTREACH_FIELD_LABELS,
  );
}

export function getMissingDealHeaders(headers: string[]) {
  return getMissingHeaders(headers, DEAL_COLUMN_ALIASES, REQUIRED_DEAL_FIELDS, DEAL_FIELD_LABELS);
}

export function getMissingCreatorHeaders(headers: string[]) {
  return getMissingHeaders(
    headers,
    CREATOR_COLUMN_ALIASES,
    REQUIRED_CREATOR_FIELDS,
    CREATOR_FIELD_LABELS,
  );
}

export function isDealWorksheetHeader(headers: string[]) {
  return getMissingDealHeaders(headers).length === 0;
}

export function isOutreachWorksheetHeader(headers: string[]) {
  const hasContactHeader = hasAnyHeaderAlias(headers, OUTREACH_COLUMN_ALIASES, [
    "name",
    "email",
    "tiktokLink",
    "instagramLink",
    "youtubeLink",
  ]);
  const hasMetricHeader =
    hasHeaderAlias(headers, OUTREACH_COLUMN_ALIASES, "emailed") ||
    hasHeaderAlias(headers, OUTREACH_COLUMN_ALIASES, "igOutreach") ||
    hasHeaderAlias(headers, OUTREACH_COLUMN_ALIASES, "replied") ||
    hasHeaderAlias(headers, OUTREACH_COLUMN_ALIASES, "finalStatus");

  return hasContactHeader && hasMetricHeader;
}

export function normalizeMemberDealRows(tabName: string, rows: SheetRow[]): Deal[] {
  const [headers, ...body] = rows;
  if (!headers) return [];

  const lookup = createHeaderLookup<DashboardDealField>(headers, DEAL_COLUMN_ALIASES);

  return body
    .filter((row) => {
      const brand = getHeaderCell(row, lookup, "brand");
      const creator = getHeaderCell(row, lookup, "creator");
      const totalPricing = parseMoney(getHeaderCell(row, lookup, "totalPricingGbp"));
      return Boolean(brand || creator || totalPricing);
    })
    .map((row, index) => {
      const totalPricingGbp = parseMoney(getHeaderCell(row, lookup, "totalPricingGbp"));
      const creatorTotalGbp = parseMoney(getHeaderCell(row, lookup, "creatorTotalGbp"));
      const managerTotalGbp = parseMoney(getHeaderCell(row, lookup, "managerTotalGbp"));
      const profitMargin = getHeaderCell(row, lookup, "profitMargin");

      return {
        id: `${tabName}-${index + 1}`,
        rowNumber: getHeaderCell(row, lookup, "rowNumber") || `${index + 1}`,
        manager: tabName,
        brand: getHeaderCell(row, lookup, "brand"),
        creator: getHeaderCell(row, lookup, "creator"),
        platform: parsePlatform(getHeaderCell(row, lookup, "platform")),
        contractLink: getHeaderCell(row, lookup, "contractLink") || undefined,
        liveLink: getHeaderCell(row, lookup, "liveLink") || undefined,
        totalPricingGbp,
        creatorTotalGbp,
        profitMargin,
        managerTotalGbp,
        vnd: parseMoney(getHeaderCell(row, lookup, "vnd")),
        netTerms: getHeaderCell(row, lookup, "netTerms"),
        managerTotalPaid: parseBoolean(getHeaderCell(row, lookup, "managerTotalPaid")),
        managerPaidCurrentMonth: parseBoolean(getHeaderCell(row, lookup, "managerPaidCurrentMonth")),
        status: parseDealStatus(getHeaderCell(row, lookup, "status")),
        notes: getHeaderCell(row, lookup, "notes") || undefined,
      };
    })
    .filter((deal) => deal.status !== "Cancelled");
}

export function normalizeCreatorRows(rows: SheetRow[]): Creator[] {
  const [headers, ...body] = rows;
  if (!headers) return [];

  const lookup = createHeaderLookup<DashboardCreatorField>(headers, CREATOR_COLUMN_ALIASES);

  return body
    .filter((row) => row.some(Boolean))
    .map((row, index) => ({
      id: `creator-${index + 1}`,
      handle: getHeaderCell(row, lookup, "handle"),
      owner: canonicalMemberName(getHeaderCell(row, lookup, "owner")),
      platform: parsePlatform(getHeaderCell(row, lookup, "platform")),
      niche: getHeaderCell(row, lookup, "niche"),
      base: getHeaderCell(row, lookup, "base") || undefined,
      email: getHeaderCell(row, lookup, "email") || undefined,
      tiktokLink: getHeaderCell(row, lookup, "tiktokLink") || undefined,
      instagramLink: getHeaderCell(row, lookup, "instagramLink") || undefined,
      youtubeLink: getHeaderCell(row, lookup, "youtubeLink") || undefined,
      estimatedRate: getHeaderCell(row, lookup, "estimatedRate") || undefined,
      songPromoRate: getHeaderCell(row, lookup, "songPromoRate") || undefined,
      followers: parseInteger(getHeaderCell(row, lookup, "followers")),
      relationship: parseRelationship(getHeaderCell(row, lookup, "relationship")),
      status: parseCreatorStatus(getHeaderCell(row, lookup, "status")) || "Active",
      activeDeals: parseInteger(getHeaderCell(row, lookup, "activeDeals")),
      revenue: parseMoney(getHeaderCell(row, lookup, "revenue")),
      notes: getHeaderCell(row, lookup, "notes") || undefined,
    }));
}

export function normalizeMemberOutreachRows(tabName: string, rows: SheetRow[]): OutreachRow[] {
  const [headers, ...body] = rows;
  if (!headers) return [];

  const lookup = createHeaderLookup<OutreachField>(headers, OUTREACH_COLUMN_ALIASES);
  const memberName = canonicalMemberName(tabName);

  return body
    .filter((row) => hasUsefulOutreachContact(row, lookup))
    .map((row, index) => {
      const finalStatus = getHeaderCell(row, lookup, "finalStatus");
      const hasBookedCallColumn = lookup.bookedCall !== undefined && lookup.bookedCall >= 0;
      const bookedCallValue = getHeaderCell(row, lookup, "bookedCall");
      const emailed = parseBoolean(getHeaderCell(row, lookup, "emailed"));
      const igOutreach = parseBoolean(getHeaderCell(row, lookup, "igOutreach"));
      const replied = parseBoolean(getHeaderCell(row, lookup, "replied"));
      const bookedCall = hasBookedCallColumn
        ? isBookedCallActivity(bookedCallValue, finalStatus, replied)
        : isBookedCallActivity("", finalStatus, replied);
      const notes = getHeaderCell(row, lookup, "notes");

      return {
        id: `${memberName}-outreach-${index + 1}`,
        memberName,
        outreachType: getHeaderCell(row, lookup, "outreachType"),
        name: getHeaderCell(row, lookup, "name"),
        tiktokLink: getHeaderCell(row, lookup, "tiktokLink") || undefined,
        instagramLink: getHeaderCell(row, lookup, "instagramLink") || undefined,
        youtubeLink: getHeaderCell(row, lookup, "youtubeLink") || undefined,
        email: getHeaderCell(row, lookup, "email") || undefined,
        niche: getHeaderCell(row, lookup, "niche"),
        mainPlatform: parsePlatform(getHeaderCell(row, lookup, "mainPlatform")),
        emailed,
        igOutreach,
        replied,
        finalStatus,
        bookedCall,
        signedFromStatus: isSignedStatus(finalStatus),
        ended: isEndedStatus(finalStatus),
        timeLog: getHeaderCell(row, lookup, "timeLog") || undefined,
        notes: notes || undefined,
      };
    });
}
