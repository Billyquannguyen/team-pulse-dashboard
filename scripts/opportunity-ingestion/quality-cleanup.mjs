#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const REPORT_DIR = ".opportunity-ingestion/quality-reports";
const SCOPES = {
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
  const config = loadConfig();
  const tokenProvider = createGoogleTokenProvider(config);
  const sheets = createSheetsClient(config.spreadsheetId, tokenProvider);

  console.log(options.dryRun ? "QUALITY CLEANUP DRY RUN: no Sheet writes will happen." : "QUALITY CLEANUP: Sheet writes are enabled.");
  console.log(`Database: ${config.spreadsheetId}`);

  const metadata = await sheets.metadata();
  const workbook = await loadWorkbook(sheets);
  const aliasPlan = buildAliasApprovalPlan(workbook.alias);
  const reviewSummary = summarizeReviewQueue(workbook.review);
  const intelligenceSummary = summarizeIntelligence(workbook);
  const finishedAt = new Date().toISOString();

  const report = {
    startedAt,
    finishedAt,
    dryRun: options.dryRun,
    spreadsheetId: config.spreadsheetId,
    spreadsheetTitle: metadata.properties?.title ?? "Unknown",
    aliasApprovals: aliasPlan.approvals,
    aliasReviewRequired: aliasPlan.reviewRequired,
    reviewSummary,
    intelligenceSummary,
  };

  if (!options.dryRun) {
    if (aliasPlan.updates.length > 0) {
      await sheets.valuesBatchUpdate(aliasPlan.updates);
    }
    await refreshIntelligenceTabs(sheets, metadata, 10000);
    await appendCleanupLog(sheets, workbook.log, report);
  }

  const reportPath = await writeLocalReport(report);
  printReport(report, reportPath);
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
Opportunity Intelligence quality cleanup

Commands:
  npm run opportunity:quality-cleanup
  npm run opportunity:quality-cleanup:dry-run

What it does:
  - reads the existing Opportunity Intelligence Google Sheet
  - approves only obvious high-confidence alias merges
  - summarizes Extraction Review issue patterns
  - refreshes intelligence formulas
  - writes a cleanup summary to Ingestion Log

What it does not do:
  - no Gmail scan
  - no new opportunity extraction
  - no schema redesign
  - no secret printing
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

async function loadWorkbook(sheets) {
  const result = await sheets.batchGet([
    `${quoteSheet(TAB_NAMES.alias)}!A1:G10000`,
    `${quoteSheet(TAB_NAMES.review)}!A1:R10000`,
    `${quoteSheet(TAB_NAMES.log)}!A1:X10000`,
    `${quoteSheet(TAB_NAMES.brandIntelligence)}!A1:AO10000`,
    `${quoteSheet(TAB_NAMES.agencyIntelligence)}!A1:AD10000`,
    `${quoteSheet(TAB_NAMES.creatorSignals)}!A1:O10000`,
  ]);
  const [alias, review, log, brandIntelligence, agencyIntelligence, creatorSignals] = result.valueRanges.map(parseTable);
  return { alias, review, log, brandIntelligence, agencyIntelligence, creatorSignals };
}

function parseTable(valueRange) {
  const values = valueRange?.values ?? [];
  return {
    headers: values[0] ?? [],
    rows: values.slice(1),
  };
}

function buildAliasApprovalPlan(table) {
  const headerMap = headerMapFor(table.headers);
  const updates = [];
  const approvals = [];
  const reviewRequired = [];

  table.rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const entityType = getCell(row, headerMap, "Entity Type");
    const observedName = getCell(row, headerMap, "Observed Name");
    const canonicalName = getCell(row, headerMap, "Canonical Name");
    const confidence = getCell(row, headerMap, "Confidence");
    const action = getCell(row, headerMap, "Suggested Action");
    const approved = getCell(row, headerMap, "Approved?");

    if (!observedName && !canonicalName) return;
    if (String(approved).toLowerCase() === "yes") return;

    const decision = aliasDecision({ entityType, observedName, canonicalName, confidence, action });
    if (decision.approve) {
      updates.push({
        range: `${quoteSheet(TAB_NAMES.alias)}!G${rowNumber}`,
        majorDimension: "ROWS",
        values: [["Yes"]],
      });
      approvals.push({
        rowNumber,
        entityType,
        observedName,
        canonicalName,
        confidence,
        reason: decision.reason,
      });
    } else {
      reviewRequired.push({
        rowNumber,
        entityType,
        observedName,
        canonicalName,
        confidence,
        action,
        reason: decision.reason,
      });
    }
  });

  return { updates, approvals, reviewRequired };
}

function aliasDecision({ entityType, observedName, canonicalName, confidence, action }) {
  if (normalize(action) !== "merge") return { approve: false, reason: "Not a merge suggestion." };
  if (!["brand", "agency"].includes(normalize(entityType))) return { approve: false, reason: "Only brand/agency merges are auto-approved." };
  if (!observedName || !canonicalName || isUnknown(canonicalName)) return { approve: false, reason: "Canonical name is missing or unknown." };
  if (containsMultiEntityHint(observedName) || containsMultiEntityHint(canonicalName)) return { approve: false, reason: "Possible multi-brand/entity case." };
  if (!isHighConfidence(confidence)) return { approve: false, reason: "Confidence is not high enough for auto-approval." };

  const observedKey = compactKey(observedName);
  const canonicalKey = compactKey(canonicalName);
  if (observedKey === canonicalKey) return { approve: true, reason: "Same name after casing/punctuation normalization." };
  if (Math.min(observedKey.length, canonicalKey.length) >= 5 && editDistance(observedKey, canonicalKey) <= 1) {
    return { approve: true, reason: "One-character spelling variant." };
  }
  return { approve: false, reason: "Names are not similar enough for safe auto-approval." };
}

function summarizeReviewQueue(table) {
  const headerMap = headerMapFor(table.headers);
  const issueCounts = new Map();
  const suggestedFixCounts = new Map();
  const subjectsByIssue = new Map();
  let reviewed = 0;
  let unreviewed = 0;

  table.rows.forEach((row) => {
    const sourceEmailId = getCell(row, headerMap, "Source Email ID");
    const issueType = getCell(row, headerMap, "Issue Type");
    const subject = getCell(row, headerMap, "Source Email Subject");
    const suggestedFix = getCell(row, headerMap, "Suggested Fix");
    const reviewedFlag = getCell(row, headerMap, "Reviewed?");
    if (!sourceEmailId && !issueType && !subject) return;

    if (normalize(reviewedFlag) === "yes" || normalize(reviewedFlag) === "true") reviewed += 1;
    else unreviewed += 1;

    for (const issue of splitIssueList(issueType)) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
      if (!subjectsByIssue.has(issue)) subjectsByIssue.set(issue, []);
      const examples = subjectsByIssue.get(issue);
      if (subject && examples.length < 3) examples.push(subject);
    }

    const fixKey = cleanText(suggestedFix).slice(0, 140);
    if (fixKey) suggestedFixCounts.set(fixKey, (suggestedFixCounts.get(fixKey) ?? 0) + 1);
  });

  return {
    totalRows: reviewed + unreviewed,
    reviewed,
    unreviewed,
    topIssues: topEntries(issueCounts, 12).map(([issue, count]) => ({
      issue,
      count,
      examples: subjectsByIssue.get(issue) ?? [],
    })),
    topSuggestedFixes: topEntries(suggestedFixCounts, 8).map(([fix, count]) => ({ fix, count })),
  };
}

function summarizeIntelligence(workbook) {
  return {
    topBrands: topIntelligenceRows(workbook.brandIntelligence, "Brand Name", ["Total Opportunities", "Confidence Score"], 20),
    topAgencies: topIntelligenceRows(workbook.agencyIntelligence, "Organization Name", ["Total Opportunities", "Confidence Score"], 20),
    priorityTiers: countColumn(workbook.creatorSignals, "Recommended Priority Tier"),
  };
}

function topIntelligenceRows(table, nameHeader, scoreHeaders, limit) {
  const headerMap = headerMapFor(table.headers);
  return table.rows
    .map((row) => {
      const name = getCell(row, headerMap, nameHeader);
      if (!name) return null;
      const values = Object.fromEntries(scoreHeaders.map((header) => [header, getCell(row, headerMap, header)]));
      const score = scoreHeaders.reduce((sum, header, index) => sum + (Number(getCell(row, headerMap, header)) || 0) * (index === 0 ? 10 : 1), 0);
      return { name, score, values };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function countColumn(table, headerName) {
  const headerMap = headerMapFor(table.headers);
  const counts = new Map();
  for (const row of table.rows) {
    const value = getCell(row, headerMap, headerName);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(topEntries(counts, 20));
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

async function appendCleanupLog(sheets, logTable, report) {
  const row = blankRow(logTable.headers.length);
  const notes = [
    `Quality cleanup completed.`,
    `Aliases approved: ${report.aliasApprovals.length}.`,
    `Aliases left for review: ${report.aliasReviewRequired.length}.`,
    `Review rows: ${report.reviewSummary.totalRows}; unreviewed: ${report.reviewSummary.unreviewed}.`,
    `Top review issues: ${report.reviewSummary.topIssues.slice(0, 5).map((item) => `${item.issue} ${item.count}`).join(", ")}.`,
  ].join(" ");
  fillRow(row, logTable.headers, {
    "Run ID": `QUALITY-CLEANUP-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`,
    "Run Started At": report.startedAt,
    "Run Finished At": report.finishedAt,
    "Gmail Query Used": "No Gmail scan. Sheet quality cleanup only.",
    "Rows Updated": String(report.aliasApprovals.length),
    "Manual Review Required": String(report.reviewSummary.unreviewed),
    Notes: notes.slice(0, 1500),
  });

  const rowNumber = logTable.rows.length + 2;
  await sheets.valuesBatchUpdate([
    {
      range: `${quoteSheet(TAB_NAMES.log)}!A${rowNumber}`,
      majorDimension: "ROWS",
      values: [row],
    },
  ]);
}

async function writeLocalReport(report) {
  await mkdir(REPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(process.cwd(), REPORT_DIR, `quality-cleanup-${timestamp}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

function printReport(report, reportPath) {
  console.log("");
  console.log("Opportunity Intelligence Quality Cleanup");
  console.log(`Started: ${report.startedAt}`);
  console.log(`Finished: ${report.finishedAt}`);
  console.log(`Mode: ${report.dryRun ? "dry run" : "live"}`);
  console.log("");
  console.log(`Alias merges approved: ${report.aliasApprovals.length}`);
  console.log(`Alias rows left for review: ${report.aliasReviewRequired.length}`);
  if (report.aliasApprovals.length > 0) {
    console.log("Approved aliases:");
    for (const alias of report.aliasApprovals.slice(0, 20)) {
      console.log(`- Row ${alias.rowNumber}: ${alias.observedName} -> ${alias.canonicalName} (${alias.reason})`);
    }
  }
  console.log("");
  console.log(`Extraction Review rows: ${report.reviewSummary.totalRows}`);
  console.log(`Unreviewed review rows: ${report.reviewSummary.unreviewed}`);
  console.log("Top review issues:");
  for (const item of report.reviewSummary.topIssues.slice(0, 10)) {
    console.log(`- ${item.issue}: ${item.count}`);
  }
  console.log("");
  console.log("Creator Matching priority tiers:");
  for (const [tier, count] of Object.entries(report.intelligenceSummary.priorityTiers)) {
    console.log(`- ${tier}: ${count}`);
  }
  console.log("");
  console.log(`Local report: ${reportPath}`);
  console.log(
    report.dryRun
      ? "Dry run complete. No Sheet rows were changed."
      : "Cleanup complete. Intelligence formulas were refreshed and the cleanup summary was logged.",
  );
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

function createSheetsClient(spreadsheetId, tokenProvider) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  return {
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
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : response.status === 429 ? 65_000 + attempt * 5_000 : Math.min(30_000, 1000 * 2 ** attempt);
      console.warn(`Google API asked us to slow down (${response.status}) on ${url.pathname}. Waiting ${Math.round(delayMs / 1000)}s before retry ${attempt + 2}/${maxAttempts}.`);
      await sleep(delayMs);
      continue;
    }
    throw new Error(`Google API failed (${response.status}) ${url.pathname}: ${body.error?.message ?? body.error ?? response.statusText}`);
  }
  throw new Error(`Google API failed after retries: ${url.pathname}`);
}

function headerMapFor(headers) {
  return new Map(headers.map((header, index) => [normalizeHeader(header), index]));
}

function getCell(row, headerMap, headerName) {
  const index = headerMap.get(normalizeHeader(headerName));
  return index === undefined ? "" : String(row[index] ?? "").trim();
}

function setCell(row, headerMap, headerName, value) {
  const index = headerMap.get(normalizeHeader(headerName));
  if (index !== undefined) row[index] = value;
}

function fillRow(row, headers, values) {
  const headerMap = headerMapFor(headers);
  for (const [header, value] of Object.entries(values)) setCell(row, headerMap, header, value);
}

function blankRow(length) {
  return Array.from({ length }, () => "");
}

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function compactKey(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

function isUnknown(value) {
  return !value || /unknown|unclear|not specified/i.test(value);
}

function containsMultiEntityHint(value) {
  return /\/|,|\band\b|\+|\sx\s/i.test(String(value ?? ""));
}

function isHighConfidence(value) {
  const normalized = normalize(value);
  const numeric = Number(normalized);
  return normalized === "high" || (Number.isFinite(numeric) && numeric >= 85);
}

function splitIssueList(value) {
  return String(value ?? "")
    .split(/;|,|\|/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function editDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
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
