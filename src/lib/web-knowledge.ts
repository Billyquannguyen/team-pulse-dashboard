type WebKnowledgeSource = {
  title: string;
  url: string;
  snippet: string;
  source: "web";
};

export type WebKnowledgeDiagnostics = {
  checkedAt: string;
  braveConfigured: boolean;
  cacheEntries: number;
  lastSearchAt: string | null;
  lastError: string | null;
  provider: "brave" | "duckduckgo-instant-answer";
};

type WebCacheEntry = {
  sources: WebKnowledgeSource[];
  warning: string | null;
  cachedAt: number;
  expiresAt: number;
};

type WebKnowledgeGlobal = typeof globalThis & {
  __teamBillionWebKnowledgeCache?: Map<string, WebCacheEntry>;
  __teamBillionLastWebSearchAt?: string | null;
  __teamBillionLastWebError?: string | null;
};

const BRAVE_SEARCH_API_KEY_ENV = "BRAVE_SEARCH_API_KEY";
const WEB_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_RESULT_LIMIT = 5;

function getGlobalStore() {
  const store = globalThis as WebKnowledgeGlobal;

  if (!store.__teamBillionWebKnowledgeCache) {
    store.__teamBillionWebKnowledgeCache = new Map();
  }

  return store;
}

function getCache() {
  return getGlobalStore().__teamBillionWebKnowledgeCache ?? new Map<string, WebCacheEntry>();
}

function setLastSearchAt() {
  getGlobalStore().__teamBillionLastWebSearchAt = new Date().toISOString();
}

function setLastError(error: string | null) {
  getGlobalStore().__teamBillionLastWebError = error;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cacheKey(query: string) {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

function getBraveApiKey() {
  return process.env[BRAVE_SEARCH_API_KEY_ENV]?.trim() ?? "";
}

export function getWebKnowledgeEnvDiagnostics() {
  return [{ name: BRAVE_SEARCH_API_KEY_ENV, exists: Boolean(getBraveApiKey()) }];
}

export function getWebKnowledgeDiagnostics(): WebKnowledgeDiagnostics {
  const store = getGlobalStore();

  return {
    checkedAt: new Date().toISOString(),
    braveConfigured: Boolean(getBraveApiKey()),
    cacheEntries: getCache().size,
    lastSearchAt: store.__teamBillionLastWebSearchAt ?? null,
    lastError: store.__teamBillionLastWebError ?? null,
    provider: getBraveApiKey() ? "brave" : "duckduckgo-instant-answer",
  };
}

export function shouldUseWebKnowledge(question: string, hasSheetContext: boolean) {
  const q = question.toLowerCase();

  return (
    hasSheetContext ||
    /\b(latest|current|today|trend|trends|news|online|web|research|market|tiktok|instagram|youtube|brand|company|summari[sz]e)\b/.test(
      q,
    )
  );
}

async function searchWithBrave(query: string): Promise<WebKnowledgeSource[]> {
  const apiKey = getBraveApiKey();
  if (!apiKey) return [];

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(SEARCH_RESULT_LIMIT));
  url.searchParams.set("text_decorations", "false");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Web search failed (${response.status}): ${response.statusText}`);
  }

  const payload = asRecord(await response.json());
  const web = asRecord(payload.web);
  const results = Array.isArray(web.results) ? web.results : [];

  return results
    .map((item) => {
      const record = asRecord(item);
      return {
        title: normalizeWhitespace(asString(record.title)),
        url: asString(record.url),
        snippet: normalizeWhitespace(asString(record.description)),
        source: "web" as const,
      };
    })
    .filter((item) => item.title && item.url && item.snippet)
    .slice(0, SEARCH_RESULT_LIMIT);
}

function flattenDuckDuckGoTopics(value: unknown): WebKnowledgeSource[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = asRecord(item);

    if (Array.isArray(record.Topics)) {
      return flattenDuckDuckGoTopics(record.Topics);
    }

    const text = normalizeWhitespace(asString(record.Text));
    const url = asString(record.FirstURL);

    if (!text || !url) return [];

    const [title, ...rest] = text.split(" - ");

    return [
      {
        title: normalizeWhitespace(title || text),
        url,
        snippet: normalizeWhitespace(rest.join(" - ") || text),
        source: "web" as const,
      },
    ];
  });
}

async function searchWithDuckDuckGo(query: string): Promise<WebKnowledgeSource[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Public web lookup failed (${response.status}): ${response.statusText}`);
  }

  const payload = asRecord(await response.json());
  const abstractText = normalizeWhitespace(asString(payload.AbstractText));
  const abstractUrl = asString(payload.AbstractURL);
  const abstractHeading = normalizeWhitespace(asString(payload.Heading));
  const sources: WebKnowledgeSource[] = [];

  if (abstractText && abstractUrl) {
    sources.push({
      title: abstractHeading || query,
      url: abstractUrl,
      snippet: abstractText,
      source: "web",
    });
  }

  sources.push(...flattenDuckDuckGoTopics(payload.RelatedTopics));

  return sources.slice(0, SEARCH_RESULT_LIMIT);
}

export async function searchWebKnowledge(query: string) {
  const key = cacheKey(query);
  const cached = getCache().get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return {
      sources: cached.sources,
      warning: cached.warning,
      provider: getBraveApiKey() ? "brave" : "duckduckgo-instant-answer",
      cached: true,
    };
  }

  try {
    setLastSearchAt();
    const braveConfigured = Boolean(getBraveApiKey());
    const sources = braveConfigured ? await searchWithBrave(query) : await searchWithDuckDuckGo(query);
    const warning =
      braveConfigured || sources.length > 0
        ? null
        : "No web results came back from the public web lookup. Add BRAVE_SEARCH_API_KEY for stronger live search.";
    const entry = {
      sources,
      warning,
      cachedAt: Date.now(),
      expiresAt: Date.now() + WEB_CACHE_TTL_MS,
    };

    getCache().set(key, entry);
    setLastError(null);

    return {
      sources,
      warning,
      provider: braveConfigured ? "brave" : "duckduckgo-instant-answer",
      cached: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLastError(message);

    if (cached) {
      return {
        sources: cached.sources,
        warning: `Live web search failed, so Billy GPT used cached web results. ${message}`,
        provider: getBraveApiKey() ? "brave" : "duckduckgo-instant-answer",
        cached: true,
      };
    }

    return {
      sources: [],
      warning: message,
      provider: getBraveApiKey() ? "brave" : "duckduckgo-instant-answer",
      cached: false,
    };
  }
}
