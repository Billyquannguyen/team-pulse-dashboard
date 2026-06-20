import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHeaderLookup, getHeaderCell } from "@/lib/sheet-headers";
import type { ExternalGptAssetLink } from "@/lib/team-asset-link-resolver";
import { resolveExternalGptLinksFromTeamAssets } from "@/lib/team-asset-link-resolver";

export type MeetingTopic = {
  id: string;
  weekKey: string;
  memberName: string;
  title: string;
  details: string;
  createdAt: string;
};

export type BillyAssistantHubDiagnostics = {
  checkedAt: string;
  storageConfigured: boolean;
  storageReadable: boolean;
  storageWritable: boolean;
  redisConfigured: boolean;
  redisReadable: boolean;
  redisWritable: boolean;
  storageMode: "google-sheet" | "redis" | "local-dev" | "unavailable";
  storageTabName: string;
  currentWeekKey: string;
  currentWeekStartsAtLabel: string;
  currentWeekTopicCount: number;
  lastSaveAt: string | null;
  lastSaveOk: boolean | null;
  lastSaveError: string | null;
  externalGptLinks: {
    contractReview: ExternalGptAssetLink;
    creatorBrandMatching: ExternalGptAssetLink;
    generalFaqs: ExternalGptAssetLink;
  };
};

type RedisEnv = {
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
};

type SaveDiagnostics = {
  savedAt: string;
  ok: boolean;
  error: string | null;
};

const REDIS_KEY_PREFIX = "team-billion:billy-gpt";
const MEETING_TOPICS_KEY_PREFIX = `${REDIS_KEY_PREFIX}:meeting-topics`;
const DIAGNOSTICS_KEY = `${REDIS_KEY_PREFIX}:diagnostics`;
const BERLIN_TIME_ZONE = "Europe/Berlin";
const TEAM_ASSETS_SPREADSHEET_ENV = "TEAM_ASSETS_SPREADSHEET_ID";
const MEETING_CONTENT_MEMORY_TAB_NAME = "Meeting Content Memory";

const MEETING_TOPIC_HEADERS = [
  "ID",
  "Week Key",
  "Member Name",
  "Topic Title",
  "Details",
  "Created At",
] as const;

type MeetingTopicField = "id" | "weekKey" | "memberName" | "title" | "details" | "createdAt";

const MEETING_TOPIC_COLUMN_ALIASES: Record<MeetingTopicField, string[]> = {
  id: ["id", "topic id"],
  weekKey: ["week key", "week", "meeting week"],
  memberName: ["member name", "member", "name"],
  title: ["topic title", "title", "topic"],
  details: ["details", "notes", "content"],
  createdAt: ["created at", "created", "timestamp"],
};

const saveMeetingTopicInput = z.object({
  memberName: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  details: z.string().trim().max(1200).default(""),
});

declare global {
  var __teamBillionBillyMeetingTopics: Map<string, MeetingTopic[]> | undefined;
  var __teamBillionBillySaveDiagnostics: SaveDiagnostics | null | undefined;
}

function getLocalTopicStore() {
  globalThis.__teamBillionBillyMeetingTopics ??= new Map<string, MeetingTopic[]>();
  return globalThis.__teamBillionBillyMeetingTopics;
}

function readEnv(): RedisEnv {
  return {
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "",
  };
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

function getRedisConfig(env = readEnv()) {
  if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) return null;

  return {
    url: env.upstashRedisRestUrl.replace(/\/+$/, ""),
    token: env.upstashRedisRestToken,
  };
}

function canUseLocalDevStore() {
  return !isProductionRuntime() && !getTeamAssetsSpreadsheetId() && !getRedisConfig();
}

function normalizeSheetKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getTeamAssetsSpreadsheetId() {
  return process.env[TEAM_ASSETS_SPREADSHEET_ENV]?.trim() ?? "";
}

const getGoogleSheetsServer = createServerOnlyFn(async () => import("@/lib/google-sheets.server"));

function getMeetingContentMemorySheet(tabs: Array<{ sheetName: string; gid?: string }>) {
  const expectedKey = normalizeSheetKey(MEETING_CONTENT_MEMORY_TAB_NAME);
  const matchedTab = tabs.find((tab) => normalizeSheetKey(tab.sheetName) === expectedKey);

  if (!matchedTab) return null;

  return {
    memberName: MEETING_CONTENT_MEMORY_TAB_NAME,
    sheetName: matchedTab.sheetName,
    gid: matchedTab.gid,
  };
}

async function loadMeetingContentMemoryWorksheet(options: { createIfMissing?: boolean } = {}) {
  const spreadsheetId = getTeamAssetsSpreadsheetId();

  if (!spreadsheetId) {
    throw new Error(`Missing required Google Sheets env var: ${TEAM_ASSETS_SPREADSHEET_ENV}`);
  }

  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();
  let tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
  let sheet = getMeetingContentMemorySheet(tabs);

  if (!sheet && options.createIfMissing) {
    await googleSheets.createSheetTab(config, spreadsheetId, MEETING_CONTENT_MEMORY_TAB_NAME);
    tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
    sheet = getMeetingContentMemorySheet(tabs);
  }

  if (!sheet) {
    throw new Error(
      `Could not find a worksheet tab named "${MEETING_CONTENT_MEMORY_TAB_NAME}" in ${TEAM_ASSETS_SPREADSHEET_ENV}.`,
    );
  }

  const [sheetRows] = await googleSheets.fetchSheetRowsBatch(config, spreadsheetId, [sheet]);
  const headers = sheetRows?.headers ?? [];
  const rows = sheetRows?.rows ?? [];
  const hasHeaders = MEETING_TOPIC_HEADERS.every(
    (header, index) => normalizeSheetKey(headers[index] ?? "") === normalizeSheetKey(header),
  );

  if (!hasHeaders) {
    await googleSheets.updateSheetRow(config, spreadsheetId, sheet, 1, [...MEETING_TOPIC_HEADERS]);
  }

  return {
    googleSheets,
    config,
    spreadsheetId,
    sheet,
    headers: hasHeaders ? headers : [...MEETING_TOPIC_HEADERS],
    rows,
  };
}

function normalizeMeetingTopic(headers: string[], row: string[], index: number): MeetingTopic | null {
  const lookup = createHeaderLookup(headers, MEETING_TOPIC_COLUMN_ALIASES);
  const weekKey = getHeaderCell(row, lookup, "weekKey");
  const memberName = getHeaderCell(row, lookup, "memberName");
  const title = getHeaderCell(row, lookup, "title");
  const createdAt = getHeaderCell(row, lookup, "createdAt");

  if (!weekKey || !memberName || !title || !createdAt) return null;

  return {
    id: getHeaderCell(row, lookup, "id") || `meeting-topic-row-${index + 2}`,
    weekKey,
    memberName,
    title,
    details: getHeaderCell(row, lookup, "details"),
    createdAt,
  };
}

function buildMeetingTopicRow(topic: MeetingTopic) {
  return [topic.id, topic.weekKey, topic.memberName, topic.title, topic.details, topic.createdAt];
}

function getBerlinParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function formatDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCurrentMeetingWeek() {
  const berlin = getBerlinParts();
  const berlinDateAsUtc = new Date(Date.UTC(berlin.year, berlin.month - 1, berlin.day));
  const berlinDayOfWeek = berlinDateAsUtc.getUTCDay();
  const daysSinceReset = berlinDayOfWeek === 0 && berlin.hour < 12 ? 7 : berlinDayOfWeek;
  const resetDate = new Date(Date.UTC(berlin.year, berlin.month - 1, berlin.day - daysSinceReset));
  const weekStartDate = formatDateKey(resetDate);

  return {
    weekKey: weekStartDate,
    label: `${weekStartDate} Sunday 12:00 Germany time`,
  };
}

function meetingTopicsKey(weekKey: string) {
  return `${MEETING_TOPICS_KEY_PREFIX}:${weekKey}`;
}

async function redisCommand<T>(command: Array<string | number>) {
  const config = getRedisConfig();

  if (!config) {
    throw new Error("Upstash Redis REST env vars are missing.");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: T;
    error?: string;
  } | null;

  if (!response.ok || payload?.error) {
    throw new Error(payload?.error ?? `Redis request failed with ${response.status}.`);
  }

  return payload?.result as T;
}

async function readSaveDiagnostics() {
  if (canUseLocalDevStore()) {
    return globalThis.__teamBillionBillySaveDiagnostics ?? null;
  }

  if (!getRedisConfig()) return null;

  const value = await redisCommand<string | null>(["GET", DIAGNOSTICS_KEY]).catch(() => null);
  if (!value) return null;

  try {
    return JSON.parse(value) as SaveDiagnostics;
  } catch {
    return null;
  }
}

async function writeSaveDiagnostics(diagnostics: SaveDiagnostics) {
  if (canUseLocalDevStore()) {
    globalThis.__teamBillionBillySaveDiagnostics = diagnostics;
    return;
  }

  if (!getRedisConfig()) return;

  await redisCommand<"OK">(["SET", DIAGNOSTICS_KEY, JSON.stringify(diagnostics)]).catch(() => {
    // Diagnostics are useful, but topic saving should not fail because this write failed.
  });
}

async function readCurrentWeekTopics() {
  const { weekKey } = getCurrentMeetingWeek();

  if (getTeamAssetsSpreadsheetId()) {
    const worksheet = await loadMeetingContentMemoryWorksheet();

    return worksheet.rows
      .map((row, index) => normalizeMeetingTopic(worksheet.headers, row, index))
      .filter((topic): topic is MeetingTopic => Boolean(topic))
      .filter((topic) => topic.weekKey === weekKey);
  }

  if (canUseLocalDevStore()) {
    return getLocalTopicStore().get(weekKey) ?? [];
  }

  if (!getRedisConfig()) {
    return [];
  }

  const rows = await redisCommand<string[]>(["LRANGE", meetingTopicsKey(weekKey), 0, -1]);

  return rows
    .map((row) => {
      try {
        return JSON.parse(row) as MeetingTopic;
      } catch {
        return null;
      }
    })
    .filter((topic): topic is MeetingTopic => Boolean(topic));
}

async function appendMeetingTopic(topic: MeetingTopic) {
  if (getTeamAssetsSpreadsheetId()) {
    const worksheet = await loadMeetingContentMemoryWorksheet({ createIfMissing: true });
    await worksheet.googleSheets.appendSheetRow(
      worksheet.config,
      worksheet.spreadsheetId,
      worksheet.sheet,
      buildMeetingTopicRow(topic),
    );
    return;
  }

  if (canUseLocalDevStore()) {
    const store = getLocalTopicStore();
    store.set(topic.weekKey, [...(store.get(topic.weekKey) ?? []), topic]);
    return;
  }

  if (!getRedisConfig()) {
    throw new Error("Meeting topic storage is not configured. Add Upstash Redis env vars.");
  }

  await redisCommand<number>(["RPUSH", meetingTopicsKey(topic.weekKey), JSON.stringify(topic)]);
}

export function getBillyAssistantEnvDiagnostics() {
  const env = readEnv();

  return [
    {
      name: TEAM_ASSETS_SPREADSHEET_ENV,
      exists: Boolean(getTeamAssetsSpreadsheetId()),
    },
    { name: "UPSTASH_REDIS_REST_URL", exists: Boolean(env.upstashRedisRestUrl) },
    { name: "UPSTASH_REDIS_REST_TOKEN", exists: Boolean(env.upstashRedisRestToken) },
  ];
}

export async function getBillyAssistantHubDiagnosticsData(): Promise<BillyAssistantHubDiagnostics> {
  const env = readEnv();
  const redisConfigured = Boolean(getRedisConfig(env));
  const storageConfigured = Boolean(getTeamAssetsSpreadsheetId());
  const week = getCurrentMeetingWeek();
  const saveDiagnostics = await readSaveDiagnostics();
  let redisReadable = false;
  let redisWritable = false;
  let storageReadable = false;
  let storageWritable = false;
  let topicCount = 0;
  let storageMode: BillyAssistantHubDiagnostics["storageMode"] = "unavailable";
  let externalGptLinks = resolveExternalGptLinksFromTeamAssets([]);

  if (storageConfigured) {
    storageMode = "google-sheet";

    try {
      topicCount = (await readCurrentWeekTopics()).length;
      storageReadable = true;
      storageWritable = true;
    } catch {
      storageReadable = false;
      storageWritable = false;
    }
  } else if (canUseLocalDevStore()) {
    redisReadable = true;
    redisWritable = true;
    storageReadable = true;
    storageWritable = true;
    storageMode = "local-dev";
    topicCount = (getLocalTopicStore().get(week.weekKey) ?? []).length;
  } else if (redisConfigured) {
    storageMode = "redis";

    try {
      topicCount = await redisCommand<number>(["LLEN", meetingTopicsKey(week.weekKey)]);
      redisReadable = true;
      redisWritable = true;
      storageReadable = true;
      storageWritable = true;
    } catch {
      redisReadable = false;
      redisWritable = false;
      storageReadable = false;
      storageWritable = false;
    }
  }

  try {
    const { getTeamAssetsDataForServer } = await import("@/lib/team-assets");
    const teamAssetsData = await getTeamAssetsDataForServer();
    externalGptLinks = resolveExternalGptLinksFromTeamAssets(teamAssetsData.allAssets);
  } catch {
    externalGptLinks = resolveExternalGptLinksFromTeamAssets([]);
  }

  return {
    checkedAt: new Date().toISOString(),
    storageConfigured,
    storageReadable,
    storageWritable,
    redisConfigured,
    redisReadable,
    redisWritable,
    storageMode,
    storageTabName: MEETING_CONTENT_MEMORY_TAB_NAME,
    currentWeekKey: week.weekKey,
    currentWeekStartsAtLabel: week.label,
    currentWeekTopicCount: topicCount,
    lastSaveAt: saveDiagnostics?.savedAt ?? null,
    lastSaveOk: saveDiagnostics?.ok ?? null,
    lastSaveError: saveDiagnostics?.error ?? null,
    externalGptLinks,
  };
}

export const getBillyAssistantHubDiagnostics = createServerFn({ method: "GET" }).handler(
  async () => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    return getBillyAssistantHubDiagnosticsData();
  },
);

export const getThisWeeksMeetingTopics = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  const week = getCurrentMeetingWeek();
  const topics = await readCurrentWeekTopics();

  return {
    weekKey: week.weekKey,
    weekLabel: week.label,
    topics: topics.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
  };
});

export const saveMeetingTopic = createServerFn({ method: "POST" })
  .inputValidator(saveMeetingTopicInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    const week = getCurrentMeetingWeek();
    const topic: MeetingTopic = {
      id: `meeting-topic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      weekKey: week.weekKey,
      memberName: data.memberName,
      title: data.title,
      details: data.details,
      createdAt: new Date().toISOString(),
    };

    try {
      await appendMeetingTopic(topic);
      await writeSaveDiagnostics({
        savedAt: new Date().toISOString(),
        ok: true,
        error: null,
      });

      return {
        ok: true,
        message: "Noted — I’ll keep this for this week’s meeting.",
        topic,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeSaveDiagnostics({
        savedAt: new Date().toISOString(),
        ok: false,
        error: message,
      });

      return {
        ok: false,
        message,
        topic: null,
      };
    }
  });

export const billyAssistantDiagnosticsQuery = {
  queryKey: ["team-billion-billy-assistant-diagnostics"],
  queryFn: () => getBillyAssistantHubDiagnostics(),
  staleTime: 60_000,
};

export const meetingTopicsQuery = {
  queryKey: ["team-billion-meeting-topics"],
  queryFn: () => getThisWeeksMeetingTopics(),
  staleTime: 30_000,
};
