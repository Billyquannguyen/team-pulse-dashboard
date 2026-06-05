#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const EXPORT_BASE_DIR = ".opportunity-ingestion/gpt-exports";
const BACKUP_BASE_DIR = ".opportunity-ingestion/backups";
const DEFAULT_OUTPUT_DIR = ".opportunity-ingestion/monthly-refresh/latest";
const DEFAULT_LOGS_DIR = ".opportunity-ingestion/monthly-refresh/logs";
const PACKAGE_NAME = "team-billion-gpt-knowledge-refresh.zip";
const SUMMARY_NAME = "monthly-gpt-refresh-summary.md";
const DEFAULT_ATTACHMENT_LIMIT_BYTES = 40 * 1024 * 1024;

const KNOWLEDGE_PACKAGE_FILES = [
  "team-billion-matching-intelligence.csv",
  "opportunity-priority-intelligence.csv",
  "agency-commercial-intelligence.csv",
  "brand-commercial-intelligence.csv",
  "pitch-angle-intelligence.csv",
  "creator-brand-opportunities.csv",
  "brand-intelligence.csv",
  "agency-intelligence.csv",
  "creator-matching-signals.csv",
  "team-billion-brand-matching-playbook.md",
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseArgs(args);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "prepare") {
    await prepareMonthlyArtifacts(options);
    return;
  }

  if (command === "notify-success") {
    await notifySuccess(options);
    return;
  }

  if (command === "notify-failure") {
    await notifyFailure(options);
    return;
  }

  if (command === "notify-discord") {
    await notifyDiscord(options);
    return;
  }

  if (command === "notify-test") {
    await notifyTest();
    return;
  }

  throw new Error(`Unknown monthly refresh command: ${command}`);
}

function parseArgs(args) {
  const options = {
    outputDir: process.env.MONTHLY_REFRESH_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    logsDir: process.env.MONTHLY_REFRESH_LOG_DIR || DEFAULT_LOGS_DIR,
    failedStep: "",
    errorMessage: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--output-dir") {
      options.outputDir = requireNext(arg, next);
      index += 1;
    } else if (arg === "--logs-dir") {
      options.logsDir = requireNext(arg, next);
      index += 1;
    } else if (arg === "--failed-step") {
      options.failedStep = requireNext(arg, next);
      index += 1;
    } else if (arg === "--error-message") {
      options.errorMessage = requireNext(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.outputDir = path.resolve(process.cwd(), options.outputDir);
  options.logsDir = path.resolve(process.cwd(), options.logsDir);
  return options;
}

function requireNext(arg, value) {
  if (!value) throw new Error(`${arg} needs a value.`);
  return value;
}

function printHelp() {
  console.log(`
Monthly Opportunity Intelligence refresh helper

Commands:
  node scripts/opportunity-ingestion/monthly-refresh.mjs prepare
  node scripts/opportunity-ingestion/monthly-refresh.mjs notify-success
  node scripts/opportunity-ingestion/monthly-refresh.mjs notify-failure --failed-step "Gmail ingestion"
  node scripts/opportunity-ingestion/monthly-refresh.mjs notify-test

What it does:
  - packages only approved Custom GPT Knowledge files
  - creates monthly-gpt-refresh-summary.md
  - sends success or failure email through Resend
  - optionally posts a no-files summary to Discord
`);
}

async function prepareMonthlyArtifacts(options) {
  await mkdir(options.outputDir, { recursive: true });

  const exportDir = await latestPath(EXPORT_BASE_DIR, (name) => name.startsWith("gpt-export-"));
  if (!exportDir) throw new Error(`No GPT export folder found in ${EXPORT_BASE_DIR}.`);

  const summary = await readJson(path.join(exportDir, "export-summary.json"));
  const backupManifest = await latestPath(
    BACKUP_BASE_DIR,
    (name) => name.startsWith("backup-") && name.endsWith(".json"),
  );
  const ingestLog = await readOptionalLog(options.logsDir, [
    "gmail-ingestion.log",
    "opportunity-ingest.log",
    "gmail-ingestion-and-sheet-update.log",
  ]);
  const backupLog = await readOptionalLog(options.logsDir, ["create-backup.log", "backup.log"]);
  const warnings = collectWarnings(ingestLog, summary);
  const metrics = parseIngestionMetrics(ingestLog);
  const decisionMetrics = await buildDecisionMetrics({ exportDir, backupManifest, metrics });

  const packagePath = path.join(options.outputDir, PACKAGE_NAME);
  const summaryPath = path.join(options.outputDir, SUMMARY_NAME);
  await createKnowledgeZip(exportDir, packagePath);

  const report = buildMonthlyReport({
    exportDir,
    summary,
    backupManifest,
    backupLog,
    metrics,
    decisionMetrics,
    warnings,
    packagePath,
  });

  await writeFile(summaryPath, report);
  await writeFile(
    path.join(options.outputDir, "monthly-refresh-artifacts.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        exportDir,
        backupManifest,
        packagePath,
        summaryPath,
        packageFiles: KNOWLEDGE_PACKAGE_FILES,
        metrics,
        decisionMetrics,
        tierCounts: summary.tierCounts ?? {},
        warnings,
      },
      null,
      2,
    ),
  );

  console.log(`Monthly GPT package: ${packagePath}`);
  console.log(`Monthly report: ${summaryPath}`);
}

async function createKnowledgeZip(exportDir, packagePath) {
  const missing = [];
  for (const file of KNOWLEDGE_PACKAGE_FILES) {
    if (!existsSync(path.join(exportDir, file))) missing.push(file);
  }

  if (missing.length > 0) {
    throw new Error(`GPT export is missing required file(s): ${missing.join(", ")}`);
  }

  await execFileAsync("zip", ["-j", "-q", packagePath, ...KNOWLEDGE_PACKAGE_FILES], {
    cwd: exportDir,
    maxBuffer: 1024 * 1024,
  });
}

function buildMonthlyReport({
  exportDir,
  summary,
  backupManifest,
  backupLog,
  metrics,
  decisionMetrics,
  warnings,
  packagePath,
}) {
  const tierCounts = summary.tierCounts ?? {};
  const outputCounts = summary.outputCounts ?? {};
  const backupLine = backupManifest
    ? `Created: ${path.relative(process.cwd(), backupManifest)}`
    : (backupLog.match(/^Manifest:\s*(.+)$/m)?.[1] ?? "Not found in this run output.");

  return `# Monthly GPT Refresh Summary

Run date: ${new Date().toISOString()}

## Gmail Ingestion

- Emails scanned: ${formatMetric(metrics.emailsScanned)}
- New opportunities: ${formatMetric(metrics.opportunitiesCreated)}
- Updated opportunities: ${formatMetric(metrics.opportunitiesUpdated)}
- New brands: ${formatMetric(metrics.brandsCreated)}
- New agencies: ${formatMetric(metrics.agenciesCreated)}
- New contacts: ${formatMetric(metrics.contactsCreated)}
- Review queue count: ${formatMetric(metrics.reviewItemsCreated ?? outputCounts.reviewCandidates)}
- Moved to review this run: ${formatMetric(decisionMetrics.reviewMovedCount)}

## 10-Second Update Decision

- Priority A opportunities added: ${formatMetric(decisionMetrics.priorityAAddedCount)}
- New brands discovered: ${formatMetric(decisionMetrics.newBrandsDiscoveredCount)}
- New agencies discovered: ${formatMetric(decisionMetrics.newAgenciesDiscoveredCount)}
- Review-before-use export rows: ${formatMetric(outputCounts.reviewCandidates)}

### Top 20 New Brands Discovered

${formatRankedList(decisionMetrics.topNewBrands, (item) => `${item.name} (${item.notes})`)}

### Top 20 New Agencies Discovered

${formatRankedList(decisionMetrics.topNewAgencies, (item) => `${item.name} (${item.notes})`)}

## Priority Distribution

${formatCounts(tierCounts)}

## Export

- Export folder location: ${path.relative(process.cwd(), exportDir)}
- Upload package: ${path.relative(process.cwd(), packagePath)}
- Backup created: ${backupLine}

## Warnings

${warnings.length > 0 ? warnings.map((warning) => `- ${warning}`).join("\n") : "- None reported."}

## Files Included In Upload Package

${KNOWLEDGE_PACKAGE_FILES.map((file) => `- ${file}`).join("\n")}

## Manual Next Step

Open GPT Builder, delete the old Knowledge files, upload the new package files, and save.
`;
}

function parseIngestionMetrics(logText) {
  return {
    emailsScanned: extractNumber(logText, "Emails scanned"),
    opportunitiesCreated: extractNumber(logText, "Opportunities created"),
    opportunitiesUpdated: extractNumber(logText, "Opportunities updated"),
    brandsCreated: extractNumber(logText, "Brands created"),
    agenciesCreated: extractNumber(logText, "Agencies created"),
    contactsCreated: extractNumber(logText, "Contacts created"),
    reviewItemsCreated: extractNumber(logText, "Review items created"),
  };
}

async function buildDecisionMetrics({ exportDir, backupManifest, metrics }) {
  const brandRows = await readCsvIfExists(
    path.join(exportDir, "brand-commercial-intelligence.csv"),
  );
  const agencyRows = await readCsvIfExists(
    path.join(exportDir, "agency-commercial-intelligence.csv"),
  );
  const priorityRows = await readCsvIfExists(
    path.join(exportDir, "opportunity-priority-intelligence.csv"),
  );
  const oldNames = backupManifest
    ? await readBackupEntitySets(backupManifest)
    : emptyBackupEntitySets();
  const oldOpportunityIds = oldNames.opportunityIds;

  const newBrands = brandRows.filter((row) => {
    const name = row.Brand?.trim();
    return name && !oldNames.brands.has(compactKey(name));
  });
  const newAgencies = agencyRows.filter((row) => {
    const name = row.Agency?.trim();
    return name && !oldNames.agencies.has(compactKey(name));
  });
  const priorityAAdded = priorityRows.filter((row) => {
    const id = row["Opportunity ID"]?.trim();
    const priorityScore = Number(row["Priority Score"]) || 0;
    const tier = row["GPT Export Tier"]?.trim();
    return (
      id && !oldOpportunityIds.has(compactKey(id)) && (priorityScore >= 80 || tier === "Tier 1")
    );
  });

  return {
    newBrandsDiscoveredCount: Number.isFinite(metrics.brandsCreated)
      ? metrics.brandsCreated
      : newBrands.length,
    newAgenciesDiscoveredCount: Number.isFinite(metrics.agenciesCreated)
      ? metrics.agenciesCreated
      : newAgencies.length,
    priorityAAddedCount: priorityAAdded.length,
    reviewMovedCount: metrics.reviewItemsCreated,
    topNewBrands: topEntities(newBrands, "Brand"),
    topNewAgencies: topEntities(newAgencies, "Agency"),
  };
}

function emptyBackupEntitySets() {
  return {
    brands: new Set(),
    agencies: new Set(),
    opportunityIds: new Set(),
  };
}

async function readBackupEntitySets(backupManifest) {
  try {
    const backup = await readJson(backupManifest);
    const brands = namesFromBackupTab(backup, "Brands", "Brand Name");
    const agencies = namesFromBackupTab(backup, "Organizations", "Organization Name");
    const opportunityIds = namesFromBackupTab(backup, "Opportunities", "Opportunity ID");
    return { brands, agencies, opportunityIds };
  } catch (error) {
    console.warn(`Could not read backup comparison data: ${errorMessage(error)}`);
    return emptyBackupEntitySets();
  }
}

function namesFromBackupTab(backup, tabName, headerName) {
  const values = backup?.tabs?.[tabName]?.values;
  if (!Array.isArray(values) || values.length === 0) return new Set();
  const headers = values[0].map((value) => String(value ?? ""));
  const index = headers.findIndex((header) => compactKey(header) === compactKey(headerName));
  if (index < 0) return new Set();
  return new Set(
    values
      .slice(1)
      .map((row) => compactKey(String(row?.[index] ?? "")))
      .filter(Boolean),
  );
}

function topEntities(rows, nameField) {
  return rows
    .map((row) => ({
      name: row[nameField]?.trim(),
      score: entityScore(row),
      notes: entityNotes(row),
    }))
    .filter((item) => item.name)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 20);
}

function entityScore(row) {
  return (
    Number(row["Relationship Strength Score"] || 0) +
    Number(row["Historical Opportunity Count"] || 0) * 3 +
    tendencyBonus(row["Fixed Fee Tendency"], "High", 12) +
    tendencyBonus(row["Affiliate Tendency"], "High", -8) +
    tendencyBonus(row["Low Budget Tendency"], "High", -10) +
    recencyBonus(row["Best Source Email Date"])
  );
}

function tendencyBonus(value, expected, bonus) {
  return normalizeText(value) === normalizeText(expected) ? bonus : 0;
}

function recencyBonus(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  const daysOld = (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
  if (daysOld <= 14) return 12;
  if (daysOld <= 45) return 6;
  return 0;
}

function entityNotes(row) {
  const parts = [];
  if (row["Typical Budget Quality"]) parts.push(row["Typical Budget Quality"]);
  if (row["Budget Quality Tendency"]) parts.push(row["Budget Quality Tendency"]);
  if (row["Fixed Fee Tendency"]) parts.push(`fixed fee: ${row["Fixed Fee Tendency"]}`);
  if (row["Affiliate Tendency"]) parts.push(`affiliate: ${row["Affiliate Tendency"]}`);
  if (row["Historical Opportunity Count"])
    parts.push(`${row["Historical Opportunity Count"]} historical`);
  if (row["Relationship Strength"]) parts.push(row["Relationship Strength"]);
  return parts.slice(0, 4).join("; ") || "new relationship signal";
}

function extractNumber(logText, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = logText.match(new RegExp(`^${escaped}:\\s*([\\d,]+)`, "im"));
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
}

function collectWarnings(ingestLog, summary) {
  const warnings = [];
  const safetyWarningIndex = ingestLog.indexOf("Safety warnings:");
  if (safetyWarningIndex >= 0) {
    const warningBlock = ingestLog.slice(safetyWarningIndex).split(/\n\n/)[0];
    for (const line of warningBlock.split("\n").slice(1)) {
      const cleaned = line.replace(/^\s*-\s*/, "").trim();
      if (cleaned) warnings.push(cleaned);
    }
  }

  const readiness = summary.gptReadiness?.scores?.overall;
  if (Number.isFinite(readiness) && readiness < 75) {
    warnings.push(`GPT readiness score is ${readiness}/100.`);
  }

  const removedCount = summary.audit?.removedCount;
  if (Number.isFinite(removedCount) && removedCount > 0) {
    warnings.push(`${removedCount} rows were removed from the curated GPT export.`);
  }

  return unique(warnings);
}

async function notifySuccess(options) {
  const artifact = await readArtifacts(options.outputDir);
  const packageStats = await stat(artifact.packagePath);
  const limit = Number(process.env.EMAIL_ATTACHMENT_MAX_BYTES || DEFAULT_ATTACHMENT_LIMIT_BYTES);
  const estimatedBase64Size = Math.ceil(packageStats.size / 3) * 4;
  const canAttach = estimatedBase64Size <= limit;
  const report = await readFile(artifact.summaryPath, "utf8");
  const runUrl = githubRunUrl();
  const artifactName = "team-billion-gpt-knowledge-refresh";
  const attachmentNote = canAttach
    ? "The GPT upload package is attached."
    : `The ZIP is too large for email attachment. Download the ${artifactName} artifact from this GitHub Actions run: ${runUrl}`;

  await sendResendEmail({
    subject: "Team Billion GPT Knowledge Refresh Ready",
    text: `${report}\n\n${attachmentNote}\n\nGitHub Actions run: ${runUrl}\n`,
    attachments: canAttach
      ? [
          {
            filename: PACKAGE_NAME,
            content: await readBase64(artifact.packagePath),
          },
        ]
      : [],
  });

  console.log("Success notification sent.");
}

async function notifyDiscord(options) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.log("Discord notification skipped because DISCORD_WEBHOOK_URL is not configured.");
    return;
  }

  const artifact = await readArtifacts(options.outputDir);
  const message = buildDiscordMessage(artifact);
  await sendDiscordMessage(webhookUrl, message);
  console.log("Discord notification sent.");
}

async function notifyTest() {
  const runUrl = githubRunUrl();
  const timestamp = new Date().toISOString();
  const emailText = `Team Billion notification test.

This is only a test of the monthly refresh email setup.
No Gmail ingestion ran.
No Sheet rows were changed.
No GPT export files were regenerated.

Sent at: ${timestamp}
GitHub Actions run: ${runUrl}
`;

  await sendResendEmail({
    subject: "Team Billion Monthly Refresh Notification Test",
    text: emailText,
    attachments: [],
  });
  console.log("Test email notification sent.");

  const webhookUrl = requiredEnv("DISCORD_WEBHOOK_URL").trim();
  await sendDiscordMessage(
    webhookUrl,
    [
      "**Team Billion monthly refresh notification test**",
      "",
      "This is only a test.",
      "No Gmail ingestion ran.",
      "No Sheet rows were changed.",
      "No GPT export files were regenerated.",
      `Sent at: ${timestamp}`,
      `Run: ${runUrl}`,
    ].join("\n"),
  );
  console.log("Test Discord notification sent.");
}

async function notifyFailure(options) {
  const failure = await readFailure(options);
  const runUrl = githubRunUrl();
  const backupManifest = await latestPath(
    BACKUP_BASE_DIR,
    (name) => name.startsWith("backup-") && name.endsWith(".json"),
  );
  const backupStatus = backupManifest
    ? `Latest backup manifest in this runner: ${path.relative(process.cwd(), backupManifest)}`
    : "No backup manifest found in this runner.";
  const recovery = backupManifest
    ? "Review the failed stage, then rerun manually from GitHub Actions. If the Sheet looks wrong, use the backup manifest with npm run opportunity:restore-backup."
    : "Fix the failed stage, then rerun manually from GitHub Actions. If ingestion started before backup completed, inspect the Sheet before rerunning.";

  await sendResendEmail({
    subject: "Team Billion GPT Knowledge Refresh Failed",
    text: `Team Billion monthly opportunity refresh failed.

Failed step: ${failure.failedStep}
Error message: ${failure.errorMessage}
Backup status: ${backupStatus}
Suggested recovery action: ${recovery}
GitHub Actions run: ${runUrl}
`,
    attachments: [],
  });

  console.log("Failure notification sent.");
}

async function sendResendEmail({ subject, text, attachments }) {
  const apiKey = requiredEnv("EMAIL_PROVIDER_API_KEY");
  const to = requiredEnv("MONTHLY_REFRESH_EMAIL_TO");
  const from = requiredEnv("MONTHLY_REFRESH_EMAIL_FROM");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: to
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      subject,
      text,
      attachments,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed (${response.status}): ${body}`);
  }
}

async function sendDiscordMessage(webhookUrl, content) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: content.slice(0, 1900),
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord notification failed (${response.status}): ${body}`);
  }
}

async function readArtifacts(outputDir) {
  const artifactPath = path.join(outputDir, "monthly-refresh-artifacts.json");
  return readJson(artifactPath);
}

async function readFailure(options) {
  const failurePath = path.join(options.outputDir, "failure.json");
  if (existsSync(failurePath)) return readJson(failurePath);
  return {
    failedStep: options.failedStep || "Unknown step",
    errorMessage: options.errorMessage || "No error message was captured.",
  };
}

async function readBase64(filePath) {
  return (await readFile(filePath)).toString("base64");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readCsvIfExists(filePath) {
  if (!existsSync(filePath)) return [];
  return parseCsv(await readFile(filePath, "utf8"));
}

async function readOptionalLog(logsDir, names) {
  for (const name of names) {
    const filePath = path.join(logsDir, name);
    if (existsSync(filePath)) return readFile(filePath, "utf8");
  }
  return "";
}

async function latestPath(baseDir, predicate) {
  const absoluteBase = path.resolve(process.cwd(), baseDir);
  if (!existsSync(absoluteBase)) return null;
  const entries = await readdir(absoluteBase, { withFileTypes: true });
  const matches = entries
    .filter((entry) => predicate(entry.name))
    .map((entry) => path.join(absoluteBase, entry.name))
    .sort();
  return matches.at(-1) ?? null;
}

function formatMetric(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "Not captured";
}

function formatCounts(counts) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) return "- Not captured";
  return entries.map(([key, value]) => `- ${key}: ${Number(value).toLocaleString()}`).join("\n");
}

function formatRankedList(items, formatItem) {
  if (!items?.length) return "- None captured from this run.";
  return items.map((item, index) => `${index + 1}. ${formatItem(item)}`).join("\n");
}

function buildDiscordMessage(artifact) {
  const metrics = artifact.metrics ?? {};
  const decision = artifact.decisionMetrics ?? {};
  const tierCounts = artifact.tierCounts ?? {};
  const runUrl = githubRunUrl();

  return [
    "**Team Billion Opportunity Intelligence monthly refresh is ready**",
    "",
    `Emails scanned: ${formatMetric(metrics.emailsScanned)}`,
    `New opportunities: ${formatMetric(metrics.opportunitiesCreated)}`,
    `Updated opportunities: ${formatMetric(metrics.opportunitiesUpdated)}`,
    `Priority A added: ${formatMetric(decision.priorityAAddedCount)}`,
    `Moved to review: ${formatMetric(decision.reviewMovedCount)}`,
    `New brands: ${formatMetric(decision.newBrandsDiscoveredCount)}`,
    `New agencies: ${formatMetric(decision.newAgenciesDiscoveredCount)}`,
    "",
    "**Priority distribution**",
    compactCounts(tierCounts),
    "",
    "**Top new brands**",
    compactEntityList(decision.topNewBrands),
    "",
    "**Top new agencies**",
    compactEntityList(decision.topNewAgencies),
    "",
    "No files are attached in Discord. Billy gets the ZIP + full summary by email.",
    `Run: ${runUrl}`,
  ].join("\n");
}

function compactCounts(counts) {
  const entries = Object.entries(counts ?? {});
  if (!entries.length) return "Not captured";
  return entries.map(([key, value]) => `${key}: ${Number(value).toLocaleString()}`).join(" | ");
}

function compactEntityList(items) {
  if (!items?.length) return "None captured from this run.";
  return items
    .slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.name}`)
    .join("\n");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() ?? [];
  return rows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
}

function compactKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

function unique(values) {
  return [...new Set(values)];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required email environment variable: ${name}`);
  return value;
}

function githubRunUrl() {
  if (
    !process.env.GITHUB_SERVER_URL ||
    !process.env.GITHUB_REPOSITORY ||
    !process.env.GITHUB_RUN_ID
  ) {
    return "GitHub Actions run URL not available outside Actions.";
  }
  return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
}
