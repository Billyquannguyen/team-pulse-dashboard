import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHeaderLookup, getHeaderCell, type HeaderLookup } from "@/lib/sheet-headers";

export const CREATOR_PROFILES_TAB_NAME = "Creator Profiles";
export const CREATOR_PROFILES_SPREADSHEET_ENV = "TEAM_ASSETS_SPREADSHEET_ID";

export type CreatorProfileType = "Exclusive" | "Partnered";

export type CreatorProfile = {
  creatorId: string;
  rowNumber: number;
  creatorName: string;
  location: string;
  nicheTags: string;
  nicheDetail: string;
  mainPlatform: string;
  ttFollowing: number;
  ttLink: string;
  instaFollowing: number;
  instaLink: string;
  ytFollowing: number;
  ytLink: string;
  analytics: string;
  type: CreatorProfileType;
  exclusiveTier: string;
  talentManager: string;
  gender: string;
  active: boolean;
  reviewStatus: "Ready" | "Needs Review";
  dataIssues: string;
  sourceTabs: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

type CreatorProfileField = Exclude<keyof CreatorProfile, "rowNumber">;

const CREATOR_PROFILE_HEADERS: Record<CreatorProfileField, string> = {
  creatorId: "Creator ID",
  creatorName: "Creator Name",
  location: "Location",
  nicheTags: "Niche Tags",
  nicheDetail: "Niche Detail",
  mainPlatform: "Main Platform",
  ttFollowing: "TT Following",
  ttLink: "TT Link",
  instaFollowing: "Insta Following",
  instaLink: "Insta Link",
  ytFollowing: "YT Following",
  ytLink: "YT Link",
  analytics: "Analytics",
  type: "Type",
  exclusiveTier: "Exclusive Tier",
  talentManager: "Talent Manager",
  gender: "Gender",
  active: "Active",
  reviewStatus: "Review Status",
  dataIssues: "Data Issues",
  sourceTabs: "Source Tabs",
  createdAt: "Created At",
  updatedAt: "Updated At",
  updatedBy: "Updated By",
};

const CREATOR_PROFILE_ALIASES = Object.fromEntries(
  Object.entries(CREATOR_PROFILE_HEADERS).map(([field, header]) => [field, [header, field]]),
) as Record<CreatorProfileField, string[]>;

const urlField = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => !value || /^https?:\/\//i.test(value), "Enter a complete URL or leave blank.");

const profileInput = z.object({
  creatorName: z.string().trim().min(1).max(220),
  location: z.string().trim().max(160).default(""),
  nicheTags: z.string().trim().max(800).default(""),
  nicheDetail: z.string().trim().max(800).default(""),
  mainPlatform: z.string().trim().max(80).default(""),
  ttFollowing: z.number().int().min(0).max(2_000_000_000).default(0),
  ttLink: urlField.default(""),
  instaFollowing: z.number().int().min(0).max(2_000_000_000).default(0),
  instaLink: urlField.default(""),
  ytFollowing: z.number().int().min(0).max(2_000_000_000).default(0),
  ytLink: urlField.default(""),
  analytics: urlField.default(""),
  type: z.enum(["Exclusive", "Partnered"]),
  exclusiveTier: z.string().trim().max(80).default(""),
  talentManager: z.string().trim().max(160).default(""),
  gender: z.string().trim().max(80).default(""),
  active: z.boolean().default(true),
  reviewStatus: z.enum(["Ready", "Needs Review"]).default("Ready"),
  dataIssues: z.string().trim().max(2000).default(""),
  updatedBy: z.string().trim().max(160).default("Team member"),
});

const updateProfileInput = profileInput.extend({
  creatorId: z.string().trim().min(1).max(80),
  rowNumber: z.number().int().min(2),
  createdAt: z.string().trim().max(40),
  sourceTabs: z.string().trim().max(800).default(""),
});

type ProfileInput = z.infer<typeof profileInput>;
type UpdateProfileInput = z.infer<typeof updateProfileInput>;

type CreatorProfileWorksheet = {
  sheet: { memberName: string; sheetName: string; gid?: string };
  headers: string[];
  rows: string[][];
};

export type CreatorProfilesData = {
  profiles: CreatorProfile[];
  source: "google-sheet" | "error";
  error?: string;
  sheetUrl?: string;
  updatedAt: string;
};

const CACHE_TTL_MS = 60_000;
let cache: { data: CreatorProfilesData; expiresAt: number } | null = null;
let refreshPromise: Promise<CreatorProfilesData> | null = null;

const getGoogleSheetsServer = createServerOnlyFn(async () => import("@/lib/google-sheets.server"));

function compactKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function numberValue(value: string) {
  const number = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function booleanValue(value: string) {
  return /^(true|yes|1|active)$/i.test(value.trim());
}

function buildLookup(headers: string[]) {
  return createHeaderLookup<CreatorProfileField>(headers, CREATOR_PROFILE_ALIASES);
}

function cell(
  row: string[],
  lookup: HeaderLookup<CreatorProfileField>,
  field: CreatorProfileField,
) {
  return getHeaderCell(row, lookup, field);
}

function normalizeProfileRow(
  row: string[],
  index: number,
  lookup: HeaderLookup<CreatorProfileField>,
): CreatorProfile | null {
  const creatorId = cell(row, lookup, "creatorId");
  const creatorName = cell(row, lookup, "creatorName");
  if (!creatorId && !creatorName) return null;

  return {
    creatorId,
    rowNumber: index + 2,
    creatorName,
    location: cell(row, lookup, "location"),
    nicheTags: cell(row, lookup, "nicheTags"),
    nicheDetail: cell(row, lookup, "nicheDetail"),
    mainPlatform: cell(row, lookup, "mainPlatform"),
    ttFollowing: numberValue(cell(row, lookup, "ttFollowing")),
    ttLink: cell(row, lookup, "ttLink"),
    instaFollowing: numberValue(cell(row, lookup, "instaFollowing")),
    instaLink: cell(row, lookup, "instaLink"),
    ytFollowing: numberValue(cell(row, lookup, "ytFollowing")),
    ytLink: cell(row, lookup, "ytLink"),
    analytics: cell(row, lookup, "analytics"),
    type: cell(row, lookup, "type") === "Exclusive" ? "Exclusive" : "Partnered",
    exclusiveTier: cell(row, lookup, "exclusiveTier"),
    talentManager: cell(row, lookup, "talentManager"),
    gender: cell(row, lookup, "gender"),
    active: booleanValue(cell(row, lookup, "active")),
    reviewStatus: cell(row, lookup, "reviewStatus") === "Needs Review" ? "Needs Review" : "Ready",
    dataIssues: cell(row, lookup, "dataIssues"),
    sourceTabs: cell(row, lookup, "sourceTabs"),
    createdAt: cell(row, lookup, "createdAt"),
    updatedAt: cell(row, lookup, "updatedAt"),
    updatedBy: cell(row, lookup, "updatedBy"),
  };
}

function normalizeProfiles(headers: string[], rows: string[][]) {
  const lookup = buildLookup(headers);
  return rows
    .map((row, index) => normalizeProfileRow(row, index, lookup))
    .filter((profile): profile is CreatorProfile => profile !== null);
}

function requiredHeadersPresent(headers: string[]) {
  const lookup = buildLookup(headers);
  return (Object.keys(CREATOR_PROFILE_HEADERS) as CreatorProfileField[]).every(
    (field) => lookup[field] !== undefined,
  );
}

function sheetUrl(spreadsheetId: string, gid?: string) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${gid ? `#gid=${gid}` : ""}`;
}

function spreadsheetId() {
  return process.env[CREATOR_PROFILES_SPREADSHEET_ENV]?.trim() ?? "";
}

async function loadWorksheet(): Promise<CreatorProfileWorksheet> {
  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();
  const id = spreadsheetId();
  if (!id) throw new Error(`Missing ${CREATOR_PROFILES_SPREADSHEET_ENV}.`);

  const tabs = await googleSheets.fetchSpreadsheetTabs(config, id);
  const matched = tabs.find(
    (tab) => compactKey(tab.sheetName) === compactKey(CREATOR_PROFILES_TAB_NAME),
  );
  if (!matched) throw new Error(`Could not find the ${CREATOR_PROFILES_TAB_NAME} worksheet.`);

  const sheet = {
    memberName: CREATOR_PROFILES_TAB_NAME,
    sheetName: matched.sheetName,
    gid: matched.gid,
  };
  const rows = await googleSheets.fetchSheetRows(config, id, sheet);
  if (!requiredHeadersPresent(rows.headers)) {
    throw new Error(`${CREATOR_PROFILES_TAB_NAME} has missing or renamed headers.`);
  }

  return { sheet, headers: rows.headers, rows: rows.rows };
}

async function readData(): Promise<CreatorProfilesData> {
  const worksheet = await loadWorksheet();
  const profiles = normalizeProfiles(worksheet.headers, worksheet.rows);
  return {
    profiles,
    source: "google-sheet",
    sheetUrl: sheetUrl(spreadsheetId(), worksheet.sheet.gid),
    updatedAt: new Date().toISOString(),
  };
}

async function cachedData() {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  if (!refreshPromise) {
    refreshPromise = readData()
      .then((data) => {
        cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function invalidateCache() {
  cache = null;
  refreshPromise = null;
}

function nextCreatorId() {
  return `CR-${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function rowFromProfile(headers: string[], profile: CreatorProfile) {
  const lookup = buildLookup(headers);
  const values: Record<CreatorProfileField, string> = {
    creatorId: profile.creatorId,
    creatorName: profile.creatorName,
    location: profile.location,
    nicheTags: profile.nicheTags,
    nicheDetail: profile.nicheDetail,
    mainPlatform: profile.mainPlatform,
    ttFollowing: profile.ttFollowing ? String(profile.ttFollowing) : "",
    ttLink: profile.ttLink,
    instaFollowing: profile.instaFollowing ? String(profile.instaFollowing) : "",
    instaLink: profile.instaLink,
    ytFollowing: profile.ytFollowing ? String(profile.ytFollowing) : "",
    ytLink: profile.ytLink,
    analytics: profile.analytics,
    type: profile.type,
    exclusiveTier: profile.type === "Exclusive" ? profile.exclusiveTier : "",
    talentManager: profile.talentManager,
    gender: profile.gender,
    active: profile.active ? "TRUE" : "FALSE",
    reviewStatus: profile.reviewStatus,
    dataIssues: profile.dataIssues,
    sourceTabs: profile.sourceTabs,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    updatedBy: profile.updatedBy,
  };
  const row = Array.from({ length: headers.length }, () => "");
  (Object.keys(values) as CreatorProfileField[]).forEach((field) => {
    const index = lookup[field];
    if (index !== undefined) row[index] = values[field];
  });
  return row;
}

function profileFromInput(input: ProfileInput, existing?: CreatorProfile): CreatorProfile {
  const today = new Date().toISOString().slice(0, 10);
  return {
    creatorId: existing?.creatorId ?? nextCreatorId(),
    rowNumber: existing?.rowNumber ?? 0,
    creatorName: input.creatorName,
    location: input.location,
    nicheTags: input.nicheTags,
    nicheDetail: input.nicheDetail,
    mainPlatform: input.mainPlatform,
    ttFollowing: input.ttFollowing,
    ttLink: input.ttLink,
    instaFollowing: input.instaFollowing,
    instaLink: input.instaLink,
    ytFollowing: input.ytFollowing,
    ytLink: input.ytLink,
    analytics: input.analytics,
    type: input.type,
    exclusiveTier: input.type === "Exclusive" ? input.exclusiveTier : "",
    talentManager: input.talentManager,
    gender: input.gender,
    active: input.active,
    reviewStatus: input.reviewStatus,
    dataIssues: input.dataIssues,
    sourceTabs: existing?.sourceTabs ?? "Created in app",
    createdAt: existing?.createdAt || today,
    updatedAt: today,
    updatedBy: input.updatedBy || "Team member",
  };
}

function normalizedUrl(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "");
}

function assertNoDuplicate(profiles: CreatorProfile[], candidate: CreatorProfile) {
  const candidateLinks = [candidate.ttLink, candidate.instaLink, candidate.ytLink]
    .map(normalizedUrl)
    .filter(Boolean);
  const duplicate = profiles.find(
    (profile) =>
      profile.creatorId !== candidate.creatorId &&
      [profile.ttLink, profile.instaLink, profile.ytLink]
        .map(normalizedUrl)
        .some((link) => link && candidateLinks.includes(link)),
  );
  if (duplicate)
    throw new Error(`This social account already belongs to ${duplicate.creatorName}.`);
}

export const fetchCreatorProfiles = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  try {
    return await cachedData();
  } catch (error) {
    return {
      profiles: [],
      source: "error" as const,
      error: error instanceof Error ? error.message : String(error),
      sheetUrl: spreadsheetId() ? sheetUrl(spreadsheetId()) : undefined,
      updatedAt: new Date().toISOString(),
    };
  }
});

export const createCreatorProfile = createServerFn({ method: "POST" })
  .inputValidator(profileInput)
  .handler(async ({ data }) => {
    const { requireWritableDashboardAuth } = await import("@/lib/auth.server");
    await requireWritableDashboardAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const worksheet = await loadWorksheet();
    const existing = normalizeProfiles(worksheet.headers, worksheet.rows);
    const profile = profileFromInput(data);
    assertNoDuplicate(existing, profile);
    await googleSheets.appendSheetRow(
      config,
      spreadsheetId(),
      worksheet.sheet,
      rowFromProfile(worksheet.headers, profile),
    );
    invalidateCache();
    return { ok: true as const, creatorId: profile.creatorId };
  });

export const updateCreatorProfile = createServerFn({ method: "POST" })
  .inputValidator(updateProfileInput)
  .handler(async ({ data }) => {
    const { requireWritableDashboardAuth } = await import("@/lib/auth.server");
    await requireWritableDashboardAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const worksheet = await loadWorksheet();
    const profiles = normalizeProfiles(worksheet.headers, worksheet.rows);
    const existing = profiles.find(
      (profile) => profile.creatorId === data.creatorId && profile.rowNumber === data.rowNumber,
    );
    if (!existing) throw new Error("Creator profile could not be found. Refresh and try again.");
    const profile = profileFromInput(data as UpdateProfileInput, {
      ...existing,
      createdAt: data.createdAt,
      sourceTabs: data.sourceTabs,
    });
    assertNoDuplicate(profiles, profile);
    await googleSheets.updateSheetRow(
      config,
      spreadsheetId(),
      worksheet.sheet,
      data.rowNumber,
      rowFromProfile(worksheet.headers, profile),
    );
    invalidateCache();
    return { ok: true as const };
  });

export const creatorProfilesQuery = {
  queryKey: ["team-billion-creator-profiles", "google-sheet-v1"],
  queryFn: () => fetchCreatorProfiles(),
  staleTime: CACHE_TTL_MS,
};
