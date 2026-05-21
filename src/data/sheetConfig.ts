export const SIGNED_CREATORS_TAB_NAME = "Signed creators ";
export const IGNORED_OUTREACH_TAB_NAMES = ["Ex-managers", "Signed creators"];
export const SHEET_HEADER_ROW_NUMBER = 1;
export const MEMBER_SUMMARY_CELLS = {
  pendingOwed: "S2",
  paidCurrentMonth: "S4",
  paidTotal: "S6",
};

export const FALLBACK_MEMBER_SHEETS = [
  { name: "KTrang" },
  { name: "HYen" },
  { name: "BNgan" },
  { name: "LNgoc" },
];

export type DashboardDealField =
  | "rowNumber"
  | "brand"
  | "creator"
  | "platform"
  | "contractLink"
  | "status"
  | "liveLink"
  | "totalPricingGbp"
  | "creatorTotalGbp"
  | "profitMargin"
  | "managerTotalGbp"
  | "vnd"
  | "netTerms"
  | "managerTotalPaid"
  | "managerPaidCurrentMonth"
  | "notes";

// Add aliases here when the real sheet headers differ from the dashboard field
// names. Matching ignores spaces, punctuation, casing, and symbols.
export const DEAL_COLUMN_ALIASES: Record<DashboardDealField, string[]> = {
  rowNumber: ["no", "no.", "number", "#"],
  brand: ["brand name", "brand", "company", "client"],
  creator: ["creator", "influencer", "talent", "creator handle"],
  platform: ["platform", "channel", "social platform"],
  contractLink: ["contract link", "contract", "contract url"],
  status: ["status", "deal status", "stage"],
  liveLink: ["live link", "live url", "post link"],
  totalPricingGbp: ["total pricing", "total pricing £", "total pricing gbp", "total pricing (£)"],
  creatorTotalGbp: ["creator total", "creator total £", "creator total gbp", "creator total (£)"],
  profitMargin: ["profit margin", "profit margin %", "margin"],
  managerTotalGbp: [
    "manager total",
    "manager total £",
    "manager total gbp",
    "manager total (this is still in £ btw)",
  ],
  vnd: ["vnd", "manager total vnd"],
  netTerms: ["net terms", "payment terms", "terms"],
  managerTotalPaid: ["manager total paid", "manager paid", "paid"],
  managerPaidCurrentMonth: [
    "manager paid current month",
    "paid current month",
    "manager current month paid",
  ],
  notes: ["notes", "note", "comments"],
};

export type DashboardCreatorField =
  | "handle"
  | "base"
  | "owner"
  | "tiktokLink"
  | "instagramLink"
  | "youtubeLink"
  | "email"
  | "platform"
  | "niche"
  | "followers"
  | "relationship"
  | "estimatedRate"
  | "songPromoRate"
  | "activeDeals"
  | "revenue"
  | "status"
  | "notes";

export const CREATOR_COLUMN_ALIASES: Record<DashboardCreatorField, string[]> = {
  handle: ["creator", "handle", "creator handle", "influencer", "name"],
  base: ["base", "location", "country"],
  owner: ["owner", "closer", "member", "assigned to"],
  tiktokLink: ["tiktok link", "tiktok", "tik tok link"],
  instagramLink: ["instagram link", "instagram", "ig link"],
  youtubeLink: ["youtube link", "youtube", "yt link"],
  email: ["email", "email address"],
  platform: ["platform", "channel", "social platform", "main platform"],
  niche: ["niche", "category", "vertical"],
  followers: ["followers", "audience", "following"],
  relationship: ["relationship", "exclusivity", "exclusive", "creator type", "partnership type"],
  estimatedRate: ["estimated rate", "rate", "pricing"],
  songPromoRate: ["song promo rate", "song rate", "music rate"],
  activeDeals: ["active deals", "open deals", "deals"],
  revenue: ["revenue", "total revenue", "deal value"],
  status: ["status", "creator status", "stage"],
  notes: ["notes", "note", "comments"],
};

export type OutreachField =
  | "outreachType"
  | "name"
  | "tiktokLink"
  | "instagramLink"
  | "youtubeLink"
  | "email"
  | "niche"
  | "mainPlatform"
  | "emailed"
  | "igOutreach"
  | "replied"
  | "finalStatus"
  | "timeLog"
  | "notes";

export const OUTREACH_COLUMN_ALIASES: Record<OutreachField, string[]> = {
  outreachType: ["outreach type", "type"],
  name: ["name", "creator", "creator name"],
  tiktokLink: ["tiktok link", "tiktok", "tik tok link"],
  instagramLink: ["instagram link", "instagram", "ig link"],
  youtubeLink: ["youtube link", "youtube", "yt link"],
  email: ["email", "email address"],
  niche: ["niche", "category", "vertical"],
  mainPlatform: ["main platform", "platform", "channel"],
  emailed: ["emailed", "email sent"],
  igOutreach: ["ig outreach", "instagram outreach", "dm outreach"],
  replied: ["replied", "reply", "responded"],
  finalStatus: ["final status", "status", "outcome"],
  timeLog: ["time log", "timestamp", "date"],
  notes: ["notes", "note", "comments"],
};
