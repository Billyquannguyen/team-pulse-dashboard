import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getActiveBrandsKnowledgeMatches } from "@/lib/active-brands";
import { callOpenAiText, getOpenAiDiagnostics, getOpenAiEnvDiagnostics } from "@/lib/openai.server";
import {
  getWebKnowledgeDiagnostics,
  getWebKnowledgeEnvDiagnostics,
  searchWebKnowledge,
  shouldUseWebKnowledge,
  type WebKnowledgeDiagnostics,
} from "@/lib/web-knowledge";

type NotionEnvPresence = {
  tokenExists: boolean;
  rootPageIdExists: boolean;
  setupReady: boolean;
  setupIssue: string | null;
};

type NotionPageSummary = {
  id: string;
  title: string;
  url: string | null;
  lastEditedTime: string | null;
};

type NotionPageContent = NotionPageSummary & {
  text: string;
};

type KnowledgeChunk = {
  id: string;
  pageId: string;
  pageTitle: string;
  pageUrl: string | null;
  heading: string | null;
  text: string;
  terms: Record<string, number>;
};

type NotionKnowledgeState = {
  syncedAt: string | null;
  pages: NotionPageSummary[];
  chunks: KnowledgeChunk[];
  error: string | null;
  warnings: string[];
  lastDurationMs: number | null;
  rootPageAccess: "unknown" | "ok" | "error";
  rootPageError: string | null;
  lastRetrievalResultCount: number;
};

export type NotionKnowledgeDiagnostics = {
  checkedAt: string;
  tokenExists: boolean;
  tokenEnvName: string;
  rootPageIdExists: boolean;
  rootPageAccess: "unknown" | "ok" | "error";
  rootPageError: string | null;
  setupReady: boolean;
  setupIssue: string | null;
  lastSyncTime: string | null;
  pagesIndexed: number;
  chunksIndexed: number;
  errors: string[];
  warnings: string[];
  isSynced: boolean;
  indexed: boolean;
  lastRetrievalResultCount: number;
  lastDurationMs: number | null;
  web: WebKnowledgeDiagnostics;
};

type BillyGptAnswer = {
  answer: string;
  foundInHandbook: boolean;
  sourceCount: number;
  syncedAt: string | null;
  sourceTags: Array<"handbook" | "sheets" | "web">;
};

export type BillyGptContextSource = {
  source: "handbook" | "sheets" | "web";
  title: string;
  text: string;
  url?: string | null;
};

export type BillyGptContextBundle = {
  sources: BillyGptContextSource[];
  sourceTags: Array<"handbook" | "sheets" | "web">;
  foundInHandbook: boolean;
  syncedAt: string | null;
  warnings: string[];
};

type NotionApiListResponse<T> = {
  results?: T[];
  has_more?: boolean;
  next_cursor?: string | null;
};

type NotionTraversalContext = {
  token: string;
  visitedPageIds: Set<string>;
  pages: NotionPageContent[];
  warnings: string[];
};

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const NOTION_TOKEN_ENV = "NOTION_API_TOKEN";
const LEGACY_NOTION_TOKEN_ENV = "NOTION_TOKEN";
const NOTION_ROOT_PAGE_ID_ENV = "NOTION_HANDBOOK_ROOT_PAGE_ID";
const MAX_NOTION_PAGES = 80;
const MAX_NESTED_BLOCK_DEPTH = 6;
const MAX_CHUNK_CHARS = 1000;
const MIN_CHUNK_CHARS = 240;
const MAX_NOTION_RETRIES = 2;

const askBillyInput = z.object({
  question: z.string().trim().min(1),
});

const STOP_WORDS = new Set([
  "a",
  "about",
  "after",
  "again",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "should",
  "so",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const defaultState: NotionKnowledgeState = {
  syncedAt: null,
  pages: [],
  chunks: [],
  error: null,
  warnings: [],
  lastDurationMs: null,
  rootPageAccess: "unknown",
  rootPageError: null,
  lastRetrievalResultCount: 0,
};

type NotionKnowledgeGlobal = typeof globalThis & {
  __teamBillionNotionKnowledge?: NotionKnowledgeState;
  __teamBillionNotionSyncPromise?: Promise<NotionKnowledgeDiagnostics> | null;
};

function getGlobalStore() {
  const store = globalThis as NotionKnowledgeGlobal;

  if (!store.__teamBillionNotionKnowledge) {
    store.__teamBillionNotionKnowledge = { ...defaultState };
  }

  return store;
}

function getState() {
  return getGlobalStore().__teamBillionNotionKnowledge ?? { ...defaultState };
}

function setState(state: NotionKnowledgeState) {
  getGlobalStore().__teamBillionNotionKnowledge = state;
}

function getSyncPromise() {
  return getGlobalStore().__teamBillionNotionSyncPromise ?? null;
}

function setSyncPromise(promise: Promise<NotionKnowledgeDiagnostics> | null) {
  getGlobalStore().__teamBillionNotionSyncPromise = promise;
}

function logNotionKnowledge(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:notion-knowledge]", message, details ?? {});
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getNotionEnv(): NotionEnvPresence & { token: string; rootPageId: string } {
  const primaryToken = process.env[NOTION_TOKEN_ENV]?.trim() ?? "";
  const legacyToken = process.env[LEGACY_NOTION_TOKEN_ENV]?.trim() ?? "";
  const token = primaryToken || legacyToken;
  const rootPageId = process.env[NOTION_ROOT_PAGE_ID_ENV]?.trim() ?? "";
  const missing = [
    token ? null : NOTION_TOKEN_ENV,
    rootPageId ? null : NOTION_ROOT_PAGE_ID_ENV,
  ].filter(Boolean);

  return {
    token,
    rootPageId,
    tokenExists: Boolean(token),
    rootPageIdExists: Boolean(rootPageId),
    setupReady: missing.length === 0,
    setupIssue: missing.length > 0 ? `Missing ${missing.join(" and ")} in Vercel.` : null,
  };
}

export function getNotionEnvDiagnostics() {
  const env = getNotionEnv();

  return [
    { name: NOTION_TOKEN_ENV, exists: env.tokenExists },
    { name: LEGACY_NOTION_TOKEN_ENV, exists: Boolean(process.env[LEGACY_NOTION_TOKEN_ENV]?.trim()) },
    { name: NOTION_ROOT_PAGE_ID_ENV, exists: env.rootPageIdExists },
    ...getWebKnowledgeEnvDiagnostics(),
    ...getOpenAiEnvDiagnostics(),
  ];
}

export function getNotionKnowledgeDiagnostics(): NotionKnowledgeDiagnostics {
  const env = getNotionEnv();
  const state = getState();
  const syncInProgress = Boolean(getSyncPromise());
  const warnings = syncInProgress ? ["Sync is currently running."] : state.warnings;

  return {
    checkedAt: new Date().toISOString(),
    tokenExists: env.tokenExists,
    tokenEnvName:
      process.env[NOTION_TOKEN_ENV]?.trim() || !process.env[LEGACY_NOTION_TOKEN_ENV]?.trim()
        ? NOTION_TOKEN_ENV
        : LEGACY_NOTION_TOKEN_ENV,
    rootPageIdExists: env.rootPageIdExists,
    rootPageAccess: state.rootPageAccess,
    rootPageError: state.rootPageError,
    setupReady: env.setupReady,
    setupIssue: env.setupIssue,
    lastSyncTime: state.syncedAt,
    pagesIndexed: state.pages.length,
    chunksIndexed: state.chunks.length,
    errors: state.error ? [state.error] : [],
    warnings,
    isSynced: Boolean(state.syncedAt && state.chunks.length > 0),
    indexed: state.chunks.length > 0,
    lastRetrievalResultCount: state.lastRetrievalResultCount,
    lastDurationMs: state.lastDurationMs,
    web: getWebKnowledgeDiagnostics(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function richTextToPlain(value: unknown) {
  if (!Array.isArray(value)) return "";

  return value
    .map((item) => asString(asRecord(item).plain_text))
    .join("")
    .trim();
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractPageTitle(page: Record<string, unknown>, fallback: string) {
  const properties = asRecord(page.properties);

  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record.type === "title") {
      const title = richTextToPlain(record.title);
      if (title) return title;
    }
  }

  return fallback || "Untitled page";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notionRequest<T>(path: string, token: string, attempt = 0): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
    cache: "no-store",
  });

  if (response.status === 429 && attempt < MAX_NOTION_RETRIES) {
    const retryAfterSeconds = Number(response.headers.get("retry-after") ?? "");
    const waitMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(6000, Math.max(1000, retryAfterSeconds * 1000))
      : 1200 * (attempt + 1);

    await sleep(waitMs);
    return notionRequest<T>(path, token, attempt + 1);
  }

  if (!response.ok) {
    let detail = response.statusText;

    try {
      const payload = asRecord(await response.json());
      detail = asString(payload.message) || detail;
    } catch {
      detail = await response.text();
    }

    throw new Error(`Notion API failed (${response.status}): ${detail}`);
  }

  return (await response.json()) as T;
}

async function fetchAllBlockChildren(blockId: string, token: string) {
  const blocks: Record<string, unknown>[] = [];
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);

    const response = await notionRequest<NotionApiListResponse<Record<string, unknown>>>(
      `/blocks/${encodeURIComponent(blockId)}/children?${query.toString()}`,
      token,
    );

    blocks.push(...(response.results ?? []));
    cursor = response.has_more ? (response.next_cursor ?? null) : null;
  } while (cursor);

  return blocks;
}

function blockText(block: Record<string, unknown>) {
  const type = asString(block.type);
  const data = asRecord(block[type]);

  if (type === "child_page") {
    return `Subpage: ${asString(asRecord(block.child_page).title) || "Untitled page"}`;
  }

  if (type === "divider") return "";

  if (type === "to_do") {
    const checked = asRecord(block.to_do).checked === true ? "[x]" : "[ ]";
    return `${checked} ${richTextToPlain(data.rich_text)}`.trim();
  }

  if (type === "table_row") {
    const cells = asRecord(block.table_row).cells;
    if (!Array.isArray(cells)) return "";

    return cells
      .map((cell) => richTextToPlain(cell))
      .filter(Boolean)
      .join(" | ");
  }

  const text = richTextToPlain(data.rich_text);
  if (!text) return "";

  if (type === "heading_1") return `# ${text}`;
  if (type === "heading_2") return `## ${text}`;
  if (type === "heading_3") return `### ${text}`;
  if (type === "bulleted_list_item") return `- ${text}`;
  if (type === "numbered_list_item") return `1. ${text}`;
  if (type === "quote") return `Quote: ${text}`;
  if (type === "callout") return `Note: ${text}`;

  return text;
}

async function collectBlockText(
  blockId: string,
  context: NotionTraversalContext,
  lines: string[],
  depth = 0,
) {
  if (depth > MAX_NESTED_BLOCK_DEPTH) {
    context.warnings.push(`Skipped very deep nested blocks under ${blockId}.`);
    return;
  }

  const blocks = await fetchAllBlockChildren(blockId, context.token);

  for (const block of blocks) {
    const text = normalizeWhitespace(blockText(block));
    if (text) lines.push(text);

    const type = asString(block.type);
    const childTitle = asString(asRecord(block.child_page).title);

    if (type === "child_page") {
      const childPageId = asString(block.id);

      if (childPageId) {
        await collectPage(childPageId, context, childTitle || "Untitled page");
      }

      continue;
    }

    if (block.has_children === true && typeof block.id === "string") {
      await collectBlockText(block.id, context, lines, depth + 1);
    }
  }
}

async function collectPage(pageId: string, context: NotionTraversalContext, titleHint: string) {
  if (context.visitedPageIds.has(pageId)) return;

  if (context.pages.length >= MAX_NOTION_PAGES) {
    context.warnings.push(`Stopped after ${MAX_NOTION_PAGES} Notion pages to keep sync fast.`);
    return;
  }

  context.visitedPageIds.add(pageId);

  const page = await notionRequest<Record<string, unknown>>(
    `/pages/${encodeURIComponent(pageId)}`,
    context.token,
  );
  const title = extractPageTitle(page, titleHint);
  const lines: string[] = [title];

  await collectBlockText(pageId, context, lines);

  context.pages.push({
    id: asString(page.id) || pageId,
    title,
    url: asString(page.url) || null,
    lastEditedTime: asString(page.last_edited_time) || null,
    text: lines.join("\n"),
  });
}

function tokenize(value: string) {
  return (
    value
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.filter((term) => !STOP_WORDS.has(term)) ?? []
  );
}

function termCounts(value: string) {
  return tokenize(value).reduce<Record<string, number>>((counts, term) => {
    counts[term] = (counts[term] ?? 0) + 1;
    return counts;
  }, {});
}

function truncateText(value: string, maxLength = 850) {
  const clean = normalizeWhitespace(value);
  if (clean.length <= maxLength) return clean;

  return `${clean.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

function chunkPage(page: NotionPageContent) {
  const chunks: KnowledgeChunk[] = [];
  const lines = page.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let heading: string | null = page.title;
  let buffer: string[] = [];
  let bufferLength = 0;

  const flush = () => {
    if (buffer.length === 0) return;

    const text = buffer.join("\n");
    if (text.length < 40) {
      buffer = [];
      bufferLength = 0;
      return;
    }

    chunks.push({
      id: `${page.id}:${chunks.length}`,
      pageId: page.id,
      pageTitle: page.title,
      pageUrl: page.url,
      heading,
      text,
      terms: termCounts(`${page.title} ${heading ?? ""} ${text}`),
    });

    buffer = [];
    bufferLength = 0;
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch && bufferLength >= MIN_CHUNK_CHARS) {
      flush();
    }

    if (headingMatch?.[1]) {
      heading = headingMatch[1];
    }

    buffer.push(line);
    bufferLength += line.length + 1;

    if (bufferLength >= MAX_CHUNK_CHARS) {
      flush();
    }
  }

  flush();

  return chunks;
}

function buildKnowledgeState(
  pages: NotionPageContent[],
  warnings: string[],
  startedAt: number,
): NotionKnowledgeState {
  const chunks = pages.flatMap(chunkPage);

  return {
    syncedAt: new Date().toISOString(),
    pages: pages.map(({ id, title, url, lastEditedTime }) => ({
      id,
      title,
      url,
      lastEditedTime,
    })),
    chunks,
    error: null,
    warnings,
    lastDurationMs: Date.now() - startedAt,
    rootPageAccess: "ok",
    rootPageError: null,
    lastRetrievalResultCount: getState().lastRetrievalResultCount ?? 0,
  };
}

async function runNotionSync(): Promise<NotionKnowledgeDiagnostics> {
  const startedAt = Date.now();
  const env = getNotionEnv();

  if (!env.setupReady) {
    const message = env.setupIssue ?? "Notion is not configured.";
    setState({
      ...defaultState,
      error: message,
      lastDurationMs: Date.now() - startedAt,
      rootPageAccess: "unknown",
      rootPageError: null,
    });
    return getNotionKnowledgeDiagnostics();
  }

  const context: NotionTraversalContext = {
    token: env.token,
    visitedPageIds: new Set(),
    pages: [],
    warnings: [],
  };

  try {
    await collectPage(env.rootPageId, context, "Team Billion Handbook");
    const nextState = buildKnowledgeState(context.pages, context.warnings, startedAt);
    setState(nextState);

    logNotionKnowledge("notion handbook sync complete", {
      pagesIndexed: nextState.pages.length,
      chunksIndexed: nextState.chunks.length,
      durationMs: nextState.lastDurationMs,
    });

    return getNotionKnowledgeDiagnostics();
  } catch (error) {
    const message = errorMessage(error);
    setState({
      ...getState(),
      error: message,
      warnings: context.warnings,
      lastDurationMs: Date.now() - startedAt,
      rootPageAccess: "error",
      rootPageError: message,
      lastRetrievalResultCount: getState().lastRetrievalResultCount ?? 0,
    });

    logNotionKnowledge("notion handbook sync failed", { error: message });
    return getNotionKnowledgeDiagnostics();
  }
}

function scoreChunk(chunk: KnowledgeChunk, query: string, queryTerms: string[]) {
  const normalizedQuery = query.toLowerCase();
  const chunkText = `${chunk.pageTitle} ${chunk.heading ?? ""} ${chunk.text}`.toLowerCase();
  let score = chunkText.includes(normalizedQuery) ? 12 : 0;

  for (const term of queryTerms) {
    score += chunk.terms[term] ?? 0;

    if (chunk.pageTitle.toLowerCase().includes(term)) {
      score += 2;
    }

    if (chunk.heading?.toLowerCase().includes(term)) {
      score += 2;
    }
  }

  return score;
}

function searchKnowledge(question: string) {
  const state = getState();
  const queryTerms = Array.from(new Set(tokenize(question)));

  if (!state.syncedAt || state.chunks.length === 0 || queryTerms.length === 0) {
    return [];
  }

  return state.chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, question, queryTerms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

async function ensureKnowledgeReady() {
  const state = getState();
  const env = getNotionEnv();

  if (state.chunks.length > 0 || !env.setupReady) {
    return state;
  }

  const activeSync = getSyncPromise();
  if (activeSync) {
    await activeSync;
    return getState();
  }

  await runNotionSync();
  return getState();
}

function setLastRetrievalResultCount(count: number) {
  setState({
    ...getState(),
    lastRetrievalResultCount: count,
  });
}

function sourceLabel(chunk: KnowledgeChunk) {
  const heading = chunk.heading && chunk.heading !== chunk.pageTitle ? `, ${chunk.heading}` : "";
  return `${chunk.pageTitle}${heading}`;
}

function isInternalAgencyQuestion(question: string) {
  return /\b(we|our|team billion|handbook|commission|structure|policy|process|onboard|onboarding|creator|creators|rate|script|outreach|follow up|workflow|billing|invoice)\b/i.test(
    question,
  );
}

function uniqueSourceTags(tags: Array<"handbook" | "sheets" | "web">) {
  return tags.filter((tag, index) => tags.indexOf(tag) === index);
}

function contextBundleToModelText(bundle: BillyGptContextBundle) {
  if (bundle.sources.length === 0) return "No source context found.";

  return bundle.sources
    .map((source, index) => {
      const urlLine = source.url ? `\nURL: ${source.url}` : "";
      return `${index + 1}. [${source.source}] ${source.title}${urlLine}\n${source.text}`;
    })
    .join("\n\n");
}

function sourceTagsToLabel(tags: Array<"handbook" | "sheets" | "web">) {
  const labels = tags.map((tag) => {
    if (tag === "handbook") return "Handbook";
    if (tag === "sheets") return "Sheets";
    return "Web";
  });

  return labels.join(", ");
}

function appendSourceLabels(answer: string, tags: Array<"handbook" | "sheets" | "web">) {
  if (tags.length === 0) return answer;
  if (/Sources used:/i.test(answer)) return answer;
  return `${answer.trim()}\n\nSources used: ${sourceTagsToLabel(tags)}`;
}

export async function getBillyGptContextBundle(
  question: string,
  options: { includeWeb?: boolean } = {},
): Promise<BillyGptContextBundle> {
  const state = await ensureKnowledgeReady();
  const handbookMatches = searchKnowledge(question);
  const sheetMatches = await getActiveBrandsKnowledgeMatches(question);
  const useWeb =
    options.includeWeb ?? shouldUseWebKnowledge(question, sheetMatches.length > 0);
  const webResult = useWeb
    ? await searchWebKnowledge(question)
    : {
        sources: [],
        warning: null,
        provider: getWebKnowledgeDiagnostics().provider,
        cached: false,
      };
  const sources: BillyGptContextSource[] = [
    ...handbookMatches.slice(0, 4).map(({ chunk }) => ({
      source: "handbook" as const,
      title: sourceLabel(chunk),
      text: truncateText(chunk.text, 1200),
      url: chunk.pageUrl,
    })),
    ...sheetMatches.slice(0, 3).map((match) => ({
      source: "sheets" as const,
      title: match.title,
      text: truncateText(match.text, 800),
    })),
    ...webResult.sources.slice(0, 3).map((match) => ({
      source: "web" as const,
      title: match.title,
      text: truncateText(match.snippet, 700),
      url: match.url,
    })),
  ];
  const sourceTags = uniqueSourceTags(sources.map((source) => source.source));
  setLastRetrievalResultCount(sources.length);

  return {
    sources,
    sourceTags,
    foundInHandbook: handbookMatches.length > 0,
    syncedAt: state.syncedAt,
    warnings: webResult.warning ? [webResult.warning] : [],
  };
}

export function formatBillyGptContextForModel(bundle: BillyGptContextBundle) {
  return contextBundleToModelText(bundle);
}

function fallbackAnswerFromContext(
  question: string,
  bundle: BillyGptContextBundle,
): BillyGptAnswer {
  if (bundle.sources.length === 0) {
    return {
      answer: isInternalAgencyQuestion(question)
        ? "I could not find that in the synced Team Billion handbook. I do not want to guess an internal answer, so add it to Notion and sync again."
        : "I could not find a reliable handbook, sheets, or web source for that. Try asking with a brand name, platform, or more specific topic.",
      foundInHandbook: false,
      sourceCount: 0,
      syncedAt: bundle.syncedAt,
      sourceTags: [],
    };
  }

  return {
    answer:
      "I found relevant internal context, but the AI model is not connected right now. Add OPENAI_API_KEY in Vercel to enable full Billy GPT answers.",
    foundInHandbook: bundle.foundInHandbook,
    sourceCount: bundle.sources.length,
    syncedAt: bundle.syncedAt,
    sourceTags: bundle.sourceTags,
  };
}

async function answerFromKnowledge(question: string): Promise<BillyGptAnswer> {
  const diagnostics = getNotionKnowledgeDiagnostics();
  const state = await ensureKnowledgeReady();

  if (!diagnostics.setupReady) {
    return {
      answer:
        "Billy GPT is not connected to the Notion handbook yet. Add NOTION_API_TOKEN and NOTION_HANDBOOK_ROOT_PAGE_ID in Vercel, then sync the handbook.",
      foundInHandbook: false,
      sourceCount: 0,
      syncedAt: state.syncedAt,
      sourceTags: [],
    };
  }

  if (!getState().syncedAt || getState().chunks.length === 0) {
    return {
      answer:
        "Billy GPT could not load the handbook index yet. Ask an admin to run Sync Notion Knowledge, then try again.",
      foundInHandbook: false,
      sourceCount: 0,
      syncedAt: getState().syncedAt,
      sourceTags: [],
    };
  }

  const bundle = await getBillyGptContextBundle(question);
  const sourceCount = bundle.sources.length;

  if (sourceCount === 0) {
    return {
      answer:
        isInternalAgencyQuestion(question)
          ? "I could not find that in the synced Team Billion handbook. I do not want to guess an internal answer, so add it to Notion and sync again."
          : "I could not find a reliable handbook, sheets, or web source for that. Try asking with a brand name, platform, or more specific topic.",
      foundInHandbook: false,
      sourceCount: 0,
      syncedAt: getState().syncedAt,
      sourceTags: [],
    };
  }

  if (!getOpenAiDiagnostics().keyPresent) {
    return fallbackAnswerFromContext(question, bundle);
  }

  try {
    const response = await callOpenAiText({
      instructions:
        "You are Billy GPT, the internal AI assistant for Team Billion, an influencer management agency. Use the provided source-labeled context internally. Prefer [handbook] as the internal source of truth, use [sheets] for live operational context, and use [web] only for external enrichment. Do not dump raw source chunks. If the handbook does not contain an internal policy answer, say that clearly. Keep the answer concise, practical, and directly useful.",
      input: `User question:\n${question}\n\nSource context:\n${contextBundleToModelText(bundle)}`,
      maxOutputTokens: 900,
    });

    return {
      answer: appendSourceLabels(response.text, bundle.sourceTags),
      foundInHandbook: bundle.foundInHandbook,
      sourceCount,
      syncedAt: getState().syncedAt,
      sourceTags: bundle.sourceTags,
    };
  } catch {
    return {
      answer:
        "I found source context, but I could not get the AI model to write a clean answer right now. Try again in a moment.",
      foundInHandbook: bundle.foundInHandbook,
      sourceCount,
      syncedAt: getState().syncedAt,
      sourceTags: bundle.sourceTags,
    };
  }
}

export const getBillyGptKnowledgeStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  return getNotionKnowledgeDiagnostics();
});

export const syncNotionKnowledge = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdminAuth } = await import("@/lib/auth.server");
  await requireAdminAuth();

  const activeSync = getSyncPromise();
  if (activeSync) return activeSync;

  const promise = runNotionSync().finally(() => {
    setSyncPromise(null);
  });

  setSyncPromise(promise);
  return promise;
});

export const askBillyGpt = createServerFn({ method: "POST" })
  .inputValidator(askBillyInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    return answerFromKnowledge(data.question.slice(0, 4000));
  });
