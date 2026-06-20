#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_QUERY =
  'in:anywhere -in:spam -in:trash {campaign collaboration partnership creator influencer sponsorship paid "brand brief" booking collab "creator campaign" "influencer campaign" "brand partnership"}';

const CHECKPOINT_DIR = ".brand-contact-scan";
const CHECKPOINT_FILE = "checkpoint.json";
const CONTACT_DATABASE_TAB = "Contact Database";
const CONTACT_HEADERS = ["id", "brandName", "contactName", "contactFirstName", "email", "position"];
const SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
};

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "yahoo.com",
  "qq.com",
  "163.com",
  "126.com",
  "proton.me",
]);

const SOURCE_ORG_HINTS = [
  "agency",
  "talent",
  "creator",
  "influencer",
  "mcn",
  "media",
  "marketing",
  "pr",
  "partners",
  "partnership",
  "management",
  "studio",
  "network",
  "affiliate",
  "katlas",
];

const INTERNAL_EMAIL_DOMAINS = new Set(["stride-social.com"]);

const AUTOMATED_OR_LOW_VALUE_DOMAINS = new Set(["amazon.com", "beehiiv.com", "substack.com"]);

const BAD_BRAND_CANDIDATES = new Set([
  "a creator",
  "all",
  "brand",
  "campaign",
  "collaborations",
  "collaborations also",
  "collaboration",
  "creator",
  "creators",
  "deals on youtube",
  "equity",
  "foodie creators",
  "has confirmed everything",
  "influencer",
  "influencers",
  "intent",
  "partnership",
  "partnerships",
  "paid",
  "stride social",
  "team",
  "the brand",
  "the campaign",
  "visibility",
  "you",
  "you best",
  "you on instagram",
  "your",
  "your creator",
]);

const POSITION_PATTERNS = [
  "Influencer Marketing Manager",
  "Creator Partnerships Manager",
  "Brand Partnerships Manager",
  "Partnerships Manager",
  "Affiliate Manager",
  "Social Media Manager",
  "Marketing Manager",
  "Growth Marketing Manager",
  "PR Manager",
  "Public Relations Manager",
  "Talent Manager",
  "Account Manager",
  "Campaign Manager",
  "Community Manager",
  "Brand Manager",
  "Partnerships Lead",
  "Marketing Lead",
  "Head of Marketing",
  "Head of Partnerships",
  "Founder",
  "Co-Founder",
  "CEO",
  "Director",
  "Manager",
  "Coordinator",
  "Assistant",
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles([".env", ".env.local", ".env.brand-contact-scan", ".env.opportunity-ingestion"]);
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.selfTest) {
    runSelfTest();
    return;
  }

  const config = loadConfig(options);

  if (options.resetCheckpoint) {
    await resetCheckpoint(config);
    return;
  }

  const gmailTokenProvider = createGmailTokenProvider(config);
  const sheetsTokenProvider = createSheetsTokenProvider(config);
  const gmail = createGmailClient(gmailTokenProvider);
  const sheets = createSheetsClient(config, sheetsTokenProvider);

  if (options.validateCredentials) {
    await validateCredentials({ gmail, sheets, config });
    return;
  }

  console.log(options.dryRun ? "DRY RUN: no sheet writes will happen." : "LIVE RUN: Contact Database rows can be created or updated.");
  console.log(`Team Asset sheet: ${config.spreadsheetId}`);
  console.log(`Query: ${config.query}`);

  const contactDatabase = await loadContactDatabase(sheets);
  let checkpoint = options.dryRun ? null : await loadCheckpoint(config);
  const state =
    checkpoint ??
    createInitialState({
      query: config.query,
      runId: createRunId(),
      startedAt: new Date().toISOString(),
    });

  const existingById = new Map(contactDatabase.contacts.map((contact) => [contact.id, contact]));
  const seenThisRun = new Set();
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
        existingById,
        seenThisRun,
        state,
      });

      if (!options.dryRun) {
        await flushWritePlan(sheets, contactDatabase, plan);
      }

      applyPlanToMemory(contactDatabase, existingById, plan);
      updateCounters(state, plan);
      state.processedMessageIds.push(...batch);
      state.lastProcessedAt = new Date().toISOString();
      state.lastProcessedMessageId = batch[batch.length - 1] ?? state.lastProcessedMessageId;

      if (!options.dryRun) await saveCheckpoint(config, state);

      processedThisRun += batch.length;
      console.log(
        `Processed ${processedThisRun} messages this run | scanned ${state.emailsScanned} | found ${state.contactsFound} | created ${state.contactsCreated} | updated ${state.contactsUpdated} | skipped ${state.skipped}`,
      );

      if (config.maxEmails && state.emailsScanned >= config.maxEmails) break;
    }

    hasMore = Boolean(state.nextPageToken);
  }

  if (!options.dryRun) {
    state.finishedAt = new Date().toISOString();
    state.done = !state.nextPageToken || Boolean(config.maxEmails || config.maxPages);
    await saveCheckpoint(config, state);
  }

  printSummary(state, options);
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    validateCredentials: false,
    resetCheckpoint: false,
    selfTest: false,
    help: false,
    maxEmails: 0,
    maxPages: 0,
    pageSize: 100,
    batchSize: 50,
    concurrency: 3,
    query: "",
    sinceDays: 0,
    checkpointPath: path.join(process.cwd(), CHECKPOINT_DIR, CHECKPOINT_FILE),
    checkpointExplicit: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--validate-credentials") options.validateCredentials = true;
    else if (arg === "--reset-checkpoint") options.resetCheckpoint = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--query") {
      options.query = next;
      index += 1;
    } else if (arg === "--since-days") {
      options.sinceDays = Number(next);
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

function printHelp() {
  console.log(`
Brand Contact Gmail scanner

Commands:
  npm run brand-contacts:self-test
  npm run brand-contacts:validate-credentials
  npm run brand-contacts:dry-run
  npm run brand-contacts:scan

Options:
  --dry-run                 Read Gmail and preview writes without updating Sheets
  --max-emails <number>     Stop after N candidate emails
  --max-pages <number>      Stop after N Gmail result pages
  --page-size <number>      Gmail search page size, max 500
  --batch-size <number>     Gmail read batch size
  --concurrency <number>    Parallel Gmail reads, default 3
  --query <gmail query>     Override Gmail search query
  --since-days <number>     Add newer_than:Nd to the query
  --checkpoint <path>       Override checkpoint path
  --reset-checkpoint        Delete checkpoint and exit
  --validate-credentials    Check Gmail and Team Asset sheet access
  --self-test               Run local ID, extraction, and row mapping tests
`);
}

function loadConfig(options) {
  const missing = [];
  const baseQuery = options.query || process.env.BRAND_CONTACT_SCAN_GMAIL_QUERY || DEFAULT_QUERY;
  const query = withSinceDays(baseQuery, options.sinceDays || Number(process.env.BRAND_CONTACT_SCAN_SINCE_DAYS || 0));
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
    spreadsheetId: env("TEAM_ASSETS_SPREADSHEET_ID", missing),
    query,
    checkpointPath,
    maxEmails: options.maxEmails,
    maxPages: options.maxPages,
    pageSize: clamp(options.pageSize, 1, 500),
    batchSize: clamp(options.batchSize, 1, 50),
    concurrency: clamp(options.concurrency, 1, 8),
  };

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return config;
}

function withSinceDays(query, sinceDays) {
  if (!sinceDays || !Number.isFinite(sinceDays) || sinceDays <= 0) return query;
  if (/\b(newer_than|older_than|after|before):/i.test(query)) return query;
  return `${query} newer_than:${Math.round(sinceDays)}d`;
}

function env(name, missing) {
  const value = process.env[name];
  if (!value) missing.push(name);
  return value ?? "";
}

async function validateCredentials({ gmail, sheets, config }) {
  console.log("Validating Brand Contact Scan credentials...");
  console.log(`Gmail client ID: ${maskValue(config.gmailClientId)}`);
  console.log(`Gmail refresh token: ${maskValue(config.gmailRefreshToken)}`);
  console.log(`Service account: ${config.serviceAccountEmail}`);
  console.log(`Private key loaded: ${config.privateKey.includes("BEGIN PRIVATE KEY") ? "yes" : "no"}`);
  console.log(`Team Asset spreadsheet ID: ${config.spreadsheetId}`);

  const profile = await gmail.profile();
  console.log(`Gmail auth: OK (${profile.emailAddress ?? "profile email hidden"})`);

  const metadata = await sheets.metadata();
  console.log(`Google Sheets auth: OK`);
  console.log(`Spreadsheet title: ${metadata.properties?.title ?? "Unknown"}`);

  const database = await loadContactDatabase(sheets);
  console.log(`Contact Database tab: OK (${database.contacts.length} existing contacts)`);

  const estimate = await gmail.estimateSearch(config.query);
  console.log(`Estimated Gmail matches: ${estimate.resultSizeEstimate ?? 0}`);
  console.log("Credential validation complete. No emails were scanned.");
}

function maskValue(value) {
  if (!value) return "missing";
  if (value.length <= 10) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function resetCheckpoint(config) {
  await rm(config.checkpointPath, { force: true });
  console.log(`Removed checkpoint: ${config.checkpointPath}`);
}

async function loadCheckpoint(config) {
  if (!existsSync(config.checkpointPath)) return null;
  const raw = await readFile(config.checkpointPath, "utf8");
  return JSON.parse(raw);
}

async function saveCheckpoint(config, state) {
  await mkdir(path.dirname(config.checkpointPath), { recursive: true });
  await writeFile(config.checkpointPath, JSON.stringify(state, null, 2));
}

function createInitialState({ runId, startedAt, query }) {
  return {
    runId,
    startedAt,
    finishedAt: "",
    query,
    nextPageToken: "",
    pagesScanned: 0,
    emailsScanned: 0,
    contactsFound: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    duplicatesSkipped: 0,
    skipped: 0,
    skippedMissingBrand: 0,
    skippedMissingEmail: 0,
    skippedNoReply: 0,
    extractionSamples: [],
    skippedSamples: [],
    errors: [],
    processedMessageIds: [],
    lastProcessedAt: "",
    lastProcessedMessageId: "",
    done: false,
  };
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `BRAND-CONTACTS-${stamp}`;
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
    async estimateSearch(query) {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("q", query);
      url.searchParams.set("maxResults", "1");
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
    async valuesGet(range) {
      const url = new URL(`${base}/values/${encodeURIComponent(range)}`);
      url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
      return googleFetch(url, tokenProvider);
    },
    async valuesUpdate(range, values) {
      const url = new URL(`${base}/values/${encodeURIComponent(range)}`);
      url.searchParams.set("valueInputOption", "USER_ENTERED");
      return googleFetch(url, tokenProvider, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          majorDimension: "ROWS",
          values,
        }),
      });
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
    async valuesClear(range) {
      const url = new URL(`${base}/values/${encodeURIComponent(range)}:clear`);
      return googleFetch(url, tokenProvider, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
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
      const delayMs = retryDelayMs(response, attempt);
      console.warn(`Google API asked us to slow down (${response.status}). Waiting ${Math.round(delayMs / 1000)}s before retry ${attempt + 2}/${maxAttempts}.`);
      await sleep(delayMs);
      continue;
    }
    throw new Error(`Google API failed (${response.status}) ${url.pathname}: ${body.error?.message ?? body.error ?? response.statusText}`);
  }
  throw new Error(`Google API failed after retries: ${url.pathname}`);
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return Math.min(30_000, 1000 * 2 ** attempt);
}

async function loadContactDatabase(sheets) {
  let metadata = await sheets.metadata();
  let tab = getTab(metadata, CONTACT_DATABASE_TAB);

  if (!tab) {
    await sheets.batchUpdate([{ addSheet: { properties: { title: CONTACT_DATABASE_TAB } } }]);
    metadata = await sheets.metadata();
    tab = getTab(metadata, CONTACT_DATABASE_TAB);
  }

  if (!tab) throw new Error(`Could not find or create "${CONTACT_DATABASE_TAB}".`);

  let table = await readContactTable(sheets);
  if (table.headers.length === 0) {
    await sheets.valuesUpdate(`${quoteSheet(CONTACT_DATABASE_TAB)}!A1:F1`, [CONTACT_HEADERS]);
    table = { headers: CONTACT_HEADERS, rows: [] };
  }

  if (!hasCurrentHeaderSchema(table.headers)) {
    const oldRowCount = table.rows.length;
    const contacts = normalizeContactRows(table.headers, table.rows);
    const rows = contacts.map((contact) => contactToRow(contact));
    await sheets.valuesUpdate(`${quoteSheet(CONTACT_DATABASE_TAB)}!A1:F${Math.max(1, rows.length + 1)}`, [
      CONTACT_HEADERS,
      ...rows,
    ]);
    if (oldRowCount > rows.length) {
      await sheets.valuesClear(`${quoteSheet(CONTACT_DATABASE_TAB)}!A${rows.length + 2}:F${oldRowCount + 1}`);
    }
    await sheets.valuesClear(`${quoteSheet(CONTACT_DATABASE_TAB)}!G:ZZ`);
    await sheets.batchUpdate([
      {
        updateSheetProperties: {
          properties: {
            sheetId: tab.properties.sheetId,
            gridProperties: { columnCount: CONTACT_HEADERS.length },
          },
          fields: "gridProperties.columnCount",
        },
      },
    ]);
    table = { headers: CONTACT_HEADERS, rows };
  }

  return {
    sheetId: tab.properties.sheetId,
    contacts: normalizeContactRows(table.headers, table.rows),
  };
}

async function readContactTable(sheets) {
  const result = await sheets.valuesGet(`${quoteSheet(CONTACT_DATABASE_TAB)}!A1:Z`);
  const values = result.values ?? [];
  return {
    headers: values[0] ?? [],
    rows: values.slice(1),
  };
}

function getTab(metadata, name) {
  return (metadata.sheets ?? []).find((sheet) => sheet.properties?.title === name) ?? null;
}

function hasCurrentHeaderSchema(headers) {
  if (headers.length !== CONTACT_HEADERS.length) return false;
  return CONTACT_HEADERS.every((header, index) => compactKey(headers[index] ?? "") === compactKey(header));
}

function normalizeContactRows(headers, rows) {
  const lookup = buildHeaderLookup(headers);
  return rows
    .map((row, index) => {
      const brandName = cleanBrandName(getCell(row, lookup, "brandName"));
      const email = normalizeEmail(getCell(row, lookup, "email"));
      const contactName = cleanContactName(getCell(row, lookup, "contactName"));
      if (!brandName && !email && !contactName) return null;

      const contact = {
        id: getCell(row, lookup, "id"),
        rowNumber: index + 2,
        brandName,
        contactName,
        contactFirstName: splitFirstName(contactName, getCell(row, lookup, "contactFirstName")),
        email,
        position: cleanPosition(getCell(row, lookup, "position")),
      };

      return {
        ...contact,
        id: contact.id || contactId(contact.brandName, contact.email),
      };
    })
    .filter(Boolean);
}

function buildHeaderLookup(headers) {
  const aliases = {
    id: ["id", "contact id"],
    brandName: ["brandname", "brand name", "brand", "company", "company name", "brands mentioned"],
    contactName: ["contactname", "contact name", "name", "full name"],
    contactFirstName: ["contactfirstname", "contact first name", "first name", "firstname"],
    email: ["email", "email address", "work email", "business email", "contact email"],
    position: ["position", "title", "job title", "role", "contact role"],
  };
  const normalizedHeaders = headers.map((header) => compactKey(header));
  const lookup = {};

  for (const [field, names] of Object.entries(aliases)) {
    const normalizedNames = names.map(compactKey);
    lookup[field] = normalizedHeaders.findIndex((header) => normalizedNames.includes(header));
  }

  return lookup;
}

function getCell(row, lookup, field) {
  const index = lookup[field];
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function createWritePlan(messages, context) {
  const plan = {
    creates: [],
    updates: [],
    skips: [],
    errors: [],
  };

  for (const message of messages) {
    context.state.emailsScanned += 1;

    try {
      const email = normalizeGmailMessage(message);
      const result = extractBrandContact(email);

      if (!result.ok) {
        plan.skips.push(result);
        recordSkippedSample(context.state, email, result.reason);
        continue;
      }

      const contact = result.contact;
      if (context.seenThisRun.has(contact.id)) {
        plan.skips.push({ ok: false, reason: "Duplicate found in this run", code: "duplicate-run" });
        continue;
      }
      context.seenThisRun.add(contact.id);

      const existing = context.existingById.get(contact.id);
      if (existing?.rowNumber) {
        const merged = mergeContact(existing, contact);
        if (contactsEqual(existing, merged)) {
          plan.skips.push({ ok: false, reason: "Existing row already has this contact", code: "duplicate-existing" });
          continue;
        }
        plan.updates.push({
          rowNumber: existing.rowNumber,
          contact: merged,
        });
      } else {
        plan.creates.push(contact);
      }

      recordExtractionSample(context.state, email, contact);
    } catch (error) {
      const messageId = message.id ?? "unknown-message";
      const detail = `${messageId}: ${safeError(error)}`;
      context.state.errors.push(detail);
      plan.errors.push(detail);
    }
  }

  return plan;
}

function extractBrandContact(email) {
  const sender = parseSender(email.from);
  const contactEmail = normalizeEmail(sender.email);
  const senderDomain = domainFromEmail(contactEmail);

  if (!contactEmail || !isValidEmail(contactEmail)) {
    return { ok: false, reason: "Missing sender email", code: "missing-email" };
  }

  if (
    isNoReplyEmail(contactEmail) ||
    domainMatches(senderDomain, INTERNAL_EMAIL_DOMAINS) ||
    domainMatches(senderDomain, AUTOMATED_OR_LOW_VALUE_DOMAINS)
  ) {
    return { ok: false, reason: "No-reply or automated sender", code: "no-reply" };
  }

  const text = `${email.subject}\n${email.snippet}\n${email.body}`.slice(0, 80_000);
  const brandName = inferBrandName({ email, sender, text });

  if (!brandName) {
    return { ok: false, reason: "Could not detect brand name", code: "missing-brand" };
  }

  const contactName = cleanContactName(sender.name);
  const position = inferPosition(text);

  if (sameEntityName(brandName, contactName)) {
    return { ok: false, reason: "Brand looked like the sender contact name", code: "missing-brand" };
  }

  if (/talent manager/i.test(position) && looksLikePersonName(brandName)) {
    return { ok: false, reason: "Brand looked like a represented talent, not a brand", code: "missing-brand" };
  }

  const contact = {
    id: contactId(brandName, contactEmail),
    brandName,
    contactName,
    contactFirstName: splitFirstName(contactName, ""),
    email: contactEmail,
    position,
  };

  return { ok: true, contact };
}

function inferBrandName({ email, sender, text }) {
  const candidates = [];
  const subject = String(email.subject ?? "").replace(/^(re|fw|fwd)\s*:\s*/i, "").trim();

  collectMatches(candidates, subject, [
    /^\[?\s*([A-Z][A-Za-z0-9&'.+ -]{1,55})\s+(?:x|X|×)\s+@?[A-Za-z0-9_.-]+/g,
    /\b(?:booking|campaign|collab|collaboration|partnership|sponsorship|brief|opportunity|activation|promotion)\s+(?:for|with|from)\s+([A-Z][A-Za-z0-9&'.+ -]{1,55})/gi,
    /\b(?:client|brand|on behalf of)\s+([A-Z][A-Za-z0-9&'.+ -]{1,55})/gi,
    /\b([A-Z][A-Za-z0-9&'.+ -]{1,55})\s+(?:x|X)\s+(?:Team Billion|creator|creators|campaign|collab|collaboration|partnership)/g,
    /\b([A-Z][A-Za-z0-9&'.+ -]{1,45})\s+(?:campaign|collab|collaboration|partnership|sponsorship|brief|booking|opportunity)\b/g,
  ]);

  collectMatches(candidates, text, [
    /\b(?:booking|campaign|collab|collaboration|partnership|sponsorship|brief|opportunity|activation|promotion)\s+(?:for|with|from)\s+([A-Z][A-Za-z0-9&'.+ -]{1,55})(?:[\n\r:|,!.]|\s+-)/gi,
    /\b(?:client|brand)\s*:?\s+([A-Z][A-Za-z0-9&'.+ -]{1,55})(?:[\n\r:|,!.]|\s+-)/gi,
    /\bon behalf of\s+([A-Z][A-Za-z0-9&'.+ -]{1,55})(?:[\n\r:|,!.]|\s+-)/gi,
  ]);

  const domainBrand = inferBrandFromSenderDomain(sender.domain);
  if (domainBrand) candidates.push(domainBrand);

  return chooseBestBrandCandidate(candidates);
}

function collectMatches(candidates, text, patterns) {
  for (const pattern of patterns) {
    for (const match of String(text ?? "").matchAll(pattern)) {
      const candidate = cleanBrandName(match[1]);
      if (candidate && !isBadBrandCandidate(candidate)) candidates.push(candidate);
    }
  }
}

function inferBrandFromSenderDomain(domain) {
  if (!domain || GENERIC_EMAIL_DOMAINS.has(domain)) return "";
  const root = rootDomainName(domain);
  if (!root || SOURCE_ORG_HINTS.some((hint) => root.toLowerCase().includes(hint))) return "";
  return toTitleCase(root.replace(/[-_.]+/g, " "));
}

function chooseBestBrandCandidate(candidates) {
  const cleaned = unique(candidates.map(cleanBrandName).filter((candidate) => candidate && !isBadBrandCandidate(candidate)));
  if (cleaned.length === 0) return "";

  const scored = cleaned.map((candidate, index) => {
    let score = 100 - index;
    const words = candidate.split(/\s+/);
    if (words.length <= 3) score += 8;
    if (/\b(ai|app|beauty|skin|labs|studio|shop|co|coffee|fit|health|wear)\b/i.test(candidate)) score += 4;
    if (words.length > 5) score -= 20;
    if (candidate.length > 42) score -= 10;
    return { candidate, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.candidate ?? "";
}

function isBadBrandCandidate(value) {
  const normalized = normalizeKey(value);
  return (
    !normalized ||
    normalized.length < 2 ||
    BAD_BRAND_CANDIDATES.has(normalized) ||
    normalized.includes("@") ||
    /\b(creator|creators|collaborations?|partnerships?|equity|visibility|instagram|youtube)\b/i.test(value) ||
    /^(new|potential|paid|creator|influencer|brand|campaign)\b/i.test(value) ||
    /^behind\b/i.test(value) ||
    /\b(your content|your creator|our client|the client|next steps|calendar|meeting|invoice|receipt|confirmed everything|best)\b/i.test(value) ||
    String(value).length > 60
  );
}

function inferPosition(text) {
  const lower = String(text ?? "").toLowerCase();
  for (const position of POSITION_PATTERNS) {
    if (lower.includes(position.toLowerCase())) return position;
  }

  const titleMatch = String(text ?? "").match(/(?:title|role|position)\s*:?\s*([A-Za-z /-]{3,60})/i);
  if (titleMatch?.[1]) return cleanPosition(titleMatch[1]);
  return "";
}

function parseSender(from) {
  const match = String(from ?? "").match(/^(.*?)<([^>]+)>$/);
  const email = (match ? match[2] : from).trim().replace(/^mailto:/i, "");
  const rawName = (match ? match[1] : String(from ?? "").split("@")[0]).replace(/["']/g, "").trim();
  return {
    raw: from,
    name: cleanContactName(rawName),
    email,
    domain: email.includes("@") ? email.split("@").pop().toLowerCase() : "",
  };
}

function normalizeGmailMessage(message) {
  const headers = Object.fromEntries(
    (message.payload?.headers ?? []).map((header) => [String(header.name).toLowerCase(), header.value]),
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

async function flushWritePlan(sheets, contactDatabase, plan) {
  const writes = [];

  if (plan.creates.length > 0) {
    const startRow = contactDatabase.contacts.length + 2;
    writes.push({
      range: `${quoteSheet(CONTACT_DATABASE_TAB)}!A${startRow}`,
      majorDimension: "ROWS",
      values: plan.creates.map(contactToRow),
    });
  }

  for (const update of plan.updates) {
    writes.push({
      range: `${quoteSheet(CONTACT_DATABASE_TAB)}!A${update.rowNumber}:F${update.rowNumber}`,
      majorDimension: "ROWS",
      values: [contactToRow(update.contact)],
    });
  }

  if (writes.length > 0) await sheets.valuesBatchUpdate(writes);
}

function applyPlanToMemory(contactDatabase, existingById, plan) {
  for (const contact of plan.creates) {
    contactDatabase.contacts.push({
      ...contact,
      rowNumber: contactDatabase.contacts.length + 2,
    });
    existingById.set(contact.id, contactDatabase.contacts.at(-1));
  }

  for (const update of plan.updates) {
    const rowIndex = update.rowNumber - 2;
    contactDatabase.contacts[rowIndex] = {
      ...update.contact,
      rowNumber: update.rowNumber,
    };
    existingById.set(update.contact.id, contactDatabase.contacts[rowIndex]);
  }
}

function updateCounters(state, plan) {
  state.contactsFound += plan.creates.length + plan.updates.length;
  state.contactsCreated += plan.creates.length;
  state.contactsUpdated += plan.updates.length;
  state.duplicatesSkipped += plan.skips.filter((skip) => skip.code?.includes("duplicate")).length;
  state.skipped += plan.skips.length;
  state.skippedMissingBrand += plan.skips.filter((skip) => skip.code === "missing-brand").length;
  state.skippedMissingEmail += plan.skips.filter((skip) => skip.code === "missing-email").length;
  state.skippedNoReply += plan.skips.filter((skip) => skip.code === "no-reply").length;
}

function contactToRow(contact) {
  return CONTACT_HEADERS.map((header) => contact[header] ?? "");
}

function mergeContact(existing, incoming) {
  const merged = {
    ...existing,
    id: incoming.id || existing.id,
    brandName: existing.brandName || incoming.brandName,
    contactName: existing.contactName || incoming.contactName,
    contactFirstName: existing.contactFirstName || incoming.contactFirstName,
    email: existing.email || incoming.email,
    position: existing.position || incoming.position,
  };

  if (!merged.contactFirstName && merged.contactName) {
    merged.contactFirstName = splitFirstName(merged.contactName, "");
  }

  return merged;
}

function contactsEqual(left, right) {
  return CONTACT_HEADERS.every((header) => String(left[header] ?? "") === String(right[header] ?? ""));
}

function contactId(brandName, email) {
  const brand = slug(brandName);
  const mailbox = slug(normalizeEmail(email));
  return `brand-contact-${brand}-${mailbox}`.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function splitFirstName(contactName, explicitFirstName) {
  if (String(explicitFirstName ?? "").trim()) return String(explicitFirstName).trim();
  return String(contactName ?? "").trim().split(/\s+/)[0] ?? "";
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function domainFromEmail(email) {
  return normalizeEmail(email).split("@").pop() ?? "";
}

function domainMatches(domain, domains) {
  return [...domains].some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function isNoReplyEmail(email) {
  const local = email.split("@")[0] ?? "";
  return /^(no-?reply|donotreply|do-not-reply|notification|notifications|mailer|mailchimp|calendar|support|store-news|news|hello-news)$/i.test(local);
}

function sameEntityName(left, right) {
  const leftKey = compactKey(left);
  const rightKey = compactKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function looksLikePersonName(value) {
  const words = cleanEntityName(value).split(/\s+/).filter(Boolean);
  return words.length === 2 && words.every((word) => /^[A-Z][a-z'’-]{2,}$/.test(word));
}

function cleanBrandName(value) {
  return cleanEntityName(value)
    .replace(/\b(?:creator|influencer|campaign|collaboration|collab|partnership|sponsorship|brief|booking|opportunity|activation|promotion)\b.*$/i, "")
    .replace(/\s+(?:for|with|from|by)$/i, "")
    .trim();
}

function cleanContactName(value) {
  return cleanEntityName(value)
    .replace(/\s+via\s+.+$/i, "")
    .replace(/\s+from\s+.+$/i, "")
    .trim();
}

function cleanPosition(value) {
  const cleaned = cleanEntityName(value).replace(/[|].*$/g, "").slice(0, 80).trim();
  if (!/[A-Za-z]{3}/.test(cleaned)) return "";
  return cleaned;
}

function cleanEntityName(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^[\s:|,-]+|[\s:|,!.?;-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rootDomainName(domain) {
  const parts = String(domain ?? "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] ?? "";
  const secondLevel = parts.at(-2) ?? parts[0];
  const thirdLevel = parts.at(-3) ?? "";
  if (["co", "com", "org", "net"].includes(secondLevel) && thirdLevel) return thirdLevel;
  return secondLevel;
}

function slug(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function compactKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9@.]+/g, "");
}

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9@. ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value) {
  return String(value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.length <= 2 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`))
    .join(" ");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function quoteSheet(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function formatGoogleError(result) {
  const error = result.error ? String(result.error) : "";
  const description = result.error_description ? String(result.error_description) : "";
  if (error && description) return `${error} - ${description}`;
  return description || error || "No access token returned";
}

function normalizePrivateKey(value) {
  return String(value ?? "").replace(/\\n/g, "\n");
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(base64, "base64");
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function recordExtractionSample(state, email, contact) {
  if (state.extractionSamples.length >= 25) return;
  state.extractionSamples.push({
    subject: email.subject,
    sender: email.from,
    brandName: contact.brandName,
    email: contact.email,
    contactName: contact.contactName,
    position: contact.position,
  });
}

function recordSkippedSample(state, email, reason) {
  if (state.skippedSamples.length >= 25) return;
  state.skippedSamples.push({
    subject: email.subject,
    sender: email.from,
    reason,
  });
}

function printSummary(state, options) {
  console.log("\nBrand contact scan summary");
  console.log(`Run ID: ${state.runId}`);
  console.log(`Mode: ${options.dryRun ? "dry run" : "live"}`);
  console.log(`Emails scanned: ${state.emailsScanned}`);
  console.log(`Contacts found: ${state.contactsFound}`);
  console.log(`Contacts created: ${state.contactsCreated}`);
  console.log(`Contacts updated: ${state.contactsUpdated}`);
  console.log(`Duplicates skipped: ${state.duplicatesSkipped}`);
  console.log(`Skipped: ${state.skipped}`);
  console.log(`Skipped missing brand: ${state.skippedMissingBrand}`);
  console.log(`Skipped missing email: ${state.skippedMissingEmail}`);
  console.log(`Skipped no-reply: ${state.skippedNoReply}`);

  if (state.extractionSamples.length > 0) {
    console.log("\nSample contacts:");
    for (const sample of state.extractionSamples.slice(0, 10)) {
      console.log(`- ${sample.brandName} | ${sample.email} | ${sample.contactName || "No name"} | ${sample.position || "No position"}`);
      console.log(`  Subject: ${sample.subject}`);
    }
  }

  if (state.skippedSamples.length > 0 && options.dryRun) {
    console.log("\nSample skips:");
    for (const sample of state.skippedSamples.slice(0, 5)) {
      console.log(`- ${sample.reason} | ${sample.sender}`);
      console.log(`  Subject: ${sample.subject}`);
    }
  }

  if (state.errors.length > 0) {
    console.log("\nErrors:");
    for (const error of state.errors.slice(-10)) console.log(`- ${error}`);
  }

  if (options.dryRun) {
    console.log("\nDry run complete. No Contact Database rows were changed.");
  } else {
    console.log(state.nextPageToken ? "\nCheckpoint saved. Run again to resume." : "\nNo next page token. Scan is complete for this query.");
  }
}

function loadEnvFiles(files) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = parseEnvValue(rawValue);
    }
  }
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\n/g, "\n");
  }
  return value;
}

function runSelfTest() {
  const sameA = contactId("Dola AI", "ABC@KatlasMedia.com");
  const sameB = contactId("dola ai", "abc@katlasmedia.com");
  assert(sameA === sameB, "Normalized brand + email should create the same ID.");

  const differentBrand = contactId("Poppi", "abc@katlasmedia.com");
  assert(sameA !== differentBrand, "Same agency email can exist under different brands.");

  const fakeEmail = {
    id: "msg-1",
    from: '"Alex Carter" <abc@katlasmedia.com>',
    subject: "Booking for Dola AI creator campaign",
    snippet: "Paid creator campaign for Dola AI.",
    body: "Hi Team, I am Alex, Partnerships Manager. Booking for Dola AI.",
  };
  const extracted = extractBrandContact(fakeEmail);
  assert(extracted.ok, "Sample email should extract a contact.");
  assert(extracted.contact.brandName === "Dola AI", "Sample email should extract Dola AI.");
  assert(extracted.contact.email === "abc@katlasmedia.com", "Sample email should normalize email.");
  assert(extracted.contact.contactName === "Alex Carter", "Sample email should extract sender name.");

  const row = contactToRow(extracted.contact);
  assert(row.length === CONTACT_HEADERS.length, "Sheet row should match simplified Contact Database headers.");
  assert(row[0] === extracted.contact.id, "Sheet row should include stable ID.");
  assert(row[1] === "Dola AI", "Sheet row should include brandName.");
  assert(row[4] === "abc@katlasmedia.com", "Sheet row should include email.");

  console.log("Brand contact scanner self-test passed.");
}

function assert(condition, message) {
  if (!condition) throw new Error(`Self-test failed: ${message}`);
}
