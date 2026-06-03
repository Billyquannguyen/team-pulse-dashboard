#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const BACKUP_DIR = ".opportunity-ingestion/backups";
const LATEST_BACKUP_FILE = "latest-backup.json";
const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles([".env", ".env.local", ".env.opportunity-ingestion"]);
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.command) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const tokenProvider = createGoogleTokenProvider(config);
  const sheets = createSheetsClient(config.spreadsheetId, tokenProvider);

  if (options.command === "create") {
    await createBackup({ config, sheets });
    return;
  }

  if (options.command === "restore") {
    await restoreBackup({ config, sheets, options });
    return;
  }

  throw new Error(`Unknown command: ${options.command}`);
}

function parseArgs(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      command: "",
      backupManifest: "",
      confirm: false,
      help: true,
    };
  }

  const options = {
    command: args[0] ?? "",
    backupManifest: "",
    confirm: false,
    help: false,
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--backup") {
      options.backupManifest = next;
      index += 1;
    } else if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Opportunity Intelligence backup and restore

Commands:
  npm run opportunity:create-backup
  npm run opportunity:restore-backup

Options:
  --backup <path>   Restore from a specific backup manifest
  --confirm         Required before restore writes anything

This uses Google Sheets API only. It does not require Google Drive API access.

Safe restore:
  npm run opportunity:restore-backup
  npm run opportunity:restore-backup -- --confirm
`);
}

function loadConfig() {
  const missing = [];
  const config = {
    serviceAccountEmail: env("GOOGLE_SERVICE_ACCOUNT_EMAIL", missing),
    privateKey: normalizePrivateKey(env("GOOGLE_PRIVATE_KEY", missing)),
    spreadsheetId: env("OPPORTUNITY_DATABASE_SPREADSHEET_ID", missing),
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

async function createBackup({ config, sheets }) {
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const metadata = await sheets.metadata();
  const sourceTitle = metadata.properties?.title ?? "Team Billion Opportunity Intelligence Database";
  const tabs = {};
  const rowCountsByTab = {};

  console.log(`Creating local rollback snapshot for: ${sourceTitle}`);

  for (const sheet of metadata.sheets ?? []) {
    const properties = sheet.properties;
    if (!properties?.title) continue;

    const title = properties.title;
    const formulaValues = await sheets.valuesGet(`${quoteSheet(title)}!A1:ZZZ`, "FORMULA");
    const formattedValues = await sheets.valuesGet(`${quoteSheet(title)}!A1:ZZZ`, "FORMATTED_VALUE");
    const values = formulaValues.values ?? [];

    tabs[title] = {
      title,
      properties,
      values,
      formattedValues: formattedValues.values ?? [],
    };
    rowCountsByTab[title] = {
      usedRows: values.length,
      gridRows: properties.gridProperties?.rowCount ?? 0,
      gridColumns: properties.gridProperties?.columnCount ?? 0,
      sheetId: properties.sheetId,
      index: properties.index,
    };
  }

  const manifest = {
    kind: "team-billion-opportunity-database-local-sheets-backup",
    backupMode: "local-sheets-api-snapshot",
    sourceSpreadsheetId: config.spreadsheetId,
    timestamp,
    createdAt: timestamp,
    sourceTitle,
    rowCountsByTab,
    sheetMetadata: {
      spreadsheetId: metadata.spreadsheetId,
      properties: metadata.properties,
      sheets: (metadata.sheets ?? []).map((sheet) => ({
        properties: sheet.properties,
      })),
    },
    tabs,
    restoreInstructions: [
      "This backup is a local JSON snapshot created with Google Sheets API.",
      "It stores tab metadata plus A1:ZZZ values/formulas for each tab.",
      "To preview restore, run npm run opportunity:restore-backup.",
      "To restore from the latest backup, run npm run opportunity:restore-backup -- --confirm.",
      "To restore from a specific backup, run npm run opportunity:restore-backup -- --backup <manifest-path> --confirm.",
    ],
  };

  await mkdir(BACKUP_DIR, { recursive: true });
  const manifestPath = path.join(process.cwd(), BACKUP_DIR, `backup-${safeTimestamp}.json`);
  const latestPath = path.join(process.cwd(), BACKUP_DIR, LATEST_BACKUP_FILE);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(latestPath, JSON.stringify(manifest, null, 2));

  console.log("Backup snapshot created.");
  console.log(`Source spreadsheet ID: ${manifest.sourceSpreadsheetId}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log("Row counts by tab:");
  for (const [tab, counts] of Object.entries(rowCountsByTab)) {
    console.log(`- ${tab}: used rows ${counts.usedRows}, grid rows ${counts.gridRows}`);
  }
}

async function restoreBackup({ config, sheets, options }) {
  const manifestPath = path.resolve(
    options.backupManifest || path.join(process.cwd(), BACKUP_DIR, LATEST_BACKUP_FILE),
  );

  if (!existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const sourceSpreadsheetId = manifest.sourceSpreadsheetId || config.spreadsheetId;

  if (sourceSpreadsheetId !== config.spreadsheetId) {
    throw new Error(
      `Manifest source spreadsheet does not match OPPORTUNITY_DATABASE_SPREADSHEET_ID. Manifest: ${sourceSpreadsheetId}. Env: ${config.spreadsheetId}`,
    );
  }

  const tabNames = Object.keys(manifest.tabs ?? {});

  console.log("Restore target:");
  console.log(`- Spreadsheet ID: ${sourceSpreadsheetId}`);
  console.log(`- Backup mode: ${manifest.backupMode ?? "unknown"}`);
  console.log(`- Backup timestamp: ${manifest.timestamp ?? "Unknown"}`);
  console.log(`- Manifest: ${manifestPath}`);
  console.log(`- Tabs to restore: ${tabNames.join(", ")}`);

  if (!options.confirm) {
    console.log("");
    console.log("No changes made.");
    console.log("To restore, run:");
    console.log(`npm run opportunity:restore-backup -- --backup "${manifestPath}" --confirm`);
    return;
  }

  if (tabNames.length === 0) {
    throw new Error("Backup manifest has no tabs to restore.");
  }

  console.log("Restoring spreadsheet values/formulas from local snapshot...");
  const metadata = await sheets.metadata();
  await ensureTabsExist(sheets, metadata, manifest);

  const clearRanges = tabNames.map((title) => `${quoteSheet(title)}!A1:ZZZ`);
  await sheets.batchClear(clearRanges);

  const data = tabNames.map((title) => ({
    range: `${quoteSheet(title)}!A1`,
    values: manifest.tabs[title].values ?? [],
  }));
  await sheets.valuesBatchUpdate(data);

  const restoredAt = new Date().toISOString();
  const restoreLogPath = path.join(process.cwd(), BACKUP_DIR, `restore-${restoredAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(
    restoreLogPath,
    JSON.stringify(
      {
        restoredAt,
        sourceSpreadsheetId,
        manifestPath,
        restoredTabs: tabNames,
      },
      null,
      2,
    ),
  );

  console.log("Restore complete.");
  console.log(`Restore log: ${restoreLogPath}`);
}

async function ensureTabsExist(sheets, metadata, manifest) {
  const existing = new Set((metadata.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const requests = [];

  for (const [title, tab] of Object.entries(manifest.tabs ?? {})) {
    if (existing.has(title)) continue;
    const properties = tab.properties ?? {};
    requests.push({
      addSheet: {
        properties: {
          title,
          gridProperties: properties.gridProperties,
        },
      },
    });
  }

  if (requests.length > 0) {
    await sheets.batchUpdate(requests);
  }
}

function createSheetsClient(spreadsheetId, tokenProvider) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  return {
    spreadsheetId,
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
    async batchClear(ranges) {
      const url = new URL(`${base}/values:batchClear`);
      return googleFetch(url, tokenProvider, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ranges }),
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
