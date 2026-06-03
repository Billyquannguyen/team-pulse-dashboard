#!/usr/bin/env node

import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_QUERY =
  'in:anywhere -in:spam -in:trash -from:quan@stride-social.com {campaign brief creator collaboration partnership affiliate song "music promotion" UGC whitelisting "paid usage" ambassador gifted PR influencer creators sponsorship collab "paid collaboration" partnership sponsorship KOL whitelisting "Spark Ads"}';

const CHECKPOINT_DIR = ".opportunity-ingestion";
const CHECKPOINT_FILE = "checkpoint.json";
const LOG_UPDATE_INTERVAL_EMAILS = 100;
const SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
};

const TAB_NAMES = {
  opportunities: "Opportunities",
  organizations: "Organizations",
  brands: "Brands",
  contacts: "Contacts",
  review: "Extraction Review",
  log: "Ingestion Log",
  alias: "Alias Mapping",
  brandIntelligence: "Brand Intelligence",
  agencyIntelligence: "Agency Intelligence",
  contactIntelligence: "Contact Intelligence",
  creatorSignals: "Creator Matching Signals",
};

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "qq.com",
  "163.com",
  "126.com",
  "yahoo.com",
]);

const AGENCY_HINTS = [
  "agency",
  "talent",
  "creator",
  "influencer",
  "mcn",
  "pr",
  "network",
  "platform",
  "media",
  "affiliate",
  "partners",
  "collab",
  "marketing",
  "growth",
  "grow",
  "studio",
  "label",
  "music",
];

const KNOWN_SOURCE_ORGS = new Map([
  ["growmaxvalue.com", ["GrowMaxValue", "Agency"]],
  ["createmate.world", ["Create Mate", "Talent Platform"]],
  ["sound.createmate.world", ["Create Mate", "Talent Platform"]],
  ["music.createmate.world", ["Create Mate", "Talent Platform"]],
  ["noxinfluencer.com", ["NoXInfluencer", "Talent Platform"]],
  ["kglowing.ai", ["Kglowing", "PR Agency"]],
  ["influencer.com", ["Influencer.com", "Agency"]],
  ["filify.app", ["Filify", "Affiliate Network"]],
  ["livenation.com", ["Live Nation", "Brand"]],
  ["bytedance.com", ["ByteDance / TikTok", "Talent Platform"]],
  ["tiktok.com", ["TikTok", "Talent Platform"]],
  ["contentlab.xyz", ["ContentLab", "Agency"]],
  ["luxiotalent.com", ["Luxio Talent", "Agency"]],
  ["wotohub.com", ["WotoHub", "Talent Platform"]],
  ["brandnetworkinghub.com", ["WotoHub / BrandNetworkingHub", "Talent Platform"]],
  ["tablerock.com", ["Table Rock", "Agency"]],
  ["mediamz.com", ["MediaMZ", "Agency"]],
  ["rokiagency.com", ["Roki Agency", "Agency"]],
  ["memo.live", ["Memo.live", "Agency"]],
  ["influcio.com", ["Influcio", "Agency"]],
  ["influur.com", ["Influur", "Talent Platform"]],
]);

const REVIEW_ISSUES = {
  unclearBrand: "Unclear Brand",
  unclearAgency: "Agency Brand Confusion",
  lowConfidence: "Low Confidence Extraction",
  missingBudget: "Missing Budget",
  vagueRequirements: "Missing Creator Requirements",
  lowBudget: "Low Budget Concern",
  affiliate: "Pure Affiliate Concern",
  historical: "Historical Signal Not Active Opportunity",
  duplicate: "Possible Duplicate",
};

const RELEVANCE_REASONS = {
  clearBrandBrief: "Clear brand brief",
  paidCampaign: "Paid campaign detected",
  affiliateOffer: "Affiliate offer detected",
  songPromotion: "Song promotion detected",
  prGifting: "PR gifting detected",
  agencyBrief: "Agency brief detected",
  tooVague: "Too vague",
  newsletter: "Newsletter / mass blast",
  noOpportunity: "No creator opportunity",
  internal: "Internal / irrelevant",
  duplicate: "Duplicate",
};

const POLLUTED_ENTITY_NAMES = new Set([
  "aching out",
  "a creator like you",
  "bestfriday agency",
  "cash sharing",
  "china. as you know",
  "completing this task",
  "creators whose content celebrates beauty",
  "direct communication",
  "emails",
  "feedback. on sat",
  "gold",
  "her",
  "my side",
  "not getting back earlier",
  "sending that over",
  "sharing this",
  "sharing your production charge",
  "talented creators like you",
  "tech creator",
  "the brand",
  "the campaign",
  "the creator rewards program",
  "the creator rewards programme",
  "the next steps",
  "this creator",
  "to me",
  "travel and",
  "you!",
]);

const POLLUTED_ENTITY_PATTERNS = [
  /\b(getting back|not getting|thanks?|thank you|following up|reaching out|reply|respond|heard back)\b/i,
  /\b(rate with us|rate with me|brand'?s budget|budget for this|campaign to begin|collaboration to begin)\b/i,
  /\b(direct communication|sending that over|sharing your|sharing her|production charge)\b/i,
  /\b(this creator|creator like you|talented creators like you|your content|her rate|his rate|their rate)\b/i,
  /\b(hi dear creator|dear creator|dear influencer|hello creator)\b/i,
  /\b(feedback|next steps|creator rewards program|creator rewards programme|completing this task)\b/i,
  /\b(mon|tue|wed|thu|fri|sat|sun)\b/i,
];

const NON_ACTIONABLE_MARKETING_PATTERNS = [
  /\b(newsletter|digest|roundup|webinar|case study|blog|product update|press release|view in browser|manage preferences)\b/i,
  /\b(no-reply|noreply|do not reply|unsubscribe)\b/i,
  /\b(security alert|verify your account|password reset|receipt|invoice|delivery status notification|out of office|calendar invitation)\b/i,
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles([".env", ".env.local", ".env.opportunity-ingestion"]);
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.resetCheckpoint) {
    await resetCheckpoints(config, options);
    return;
  }

  if (options.validateCredentials) {
    await validateCredentials(config);
    return;
  }

  console.log(options.dryRun ? "DRY RUN: no sheet writes will happen." : "LIVE RUN: sheet writes are enabled.");
  console.log(`Database: ${config.spreadsheetId}`);
  console.log(`Query: ${config.query}`);

  let checkpoint = options.dryRun ? null : await loadCheckpoint(config);
  if (!options.dryRun && checkpoint && !checkpoint.ingestionLogRowNumber) {
    console.log("Ignoring old non-live checkpoint. It was likely created by a dry run.");
    checkpoint = null;
  }
  const runId = checkpoint?.runId ?? createRunId();
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
  const state = checkpoint ?? createInitialCheckpoint(runId, startedAt, config.query);

  const gmailTokenProvider = createGmailTokenProvider(config);
  const sheetsTokenProvider = createSheetsTokenProvider(config);
  const sheets = createSheetsClient(config, sheetsTokenProvider);
  const gmail = createGmailClient(gmailTokenProvider);

  const workbook = await loadWorkbook(sheets);
  const aliasMap = buildAliasMap(workbook.alias.rows, workbook.alias.headers);
  const indexes = buildIndexes(workbook);

  if (!options.dryRun) {
    await ensureGridCapacity(sheets, workbook.metadata, 10000);
    if (!state.ingestionLogRowNumber) {
      const logRowNumber = await appendIngestionLog(sheets, workbook, state);
      state.ingestionLogRowNumber = logRowNumber;
      await saveCheckpoint(config, state);
    }
  }

  let processedThisRun = 0;
  let hasMore = true;

  while (hasMore) {
    if (config.maxEmails && state.emailsScanned >= config.maxEmails) break;
    if (config.maxPages && state.pagesScanned >= config.maxPages) break;

    const page = await gmail.searchMessages({
      query: config.query,
      maxResults: config.pageSize,
      pageToken: state.nextPageToken || undefined,
    });

    const messageIds = (page.messages ?? []).map((message) => message.id).filter(Boolean);
    state.pagesScanned += 1;
    state.nextPageToken = page.nextPageToken ?? "";

    if (messageIds.length === 0) {
      hasMore = false;
      break;
    }

    let unreadIds = messageIds.filter((id) => !state.processedMessageIds.includes(id));
    if (config.maxEmails) {
      const remaining = Math.max(0, config.maxEmails - state.emailsScanned);
      unreadIds = unreadIds.slice(0, remaining);
    }
    const batches = chunk(unreadIds, config.batchSize);

    for (const batch of batches) {
      const messages = await mapWithConcurrency(batch, config.concurrency, (id) => gmail.getMessage(id));
      const plan = createWritePlan(messages, {
        aliasMap,
        indexes,
        workbook,
        state,
        options,
      });

      if (!options.dryRun) {
        await flushWritePlan(sheets, workbook, plan);
      }

      applyPlanToMemory(workbook, indexes, plan);
      updateCounters(state, plan);
      state.processedMessageIds.push(...batch);
      state.lastProcessedAt = new Date().toISOString();
      state.lastProcessedMessageId = batch[batch.length - 1] ?? state.lastProcessedMessageId;

      if (!options.dryRun) {
        await saveCheckpoint(config, state);
      }
      if (!options.dryRun && shouldUpdateIngestionLog(state)) {
        await updateIngestionLogSafely(sheets, workbook, state);
      }

      processedThisRun += batch.length;
      console.log(
        `Processed ${processedThisRun} messages this run | scanned ${state.emailsScanned} | created ${state.opportunitiesCreated} | updated ${state.opportunitiesUpdated} | skipped ${state.duplicatesSkipped} | reviews ${state.reviewItemsCreated}`,
      );

      if (config.maxEmails && state.emailsScanned >= config.maxEmails) break;
    }

    hasMore = Boolean(state.nextPageToken);
  }

  if (!options.dryRun) {
    await refreshIntelligenceTabs(sheets, workbook.metadata, 10000);
    state.finishedAt = new Date().toISOString();
    state.done = !state.nextPageToken || Boolean(config.maxEmails || config.maxPages);
    await saveCheckpoint(config, state);
    await updateIngestionLog(sheets, workbook, state);
    await saveCheckpoint(config, state);
  }

  printSummary(state, options);
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    resetCheckpoint: false,
    validateCredentials: false,
    validateSample: false,
    help: false,
    maxEmails: 0,
    maxPages: 0,
    pageSize: 100,
    batchSize: 50,
    concurrency: 3,
    query: DEFAULT_QUERY,
    checkpointPath: path.join(process.cwd(), CHECKPOINT_DIR, CHECKPOINT_FILE),
    checkpointExplicit: false,
    updateExisting: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--reset-checkpoint") options.resetCheckpoint = true;
    else if (arg === "--validate-credentials") options.validateCredentials = true;
    else if (arg === "--validate-sample") {
      options.validateSample = true;
      options.dryRun = true;
    }
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--no-update-existing") options.updateExisting = false;
    else if (arg === "--query") {
      options.query = next;
      index += 1;
    } else if (arg === "--max-emails") {
      options.maxEmails = Number(next);
      index += 1;
    } else if (arg === "--max-pages") {
      options.maxPages = Number(next);
      index += 1;
    } else if (arg === "--page-size") {
      options.pageSize = Number(next);
      index += 1;
    } else if (arg === "--batch-size") {
      options.batchSize = Number(next);
      index += 1;
    } else if (arg === "--concurrency") {
      options.concurrency = Number(next);
      index += 1;
    } else if (arg === "--checkpoint") {
      options.checkpointPath = path.resolve(next);
      options.checkpointExplicit = true;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function loadConfig(options) {
  const missing = [];
  let checkpointPath = options.checkpointPath;
  if (!options.checkpointExplicit && !options.dryRun && options.maxEmails > 0) {
    checkpointPath = path.join(process.cwd(), CHECKPOINT_DIR, `checkpoint.max-${options.maxEmails}.json`);
  }
  const config = {
    gmailClientId: env("GMAIL_CLIENT_ID", missing),
    gmailClientSecret: env("GMAIL_CLIENT_SECRET", missing),
    gmailRefreshToken: env("GMAIL_REFRESH_TOKEN", missing),
    serviceAccountEmail: env("GOOGLE_SERVICE_ACCOUNT_EMAIL", missing),
    privateKey: normalizePrivateKey(env("GOOGLE_PRIVATE_KEY", missing)),
    spreadsheetId: env("OPPORTUNITY_DATABASE_SPREADSHEET_ID", missing),
    query: options.query || process.env.OPPORTUNITY_GMAIL_QUERY || DEFAULT_QUERY,
    checkpointPath,
    maxEmails: options.maxEmails,
    maxPages: options.maxPages,
    pageSize: clamp(options.pageSize, 1, 500),
    batchSize: clamp(options.batchSize, 1, 50),
    concurrency: clamp(options.concurrency, 1, 8),
  };

  if (missing.length > 0 && !options.help && !options.resetCheckpoint) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return config;
}

function env(name, missing) {
  const value = process.env[name];
  if (!value) missing.push(name);
  return value ?? "";
}

function printHelp() {
  console.log(`
Opportunity Intelligence Gmail ingestion runner

Commands:
  npm run opportunity:ingest:dry-run
  npm run opportunity:ingest

Options:
  --dry-run                 Read Gmail and plan writes without updating Sheets
  --max-emails <number>     Stop after N scanned candidate emails
  --max-pages <number>      Stop after N Gmail search pages
  --page-size <number>      Gmail search page size, max 500
  --batch-size <number>     Message write batch size
  --concurrency <number>    Parallel Gmail reads, default 3
  --query <gmail query>     Override Gmail search query
  --checkpoint <path>       Override checkpoint path
  --reset-checkpoint        Delete checkpoint and exit
  --validate-credentials    Check Gmail auth and Sheets access without scanning email
  --validate-sample         Dry-run sample mode with quality warnings
  --no-update-existing      Skip existing Source Email IDs instead of improving rows
`);
}

async function validateCredentials(config) {
  console.log("Validating Opportunity Ingestion credentials...");
  console.log(`Gmail client ID: ${maskValue(config.gmailClientId)}`);
  console.log(`Gmail refresh token: ${maskValue(config.gmailRefreshToken)}`);
  console.log(`Service account: ${config.serviceAccountEmail}`);
  console.log(`Private key loaded: ${config.privateKey.includes("BEGIN PRIVATE KEY") ? "yes" : "no"}`);
  console.log(`Database spreadsheet ID: ${config.spreadsheetId}`);

  const gmailTokenProvider = createGmailTokenProvider(config);
  const sheetsTokenProvider = createSheetsTokenProvider(config);
  const sheets = createSheetsClient(config, sheetsTokenProvider);
  const gmail = createGmailClient(gmailTokenProvider);

  const profile = await gmail.profile();
  console.log(`Gmail auth: OK (${profile.emailAddress ?? "profile email hidden"})`);

  const metadata = await sheets.metadata();
  const sheetNames = (metadata.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter(Boolean);
  console.log(`Google Sheets auth: OK`);
  console.log(`Spreadsheet title: ${metadata.properties?.title ?? "Unknown"}`);
  console.log(`Tabs found: ${sheetNames.join(", ")}`);

  const missingTabs = Object.values(TAB_NAMES).filter((tabName) => !sheetNames.includes(tabName));
  if (missingTabs.length > 0) {
    console.log(`Missing expected tabs: ${missingTabs.join(", ")}`);
  } else {
    console.log("Expected tabs: OK");
  }

  console.log("Credential validation complete. No Gmail scan was run.");
}

function maskValue(value) {
  if (!value) return "missing";
  if (value.length <= 10) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatGoogleError(result) {
  const error = result.error ? String(result.error) : "";
  const description = result.error_description ? String(result.error_description) : "";
  if (error && description) return `${error} - ${description}`;
  return description || error || "No access token returned";
}

async function loadCheckpoint(config) {
  if (!existsSync(config.checkpointPath)) return null;
  const raw = await readFile(config.checkpointPath, "utf8");
  return JSON.parse(raw);
}

async function resetCheckpoints(config, options) {
  if (options.checkpointExplicit) {
    await rm(config.checkpointPath, { force: true });
    console.log(`Removed checkpoint: ${config.checkpointPath}`);
    return;
  }

  const checkpointDir = path.join(process.cwd(), CHECKPOINT_DIR);
  if (!existsSync(checkpointDir)) {
    console.log("No checkpoint folder found. Nothing to reset.");
    return;
  }

  const files = await readdir(checkpointDir);
  const checkpointFiles = files.filter((file) => /^checkpoint.*\.json$/.test(file));
  for (const file of checkpointFiles) {
    await rm(path.join(checkpointDir, file), { force: true });
  }
  console.log(`Removed ${checkpointFiles.length} local checkpoint file(s). Sheet data was not changed.`);
}

function createInitialCheckpoint(runId, startedAt, query) {
  return {
    runId,
    startedAt,
    finishedAt: "",
    query,
    nextPageToken: "",
    pagesScanned: 0,
    emailsScanned: 0,
    relevantEmailsFound: 0,
    opportunitiesCreated: 0,
    opportunitiesUpdated: 0,
    duplicatesSkipped: 0,
    skippedIrrelevant: 0,
    reviewNeededEmails: 0,
    unknownBrandCount: 0,
    unknownAgencyCount: 0,
    brandsCreated: 0,
    agenciesCreated: 0,
    contactsCreated: 0,
    reviewItemsCreated: 0,
    aliasesCreated: 0,
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    errors: [],
    confidenceDistribution: { high: 0, medium: 0, low: 0 },
    relevanceDistribution: {
      opportunityCreated: 0,
      reviewNeeded: 0,
      skippedIrrelevant: 0,
      duplicate: 0,
    },
    reasonCounts: {},
    classificationSamples: [],
    processedMessageIds: [],
    lastProcessedAt: "",
    lastProcessedMessageId: "",
    ingestionLogRowNumber: 0,
    done: false,
  };
}

async function saveCheckpoint(config, state) {
  await mkdir(path.dirname(config.checkpointPath), { recursive: true });
  await writeFile(config.checkpointPath, JSON.stringify(state, null, 2));
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `RUN-${stamp}-FULL`;
}

function createGmailTokenProvider(config) {
  let cached = null;
  return async function getToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.gmailClientId,
        client_secret: config.gmailClientSecret,
        refresh_token: config.gmailRefreshToken,
        grant_type: "refresh_token",
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      throw new Error(`Gmail OAuth failed (${response.status}): ${formatGoogleError(result)}`);
    }
    cached = {
      accessToken: result.access_token,
      expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000,
    };
    return cached.accessToken;
  };
}

function createSheetsTokenProvider(config) {
  let cached = null;
  return async function getToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
    const assertion = await signServiceAccountJwt(config);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      throw new Error(`Google Sheets service account auth failed (${response.status}): ${formatGoogleError(result)}`);
    }
    cached = {
      accessToken: result.access_token,
      expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000,
    };
    return cached.accessToken;
  };
}

async function signServiceAccountJwt(config) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64Url(
    JSON.stringify({
      iss: config.serviceAccountEmail,
      scope: SCOPES.sheets,
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const key = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

function createGmailClient(tokenProvider) {
  return {
    async profile() {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/profile");
      return googleFetch(url, tokenProvider);
    },
    async searchMessages({ query, maxResults, pageToken }) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("q", query);
      url.searchParams.set("maxResults", String(maxResults));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return googleFetch(url, tokenProvider);
    },
    async getMessage(messageId) {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
      url.searchParams.set("format", "full");
      return googleFetch(url, tokenProvider);
    },
  };
}

function createSheetsClient(config, tokenProvider) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}`;
  return {
    spreadsheetId: config.spreadsheetId,
    async metadata() {
      const url = new URL(base);
      url.searchParams.set("includeGridData", "false");
      return googleFetch(url, tokenProvider);
    },
    async batchGet(ranges) {
      const url = new URL(`${base}/values:batchGet`);
      for (const range of ranges) url.searchParams.append("ranges", range);
      url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
      return googleFetch(url, tokenProvider);
    },
    async valuesBatchUpdate(data) {
      const url = new URL(`${base}/values:batchUpdate`);
      return googleFetch(url, tokenProvider, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          valueInputOption: "USER_ENTERED",
          data,
        }),
      });
    },
    async batchUpdate(requests) {
      const url = new URL(`${base}:batchUpdate`);
      return googleFetch(url, tokenProvider, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requests }),
      });
    },
  };
}

async function googleFetch(url, tokenProvider, init = {}) {
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${await tokenProvider()}`,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maxAttempts - 1) {
      const delayMs = retryDelayMs(response, url, init, attempt);
      console.warn(`Google API asked us to slow down (${response.status}) on ${url.pathname}. Waiting ${Math.round(delayMs / 1000)}s before retry ${attempt + 2}/${maxAttempts}.`);
      await sleep(delayMs);
      continue;
    }
    throw new Error(`Google API failed (${response.status}) ${url.pathname}: ${body.error?.message ?? body.error ?? response.statusText}`);
  }
  throw new Error(`Google API failed after retries: ${url.pathname}`);
}

function retryDelayMs(response, url, init, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const isSheetsWrite = url.hostname.includes("sheets.googleapis.com") && String(init.method ?? "GET").toUpperCase() !== "GET";
  if (response.status === 429 && isSheetsWrite) return 65_000 + attempt * 5_000;
  return Math.min(30_000, 1000 * 2 ** attempt);
}

async function loadWorkbook(sheets) {
  const metadata = await sheets.metadata();
  const ranges = [
    `${quoteSheet(TAB_NAMES.opportunities)}!A1:CL`,
    `${quoteSheet(TAB_NAMES.organizations)}!A1:AN`,
    `${quoteSheet(TAB_NAMES.brands)}!A1:BI`,
    `${quoteSheet(TAB_NAMES.contacts)}!A1:AF`,
    `${quoteSheet(TAB_NAMES.review)}!A1:R`,
    `${quoteSheet(TAB_NAMES.log)}!A1:X`,
    `${quoteSheet(TAB_NAMES.alias)}!A1:G`,
  ];
  const result = await sheets.batchGet(ranges);
  const [opportunities, organizations, brands, contacts, review, log, alias] = result.valueRanges.map(parseTable);
  return { metadata, opportunities, organizations, brands, contacts, review, log, alias };
}

function parseTable(valueRange) {
  const values = valueRange?.values ?? [];
  return {
    headers: values[0] ?? [],
    rows: values.slice(1),
  };
}

function buildIndexes(workbook) {
  return {
    opportunitiesByEmailId: indexRowsByHeader(workbook.opportunities, "Source Email ID"),
    opportunityDuplicateKeys: buildOpportunityDuplicateIndex(workbook.opportunities),
    organizationsByName: indexRowsByHeader(workbook.organizations, "Organization Name"),
    brandsByName: indexRowsByHeader(workbook.brands, "Brand Name"),
    contactsByEmail: indexRowsByHeader(workbook.contacts, "Email"),
  };
}

function buildOpportunityDuplicateIndex(table) {
  const headerMap = headerMapFor(table.headers);
  const index = new Map();
  for (const row of table.rows) {
    const keys = buildExistingOpportunityDuplicateKeys(row, headerMap);
    for (const key of keys) {
      if (!index.has(key)) index.set(key, getCell(row, headerMap, "Opportunity ID") || "existing opportunity");
    }
  }
  return index;
}

function buildExistingOpportunityDuplicateKeys(row, headerMap) {
  const subject = getCell(row, headerMap, "Source Email Subject");
  const brandName = getCell(row, headerMap, "Brand Name");
  const sourceName = getCell(row, headerMap, "Source Organization Name");
  const date = getCell(row, headerMap, "Source Email Date");
  const summary = getCell(row, headerMap, "Campaign Summary");
  return unique([
    subjectDuplicateKey(subject),
    brandName && sourceName && date ? `brand-source-week:${normalizeKey(brandName)}:${normalizeKey(sourceName)}:${weekKey(date)}` : "",
    brandName && summary ? `brand-summary:${normalizeKey(brandName)}:${summaryKey(summary)}` : "",
  ]);
}

function findDuplicateOpportunity(extracted, context) {
  const keys = buildIncomingOpportunityDuplicateKeys(extracted);
  for (const key of keys) {
    const match = context.indexes.opportunityDuplicateKeys.get(key);
    if (match) {
      return {
        reason: RELEVANCE_REASONS.duplicate,
        detail: `Potential duplicate matched by ${key.split(":")[0]} against ${match}.`,
      };
    }
  }
  return null;
}

function buildIncomingOpportunityDuplicateKeys(extracted) {
  return unique([
    extracted.email.threadId ? `thread:${extracted.email.threadId}` : "",
    subjectDuplicateKey(extracted.email.subject),
    extracted.brandName && extracted.sourceOrganizationName
      ? `brand-source-week:${normalizeKey(extracted.brandName)}:${normalizeKey(extracted.sourceOrganizationName)}:${weekKey(extracted.email.date)}`
      : "",
    extracted.brandName && extracted.campaignSummary
      ? `brand-summary:${normalizeKey(extracted.brandName)}:${summaryKey(extracted.campaignSummary)}`
      : "",
  ]);
}

function buildAliasMap(rows, headers) {
  const headerMap = headerMapFor(headers);
  const aliasMap = new Map();
  for (const row of rows) {
    const approved = getCell(row, headerMap, "Approved?").toLowerCase() === "yes";
    const action = getCell(row, headerMap, "Suggested Action").toLowerCase();
    if (!approved || action !== "merge") continue;
    const entityType = normalizeKey(getCell(row, headerMap, "Entity Type"));
    const observed = normalizeKey(getCell(row, headerMap, "Observed Name"));
    const canonical = getCell(row, headerMap, "Canonical Name");
    if (entityType && observed && canonical) aliasMap.set(`${entityType}:${observed}`, canonical);
  }
  return aliasMap;
}

function createWritePlan(messages, context) {
  ensureQualityMetrics(context.state);
  const plan = {
    opportunityCreates: [],
    opportunityUpdates: [],
    organizationCreates: [],
    organizationUpdates: [],
    brandCreates: [],
    brandUpdates: [],
    contactCreates: [],
    contactUpdates: [],
    reviewCreates: [],
    aliasCreates: [],
    skipped: [],
  };

  for (const message of messages) {
    context.state.emailsScanned += 1;
    try {
      const email = normalizeGmailMessage(message);
      const extracted = extractOpportunity(email, context.aliasMap);

      if (!extracted.isRelevant) {
        const classification = extracted.classification ?? "Skipped Irrelevant";
        recordClassification(context.state, {
          email,
          classification,
          reason: extracted.reasonCode ?? extracted.skipReason ?? RELEVANCE_REASONS.noOpportunity,
          detail: extracted.reasonDetail ?? extracted.skipReason ?? "",
          brandName: extracted.brandName ?? "Unknown",
          sourceOrganizationName: extracted.sourceOrganizationName ?? "Unknown",
          opportunityType: extracted.opportunityType ?? "Unknown",
          confidenceScore: extracted.confidenceScore ?? 0,
        });
        if (classification === "Review Needed") {
          plan.reviewCreates.push(buildReviewRow(extracted, context.workbook.review.headers));
        } else {
          plan.skipped.push({ id: email.id, reason: extracted.reasonCode ?? extracted.skipReason });
        }
        continue;
      }

      const opportunityRow = buildOpportunityRow(extracted, context.workbook.opportunities.headers);
      const sourceIndex = context.indexes.opportunitiesByEmailId.get(email.id);
      if (sourceIndex && context.options.updateExisting) {
        const existing = context.workbook.opportunities.rows[sourceIndex.rowIndex] ?? [];
        plan.opportunityUpdates.push({
          rowNumber: sourceIndex.rowNumber,
          values: mergeOpportunityRows(existing, opportunityRow, context.workbook.opportunities.headers),
        });
        context.state.relevantEmailsFound += 1;
        recordClassification(context.state, {
          email,
          classification: "Opportunity Created",
          reason: extracted.reasonCode,
          detail: "Source Email ID already exists, so the existing opportunity row will be updated instead of duplicated.",
          brandName: extracted.brandName,
          sourceOrganizationName: extracted.sourceOrganizationName,
          opportunityType: extracted.opportunityType,
          confidenceScore: extracted.confidenceScore,
        });
        addConfidenceBucket(context.state, extracted.confidenceScore);
        continue;
      }

      const duplicate = sourceIndex ? { reason: RELEVANCE_REASONS.duplicate, detail: "Source Email ID already exists." } : findDuplicateOpportunity(extracted, context);

      if (duplicate) {
        recordClassification(context.state, {
          email,
          classification: "Skipped Irrelevant",
          reason: RELEVANCE_REASONS.duplicate,
          detail: duplicate.detail,
          brandName: extracted.brandName,
          sourceOrganizationName: extracted.sourceOrganizationName,
          opportunityType: extracted.opportunityType,
          confidenceScore: extracted.confidenceScore,
        });
        plan.skipped.push({ id: email.id, reason: duplicate.reason, duplicate: true });
        continue;
      }

      context.state.relevantEmailsFound += 1;

      plan.opportunityCreates.push(opportunityRow);
      for (const duplicateKey of buildIncomingOpportunityDuplicateKeys(extracted)) {
        if (!context.indexes.opportunityDuplicateKeys.has(duplicateKey)) {
          context.indexes.opportunityDuplicateKeys.set(duplicateKey, extracted.email.id);
        }
      }

      upsertReferenceRows(extracted, context, plan);

      if (extracted.needsHumanReview) {
        plan.reviewCreates.push(buildReviewRow(extracted, context.workbook.review.headers));
      }

      for (const alias of extracted.suggestedAliases) {
        plan.aliasCreates.push(buildAliasRow(alias, context.workbook.alias.headers));
      }

      recordClassification(context.state, {
        email,
        classification: "Opportunity Created",
        reason: extracted.reasonCode,
        detail: extracted.reasonDetail,
        brandName: extracted.brandName,
        sourceOrganizationName: extracted.sourceOrganizationName,
        opportunityType: extracted.opportunityType,
        confidenceScore: extracted.confidenceScore,
      });
      addConfidenceBucket(context.state, extracted.confidenceScore);
    } catch (error) {
      context.state.errors.push(`${message.id}: ${safeError(error)}`);
    }
  }

  return plan;
}

function extractOpportunity(email, aliasMap) {
  const text = `${email.subject}\n${email.snippet}\n${email.body}`.slice(0, 60_000);
  const lower = text.toLowerCase();

  if (isIgnorableEmail(lower)) {
    return buildNonOpportunityResult(email, {
      classification: "Skipped Irrelevant",
      reasonCode: RELEVANCE_REASONS.internal,
      reasonDetail: "Operational, personal, billing, or account email without creator opportunity context.",
    });
  }

  const opportunitySignals = [
    "paid collaboration",
    "collaboration",
    "campaign",
    "brief",
    "creator",
    "influencer",
    "affiliate",
    "commission",
    "song promotion",
    "music promotion",
    "ugc",
    "whitelisting",
    "spark",
    "ad code",
    "ambassador",
    "gifted",
    "pr box",
    "partnership",
    "rate",
    "budget",
    "deliverable",
    "usage rights",
  ];

  if (!opportunitySignals.some((signal) => lower.includes(signal))) {
    return buildNonOpportunityResult(email, {
      classification: "Skipped Irrelevant",
      reasonCode: RELEVANCE_REASONS.noOpportunity,
      reasonDetail: "Gmail result did not contain a clear creator, campaign, brand, or commercial opportunity signal.",
    });
  }

  const sender = parseSender(email.from);
  const source = inferSourceOrganization(sender, text);
  const rawBrand = inferBrand(email.subject, text, source);
  const brandName = applyAlias(aliasMap, "Brand", rawBrand || "Unknown");
  const sourceOrganizationName = applyAlias(aliasMap, "Agency", source.name || "Unknown");
  const contactName = applyAlias(aliasMap, "Contact", sender.name || "Unknown");
  const contactEmail = sender.email || "Unknown";
  const opportunityType = classifyOpportunityType(lower, brandName, sourceOrganizationName);
  const opportunityName = inferOpportunityName(brandName, opportunityType, email.subject);
  const budget = extractBudget(text, opportunityType);
  const creator = extractCreatorRequirements(text);
  const deliverables = extractDeliverables(text);
  const status = inferOpportunityStatus(lower, email.date);
  const sourceStrength = inferSourceStrength(source, lower, email);
  const commercial = classifyCommercialQuality({ budget, opportunityType, lower });
  const relevance = classifyRelevance({ opportunityType, commercial, lower, status });
  const confidenceScore = scoreConfidence({
    brandName,
    sourceOrganizationName,
    contactEmail,
    opportunityType,
    budget,
    creator,
    deliverables,
    sourceStrength,
  });
  const review = buildReviewSignals({
    brandName,
    source,
    opportunityType,
    budget,
    creator,
    confidenceScore,
    commercial,
    sourceStrength,
  });

  const suggestedAliases = [];
  if (rawBrand && rawBrand !== brandName) {
    // Approved aliases are applied, not re-created.
  }
  if (isProbablyUnknownBrand(brandName) && source.name !== "Unknown" && source.type !== "Brand") {
    suggestedAliases.push({
      entityType: "Unknown Entity",
      observedName: `${brandName} from ${sender.email}`,
      canonicalName: "Unknown",
      confidence: "Low",
      action: "Review",
    });
  }

  const actionability = evaluateOpportunityIntent({
    email,
    lower,
    source,
    sourceStrength,
    brandName,
    sourceOrganizationName,
    opportunityType,
    budget,
    creator,
    deliverables,
  });

  const baseResult = {
    email,
    opportunityName,
    opportunityType,
    opportunityStatus: status,
    brandName,
    brandCategory: inferCategory(text, opportunityType),
    sourceOrganizationName,
    sourceOrganizationType: source.type,
    contactName,
    contactEmail,
    contactRole: inferContactRole(text, source.type),
    campaignSummary: summarizeCampaign(brandName, opportunityType, text),
    creator,
    budget,
    deliverables,
    usageRights: extractUsageRights(text),
    whitelisting: extractWhitelisting(text),
    exclusivity: extractExclusivity(text),
    timeline: extractTimeline(text),
    applicationProcess: extractApplicationProcess(text),
    matchingKeywords: buildKeywords(brandName, sourceOrganizationName, opportunityType, creator, text),
    confidenceScore,
    needsHumanReview: review.issues.length > 0,
    reviewNotes: review.notes,
    reviewIssues: review.issues,
    brandPreferenceTags: buildPreferenceTags(creator, opportunityType, text),
    creatorMatchTags: buildCreatorMatchTags(creator, opportunityType, text),
    requirementConfidence: confidenceScore >= 85 ? "High" : confidenceScore >= 70 ? "Medium" : "Low",
    commercialQuality: commercial.quality,
    budgetRating: commercial.rating,
    budgetFloorConcern: commercial.budgetFloorConcern,
    fixedFeePresent: budget.fixedFeePresent,
    affiliatePresent: budget.affiliatePresent,
    affiliateOnly: budget.affiliateOnly,
    songPromotionException: opportunityType === "Song Promotion" ? "Yes" : "No",
    historicalValue: confidenceScore >= 80 ? "High" : confidenceScore >= 65 ? "Medium" : "Low",
    stillUsefulForMatching: review.issues.includes(REVIEW_ISSUES.unclearBrand) ? "Maybe" : "Yes",
    opportunityRelevanceType: relevance,
    opportunityAgeNotes: buildAgeNotes(email.date, relevance),
    disqualifierFlags: buildDisqualifierFlags(commercial, review.issues),
    rankingNotes: buildRankingNotes(commercial, relevance, confidenceScore),
    recommendedPitchAngle: buildPitchAngle(creator, opportunityType, brandName),
    sourceStrength,
    suggestedAliases,
    classification: actionability.classification,
    reasonCode: actionability.reasonCode,
    reasonDetail: actionability.reasonDetail,
  };

  if (actionability.classification !== "Opportunity Created") {
    return {
      ...baseResult,
      isRelevant: false,
      needsHumanReview: actionability.classification === "Review Needed",
      reviewIssues: unique([...review.issues, actionability.reviewIssue].filter(Boolean)),
      reviewNotes: actionability.reasonDetail,
    };
  }

  return {
    ...baseResult,
    isRelevant: true,
  };
}

function buildNonOpportunityResult(email, { classification, reasonCode, reasonDetail }) {
  return {
    isRelevant: false,
    email,
    classification,
    reasonCode,
    reasonDetail,
    skipReason: reasonCode,
    brandName: "Unknown",
    sourceOrganizationName: parseSender(email.from).domain || "Unknown",
    opportunityType: "Unknown",
    confidenceScore: 0,
  };
}

function evaluateOpportunityIntent({
  lower,
  source,
  sourceStrength,
  brandName,
  sourceOrganizationName,
  opportunityType,
  budget,
  creator,
  deliverables,
}) {
  const hasBrand = !isProbablyUnknownBrand(brandName);
  const hasKnownSource = sourceOrganizationName !== "Unknown";
  const hasBudget = budget.amount !== "Unknown";
  const hasDeliverables = deliverables !== "Unknown";
  const hasCreatorRequirements = Object.values(creator).some((value) => value && value !== "Not specified");
  const hasFixedFee = budget.fixedFeePresent === "Yes";
  const hasBriefLanguage = /\b(brief|creator brief|brand brief|campaign brief|requirements?|deliverables?|casting|looking for)\b/.test(lower);
  const hasCampaignLanguage = /\b(campaign|collaboration|partnership|sponsorship|opportunity|promotion|ambassador|whitelisting|usage rights|spark ads?|ugc)\b/.test(lower);
  const hasPaidLanguage = /\b(paid|budget|rate|fee|flat rate|fixed fee|offer|payment|compensation)\b/.test(lower);
  const isNewsletterish = /\b(newsletter|digest|roundup|webinar|report|case study|blog|product update|manage preferences|view in browser)\b/.test(lower);
  const hasUnsubscribe = /\bunsubscribe\b/.test(lower);
  const actionableContext = hasBrand || hasKnownSource || hasCreatorRequirements || hasBudget || hasDeliverables;
  const realOpportunityContext = (hasBrand || hasKnownSource) && (hasCreatorRequirements || hasBudget || hasDeliverables || hasBriefLanguage);
  const nonActionableMarketing = isNonActionableMarketingEmail(lower) && !hasFixedFee && !hasDeliverables && !hasBriefLanguage;

  if (nonActionableMarketing) {
    return {
      classification: "Skipped Irrelevant",
      reasonCode: RELEVANCE_REASONS.newsletter,
      reasonDetail: "Newsletter, no-reply, account, or marketing-style email without actionable creator brief details.",
    };
  }

  if (isNewsletterish && (hasUnsubscribe || sourceStrength === "Newsletter") && !hasPaidLanguage && !hasBudget && !hasDeliverables) {
    return {
      classification: "Skipped Irrelevant",
      reasonCode: RELEVANCE_REASONS.newsletter,
      reasonDetail: "Newsletter-style email without paid, deliverable, or brand brief detail.",
    };
  }

  if (isNewsletterish && !hasCampaignLanguage && !hasPaidLanguage && opportunityType === "Other") {
    return {
      classification: "Skipped Irrelevant",
      reasonCode: RELEVANCE_REASONS.newsletter,
      reasonDetail: "Newsletter-style email without actionable creator campaign details.",
    };
  }

  if (opportunityType === "Song Promotion" && /\b(song|music|artist|track|audio)\b/.test(lower) && (hasPaidLanguage || hasBudget || hasCampaignLanguage)) {
    return {
      classification: "Opportunity Created",
      reasonCode: RELEVANCE_REASONS.songPromotion,
      reasonDetail: "Song or music promotion language includes campaign/commercial intent.",
    };
  }

  if (opportunityType === "Affiliate" && /\b(affiliate|commission|tiktok shop|creator marketplace)\b/.test(lower) && realOpportunityContext) {
    return {
      classification: "Opportunity Created",
      reasonCode: RELEVANCE_REASONS.affiliateOffer,
      reasonDetail: "Affiliate or commission-based creator offer detected.",
    };
  }

  if (opportunityType === "PR Gifting" && /\b(pr box|gifted|free product|sample|gifting)\b/.test(lower) && realOpportunityContext) {
    return {
      classification: "Opportunity Created",
      reasonCode: RELEVANCE_REASONS.prGifting,
      reasonDetail: "PR gifting or product seeding opportunity detected.",
    };
  }

  if ((source.type === "Agency" || source.type === "PR Agency" || source.type === "Talent Platform" || sourceStrength === "Agency Brief") && hasCampaignLanguage && realOpportunityContext) {
    return {
      classification: "Opportunity Created",
      reasonCode: RELEVANCE_REASONS.agencyBrief,
      reasonDetail: "Agency/source email includes campaign intent and creator/opportunity details.",
    };
  }

  if (hasBrand && hasBriefLanguage && (hasCreatorRequirements || hasBudget || hasDeliverables)) {
    return {
      classification: "Opportunity Created",
      reasonCode: RELEVANCE_REASONS.clearBrandBrief,
      reasonDetail: "Brand brief has enough creator, budget, or deliverable context.",
    };
  }

  if ((opportunityType === "Paid Campaign" || hasPaidLanguage) && hasCampaignLanguage && (hasBrand || hasKnownSource) && (hasBudget || hasDeliverables || hasCreatorRequirements)) {
    return {
      classification: "Opportunity Created",
      reasonCode: RELEVANCE_REASONS.paidCampaign,
      reasonDetail: "Paid/campaign language includes enough actionable context.",
    };
  }

  if ((hasBriefLanguage || hasCampaignLanguage || hasPaidLanguage) && actionableContext) {
    return {
      classification: "Review Needed",
      reasonCode: RELEVANCE_REASONS.tooVague,
      reasonDetail: "Potential opportunity, but not enough clear brand, creator, budget, or deliverable detail to create a confident opportunity row.",
      reviewIssue: REVIEW_ISSUES.lowConfidence,
    };
  }

  if (isNewsletterish || hasUnsubscribe || sourceStrength === "Newsletter" || sourceStrength === "Mass Creator Blast") {
    return {
      classification: "Skipped Irrelevant",
      reasonCode: RELEVANCE_REASONS.newsletter,
      reasonDetail: "Mass/newsletter-style message without enough actionable opportunity details.",
    };
  }

  return {
    classification: "Skipped Irrelevant",
    reasonCode: RELEVANCE_REASONS.noOpportunity,
    reasonDetail: "No clear actionable creator opportunity intent detected.",
  };
}

function buildOpportunityRow(extracted, headers) {
  const row = blankRow(headers.length);
  const now = new Date().toISOString();
  const id = stableId("OPP", extracted.email.date, extracted.email.id);
  const values = {
    "Opportunity ID": id,
    "Source Email ID": extracted.email.id,
    "Source Email Date": dateOnly(extracted.email.date),
    "Source Email Subject": extracted.email.subject,
    "Source Email Link": extracted.email.displayUrl,
    "Extracted At": now,
    "Last Updated": now,
    "Opportunity Name": extracted.opportunityName,
    "Opportunity Type": extracted.opportunityType,
    "Opportunity Status": extracted.opportunityStatus,
    "Brand Name": extracted.brandName,
    "Brand Category": extracted.brandCategory,
    "Source Organization Name": extracted.sourceOrganizationName,
    "Source Organization Type": extracted.sourceOrganizationType,
    "Contact Name": extracted.contactName,
    "Contact Email": extracted.contactEmail,
    "Contact Role": extracted.contactRole,
    "Campaign Summary": extracted.campaignSummary,
    "Creator Gender Requirement": extracted.creator.gender,
    "Creator Country Requirement": extracted.creator.country,
    "Creator Language Requirement": extracted.creator.language,
    "Creator Platform Requirement": extracted.creator.platforms,
    "Creator Niche Requirement": extracted.creator.niche,
    "Audience Requirement": extracted.creator.audience,
    "Follower Range Requirement": extracted.creator.followers,
    "Engagement Requirement": extracted.creator.engagement,
    "Special Creator Requirements": extracted.creator.special,
    "Budget Amount": extracted.budget.amount,
    "Budget Currency": extracted.budget.currency,
    "Budget Notes": extracted.budget.notes,
    "Affiliate Commission": extracted.budget.affiliateCommission,
    Deliverables: extracted.deliverables,
    "Usage Rights": extracted.usageRights,
    "Whitelisting / Paid Media": extracted.whitelisting,
    Exclusivity: extracted.exclusivity,
    "Timeline / Deadline": extracted.timeline,
    "Application Process": extracted.applicationProcess,
    "Open To Pitching?": extracted.opportunityStatus === "Expired" ? "No" : "Yes",
    "Matching Keywords": extracted.matchingKeywords,
    "Confidence Score": String(extracted.confidenceScore),
    "Needs Human Review": extracted.needsHumanReview ? "TRUE" : "FALSE",
    "Review Notes": extracted.reviewNotes,
    "Account Owner": "Unknown",
    "Last Owner": "Unknown",
    "Member Tag / Deal Code": "Unknown",
    "Relationship Notes": "Generated by Gmail ingestion runner; review before manual enrichment.",
    "Brand Preference Tags": extracted.brandPreferenceTags,
    "Creator Match Tags": extracted.creatorMatchTags,
    "Requirement Confidence": extracted.requirementConfidence,
    "Commercial Quality": extracted.commercialQuality,
    "Budget Rating": extracted.budgetRating,
    "Minimum Budget Concern": extracted.budgetFloorConcern,
    "Typical Budget Range": extracted.budget.typicalRange,
    "Expected Deal Value": extracted.budget.expectedValue,
    "Commercial Notes": extracted.budget.commercialNotes,
    "Last Communication Date": dateOnly(extracted.email.date),
    "Communication Recency": communicationRecency(extracted.email.date),
    "Communication Status": communicationStatus(extracted.email.date),
    "Historical Value": extracted.historicalValue,
    "Still Useful For Matching?": extracted.stillUsefulForMatching,
    "Opportunity Relevance Type": extracted.opportunityRelevanceType,
    "Opportunity Age Notes": extracted.opportunityAgeNotes,
    "Commercial Quality Score": commercialScore(extracted.commercialQuality),
    "Relationship Score": relationshipScore(extracted.sourceStrength),
    "Recency Score": recencyScore(extracted.email.date),
    "Disqualifier Flags": extracted.disqualifierFlags,
    "Ranking Notes": extracted.rankingNotes,
    "Recommended Pitch Angle": extracted.recommendedPitchAngle,
    "Budget Floor Concern": extracted.budgetFloorConcern,
    "Fixed Fee Present?": extracted.fixedFeePresent,
    "Affiliate Present?": extracted.affiliatePresent,
    "Affiliate Only?": extracted.affiliateOnly,
    "Song Promotion Exception?": extracted.songPromotionException,
    "Historical Outcome": "Unknown",
    "Outcome Notes": "Unknown",
    "Won Before?": "Unknown",
    "Lost Before?": "Unknown",
    "Revenue Generated": "",
    "Approx Deal Value": extracted.budget.expectedValue,
    "Success Signal": "Unknown",
    "Budget Penalty Score": extracted.budgetFloorConcern === "Yes" ? "40" : "0",
    "Affiliate Penalty Score": extracted.affiliateOnly === "Yes" ? "50" : extracted.affiliatePresent === "Yes" ? "10" : "0",
    "Disqualifier Penalty Score": extracted.disqualifierFlags ? "15" : "0",
    "Source Strength": extracted.sourceStrength,
  };
  fillRow(row, headers, values);
  return row;
}

function mergeOpportunityRows(existing, incoming, headers) {
  const headerMap = headerMapFor(headers);
  const existingConfidence = Number(getCell(existing, headerMap, "Confidence Score")) || 0;
  const incomingConfidence = Number(getCell(incoming, headerMap, "Confidence Score")) || 0;
  const merged = [...existing];

  headers.forEach((header, index) => {
    const current = existing[index] ?? "";
    const next = incoming[index] ?? "";
    if (!current && next) merged[index] = next;
    else if (incomingConfidence > existingConfidence && next && !isManualField(header)) merged[index] = next;
  });

  setCell(merged, headerMap, "Last Updated", new Date().toISOString());
  return merged;
}

function isManualField(header) {
  return [
    "Account Owner",
    "Last Owner",
    "Member Tag / Deal Code",
    "Relationship Notes",
    "Review Notes",
    "Reviewer Notes",
  ].includes(header);
}

function buildReviewRow(extracted, headers) {
  const row = blankRow(headers.length);
  const reviewIssues = unique(extracted.reviewIssues ?? []);
  fillRow(row, headers, {
    "Review ID": stableId("REV", extracted.email.date, extracted.email.id),
    "Source Email ID": extracted.email.id,
    "Source Email Date": dateOnly(extracted.email.date),
    "Source Email Subject": extracted.email.subject,
    "Source Email Link": extracted.email.displayUrl,
    "Issue Type": reviewIssues.join("; ") || extracted.reasonCode || "Review Needed",
    "Extracted Guess": `${extracted.brandName} | ${extracted.sourceOrganizationName} | ${extracted.opportunityType}`,
    "Reason For Review": buildReviewReason(extracted, reviewIssues),
    "Suggested Fix": buildReviewSuggestedFix(extracted, reviewIssues),
    "Reviewed?": "No",
    "Suggested Brand Preference Tags": extracted.brandPreferenceTags,
    "Suggested Commercial Quality": extracted.commercialQuality,
    "Suggested Relevance Type": extracted.opportunityRelevanceType,
    "Suggested Priority": extracted.confidenceScore >= 80 ? "Medium" : "Review",
    "Reviewer Decision": "",
  });
  return row;
}

function buildReviewReason(extracted, issues) {
  const parts = [];
  if (extracted.reasonCode) parts.push(`${extracted.reasonCode}: ${extracted.reasonDetail}`);
  for (const issue of issues) {
    const detail = reviewIssueDetail(issue);
    if (detail) parts.push(`${issue}: ${detail.whyItMatters}`);
  }
  return unique(parts).join(" | ") || "Extraction needs human review before matching.";
}

function buildReviewSuggestedFix(extracted, issues) {
  const fixes = issues.map((issue) => reviewIssueDetail(issue)?.suggestedFix).filter(Boolean);
  if (extracted.reasonCode === RELEVANCE_REASONS.tooVague) {
    fixes.unshift("Open the source email and confirm whether this is an actual creator opportunity before creating an Opportunity row.");
  }
  return unique(fixes).join(" | ") || "Review brand, source organization, opportunity type, creator requirements, and commercial terms.";
}

function reviewIssueDetail(issue) {
  const details = {
    [REVIEW_ISSUES.unclearBrand]: {
      whyItMatters: "Brand is unclear, so future creator matching could point to the wrong company.",
      suggestedFix: "Identify the actual brand from the email body/signature, not just the sender domain.",
    },
    [REVIEW_ISSUES.unclearAgency]: {
      whyItMatters: "Source organization is unclear, so relationship history may be attached to the wrong agency/contact.",
      suggestedFix: "Confirm whether the sender is a brand, agency, platform, label, or unknown source.",
    },
    [REVIEW_ISSUES.missingBudget]: {
      whyItMatters: "Budget is missing, so commercial priority cannot be scored reliably.",
      suggestedFix: "Add budget or mark Unknown if the email does not mention money.",
    },
    [REVIEW_ISSUES.vagueRequirements]: {
      whyItMatters: "Creator requirements are vague, so matching signals may be weak.",
      suggestedFix: "Add country, niche, platform, gender, audience, or follower requirements if visible.",
    },
    [REVIEW_ISSUES.lowConfidence]: {
      whyItMatters: "Extractor confidence is low, so the row may mix brand, agency, or campaign details.",
      suggestedFix: "Review the extracted guess against the source email before using this for matching.",
    },
    [REVIEW_ISSUES.lowBudget]: {
      whyItMatters: "Low-budget opportunities should not rank highly for normal paid campaign pitching.",
      suggestedFix: "Confirm whether this is low-value, affiliate-only, or a song-promotion exception.",
    },
    [REVIEW_ISSUES.affiliate]: {
      whyItMatters: "Pure affiliate offers usually cannot support manager commission.",
      suggestedFix: "Confirm whether there is any fixed fee alongside affiliate commission.",
    },
    [REVIEW_ISSUES.historical]: {
      whyItMatters: "The email may be a historical preference signal, not an active opportunity.",
      suggestedFix: "Mark relevance type as historical signal if the campaign is no longer active.",
    },
    [REVIEW_ISSUES.duplicate]: {
      whyItMatters: "Possible duplicate records can inflate opportunity and brand intelligence counts.",
      suggestedFix: "Compare source subject, brand, sender, and campaign summary before keeping both rows.",
    },
  };
  return details[issue] ?? null;
}

function buildAliasRow(alias, headers) {
  const row = blankRow(headers.length);
  fillRow(row, headers, {
    "Entity Type": alias.entityType,
    "Observed Name": alias.observedName,
    "Canonical Name": alias.canonicalName,
    Occurrences: "1",
    Confidence: alias.confidence,
    "Suggested Action": alias.action,
    "Approved?": "No",
  });
  return row;
}

function upsertReferenceRows(extracted, context, plan) {
  const brandKey = normalizeKey(extracted.brandName);
  if (brandKey && brandKey !== "unknown" && !context.indexes.brandsByName.has(brandKey)) {
    plan.brandCreates.push(buildBrandRow(extracted, context.workbook.brands.headers));
    context.indexes.brandsByName.set(brandKey, { rowIndex: context.workbook.brands.rows.length + plan.brandCreates.length - 1, rowNumber: context.workbook.brands.rows.length + plan.brandCreates.length + 1 });
  }

  const orgKey = normalizeKey(extracted.sourceOrganizationName);
  if (orgKey && orgKey !== "unknown" && !context.indexes.organizationsByName.has(orgKey)) {
    plan.organizationCreates.push(buildOrganizationRow(extracted, context.workbook.organizations.headers));
    context.indexes.organizationsByName.set(orgKey, { rowIndex: context.workbook.organizations.rows.length + plan.organizationCreates.length - 1, rowNumber: context.workbook.organizations.rows.length + plan.organizationCreates.length + 1 });
  }

  const contactKey = normalizeKey(extracted.contactEmail);
  if (contactKey && contactKey !== "unknown" && !context.indexes.contactsByEmail.has(contactKey)) {
    plan.contactCreates.push(buildContactRow(extracted, context.workbook.contacts.headers));
    context.indexes.contactsByEmail.set(contactKey, { rowIndex: context.workbook.contacts.rows.length + plan.contactCreates.length - 1, rowNumber: context.workbook.contacts.rows.length + plan.contactCreates.length + 1 });
  }
}

function buildBrandRow(extracted, headers) {
  const row = blankRow(headers.length);
  fillRow(row, headers, {
    "Brand ID": stableId("BRAND", extracted.email.date, extracted.brandName),
    "Brand Name": extracted.brandName,
    "Parent Organization": extracted.sourceOrganizationName,
    Category: extracted.brandCategory,
    "Country / Market": extracted.creator.country,
    "Total Opportunities Found": "1",
    "Most Common Opportunity Type": extracted.opportunityType,
    "Most Common Creator Requirement": extracted.creatorMatchTags,
    "Most Common Platform": extracted.creator.platforms,
    "Typical Budget Range": extracted.budget.typicalRange,
    "Typical Usage Rights": extracted.usageRights,
    "Typical Exclusivity": extracted.exclusivity,
    "Last Seen": dateOnly(extracted.email.date),
    "Brand Notes": "Created by Gmail ingestion runner.",
    "Confidence Score": String(extracted.confidenceScore),
    "Needs Human Review": extracted.needsHumanReview ? "TRUE" : "FALSE",
    "Brand Preference Tags": extracted.brandPreferenceTags,
    "Known Preferences": extracted.creatorMatchTags,
    "Typical Creator Gender": extracted.creator.gender,
    "Typical Creator Country": extracted.creator.country,
    "Typical Creator Language": extracted.creator.language,
    "Typical Creator Platform": extracted.creator.platforms,
    "Typical Creator Niches": extracted.creator.niche,
    "Typical Audience Requirements": extracted.creator.audience,
    "Typical Opportunity Types": extracted.opportunityType,
    "Commercial Quality": extracted.commercialQuality,
    "Budget Floor Concern": extracted.budgetFloorConcern,
    "Minimum Budget Concern": extracted.budgetFloorConcern,
    "Last Communication Date": dateOnly(extracted.email.date),
    "Communication Recency": communicationRecency(extracted.email.date),
    "Communication Status": communicationStatus(extracted.email.date),
    "Historical Preference Value": extracted.historicalValue,
    "Still Useful For Matching?": extracted.stillUsefulForMatching,
    "Recommended Pitch Angle": extracted.recommendedPitchAngle,
    "Weekly Update Eligible?": "Yes",
  });
  return row;
}

function buildOrganizationRow(extracted, headers) {
  const row = blankRow(headers.length);
  fillRow(row, headers, {
    "Organization ID": stableId("ORG", extracted.email.date, extracted.sourceOrganizationName),
    "Organization Name": extracted.sourceOrganizationName,
    "Organization Type": extracted.sourceOrganizationType,
    "Primary Contact Email": extracted.contactEmail,
    "Primary Contact Name": extracted.contactName,
    "Total Opportunities Found": "1",
    "Brands Represented": extracted.brandName,
    "Last Seen": dateOnly(extracted.email.date),
    "Relationship Notes": "Created by Gmail ingestion runner.",
    "Confidence Score": String(extracted.confidenceScore),
    "Needs Human Review": extracted.needsHumanReview ? "TRUE" : "FALSE",
    "Last Communication Date": dateOnly(extracted.email.date),
    "Communication Recency": communicationRecency(extracted.email.date),
    "Communication Status": communicationStatus(extracted.email.date),
    "Brands Represented Normalized": extracted.brandName,
    "Typical Opportunity Types": extracted.opportunityType,
    "Typical Commercial Quality": extracted.commercialQuality,
    "Commercial Notes": extracted.budget.commercialNotes,
    "Weekly Update Eligible?": "Yes",
    "Opportunity Volume": "Low",
    "Agency Usefulness": extracted.sourceOrganizationType === "Brand" ? "Unknown" : "Medium",
    "Budget Pattern": extracted.budgetRating,
  });
  return row;
}

function buildContactRow(extracted, headers) {
  const row = blankRow(headers.length);
  fillRow(row, headers, {
    "Contact ID": stableId("CONTACT", extracted.email.date, extracted.contactEmail),
    "Contact Name": extracted.contactName,
    Email: extracted.contactEmail,
    Organization: extracted.sourceOrganizationName,
    Role: extracted.contactRole,
    "Brands Mentioned": extracted.brandName,
    "Total Opportunities Sent": "1",
    "Last Seen": dateOnly(extracted.email.date),
    Notes: "Created by Gmail ingestion runner.",
    "Confidence Score": String(extracted.confidenceScore),
    "Needs Human Review": extracted.needsHumanReview ? "TRUE" : "FALSE",
    "Last Communication Date": dateOnly(extracted.email.date),
    "Communication Recency": communicationRecency(extracted.email.date),
    "Communication Status": communicationStatus(extracted.email.date),
    "Brands Represented Normalized": extracted.brandName,
    "Typical Opportunity Types": extracted.opportunityType,
    "Typical Creator Preferences": extracted.creatorMatchTags,
    "Commercial Quality": extracted.commercialQuality,
    "Best Use": "Use this contact when creator profile matches the extracted brand/category signal.",
  });
  return row;
}

async function flushWritePlan(sheets, workbook, plan) {
  const writes = [];
  appendRange(writes, workbook.opportunities, TAB_NAMES.opportunities, plan.opportunityCreates);
  appendRange(writes, workbook.organizations, TAB_NAMES.organizations, plan.organizationCreates);
  appendRange(writes, workbook.brands, TAB_NAMES.brands, plan.brandCreates);
  appendRange(writes, workbook.contacts, TAB_NAMES.contacts, plan.contactCreates);
  appendRange(writes, workbook.review, TAB_NAMES.review, plan.reviewCreates);
  appendRange(writes, workbook.alias, TAB_NAMES.alias, plan.aliasCreates);

  for (const update of plan.opportunityUpdates) {
    writes.push({
      range: `${quoteSheet(TAB_NAMES.opportunities)}!A${update.rowNumber}:${columnName(update.values.length - 1)}${update.rowNumber}`,
      majorDimension: "ROWS",
      values: [update.values],
    });
  }

  if (writes.length > 0) await sheets.valuesBatchUpdate(writes);
}

function appendRange(writes, table, sheetName, rows) {
  if (rows.length === 0) return;
  const startRow = table.rows.length + 2;
  writes.push({
    range: `${quoteSheet(sheetName)}!A${startRow}`,
    majorDimension: "ROWS",
    values: rows,
  });
}

function applyPlanToMemory(workbook, indexes, plan) {
  appendMemory(workbook.opportunities, indexes.opportunitiesByEmailId, plan.opportunityCreates, "Source Email ID");
  appendMemory(workbook.organizations, indexes.organizationsByName, plan.organizationCreates, "Organization Name");
  appendMemory(workbook.brands, indexes.brandsByName, plan.brandCreates, "Brand Name");
  appendMemory(workbook.contacts, indexes.contactsByEmail, plan.contactCreates, "Email");
  workbook.review.rows.push(...plan.reviewCreates);
  workbook.alias.rows.push(...plan.aliasCreates);
  for (const update of plan.opportunityUpdates) {
    workbook.opportunities.rows[update.rowNumber - 2] = update.values;
  }
}

function appendMemory(table, index, rows, keyHeader) {
  const headerMap = headerMapFor(table.headers);
  for (const row of rows) {
    table.rows.push(row);
    const rowNumber = table.rows.length + 1;
    index.set(normalizeKey(getCell(row, headerMap, keyHeader)), { rowIndex: table.rows.length - 1, rowNumber });
  }
}

function updateCounters(state, plan) {
  ensureQualityMetrics(state);
  state.opportunitiesCreated += plan.opportunityCreates.length;
  state.opportunitiesUpdated += plan.opportunityUpdates.length;
  state.brandsCreated += plan.brandCreates.length;
  state.agenciesCreated += plan.organizationCreates.length;
  state.contactsCreated += plan.contactCreates.length;
  state.reviewItemsCreated += plan.reviewCreates.length;
  state.aliasesCreated += plan.aliasCreates.length;
  state.duplicatesSkipped += plan.skipped.filter((item) => item.duplicate || item.reason === RELEVANCE_REASONS.duplicate).length;
  state.skippedIrrelevant += plan.skipped.filter((item) => !(item.duplicate || item.reason === RELEVANCE_REASONS.duplicate)).length;
  state.rowsCreated +=
    plan.opportunityCreates.length +
    plan.organizationCreates.length +
    plan.brandCreates.length +
    plan.contactCreates.length +
    plan.reviewCreates.length +
    plan.aliasCreates.length;
  state.rowsUpdated += plan.opportunityUpdates.length;
  state.rowsSkipped += plan.skipped.length;
}

function ensureQualityMetrics(state) {
  state.skippedIrrelevant ??= 0;
  state.reviewNeededEmails ??= 0;
  state.unknownBrandCount ??= 0;
  state.unknownAgencyCount ??= 0;
  state.relevanceDistribution ??= {
    opportunityCreated: 0,
    reviewNeeded: 0,
    skippedIrrelevant: 0,
    duplicate: 0,
  };
  state.reasonCounts ??= {};
  state.classificationSamples ??= [];
  state.confidenceDistribution ??= { high: 0, medium: 0, low: 0 };
}

function recordClassification(state, sample) {
  ensureQualityMetrics(state);
  const reason = sample.reason || "Unknown";
  state.reasonCounts[reason] = (state.reasonCounts[reason] ?? 0) + 1;

  if (sample.classification === "Opportunity Created") {
    state.relevanceDistribution.opportunityCreated += 1;
  } else if (sample.classification === "Review Needed") {
    state.relevanceDistribution.reviewNeeded += 1;
    state.reviewNeededEmails += 1;
  } else if (reason === RELEVANCE_REASONS.duplicate) {
    state.relevanceDistribution.duplicate += 1;
  } else {
    state.relevanceDistribution.skippedIrrelevant += 1;
  }

  const shouldCountUnknowns = sample.classification === "Opportunity Created" || sample.classification === "Review Needed";
  if (shouldCountUnknowns && isProbablyUnknownBrand(sample.brandName)) state.unknownBrandCount += 1;
  if (shouldCountUnknowns && (!sample.sourceOrganizationName || sample.sourceOrganizationName === "Unknown")) state.unknownAgencyCount += 1;

  if (state.classificationSamples.length < 100) {
    state.classificationSamples.push({
      subject: sample.email.subject,
      sender: sample.email.from,
      classification: sample.classification,
      reason,
      detail: sample.detail,
      brand: sample.brandName || "Unknown",
      sourceOrganization: sample.sourceOrganizationName || "Unknown",
      opportunityType: sample.opportunityType || "Unknown",
      confidence: sample.confidenceScore ?? 0,
    });
  }
}

async function appendIngestionLog(sheets, workbook, state) {
  const row = buildIngestionLogRow(state, workbook.log.headers);
  const rowNumber = workbook.log.rows.length + 2;
  await sheets.valuesBatchUpdate([
    {
      range: `${quoteSheet(TAB_NAMES.log)}!A${rowNumber}`,
      majorDimension: "ROWS",
      values: [row],
    },
  ]);
  workbook.log.rows.push(row);
  return rowNumber;
}

async function updateIngestionLog(sheets, workbook, state) {
  if (!state.ingestionLogRowNumber) return;
  const row = buildIngestionLogRow(state, workbook.log.headers);
  await sheets.valuesBatchUpdate([
    {
      range: `${quoteSheet(TAB_NAMES.log)}!A${state.ingestionLogRowNumber}:${columnName(row.length - 1)}${state.ingestionLogRowNumber}`,
      majorDimension: "ROWS",
      values: [row],
    },
  ]);
}

async function updateIngestionLogSafely(sheets, workbook, state) {
  try {
    await updateIngestionLog(sheets, workbook, state);
  } catch (error) {
    console.warn(`Could not update ingestion log right now: ${safeError(error)}. Checkpoint was still saved locally.`);
  }
}

function shouldUpdateIngestionLog(state) {
  return state.emailsScanned > 0 && state.emailsScanned % LOG_UPDATE_INTERVAL_EMAILS === 0;
}

function buildIngestionLogRow(state, headers) {
  const row = blankRow(headers.length);
  fillRow(row, headers, {
    "Run ID": state.runId,
    "Run Started At": state.startedAt,
    "Run Finished At": state.finishedAt,
    "Gmail Query Used": state.query,
    "Emails Scanned": String(state.emailsScanned),
    "Relevant Emails Found": String(state.relevantEmailsFound),
    "Opportunities Created": String(state.opportunitiesCreated),
    "Opportunities Updated": String(state.opportunitiesUpdated),
    "Duplicates Skipped": String(state.duplicatesSkipped),
    "Review Items Created": String(state.reviewItemsCreated),
    Errors: state.errors.slice(-10).join(" | "),
    Notes: state.done ? "Full historical scan finished or stopped by configured limit." : "Full historical scan in progress. Resume uses local checkpoint.",
    "Scan Mode": "Gmail API Runner",
    "Pilot / Full / Weekly": "Full",
    "Last Successful Scan Date": state.lastProcessedAt,
    "Resume Cursor / Page Token": state.nextPageToken,
    "Rows Created": String(state.rowsCreated),
    "Rows Updated": String(state.rowsUpdated),
    "Rows Skipped": String(state.rowsSkipped),
    "Manual Review Required": String(state.reviewItemsCreated),
    "Relevant Email Rate": state.emailsScanned ? formatPercent((state.opportunitiesCreated + state.opportunitiesUpdated) / state.emailsScanned) : "",
    "Skipped Irrelevant": String(state.skippedIrrelevant ?? 0),
    "Review Needed Emails": String(state.reviewNeededEmails ?? 0),
    "Weekly Automation Ready?": "No",
    "Notes For Next Scan": state.nextPageToken ? "Resume from checkpoint before starting another run." : "Refresh alias mapping and intelligence after reviewing output.",
  });
  return row;
}

async function ensureGridCapacity(sheets, metadata, minRows) {
  const requests = [];
  for (const sheet of metadata.sheets ?? []) {
    const props = sheet.properties;
    if (!props?.title || !Object.values(TAB_NAMES).includes(props.title)) continue;
    if ((props.gridProperties?.rowCount ?? 0) < minRows) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: props.sheetId,
            gridProperties: { rowCount: minRows },
          },
          fields: "gridProperties.rowCount",
        },
      });
    }
  }
  if (requests.length > 0) await sheets.batchUpdate(requests);
}

async function refreshIntelligenceTabs(sheets, metadata, minRows) {
  const ids = sheetIds(metadata);
  const requests = [
    copyFormula(ids[TAB_NAMES.brandIntelligence], 1, minRows, 1, 37),
    copyFormula(ids[TAB_NAMES.agencyIntelligence], 1, minRows, 1, 29),
    copyFormula(ids[TAB_NAMES.contactIntelligence], 1, minRows, 1, 18),
    copyFormula(ids[TAB_NAMES.creatorSignals], 1, minRows, 1, 17),
    {
      updateCells: {
        start: { sheetId: ids[TAB_NAMES.creatorSignals], rowIndex: 1, columnIndex: 14 },
        rows: [
          {
            values: [
              {
                userEnteredValue: {
                  formulaValue:
                    '=IF($A2="","",IF(XLOOKUP($A2,\'Brand Intelligence\'!A:A,\'Brand Intelligence\'!B:B,0)<3,"Insufficient Data",IF(REGEXMATCH(LOWER($A2),"unknown"),"Unknown",IF(OR(I2="Yes",J2="High",H2="Low"),"Tier 4",IF(AND(H2="Strong",OR(K2="Emerging",K2="Moderate",K2="Strong")),"Tier 1",IF(AND(M2="Strong",H2<>"Unknown",N2="Yes"),"Tier 2",IF(OR(H2="Acceptable",H2="Strong",M2="Medium",L2="Medium"),"Tier 3","Unknown")))))))',
                },
              },
            ],
          },
        ],
        fields: "userEnteredValue",
      },
    },
    copyFormula(ids[TAB_NAMES.creatorSignals], 1, minRows, 14, 15),
  ].filter((request) => request !== null);
  await sheets.batchUpdate(requests);
}

function copyFormula(sheetId, startRow, endRow, startCol, endCol) {
  if (!sheetId) return null;
  return {
    copyPaste: {
      source: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: startCol,
        endColumnIndex: endCol,
      },
      destination: {
        sheetId,
        startRowIndex: startRow,
        endRowIndex: endRow,
        startColumnIndex: startCol,
        endColumnIndex: endCol,
      },
      pasteType: "PASTE_FORMULA",
    },
  };
}

function sheetIds(metadata) {
  const ids = {};
  for (const sheet of metadata.sheets ?? []) {
    if (sheet.properties?.title) ids[sheet.properties.title] = sheet.properties.sheetId;
  }
  return ids;
}

function normalizeGmailMessage(message) {
  const headers = Object.fromEntries(
    (message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
  );
  const body = decodePayload(message.payload);
  return {
    id: message.id,
    threadId: message.threadId,
    from: headers.from ?? "",
    to: headers.to ?? "",
    subject: headers.subject ?? "(no subject)",
    date: headers.date ? new Date(headers.date) : new Date(Number(message.internalDate ?? Date.now())),
    snippet: message.snippet ?? "",
    body,
    displayUrl: `https://mail.google.com/mail/#all/${message.id}`,
  };
}

function decodePayload(payload) {
  if (!payload) return "";
  const chunks = [];
  const visit = (part) => {
    const mimeType = part.mimeType ?? "";
    if (part.body?.data && (mimeType.includes("text/plain") || mimeType.includes("text/html"))) {
      chunks.push(decodeBase64Url(part.body.data));
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);
  return stripHtml(chunks.join("\n")).slice(0, 80_000);
}

function decodeBase64Url(value) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripHtml(value) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSender(from) {
  const match = from.match(/^(.*?)<([^>]+)>$/);
  const email = (match ? match[2] : from).trim().replace(/^mailto:/i, "");
  const name = (match ? match[1] : from.split("@")[0]).replace(/["']/g, "").trim();
  return {
    raw: from,
    name: toTitleCase(name || "Unknown"),
    email,
    domain: email.includes("@") ? email.split("@").pop().toLowerCase() : "",
  };
}

function inferSourceOrganization(sender, text) {
  const known = findKnownSourceOrg(sender.domain);
  if (known) return { name: known[0], type: known[1] };
  if (!sender.domain || GENERIC_EMAIL_DOMAINS.has(sender.domain)) {
    const signature = inferSignatureCompany(text);
    return signature ? signature : { name: "Unknown", type: "Other" };
  }
  const domainRoot = rootDomainName(sender.domain);
  const name = toTitleCase(domainRoot.replace(/[-_.]/g, " "));
  const type = AGENCY_HINTS.some((hint) => domainRoot.toLowerCase().includes(hint))
    ? inferAgencyType(domainRoot)
    : "Brand";
  return { name, type };
}

function findKnownSourceOrg(domain) {
  if (!domain) return null;
  const exact = KNOWN_SOURCE_ORGS.get(domain);
  if (exact) return exact;
  for (const [knownDomain, value] of KNOWN_SOURCE_ORGS.entries()) {
    if (domain.endsWith(`.${knownDomain}`)) return value;
  }
  return null;
}

function rootDomainName(domain) {
  const parts = String(domain ?? "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] ?? "";
  const secondLevel = parts.at(-2) ?? parts[0];
  const thirdLevel = parts.at(-3) ?? "";
  if (["co", "com", "org", "net"].includes(secondLevel) && thirdLevel) return thirdLevel;
  return secondLevel;
}

function inferSignatureCompany(text) {
  const patterns = [
    /from\s+([A-Z][A-Za-z0-9&.\- ]{2,40})\s+(Agency|Inc|Team|Marketing|Media|Studio|Network)/i,
    /(?:company|agency|team):\s*([A-Z][A-Za-z0-9&.\- ]{2,50})/i,
    /(?:regards|best|thanks)[,\s]+(?:[A-Z][A-Za-z ]+)\s+([A-Z][A-Za-z0-9&.\- ]{2,50})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const name = cleanEntityName(match[1]);
      if (isBadSourceCandidate(name)) continue;
      return { name, type: inferAgencyType(name) };
    }
  }
  return null;
}

function inferAgencyType(value) {
  const lower = value.toLowerCase();
  if (lower.includes("affiliate")) return "Affiliate Network";
  if (lower.includes("pr")) return "PR Agency";
  if (lower.includes("music") || lower.includes("label")) return "Label";
  if (lower.includes("platform") || lower.includes("creator") || lower.includes("talent")) return "Talent Platform";
  if (lower.includes("agency") || lower.includes("media") || lower.includes("marketing")) return "Agency";
  return "Other";
}

function inferBrand(subject, text, source) {
  const candidates = extractSubjectBrandCandidates(subject);
  const patterns = [
    /(?:with|for|from|promoting|promotion for|collaboration with)\s+([A-Z][A-Za-z0-9&'.\- ]{2,45})(?:[\n\r:|,!.])/gi,
    /([A-Z][A-Za-z0-9&'.\- ]{2,45})\s+(?:x|×|X)\s+(?:Excellent Creator|Creator|Paid|Collaboration|Campaign)/gi,
    /(?:client|brand)\s+([A-Z][A-Za-z0-9&'.\- ]{2,45})(?:[\n\r:|,!.])/gi,
    /paid collaboration with\s+([A-Z][A-Za-z0-9&'.\- ]{2,45})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = cleanEntityName(match[1]);
      if (candidate && !isBadBrandCandidate(candidate)) candidates.push(candidate);
    }
  }
  const subjectSplit = subject.split(/[:|]/)[0];
  if (subjectSplit && /collab|campaign|partnership|promotion|invite|paid/i.test(subject)) {
    const subjectCandidate = cleanEntityName(
      subjectSplit.replace(/re$/i, "").replace(/paid|collaboration|invitation|opportunity|exclusive|offer/gi, ""),
    );
    if (subjectCandidate && !isBadBrandCandidate(subjectCandidate)) candidates.push(subjectCandidate);
  }
  if (source.type === "Brand" && source.name !== "Unknown") candidates.push(source.name);
  return chooseBestBrandCandidate(candidates, source) ?? "Unknown";
}

function extractSubjectBrandCandidates(subject) {
  const candidates = [];
  const cleanedSubject = String(subject ?? "").replace(/^(re|fw|fwd)\s*:\s*/i, "").trim();
  const subjectPatterns = [
    /\bx\s+([^:|]{2,60})\s*:/i,
    /(?:campaign|collaboration|opportunity|partnership|promo|promotion)[^:|]{0,80}\bwith\s+([^:|,]{2,60})/i,
    /\bwith\s+([^:|,]{2,60})\s*$/i,
  ];
  for (const pattern of subjectPatterns) {
    const match = cleanedSubject.match(pattern);
    if (match?.[1]) {
      const candidate = cleanEntityName(match[1].replace(/\bnew potential collaboration\b/gi, ""));
      if (candidate && !isBadBrandCandidate(candidate)) candidates.push(candidate);
    }
  }
  return candidates;
}

function chooseBestBrandCandidate(candidates, source) {
  const uniqueCandidates = unique(candidates).filter((candidate) => !isBadBrandCandidate(candidate));
  if (uniqueCandidates.length === 0) return null;
  const sourceKey = normalizeKey(source.name);
  const scored = uniqueCandidates.map((candidate, index) => {
    let score = 100 - index;
    const lower = candidate.toLowerCase();
    if (source.type !== "Brand" && normalizeKey(candidate) === sourceKey) score -= 50;
    if (/\b(ai|app|ring|shop|beauty|labs?|studio|media|agency)\b/i.test(candidate)) score += 5;
    if (lower.endsWith(" team")) score -= 40;
    if (candidate.split(/\s+/).length > 5) score -= 25;
    return { candidate, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.candidate ?? null;
}

function isBadBrandCandidate(value) {
  const lower = value.toLowerCase();
  return (
    lower.length < 2 ||
    isPollutedEntityName(value) ||
    [
      "you",
      "your",
      "your email",
      "us",
      "our",
      "this",
      "sharing this",
      "creator",
      "campaign",
      "paid",
      "tiktok",
      "instagram",
      "the brand",
      "the campaign",
      "the next steps",
      "the better",
      "emails",
      "linkedin",
      "team",
      "manager",
      "events already on your calendar",
      "new potential collaboration",
    ].includes(lower) ||
    lower.endsWith(" team") ||
    lower.startsWith("team ") ||
    lower.includes("your email") ||
    lower.includes("already on your calendar") ||
    lower.includes("@")
  );
}

function isBadSourceCandidate(value) {
  const lower = String(value ?? "").trim().toLowerCase();
  return (
    !lower ||
    lower.length < 3 ||
    isPollutedEntityName(value) ||
    ["team", "creator", "manager", "to me", "her", "him", "you", "your"].includes(lower) ||
    /^[a-z]{1,2}$/i.test(lower)
  );
}

function isPollutedEntityName(value) {
  const normalized = normalizeKey(value);
  if (!normalized || POLLUTED_ENTITY_NAMES.has(normalized)) return true;
  if (POLLUTED_ENTITY_PATTERNS.some((pattern) => pattern.test(String(value ?? "")))) return true;
  if (String(value ?? "").length > 52) return true;
  if (String(value ?? "").includes("?")) return true;
  if (/\.$/.test(String(value ?? "").trim())) return true;
  return false;
}

function classifyOpportunityType(lower, brandName, sourceOrganizationName) {
  if (lower.includes("song promotion") || lower.includes("music promotion") || lower.includes("campaign audio") || / - .* \| song promotion/i.test(lower)) return "Song Promotion";
  if (lower.includes("affiliate") || lower.includes("commission") || lower.includes("tiktok shop")) return "Affiliate";
  if (lower.includes("pr box") || lower.includes("gifted") || lower.includes("free product") || lower.includes("sample")) return "PR Gifting";
  if (lower.includes("ugc")) return "UGC";
  if (lower.includes("whitelisting") || lower.includes("paid usage") || lower.includes("licensing")) return "Whitelisting";
  if (lower.includes("ambassador")) return "Ambassador Program";
  if (lower.includes("event") || lower.includes("expo") || lower.includes("invitation to attend")) return "Event";
  if (lower.includes("app") || /chat|ai|game|dating|download/.test(lower) || /app/i.test(brandName)) return "App Promotion";
  if (lower.includes("paid") || lower.includes("budget") || lower.includes("rate")) return "Paid Campaign";
  if (sourceOrganizationName.toLowerCase().includes("platform")) return "Platform Invite";
  return "Other";
}

function extractBudget(text, opportunityType) {
  const amountPattern = /(?:\$|USD|GBP|£|EUR|€|JPY|¥)\s?([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s?(?:-|to|–)\s?(?:\$|USD|GBP|£|EUR|€|JPY|¥)?\s?([0-9][0-9,]*(?:\.[0-9]+)?))?/gi;
  const matches = [...text.matchAll(amountPattern)];
  const values = matches
    .map((match) => [parseNumber(match[1]), parseNumber(match[2])].filter(Boolean))
    .flat();
  const currency = inferCurrency(text);
  const max = values.length ? Math.max(...values) : "";
  const min = values.length ? Math.min(...values) : "";
  const fixedFeePresent = /flat rate|fixed fee|fixed rate|budget|rate|offer|fee/i.test(text) && values.length > 0 ? "Yes" : "Unknown";
  const affiliatePresent = /affiliate|commission/i.test(text) ? "Yes" : "No";
  const affiliateOnly = affiliatePresent === "Yes" && !/fixed|flat|fee|budget|paid/i.test(text) ? "Yes" : "No";
  const amount = values.length ? (min === max ? String(max) : `${min}-${max}`) : "Unknown";
  return {
    amount,
    currency,
    notes: values.length ? `Detected ${currency} ${amount}` : "Budget not detected",
    affiliateCommission: extractAffiliateCommission(text),
    typicalRange: values.length ? `${currency} ${amount}` : "Unknown",
    expectedValue: max ? String(max) : "",
    commercialNotes: buildCommercialNotes(max, affiliateOnly, opportunityType),
    fixedFeePresent,
    affiliatePresent,
    affiliateOnly,
  };
}

function classifyCommercialQuality({ budget, opportunityType }) {
  const value = Number(budget.expectedValue) || 0;
  if (budget.affiliateOnly === "Yes") {
    return { quality: "Low", rating: "Low", budgetFloorConcern: "Yes" };
  }
  if (!value) return { quality: "Unknown", rating: "Unknown", budgetFloorConcern: "Unknown" };
  if (opportunityType === "Song Promotion") {
    if (value >= 300) return { quality: "Acceptable", rating: "Acceptable", budgetFloorConcern: "No" };
    return { quality: "Low", rating: "Low", budgetFloorConcern: "Yes" };
  }
  if (value >= 1000) return { quality: "Strong", rating: "Strong", budgetFloorConcern: "No" };
  if (value >= 500) return { quality: "Acceptable", rating: "Acceptable", budgetFloorConcern: "No" };
  return { quality: "Low", rating: "Low", budgetFloorConcern: "Yes" };
}

function extractCreatorRequirements(text) {
  const lower = text.toLowerCase();
  return {
    gender: /female|women|woman|mom|mother/i.test(text) ? "Female" : /male|men|man/i.test(text) ? "Male" : "Not specified",
    country: extractCountries(text),
    language: /english/i.test(text) ? "English" : /spanish/i.test(text) ? "Spanish" : /french/i.test(text) ? "French" : "Not specified",
    platforms: extractPlatforms(text),
    niche: extractNiches(lower),
    audience: extractAudience(text),
    followers: extractFollowerRange(text),
    engagement: extractEngagement(text),
    special: extractSpecialRequirements(text),
  };
}

function extractCountries(text) {
  const countries = [];
  const map = [
    ["UK", /\bUK\b|United Kingdom|Britain|British/i],
    ["US", /\bUS\b|USA|United States|America|American/i],
    ["Canada", /Canada|Canadian/i],
    ["Germany", /Germany|German/i],
    ["France", /France|French/i],
    ["Australia", /Australia|Australian/i],
    ["Japan", /Japan|Japanese/i],
    ["Korea", /Korea|Korean/i],
  ];
  for (const [name, pattern] of map) if (pattern.test(text)) countries.push(name);
  return countries.length ? unique(countries).join(", ") : "Not specified";
}

function extractPlatforms(text) {
  const platforms = [];
  if (/TikTok/i.test(text)) platforms.push("TikTok");
  if (/Instagram|IG Reel|Reels/i.test(text)) platforms.push("Instagram");
  if (/YouTube|Shorts/i.test(text)) platforms.push("YouTube");
  if (/Rednote|Xiaohongshu/i.test(text)) platforms.push("Rednote");
  return platforms.length ? unique(platforms).join(", ") : "Not specified";
}

function extractNiches(lower) {
  const niches = [];
  const map = [
    ["Beauty", /beauty|skincare|hair|makeup|cosmetic/],
    ["Fashion", /fashion|apparel|outfit|clothing|jewelry|jewellery/],
    ["Lifestyle", /lifestyle|routine|daily/],
    ["Food", /food|meal|restaurant|recipe/],
    ["Travel", /travel|hotel|destination/],
    ["Fitness", /fitness|gym|wellness|creatine/],
    ["Parenting", /mom|mother|parent|baby|maternity/],
    ["Music", /music|song|track|audio/],
    ["Gaming", /game|gaming|puzzle/],
    ["Tech", /tech|ai|app|software|hardware/],
    ["Sports", /sport|football|soccer|basketball/],
  ];
  for (const [name, pattern] of map) if (pattern.test(lower)) niches.push(name);
  return niches.length ? unique(niches).join(", ") : "Not specified";
}

function extractAudience(text) {
  const match = text.match(/audience(?:s)?(?: of|:)?\s+([^.]{5,100})/i);
  return match ? cleanSentence(match[1]) : "Not specified";
}

function extractFollowerRange(text) {
  const match = text.match(/([0-9]+(?:k|K|,\d{3})?\+?)\s+(?:followers|follower)/i);
  return match ? match[1] : "Not specified";
}

function extractEngagement(text) {
  const match = text.match(/([0-9]+(?:k|K|,\d{3})?\+?)\s+(?:views|average views|engagement)/i);
  return match ? match[0] : "Not specified";
}

function extractSpecialRequirements(text) {
  const bits = [];
  if (/appear on camera|show your face/i.test(text)) bits.push("Creator appears on camera");
  if (/link in bio/i.test(text)) bits.push("Link in bio");
  if (/spark/i.test(text)) bits.push("Spark Ads/ad code");
  if (/raw video/i.test(text)) bits.push("Raw video requested");
  if (/draft|approval/i.test(text)) bits.push("Draft approval");
  return bits.length ? bits.join("; ") : "Not specified";
}

function extractDeliverables(text) {
  const bits = [];
  const video = text.match(/([0-9]+)\s*(?:x\s*)?(TikTok|video|Reel|Short|Story|Stories|post)s?/i);
  if (video) bits.push(video[0]);
  if (/dedicated video/i.test(text)) bits.push("Dedicated video");
  if (/IG Reel|Instagram Reel/i.test(text)) bits.push("Instagram Reel");
  if (/Story|Stories/i.test(text)) bits.push("Stories");
  if (/YouTube Shorts/i.test(text)) bits.push("YouTube Shorts");
  return bits.length ? unique(bits).join("; ") : "Unknown";
}

function extractUsageRights(text) {
  const match = text.match(/([0-9]+\s*(?:day|month|year)[^.\n]{0,40}(?:usage|rights|licensing)|usage rights|content usage|raw video)/i);
  return match ? cleanSentence(match[0]) : "Unknown";
}

function extractWhitelisting(text) {
  const bits = [];
  if (/spark/i.test(text)) bits.push("Spark Ads/ad code");
  if (/whitelisting/i.test(text)) bits.push("Whitelisting");
  if (/paid usage/i.test(text)) bits.push("Paid usage");
  if (/link in bio/i.test(text)) bits.push("Link in bio");
  return bits.length ? bits.join("; ") : "Unknown";
}

function extractExclusivity(text) {
  const match = text.match(/exclusiv(?:e|ity)[^.]{0,80}/i);
  return match ? cleanSentence(match[0]) : "Unknown";
}

function extractTimeline(text) {
  const match = text.match(/(?:deadline|due|live|post|campaign ends?|by)\s*:?\s*([^.\n]{4,80})/i);
  return match ? cleanSentence(match[0]) : "Unknown";
}

function extractApplicationProcess(text) {
  if (/reply/i.test(text)) return "Reply to email";
  if (/form|google form/i.test(text)) return "Submit form";
  if (/link|apply/i.test(text)) return "Apply through link";
  return "Unknown";
}

function inferOpportunityStatus(lower, date) {
  if (/won|signed|confirmed|contract|live link|spark code shared/.test(lower)) return "Won";
  if (/lost|declined|not moving forward/.test(lower)) return "Lost";
  if (/negotiat|counter|offer|rate/.test(lower)) return "Negotiating";
  if (/expired|filled|closed|no longer/.test(lower)) return "Expired";
  if (daysSince(date) > 180) return "Unknown";
  return "Open";
}

function inferSourceStrength(source, lower, email) {
  if (source.type === "Brand" && !GENERIC_EMAIL_DOMAINS.has(parseSender(email.from).domain)) return "Direct Brand Outreach";
  if (/reply|re:/.test(email.subject.toLowerCase())) return "Personal Contact";
  if (source.type === "Affiliate Network") return "Platform Invite";
  if (source.type === "Talent Platform") return "Platform Invite";
  if (source.type === "Agency" || source.type === "PR Agency") return "Agency Brief";
  if (/unsubscribe|newsletter/.test(lower)) return "Newsletter";
  if (/bcc|undisclosed-recipients/i.test(email.to)) return "Mass Creator Blast";
  return "Unknown";
}

function classifyRelevance({ opportunityType, commercial, status }) {
  if (commercial.quality === "Low" && opportunityType !== "Song Promotion") return "Low-Value Lead";
  if (status === "Expired") return "Historical Preference Signal";
  if (["Open", "Negotiating", "Won"].includes(status)) return "Active Opportunity";
  return "Historical Preference Signal";
}

function scoreConfidence({ brandName, sourceOrganizationName, contactEmail, opportunityType, budget, creator, deliverables, sourceStrength }) {
  let score = 30;
  if (!isProbablyUnknownBrand(brandName)) score += 15;
  if (sourceOrganizationName !== "Unknown") score += 10;
  if (contactEmail !== "Unknown") score += 8;
  if (opportunityType !== "Other") score += 10;
  if (budget.amount !== "Unknown") score += 10;
  if (creator.platforms !== "Not specified") score += 7;
  if (creator.niche !== "Not specified") score += 5;
  if (deliverables !== "Unknown") score += 5;
  if (sourceStrength !== "Unknown") score += 5;
  return clamp(score, 30, 98);
}

function buildReviewSignals({ brandName, source, opportunityType, budget, creator, confidenceScore, commercial, sourceStrength }) {
  const issues = [];
  if (isProbablyUnknownBrand(brandName) || isPollutedEntityName(brandName)) issues.push(REVIEW_ISSUES.unclearBrand);
  if (source.name === "Unknown" || sourceStrength === "Unknown" || isBadSourceCandidate(source.name)) issues.push(REVIEW_ISSUES.unclearAgency);
  if (budget.amount === "Unknown") issues.push(REVIEW_ISSUES.missingBudget);
  if (creator.niche === "Not specified" && creator.platforms === "Not specified") issues.push(REVIEW_ISSUES.vagueRequirements);
  if (confidenceScore < 70) issues.push(REVIEW_ISSUES.lowConfidence);
  if (commercial.budgetFloorConcern === "Yes") issues.push(REVIEW_ISSUES.lowBudget);
  if (budget.affiliateOnly === "Yes") issues.push(REVIEW_ISSUES.affiliate);
  if (!["Open", "Negotiating"].includes(opportunityType) && opportunityType === "Other") issues.push(REVIEW_ISSUES.historical);
  return {
    issues: unique(issues),
    notes: unique(issues).join("; ") || "No major extraction issue detected.",
  };
}

function isIgnorableEmail(lower) {
  if (isNonActionableMarketingEmail(lower) && !/(campaign brief|creator brief|deliverables?|fixed fee|flat rate|usage rights|whitelisting|spark ads?)/.test(lower)) return true;
  return [
    "security alert",
    "verify your account",
    "password reset",
    "receipt",
    "invoice",
    "delivery status notification",
    "out of office",
    "calendar invitation",
    "unsubscribe from this newsletter",
  ].some((term) => lower.includes(term)) && !/(campaign|collaboration|creator|brief|affiliate|paid)/.test(lower);
}

function isNonActionableMarketingEmail(lower) {
  const hasMarketingPattern = NON_ACTIONABLE_MARKETING_PATTERNS.some((pattern) => pattern.test(lower));
  if (!hasMarketingPattern) return false;
  const hasConcreteCreatorBrief = /\b(campaign brief|creator brief|deliverables?|usage rights|whitelisting|spark ads?|fixed fee|flat rate|\$\s?[0-9]|usd\s?[0-9]|£\s?[0-9]|€\s?[0-9])\b/i.test(lower);
  return !hasConcreteCreatorBrief;
}

function inferOpportunityName(brandName, opportunityType, subject) {
  if (!isProbablyUnknownBrand(brandName)) return `${brandName} ${opportunityType}`;
  return cleanSentence(subject).slice(0, 80);
}

function inferCategory(text, opportunityType) {
  const lower = text.toLowerCase();
  if (/beauty|skincare|hair|makeup/.test(lower)) return "Beauty / personal care";
  if (/fashion|jewelry|apparel/.test(lower)) return "Fashion / apparel";
  if (/ai|app|software|chat/.test(lower)) return "App / technology";
  if (/music|song|artist/.test(lower)) return "Music";
  if (/food|restaurant|meal/.test(lower)) return "Food / beverage";
  if (/travel|hotel/.test(lower)) return "Travel / hospitality";
  if (/game|gaming/.test(lower)) return "Gaming";
  return opportunityType;
}

function inferContactRole(text, sourceType) {
  const match = text.match(/(?:title|role):\s*([A-Za-z /-]{3,60})/i);
  if (match) return cleanSentence(match[1]);
  if (sourceType === "Brand") return "Brand contact";
  if (sourceType === "PR Agency") return "PR contact";
  if (sourceType === "Agency") return "Agency contact";
  return "Unknown";
}

function summarizeCampaign(brandName, opportunityType, text) {
  const firstSentence = cleanSentence(text.split(/[.!?]\s/).find((part) => part.length > 40) ?? "");
  return `${brandName} ${opportunityType}. ${firstSentence}`.slice(0, 350);
}

function buildPreferenceTags(creator, opportunityType, text) {
  return unique([
    ...splitCsv(creator.country),
    ...splitCsv(creator.gender),
    ...splitCsv(creator.language),
    ...splitCsv(creator.niche),
    ...splitCsv(creator.platforms),
    opportunityType,
  ].filter((value) => value && !["Not specified", "Unknown"].includes(value))).join(", ");
}

function buildCreatorMatchTags(creator, opportunityType, text) {
  return buildPreferenceTags(creator, opportunityType, text);
}

function buildKeywords(brandName, sourceOrganizationName, opportunityType, creator) {
  return unique([
    brandName,
    sourceOrganizationName,
    opportunityType,
    ...splitCsv(creator.country),
    ...splitCsv(creator.platforms),
    ...splitCsv(creator.niche),
  ].filter((value) => value && !["Unknown", "Not specified"].includes(value))).join(", ").toLowerCase();
}

function buildCommercialNotes(value, affiliateOnly, opportunityType) {
  if (affiliateOnly === "Yes") return "Affiliate-only or commission-led opportunity.";
  if (!value) return "Commercial terms unclear.";
  if (opportunityType === "Song Promotion") return "Song promotion rates can be lower than normal brand campaigns.";
  if (value >= 800) return "Strong fixed-fee signal.";
  if (value >= 300) return "Acceptable fixed-fee signal.";
  return "Low fixed-fee signal.";
}

function buildAgeNotes(date, relevance) {
  const days = daysSince(date);
  if (days > 365) return `Historical email, ${days} days old. Use as preference signal unless manually confirmed active.`;
  if (relevance === "Active Opportunity") return "Recent or active-looking opportunity.";
  return "Use as preference or relationship signal.";
}

function buildDisqualifierFlags(commercial, issues) {
  const flags = [];
  if (commercial.budgetFloorConcern === "Yes") flags.push("Low Budget");
  if (issues.includes(REVIEW_ISSUES.affiliate)) flags.push("Affiliate Only");
  if (issues.includes(REVIEW_ISSUES.unclearBrand)) flags.push("Unclear Brand");
  return flags.join("; ");
}

function buildRankingNotes(commercial, relevance, confidenceScore) {
  return `Commercial: ${commercial.quality}. Relevance: ${relevance}. Extraction confidence: ${confidenceScore}.`;
}

function buildPitchAngle(creator, opportunityType, brandName) {
  const tags = [creator.country, creator.niche, creator.platforms].filter((value) => value && value !== "Not specified");
  if (tags.length === 0) return `${brandName} has historical ${opportunityType.toLowerCase()} signal.`;
  return `Historical interest in ${tags.join(", ")} creators.`;
}

function commercialScore(value) {
  if (value === "Strong") return "85";
  if (value === "Acceptable") return "65";
  if (value === "Low") return "25";
  return "";
}

function relationshipScore(sourceStrength) {
  if (sourceStrength === "Direct Brand Outreach" || sourceStrength === "Personal Contact") return "75";
  if (sourceStrength === "Agency Brief") return "60";
  if (sourceStrength === "Platform Invite") return "45";
  return "";
}

function recencyScore(date) {
  const days = daysSince(date);
  if (days <= 30) return "90";
  if (days <= 180) return "70";
  if (days <= 365) return "45";
  return "25";
}

function communicationRecency(date) {
  const days = daysSince(date);
  if (days <= 30) return "Recent";
  if (days <= 180) return "Warm";
  if (days <= 365) return "Cold";
  return "Historical";
}

function communicationStatus(date) {
  const recency = communicationRecency(date);
  if (recency === "Recent") return "Active";
  if (recency === "Warm") return "Warm";
  if (recency === "Cold") return "Cold";
  return "Unknown";
}

function extractAffiliateCommission(text) {
  const match = text.match(/([0-9]{1,3}%[^.\n]{0,50}(?:commission|affiliate)|commission[^.\n]{0,50}[0-9]{1,3}%)/i);
  return match ? cleanSentence(match[0]) : "";
}

function inferCurrency(text) {
  if (/GBP|£/i.test(text)) return "GBP";
  if (/EUR|€/i.test(text)) return "EUR";
  if (/JPY|¥/i.test(text)) return "JPY";
  return "USD";
}

function addConfidenceBucket(state, score) {
  if (score >= 85) state.confidenceDistribution.high += 1;
  else if (score >= 70) state.confidenceDistribution.medium += 1;
  else state.confidenceDistribution.low += 1;
}

function printSummary(state, options) {
  ensureQualityMetrics(state);
  console.log("\nIngestion runner summary");
  console.log(`Run ID: ${state.runId}`);
  console.log(`Mode: ${options.dryRun ? "dry run" : "live"}`);
  console.log(`Emails scanned: ${state.emailsScanned}`);
  console.log(`Relevant emails found: ${state.relevantEmailsFound}`);
  console.log(`Opportunities created: ${state.opportunitiesCreated}`);
  console.log(`Opportunities updated: ${state.opportunitiesUpdated}`);
  console.log(`Duplicates skipped: ${state.duplicatesSkipped}`);
  console.log(`Brands created: ${state.brandsCreated}`);
  console.log(`Agencies created: ${state.agenciesCreated}`);
  console.log(`Contacts created: ${state.contactsCreated}`);
  console.log(`Review items created: ${state.reviewItemsCreated}`);
  console.log(`Aliases created: ${state.aliasesCreated}`);
  console.log(`Skipped irrelevant: ${state.skippedIrrelevant}`);
  console.log(`Review-needed emails without opportunity rows: ${state.reviewNeededEmails}`);
  console.log(
    `Relevance distribution: created ${state.relevanceDistribution.opportunityCreated}, review-needed ${state.relevanceDistribution.reviewNeeded}, skipped ${state.relevanceDistribution.skippedIrrelevant}, duplicates ${state.relevanceDistribution.duplicate}`,
  );
  console.log(`Unknown brand count: ${state.unknownBrandCount}`);
  console.log(`Unknown agency/source count: ${state.unknownAgencyCount}`);
  console.log(`Confidence distribution: high ${state.confidenceDistribution.high}, medium ${state.confidenceDistribution.medium}, low ${state.confidenceDistribution.low}`);
  printReasonCounts(state);
  if (options.dryRun || options.validateSample) printSampleClassifications(state);
  printSafetyWarnings(state, options);
  if (options.dryRun) {
    console.log("Dry run complete. No checkpoint was saved and no Sheet rows were changed.");
  } else {
    console.log(state.nextPageToken ? "Checkpoint saved. Run again to resume." : "No next page token. Scan is complete for this query.");
  }
}

function printReasonCounts(state) {
  const entries = Object.entries(state.reasonCounts ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;
  console.log("Reason counts:");
  for (const [reason, count] of entries) {
    console.log(`- ${reason}: ${count}`);
  }
}

function printSampleClassifications(state) {
  const samples = state.classificationSamples ?? [];
  if (samples.length === 0) return;

  const selected = [
    ...samples.filter((sample) => sample.classification === "Opportunity Created").slice(0, 5),
    ...samples.filter((sample) => sample.classification === "Review Needed").slice(0, 3),
    ...samples.filter((sample) => sample.classification === "Skipped Irrelevant").slice(0, 2),
  ].slice(0, 10);

  if (selected.length === 0) return;
  console.log("\nSample classifications:");
  for (const sample of selected) {
    console.log(`- ${sample.classification} | ${sample.reason} | confidence ${sample.confidence}`);
    console.log(`  Subject: ${sample.subject}`);
    console.log(`  Sender: ${sample.sender}`);
    console.log(`  Brand: ${sample.brand} | Source: ${sample.sourceOrganization} | Type: ${sample.opportunityType}`);
    if (sample.detail) console.log(`  Detail: ${sample.detail}`);
  }
}

function printSafetyWarnings(state, options) {
  const warnings = buildSafetyWarnings(state);
  if (warnings.length === 0) {
    if (options.validateSample) console.log("\nValidation recommendation: sample looks safe enough for the next controlled step.");
    return;
  }

  console.log("\nSafety warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
  if (options.validateSample) {
    console.log("Validation recommendation: review the warnings before full ingestion.");
  }
}

function buildSafetyWarnings(state) {
  const warnings = [];
  const scanned = state.emailsScanned || 0;
  const created = state.opportunitiesCreated + state.opportunitiesUpdated;
  const totalPotential = created + state.reviewNeededEmails;
  const relevantRate = scanned ? created / scanned : 0;
  const reviewRate = totalPotential ? state.reviewItemsCreated / totalPotential : 0;
  const unknownBrandRate = totalPotential ? state.unknownBrandCount / totalPotential : 0;
  const unknownAgencyRate = totalPotential ? state.unknownAgencyCount / totalPotential : 0;
  const duplicateRate = scanned ? state.duplicatesSkipped / scanned : 0;

  if (scanned >= 25 && relevantRate > 0.85) warnings.push(`Relevant email rate is high (${formatPercent(relevantRate)}). The classifier may still be permissive.`);
  if (totalPotential >= 10 && reviewRate > 0.6) warnings.push(`Review item rate is high (${formatPercent(reviewRate)}). The review queue may need cleaner extraction rules.`);
  if (scanned >= 100 && duplicateRate === 0) warnings.push("Duplicate skip rate is 0 after a larger sample. Confirm duplicate detection is catching repeated threads/campaigns.");
  if (totalPotential >= 10 && unknownBrandRate > 0.3) warnings.push(`Unknown brand rate is high (${formatPercent(unknownBrandRate)}). Brand extraction may need review.`);
  if (totalPotential >= 10 && unknownAgencyRate > 0.35) warnings.push(`Unknown agency/source rate is high (${formatPercent(unknownAgencyRate)}). Source organization extraction may need review.`);
  return warnings;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function indexRowsByHeader(table, headerName) {
  const headerMap = headerMapFor(table.headers);
  const index = new Map();
  table.rows.forEach((row, rowIndex) => {
    const key = normalizeKey(getCell(row, headerMap, headerName));
    if (key && !index.has(key)) index.set(key, { rowIndex, rowNumber: rowIndex + 2 });
  });
  return index;
}

function headerMapFor(headers) {
  const map = new Map();
  headers.forEach((header, index) => map.set(normalizeHeader(header), index));
  return map;
}

function getCell(row, headerMap, header) {
  const index = headerMap.get(normalizeHeader(header));
  return index === undefined ? "" : String(row[index] ?? "");
}

function setCell(row, headerMap, header, value) {
  const index = headerMap.get(normalizeHeader(header));
  if (index !== undefined) row[index] = value;
}

function fillRow(row, headers, values) {
  const headerMap = headerMapFor(headers);
  for (const [header, value] of Object.entries(values)) {
    const index = headerMap.get(normalizeHeader(header));
    if (index !== undefined) row[index] = value ?? "";
  }
}

function blankRow(length) {
  return Array.from({ length }, () => "");
}

function applyAlias(aliasMap, entityType, value) {
  const key = `${normalizeKey(entityType)}:${normalizeKey(value)}`;
  return aliasMap.get(key) ?? value;
}

function quoteSheet(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

function columnName(index) {
  let column = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    current = Math.floor((current - 1) / 26);
  }
  return column;
}

function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  return Buffer.from(
    pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, ""),
    "base64",
  );
}

function normalizePrivateKey(value) {
  return value.replace(/\\n/g, "\n");
}

function loadEnvFiles(files) {
  for (const file of files) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!existsSync(fullPath)) continue;
    const raw = readFileSyncSafe(fullPath);
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...parts] = trimmed.split("=");
      if (process.env[key]) continue;
      process.env[key] = parts.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function readFileSyncSafe(file) {
  return existsSync(file) ? Buffer.from(readFileSync(file)).toString("utf8") : "";
}

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSubject(value) {
  return normalizeKey(value)
    .replace(/^(re|fw|fwd)\s*:\s*/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\b(reminder|follow up|following up|urgent)\b/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function subjectDuplicateKey(value) {
  const subject = normalizeSubject(value);
  if (!isSpecificDuplicateSubject(subject)) return "";
  return `subject:${subject}`;
}

function isSpecificDuplicateSubject(subject) {
  if (!subject) return false;
  const words = subject.split(/\s+/).filter(Boolean);
  if (words.length < 4 || subject.length < 24) return false;
  const genericWords = new Set([
    "campaign",
    "collaboration",
    "opportunity",
    "partnership",
    "creator",
    "influencer",
    "brief",
    "paid",
    "brand",
    "proposal",
  ]);
  const specificWords = words.filter((word) => word.length > 2 && !genericWords.has(word));
  return specificWords.length >= 2;
}

function summaryKey(value) {
  return normalizeKey(value)
    .replace(/\b(the|and|for|with|from|campaign|collaboration|opportunity|paid|creator|brand)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join(" ");
}

function weekKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown-week";
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const days = Math.floor((date - start) / 86_400_000);
  const week = Math.floor((days + start.getUTCDay()) / 7) + 1;
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function cleanEntityName(value) {
  return toTitleCase(
    String(value ?? "")
      .replace(/[\[\]()"“”]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^(re|fw|fwd)\s*:?/i, "")
      .trim(),
  );
}

function cleanSentence(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toTitleCase(value) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function splitCsv(value) {
  return String(value ?? "")
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseNumber(value) {
  if (!value) return 0;
  return Number(String(value).replace(/,/g, ""));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

function dateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function isProbablyUnknownBrand(value) {
  return !value || /unknown|unclear|not specified/i.test(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < values.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(values[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function stableId(prefix, date, value) {
  const datePart = dateOnly(date).replace(/-/g, "");
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-12);
  return `${prefix}-${datePart}-${slug || "unknown"}`;
}
