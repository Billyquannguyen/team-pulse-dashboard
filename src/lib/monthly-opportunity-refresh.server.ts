import "@tanstack/react-start/server-only";

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { del, get, list, put } from "@vercel/blob";
import type { MonthlyRefreshState } from "@/lib/monthly-opportunity-refresh";
import {
  claimMonthlyRefreshLock,
  monthlyRefreshRedisCommand,
  releaseMonthlyRefreshLock,
} from "@/lib/monthly-opportunity-refresh-redis.server";

const LATEST_KEY = "team-billion:monthly-refresh:latest";
const ACTIVE_KEY = "team-billion:monthly-refresh:active";
const STATE_TTL_SECONDS = 60 * 60 * 24 * 120;
const BACKUP_PREFIX = "monthly-opportunity-refresh/backups/";
const PACKAGE_PREFIX = "monthly-opportunity-refresh/packages/";

function stateKey(runId: string) {
  return `team-billion:monthly-refresh:run:${runId}`;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function monthlyDiscordWebhook() {
  const value =
    process.env.DISCORD_WEBHOOK_URL?.trim() ||
    process.env.WEEKLY_GMAIL_REPORT_DISCORD_WEBHOOK_URL?.trim();
  if (!value) {
    throw new Error(
      "Missing DISCORD_WEBHOOK_URL or WEEKLY_GMAIL_REPORT_DISCORD_WEBHOOK_URL in Vercel Environment Variables.",
    );
  }
  return value;
}

function validateRuntimeConfiguration() {
  requiredEnv("CRON_SECRET");
  requiredEnv("UPSTASH_REDIS_REST_URL");
  requiredEnv("UPSTASH_REDIS_REST_TOKEN");
  requiredEnv("BLOB_STORE_ID");
  monthlyDiscordWebhook();
  requiredEnv("MASTER_GMAIL_CLIENT_ID");
  requiredEnv("MASTER_GMAIL_CLIENT_SECRET");
  requiredEnv("MASTER_GMAIL_REFRESH_TOKEN");
  requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  requiredEnv("GOOGLE_PRIVATE_KEY");
  requiredEnv("OPPORTUNITY_DATABASE_SPREADSHEET_ID");
  requiredEnv("OPENROUTER_API_KEY");
  requiredEnv("OPENROUTER_DEFAULT_MODEL");
}

function createRunId() {
  return `monthly-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
}

function runtimeRoot(runId: string) {
  if (!/^monthly-\d{14}-[a-f0-9-]{8}$/i.test(runId)) throw new Error("Invalid monthly run ID.");
  return path.join("/tmp", "team-billion-monthly-refresh", runId);
}

async function readState(runId: string) {
  const raw = await monthlyRefreshRedisCommand<string | null>(["GET", stateKey(runId)]);
  return raw ? (JSON.parse(raw) as MonthlyRefreshState) : null;
}

async function saveState(state: MonthlyRefreshState) {
  state.updatedAt = new Date().toISOString();
  await monthlyRefreshRedisCommand([
    "SET",
    stateKey(state.runId),
    JSON.stringify(state),
    "EX",
    STATE_TTL_SECONDS,
  ]);
  await monthlyRefreshRedisCommand(["SET", LATEST_KEY, state.runId, "EX", STATE_TTL_SECONDS]);
}

async function updateState(runId: string, updates: Partial<MonthlyRefreshState>) {
  const current = await readState(runId);
  if (!current) throw new Error("Monthly refresh state could not be found.");
  const next = { ...current, ...updates };
  await saveState(next);
  return next;
}

async function clearActiveRun(runId: string) {
  const script =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await monthlyRefreshRedisCommand<number>(["EVAL", script, 1, ACTIVE_KEY, runId]).catch(
    () => undefined,
  );
}

export function isMonthlyRefreshInternalRequest(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function getMonthlyOpportunityRefreshStatusServer() {
  const { requireAdminAuth } = await import("@/lib/auth.server");
  await requireAdminAuth();
  const latestRunId = await monthlyRefreshRedisCommand<string | null>(["GET", LATEST_KEY]);
  return latestRunId ? readState(latestRunId) : null;
}

export async function startMonthlyOpportunityRefreshServer() {
  const { requireAdminAuth } = await import("@/lib/auth.server");
  const auth = await requireAdminAuth();
  return startMonthlyOpportunityRefreshRun(auth.user?.email || "Dashboard admin");
}

export async function startMonthlyOpportunityRefreshRun(startedBy: string) {
  validateRuntimeConfiguration();

  const existingRunId = await monthlyRefreshRedisCommand<string | null>(["GET", ACTIVE_KEY]);
  if (existingRunId) {
    const existing = await readState(existingRunId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return { ok: true as const, alreadyRunning: true, state: existing };
    }
    await clearActiveRun(existingRunId);
  }

  const runId = createRunId();
  const claimed = await monthlyRefreshRedisCommand<"OK" | null>([
    "SET",
    ACTIVE_KEY,
    runId,
    "NX",
    "EX",
    60 * 60 * 6,
  ]);
  if (claimed !== "OK") throw new Error("Another monthly refresh started at the same time.");

  const now = new Date().toISOString();
  const state: MonthlyRefreshState = {
    runId,
    status: "queued",
    stage: "queued",
    stageLabel: "Waiting to start",
    startedAt: now,
    updatedAt: now,
    finishedAt: "",
    startedBy,
    emailsScanned: 0,
    pagesScanned: 0,
    opportunitiesCreated: 0,
    opportunitiesUpdated: 0,
    packageReady: false,
    packageBlobUrl: "",
    backupBlobUrl: "",
    error: "",
  };

  await saveState(state);
  try {
    const [{ start }, { monthlyOpportunityRefreshWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("@/workflows/monthly-opportunity-refresh"),
    ]);
    await start(monthlyOpportunityRefreshWorkflow, [runId]);
  } catch (error) {
    await markRunFailed(runId, "Start workflow", error);
    throw error;
  }
  return { ok: true as const, alreadyRunning: false, state };
}

export async function runMonthlyOpportunityRefreshStep(runId: string) {
  const lock = await claimMonthlyRefreshLock(runId);
  if (!lock) return readState(runId);

  try {
    const state = await readState(runId);
    if (!state || state.status === "success" || state.status === "failed") return;

    if (state.stage === "queued" || state.stage === "preparing") {
      await runPreparationStage(state);
    } else if (state.stage === "ingesting") {
      await runIngestionStage(state);
    } else if (state.stage === "finalizing") {
      await runFinalizationStage(state);
    }
  } catch (error) {
    await markRunFailed(runId, "Monthly refresh", error);
  } finally {
    await releaseMonthlyRefreshLock(lock);
  }
  return readState(runId);
}

async function runPreparationStage(state: MonthlyRefreshState) {
  await updateState(state.runId, {
    status: "running",
    stage: "preparing",
    stageLabel: "Checking access and creating a safety backup",
  });
  const root = runtimeRoot(state.runId);
  await resetRuntimeRoot(root);
  process.env.OPPORTUNITY_RUNTIME_ROOT = root;

  const { validateMasterGmailScopes } = await import("@/lib/gmail-oauth.server");
  await validateMasterGmailScopes();

  const [{ runOpportunityIngestion }, { runOpportunityPreflight }, { runOpportunityBackup }] =
    await Promise.all([
      // @ts-expect-error The operational script is JavaScript and exports a runtime entrypoint.
      import("../../scripts/opportunity-ingestion/runner.mjs"),
      // @ts-expect-error The operational script is JavaScript and exports a runtime entrypoint.
      import("../../scripts/opportunity-ingestion/preflight.mjs"),
      // @ts-expect-error The operational script is JavaScript and exports a runtime entrypoint.
      import("../../scripts/opportunity-ingestion/backup.mjs"),
    ]);

  await runOpportunityIngestion(["--self-test"]);
  await runOpportunityIngestion(["--validate-credentials"]);
  await runOpportunityPreflight([]);
  const backup = await runOpportunityBackup(["create"]);
  if (!backup?.manifestPath) throw new Error("The monthly safety backup was not created.");

  const backupBlob = await put(
    `${BACKUP_PREFIX}${state.runId}.json`,
    createReadStream(backup.manifestPath),
    {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      multipart: true,
    },
  );
  await pruneOldBlobs(BACKUP_PREFIX, 3);
  await updateState(state.runId, {
    status: "running",
    stage: "ingesting",
    stageLabel: "Scanning Gmail in safe batches",
    backupBlobUrl: backupBlob.url,
  });
}

async function runIngestionStage(state: MonthlyRefreshState) {
  const root = runtimeRoot(state.runId);
  await resetRuntimeRoot(root);
  process.env.OPPORTUNITY_RUNTIME_ROOT = root;
  const checkpointPath = path.join(root, ".opportunity-ingestion", "checkpoint.json");
  await mkdir(path.dirname(checkpointPath), { recursive: true });
  const checkpointKey = `${stateKey(state.runId)}:checkpoint`;
  const storedCheckpoint = await monthlyRefreshRedisCommand<string | null>(["GET", checkpointKey]);
  if (storedCheckpoint) await writeFile(checkpointPath, storedCheckpoint);

  // @ts-expect-error The operational script is JavaScript and exports a runtime entrypoint.
  const { runOpportunityIngestion } = await import("../../scripts/opportunity-ingestion/runner.mjs");
  const checkpoint = (await runOpportunityIngestion([
    "--checkpoint",
    checkpointPath,
    "--max-run-pages",
    "1",
    "--page-size",
    "5",
    "--batch-size",
    "5",
    "--concurrency",
    "2",
  ])) as Record<string, unknown> | undefined;
  const serialized = await readFile(checkpointPath, "utf8");
  await monthlyRefreshRedisCommand(["SET", checkpointKey, serialized, "EX", STATE_TTL_SECONDS]);
  const parsed = checkpoint ?? (JSON.parse(serialized) as Record<string, unknown>);
  const done = Boolean(parsed.done) || !String(parsed.nextPageToken ?? "");

  await updateState(state.runId, {
    status: "running",
    stage: done ? "finalizing" : "ingesting",
    stageLabel: done ? "Building the monthly package" : "Scanning Gmail in safe batches",
    emailsScanned: Number(parsed.emailsScanned ?? 0),
    pagesScanned: Number(parsed.pagesScanned ?? 0),
    opportunitiesCreated: Number(parsed.opportunitiesCreated ?? 0),
    opportunitiesUpdated: Number(parsed.opportunitiesUpdated ?? 0),
  });
  return true;
}

async function runFinalizationStage(state: MonthlyRefreshState) {
  const current = (await readState(state.runId)) ?? state;
  const root = runtimeRoot(state.runId);
  await resetRuntimeRoot(root);
  process.env.OPPORTUNITY_RUNTIME_ROOT = root;
  process.env.DISCORD_WEBHOOK_URL = monthlyDiscordWebhook();

  const checkpointKey = `${stateKey(state.runId)}:checkpoint`;
  const checkpointRaw = await monthlyRefreshRedisCommand<string | null>(["GET", checkpointKey]);
  if (!checkpointRaw) throw new Error("The Gmail checkpoint is missing before finalization.");
  const checkpoint = JSON.parse(checkpointRaw) as Record<string, unknown>;
  await materializePrivateBlob(
    current.backupBlobUrl,
    path.join(root, ".opportunity-ingestion", "backups", "latest-backup.json"),
  );

  const logsDir = path.join(root, ".opportunity-ingestion", "monthly-refresh", "logs");
  const outputDir = path.join(root, ".opportunity-ingestion", "monthly-refresh", state.runId);
  await mkdir(logsDir, { recursive: true });
  await writeFile(path.join(logsDir, "gmail-ingestion.log"), buildIngestionLog(checkpoint));

  const [
    { runOpportunityQualityCleanup },
    { runOpportunityGptExport },
    { runMonthlyRefreshHelper },
  ] = await Promise.all([
    // @ts-expect-error The operational script is JavaScript and exports a runtime entrypoint.
    import("../../scripts/opportunity-ingestion/quality-cleanup.mjs"),
    // @ts-expect-error The operational script is JavaScript and exports a runtime entrypoint.
    import("../../scripts/opportunity-ingestion/gpt-export.mjs"),
    // @ts-expect-error The operational script is JavaScript and exports a runtime entrypoint.
    import("../../scripts/opportunity-ingestion/monthly-refresh.mjs"),
  ]);
  await runOpportunityQualityCleanup([]);
  await runOpportunityGptExport([]);
  await runMonthlyRefreshHelper(["prepare", "--output-dir", outputDir, "--logs-dir", logsDir]);

  const artifacts = JSON.parse(
    await readFile(path.join(outputDir, "monthly-refresh-artifacts.json"), "utf8"),
  ) as { packagePath?: string; summaryPath?: string };
  if (!artifacts.packagePath) throw new Error("The monthly package path was not generated.");
  const packageBlob = await put(
    `${PACKAGE_PREFIX}${state.runId}.zip`,
    createReadStream(artifacts.packagePath),
    {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/zip",
      multipart: true,
    },
  );
  if (artifacts.summaryPath) {
    await put(
      `${PACKAGE_PREFIX}${state.runId}-summary.md`,
      createReadStream(artifacts.summaryPath),
      {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "text/markdown; charset=utf-8",
      },
    );
  }
  await pruneOldBlobs(PACKAGE_PREFIX, 6);
  await runMonthlyRefreshHelper([
    "notify-discord",
    "--output-dir",
    outputDir,
    "--logs-dir",
    logsDir,
  ]);

  await updateState(state.runId, {
    status: "success",
    stage: "complete",
    stageLabel: "Monthly refresh complete",
    finishedAt: new Date().toISOString(),
    packageReady: true,
    packageBlobUrl: packageBlob.url,
    emailsScanned: Number(checkpoint.emailsScanned ?? current.emailsScanned),
    pagesScanned: Number(checkpoint.pagesScanned ?? current.pagesScanned),
    opportunitiesCreated: Number(checkpoint.opportunitiesCreated ?? current.opportunitiesCreated),
    opportunitiesUpdated: Number(checkpoint.opportunitiesUpdated ?? current.opportunitiesUpdated),
  });
  await clearActiveRun(state.runId);
  await monthlyRefreshRedisCommand(["DEL", checkpointKey]).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

async function markRunFailed(runId: string, stage: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await updateState(runId, {
    status: "failed",
    stage: "failed",
    stageLabel: `Failed during ${stage}`,
    finishedAt: new Date().toISOString(),
    error: message.slice(0, 1200),
  }).catch(() => undefined);
  await clearActiveRun(runId);
  await sendFailureToDiscord(stage, message).catch((discordError) => {
    console.error("Monthly refresh failure notification could not be sent:", discordError);
  });
}

async function sendFailureToDiscord(stage: string, message: string) {
  const response = await fetch(monthlyDiscordWebhook(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: [
        "**Team Billion monthly refresh failed**",
        `Stage: ${stage}`,
        `Error: ${message}`,
        "Open Goals & Analytics as an admin to review the status and retry.",
      ]
        .join("\n")
        .slice(0, 1900),
      allowed_mentions: { parse: [] },
    }),
  });
  if (!response.ok) throw new Error(`Discord returned ${response.status}.`);
}

async function resetRuntimeRoot(root: string) {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
}

async function materializePrivateBlob(url: string, destination: string) {
  if (!url) throw new Error("The monthly backup URL is missing.");
  const result = await get(url, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("The monthly backup could not be downloaded.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(result.stream as never), createWriteStream(destination));
}

async function pruneOldBlobs(prefix: string, keep: number) {
  const result = await list({ prefix, limit: 100 });
  const old = [...result.blobs]
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .slice(keep);
  if (old.length) await del(old.map((blob) => blob.url));
}

function buildIngestionLog(checkpoint: Record<string, unknown>) {
  const line = (label: string, key: string) =>
    `${label}: ${Number(checkpoint[key] ?? 0).toLocaleString("en-GB")}`;
  return [
    "Ingestion runner summary",
    `Run ID: ${String(checkpoint.runId ?? "Unknown")}`,
    line("Emails scanned", "emailsScanned"),
    line("Relevant emails found", "relevantEmailsFound"),
    line("Opportunities created", "opportunitiesCreated"),
    line("Opportunities updated", "opportunitiesUpdated"),
    line("Duplicates skipped", "duplicatesSkipped"),
    line("Brands created", "brandsCreated"),
    line("Agencies created", "agenciesCreated"),
    line("Contacts created", "contactsCreated"),
    line("Review items created", "reviewItemsCreated"),
    line("Aliases created", "aliasesCreated"),
    line("Skipped irrelevant", "skippedIrrelevant"),
  ].join("\n");
}

export async function getMonthlyRefreshPackageResponse(runId: string) {
  const state = await readState(runId);
  if (!state?.packageReady || !state.packageBlobUrl) return null;
  return get(state.packageBlobUrl, { access: "private", useCache: false });
}
