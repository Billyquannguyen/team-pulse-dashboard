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

What it does:
  - packages only approved Custom GPT Knowledge files
  - creates monthly-gpt-refresh-summary.md
  - sends success or failure email through Resend
`);
}

async function prepareMonthlyArtifacts(options) {
  await mkdir(options.outputDir, { recursive: true });

  const exportDir = await latestPath(EXPORT_BASE_DIR, (name) => name.startsWith("gpt-export-"));
  if (!exportDir) throw new Error(`No GPT export folder found in ${EXPORT_BASE_DIR}.`);

  const summary = await readJson(path.join(exportDir, "export-summary.json"));
  const backupManifest = await latestPath(BACKUP_BASE_DIR, (name) => name.startsWith("backup-") && name.endsWith(".json"));
  const ingestLog = await readOptionalLog(options.logsDir, ["gmail-ingestion.log", "opportunity-ingest.log", "gmail-ingestion-and-sheet-update.log"]);
  const backupLog = await readOptionalLog(options.logsDir, ["create-backup.log", "backup.log"]);
  const warnings = collectWarnings(ingestLog, summary);
  const metrics = parseIngestionMetrics(ingestLog);

  const packagePath = path.join(options.outputDir, PACKAGE_NAME);
  const summaryPath = path.join(options.outputDir, SUMMARY_NAME);
  await createKnowledgeZip(exportDir, packagePath);

  const report = buildMonthlyReport({
    exportDir,
    summary,
    backupManifest,
    backupLog,
    metrics,
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

function buildMonthlyReport({ exportDir, summary, backupManifest, backupLog, metrics, warnings, packagePath }) {
  const tierCounts = summary.tierCounts ?? {};
  const outputCounts = summary.outputCounts ?? {};
  const backupLine = backupManifest
    ? `Created: ${path.relative(process.cwd(), backupManifest)}`
    : backupLog.match(/^Manifest:\s*(.+)$/m)?.[1] ?? "Not found in this run output.";

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

async function notifyFailure(options) {
  const failure = await readFailure(options);
  const runUrl = githubRunUrl();
  const backupManifest = await latestPath(BACKUP_BASE_DIR, (name) => name.startsWith("backup-") && name.endsWith(".json"));
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
      to: to.split(",").map((value) => value.trim()).filter(Boolean),
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

function unique(values) {
  return [...new Set(values)];
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required email environment variable: ${name}`);
  return value;
}

function githubRunUrl() {
  if (!process.env.GITHUB_SERVER_URL || !process.env.GITHUB_REPOSITORY || !process.env.GITHUB_RUN_ID) {
    return "GitHub Actions run URL not available outside Actions.";
  }
  return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
}
