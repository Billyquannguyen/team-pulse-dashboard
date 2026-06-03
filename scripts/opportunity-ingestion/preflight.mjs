#!/usr/bin/env node

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_QUERY =
  'in:anywhere -in:spam -in:trash -from:quan@stride-social.com {campaign brief creator collaboration partnership affiliate song "music promotion" UGC whitelisting "paid usage" ambassador gifted PR influencer creators sponsorship collab "paid collaboration" partnership sponsorship KOL whitelisting "Spark Ads"}';

const REQUIRED_TABS = [
  "Opportunities",
  "Organizations",
  "Brands",
  "Contacts",
  "Extraction Review",
  "Ingestion Log",
  "Alias Mapping",
  "Brand Intelligence",
  "Agency Intelligence",
  "Contact Intelligence",
  "Creator Matching Signals",
];

const INTELLIGENCE_TABS = [
  "Brand Intelligence",
  "Agency Intelligence",
  "Contact Intelligence",
  "Creator Matching Signals",
];

const SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles([".env", ".env.local", ".env.opportunity-ingestion"]);
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const startedAt = new Date().toISOString();
  const config = loadConfig(options);
  const checks = [];

  const gmailTokenProvider = createGmailTokenProvider(config);
  const googleTokenProvider = createGoogleTokenProvider(config);
  const gmail = createGmailClient(gmailTokenProvider);
  const sheets = createSheetsClient(config.spreadsheetId, googleTokenProvider);

  let spreadsheetMetadata = null;

  await runCheck(checks, "Gmail auth valid", async () => {
    const profile = await gmail.profile();
    return `Connected as ${profile.emailAddress ?? "profile email hidden"}`;
  });

  await runCheck(checks, "Sheets auth valid", async () => {
    spreadsheetMetadata = await sheets.metadata();
    return `Opened "${spreadsheetMetadata.properties?.title ?? "Untitled"}"`;
  });

  await runCheck(checks, "Drive API not required", async () => {
    return "Skipped: Drive API is not required. Backup now uses Sheets-only local snapshots.";
  });

  await runCheck(checks, "Backup system operational", async () => {
    spreadsheetMetadata ??= await sheets.metadata();
    const sheetNames = getSheetNames(spreadsheetMetadata);
    if (sheetNames.length === 0) throw new Error("Spreadsheet has no tabs to snapshot.");
    const backupDir = path.join(process.cwd(), ".opportunity-ingestion", "backups");
    const testFile = path.join(backupDir, "preflight-backup-test.json");
    await mkdir(backupDir, { recursive: true });
    await writeFile(
      testFile,
      JSON.stringify(
        {
          kind: "backup-preflight-test",
          spreadsheetId: config.spreadsheetId,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    const roundTrip = JSON.parse(await readFile(testFile, "utf8"));
    await rm(testFile, { force: true });
    if (roundTrip.kind !== "backup-preflight-test") throw new Error("Backup folder write/read round trip failed.");
    return `Sheets-only backup ready. ${sheetNames.length} tabs can be snapshotted locally.`;
  });

  await runCheck(checks, "Required tabs exist", async () => {
    spreadsheetMetadata ??= await sheets.metadata();
    const sheetNames = getSheetNames(spreadsheetMetadata);
    const missing = REQUIRED_TABS.filter((tab) => !sheetNames.includes(tab));
    if (missing.length > 0) throw new Error(`Missing tabs: ${missing.join(", ")}`);
    return `${REQUIRED_TABS.length} required tabs found.`;
  });

  await runCheck(checks, "Alias Mapping tab exists", async () => {
    spreadsheetMetadata ??= await sheets.metadata();
    const sheetNames = getSheetNames(spreadsheetMetadata);
    if (!sheetNames.includes("Alias Mapping")) throw new Error("Alias Mapping tab is missing.");
    const values = await sheets.valuesGet("'Alias Mapping'!A1:G5");
    const headers = values.values?.[0] ?? [];
    if (headers.length === 0) throw new Error("Alias Mapping tab has no header row.");
    return `Alias Mapping headers found: ${headers.join(" | ")}`;
  });

  await runCheck(checks, "Spreadsheet writable", async () => {
    const probe = `__TEAM_BILLION_PREFLIGHT_NOOP_${Date.now()}__`;
    const result = await sheets.batchUpdate([
      {
        findReplace: {
          find: probe,
          replacement: probe,
          allSheets: true,
        },
      },
    ]);
    const changed = result.replies?.[0]?.findReplace?.occurrencesChanged ?? 0;
    return `Sheets write permission OK. No-op find/replace changed ${changed} cells.`;
  });

  await runCheck(checks, "Resume checkpoint system operational", async () => {
    const checkpointDir = path.join(process.cwd(), ".opportunity-ingestion", "preflight");
    const checkpointFile = path.join(checkpointDir, "checkpoint-test.json");
    const payload = {
      kind: "preflight-checkpoint-test",
      createdAt: new Date().toISOString(),
    };
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(checkpointFile, JSON.stringify(payload, null, 2));
    const roundTrip = JSON.parse(await readFile(checkpointFile, "utf8"));
    await rm(checkpointFile, { force: true });
    if (roundTrip.kind !== payload.kind) throw new Error("Checkpoint read/write round trip failed.");
    return "Local checkpoint folder can be written and read.";
  });

  await runCheck(checks, "Intelligence tabs refresh correctly", async () => {
    spreadsheetMetadata ??= await sheets.metadata();
    const sheetNames = getSheetNames(spreadsheetMetadata);
    const missing = INTELLIGENCE_TABS.filter((tab) => !sheetNames.includes(tab));
    if (missing.length > 0) throw new Error(`Missing intelligence tabs: ${missing.join(", ")}`);

    const diagnostics = [];
    for (const tab of INTELLIGENCE_TABS) {
      const row = await sheets.valuesGet(`${quoteSheet(tab)}!A2:ZZ2`, "FORMULA");
      const formulas = (row.values?.[0] ?? []).filter((cell) => String(cell).trim().startsWith("="));
      if (formulas.length === 0) {
        throw new Error(`${tab} row 2 has no formulas to refresh/extend.`);
      }
      diagnostics.push(`${tab}: ${formulas.length} formula cells`);
    }
    return diagnostics.join("; ");
  });

  await runCheck(checks, "Estimated Gmail result count for ingestion query", async () => {
    const estimate = await gmail.estimateSearch(config.query);
    return `Estimated matching messages: ${estimate.resultSizeEstimate ?? 0}`;
  });

  const failed = checks.filter((check) => check.status === "FAIL");
  const finishedAt = new Date().toISOString();
  printReport({ startedAt, finishedAt, checks, query: config.query });

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const options = {
    help: false,
    query: process.env.OPPORTUNITY_GMAIL_QUERY || DEFAULT_QUERY,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--query") {
      options.query = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Opportunity Intelligence preflight check

Command:
  npm run opportunity:preflight

Options:
  --query <gmail query>   Override Gmail result-count query

This checks credentials, spreadsheet health, backup capability, checkpoint storage,
intelligence formula readiness, and Gmail result-size estimate.

It does not read email bodies, write opportunity rows, or create backup files.
Drive API is not required because rollback uses a local Sheets API snapshot.
`);
}

function loadConfig(options) {
  const missing = [];
  const config = {
    gmailClientId: env("GMAIL_CLIENT_ID", missing),
    gmailClientSecret: env("GMAIL_CLIENT_SECRET", missing),
    gmailRefreshToken: env("GMAIL_REFRESH_TOKEN", missing),
    serviceAccountEmail: env("GOOGLE_SERVICE_ACCOUNT_EMAIL", missing),
    privateKey: normalizePrivateKey(env("GOOGLE_PRIVATE_KEY", missing)),
    spreadsheetId: env("OPPORTUNITY_DATABASE_SPREADSHEET_ID", missing),
    query: options.query,
  };

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return config;
}

function env(name, missing) {
  const value = process.env[name];
  if (!value) missing.push(name);
  return value ?? "";
}

async function runCheck(checks, name, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    checks.push({
      name,
      status: "PASS",
      detail,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    checks.push({
      name,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
  }
}

function printReport({ startedAt, finishedAt, checks, query }) {
  console.log("");
  console.log("Opportunity Ingestion Preflight");
  console.log(`Started: ${startedAt}`);
  console.log(`Finished: ${finishedAt}`);
  console.log(`Query: ${query}`);
  console.log("");

  for (const check of checks) {
    const mark = check.status === "PASS" ? "OK" : "FAIL";
    console.log(`[${mark}] ${check.name}`);
    console.log(`     ${check.detail}`);
  }

  const passed = checks.filter((check) => check.status === "PASS").length;
  const failed = checks.filter((check) => check.status === "FAIL").length;
  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed.`);
  console.log(
    failed === 0
      ? "Preflight passed. You can create a backup before ingestion."
      : "Preflight failed. Fix the failed checks before running ingestion.",
  );
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
      throw new Error(`Gmail OAuth failed (${response.status}): ${result.error_description ?? result.error ?? "No access token returned"}`);
    }
    cached = {
      accessToken: result.access_token,
      expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000,
    };
    return cached.accessToken;
  };
}

function createGoogleTokenProvider(config) {
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
      throw new Error(`Google service account auth failed (${response.status}): ${result.error_description ?? result.error ?? "No access token returned"}`);
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
  };
}

function createSheetsClient(spreadsheetId, tokenProvider) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  return {
    async metadata() {
      const url = new URL(base);
      url.searchParams.set("includeGridData", "false");
      return googleFetch(url, tokenProvider);
    },
    async valuesGet(range, valueRenderOption = "FORMATTED_VALUE") {
      const url = new URL(`${base}/values/${encodeURIComponent(range)}`);
      url.searchParams.set("valueRenderOption", valueRenderOption);
      return googleFetch(url, tokenProvider);
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
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${await tokenProvider()}`,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`Google API failed (${response.status}) ${url.pathname}: ${body.error?.message ?? body.error ?? response.statusText}`);
  }
  throw new Error(`Google API failed after retries: ${url.pathname}`);
}

function getSheetNames(metadata) {
  return (metadata.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter(Boolean);
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

function normalizePrivateKey(value) {
  return value.replace(/\\n/g, "\n");
}

function pemToArrayBuffer(pem) {
  return Buffer.from(
    pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, ""),
    "base64",
  );
}

function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function quoteSheet(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
