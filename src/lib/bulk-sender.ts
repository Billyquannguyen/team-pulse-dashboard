import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const draftInputSchema = z.object({
  rowId: z.string().min(1).max(120),
  to: z.string().email().max(320),
  subject: z.string().min(1).max(500),
  htmlBody: z.string().min(1).max(60_000),
  textBody: z.string().min(1).max(20_000),
  threadId: z.string().min(1).max(220).optional(),
  inReplyTo: z.string().min(1).max(1000).optional(),
  references: z.string().min(1).max(5000).optional(),
});

const submitJobSchema = z.object({
  drafts: z.array(draftInputSchema).min(1).max(100),
});

const jobRequestSchema = z.object({
  jobId: z.string().uuid(),
});

type DraftInput = z.infer<typeof draftInputSchema>;
type DraftResult = {
  rowId: string;
  status: "created" | "skipped" | "failed";
  message: string;
  gmailDraftId: string;
};

export type BulkSenderJob = {
  id: string;
  memberId: string;
  status: "queued" | "processing" | "completed" | "partial" | "failed";
  total: number;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  message: string;
  results: DraftResult[];
  createdAt: string;
  updatedAt: string;
};

type StoredJob = BulkSenderJob & {
  drafts: DraftInput[];
  signatureHtml?: string;
};

const JOB_TTL_SECONDS = 60 * 60 * 24;
const MEMBER_COOLDOWN_SECONDS = 10;
const PROCESSING_LOCK_SECONDS = 90;
const PROCESSING_CHUNK_SIZE = 5;
const REDIS_QUEUE_KEY = "team-billion:bulk-sender:queue:v1";
const REDIS_LOCK_KEY = "team-billion:bulk-sender:lock:v1";

const localJobs = new Map<string, StoredJob>();
const localQueue: string[] = [];
const localCooldowns = new Map<string, number>();
const localDuplicates = new Map<string, number>();
let localLock = false;

function jobKey(jobId: string) {
  return `team-billion:bulk-sender:job:${jobId}`;
}

function cooldownKey(memberId: string) {
  return `team-billion:bulk-sender:cooldown:${memberId}`;
}

function duplicateKey(fingerprint: string) {
  return `team-billion:bulk-sender:created:${fingerprint}`;
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redisCommand<T>(command: Array<string | number>) {
  const config = getRedisConfig();
  if (!config) throw new Error("Upstash Redis is not configured.");

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: T;
    error?: string;
  } | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error ?? `Queue storage returned ${response.status}.`);
  }
  return payload?.result as T;
}

function publicJob(job: StoredJob): BulkSenderJob {
  const { drafts: _drafts, signatureHtml: _signatureHtml, ...safeJob } = job;
  return safeJob;
}

async function readJob(jobId: string) {
  if (!getRedisConfig()) return localJobs.get(jobId) ?? null;
  const raw = await redisCommand<string | null>(["GET", jobKey(jobId)]);
  if (!raw) return null;
  return JSON.parse(raw) as StoredJob;
}

async function writeJob(job: StoredJob) {
  if (!getRedisConfig()) {
    localJobs.set(job.id, job);
    return;
  }
  await redisCommand<"OK">(["SET", jobKey(job.id), JSON.stringify(job), "EX", JOB_TTL_SECONDS]);
}

async function enqueue(jobId: string) {
  if (!getRedisConfig()) {
    localQueue.push(jobId);
    return;
  }
  await redisCommand<number>(["RPUSH", REDIS_QUEUE_KEY, jobId]);
}

async function peekQueue() {
  if (!getRedisConfig()) return localQueue[0] ?? null;
  return redisCommand<string | null>(["LINDEX", REDIS_QUEUE_KEY, 0]);
}

async function removeQueueHead() {
  if (!getRedisConfig()) {
    localQueue.shift();
    return;
  }
  await redisCommand<string | null>(["LPOP", REDIS_QUEUE_KEY]);
}

async function claimCooldown(memberId: string) {
  if (!getRedisConfig()) {
    const now = Date.now();
    const expiresAt = localCooldowns.get(memberId) ?? 0;
    if (expiresAt > now) return false;
    localCooldowns.set(memberId, now + MEMBER_COOLDOWN_SECONDS * 1000);
    return true;
  }

  const result = await redisCommand<"OK" | null>([
    "SET",
    cooldownKey(memberId),
    "1",
    "NX",
    "EX",
    MEMBER_COOLDOWN_SECONDS,
  ]);
  return result === "OK";
}

async function acquireLock(token: string) {
  if (!getRedisConfig()) {
    if (localLock) return false;
    localLock = true;
    return true;
  }
  const result = await redisCommand<"OK" | null>([
    "SET",
    REDIS_LOCK_KEY,
    token,
    "NX",
    "EX",
    PROCESSING_LOCK_SECONDS,
  ]);
  return result === "OK";
}

async function releaseLock(token: string) {
  if (!getRedisConfig()) {
    localLock = false;
    return;
  }
  const script =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await redisCommand<number>(["EVAL", script, 1, REDIS_LOCK_KEY, token]);
}

async function hasDuplicate(fingerprint: string) {
  if (!getRedisConfig()) {
    const expiresAt = localDuplicates.get(fingerprint) ?? 0;
    if (expiresAt > Date.now()) return true;
    localDuplicates.delete(fingerprint);
    return false;
  }
  const value = await redisCommand<string | null>(["GET", duplicateKey(fingerprint)]);
  return Boolean(value);
}

async function rememberDuplicate(fingerprint: string) {
  if (!getRedisConfig()) {
    localDuplicates.set(fingerprint, Date.now() + JOB_TTL_SECONDS * 1000);
    return;
  }
  await redisCommand<"OK">(["SET", duplicateKey(fingerprint), "1", "EX", JOB_TTL_SECONDS]);
}

function requiredGmailEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in Vercel Environment Variables.`);
  return value;
}

async function getGmailAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredGmailEnv("BRAND_FINDER_GMAIL_CLIENT_ID"),
      client_secret: requiredGmailEnv("BRAND_FINDER_GMAIL_CLIENT_SECRET"),
      refresh_token: requiredGmailEnv("BRAND_FINDER_GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description ?? payload?.error ?? "Gmail could not create an access token.",
    );
  }
  return payload.access_token;
}

async function gmailJson<T>(accessToken: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok) {
    const detail = payload?.error?.message ?? `Gmail returned ${response.status}.`;
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `${detail} Reconnect Gmail with gmail.compose and gmail.settings.basic permissions.`,
      );
    }
    throw new Error(detail);
  }
  return payload as T;
}

async function getDefaultGmailSignature(accessToken: string) {
  const payload = await gmailJson<{
    sendAs?: Array<{
      sendAsEmail?: string;
      signature?: string;
      isDefault?: boolean;
      isPrimary?: boolean;
    }>;
  }>(accessToken, "settings/sendAs");
  const alias =
    payload.sendAs?.find((item) => item.isDefault) ??
    payload.sendAs?.find((item) => item.isPrimary) ??
    payload.sendAs?.[0];
  if (!alias) throw new Error("Gmail did not return a default sending address.");
  if (!alias.signature?.trim()) {
    throw new Error("The connected Gmail account does not have a signature configured.");
  }
  return alias.signature.trim();
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function sanitizeEmailHtml(value: string) {
  return value
    .replace(
      /<(script|iframe|object|embed|form|input|button|meta|link)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(/<(script|iframe|object|embed|form|input|button|meta|link)\b[^>]*\/?\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
}

function trimTrailingEmailSpacing(value: string) {
  let result = value.trim();
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result
      .replace(/(?:\s|&nbsp;|<br\s*\/?>)+$/gi, "")
      .replace(/<(div|p)(?:\s[^>]*)?>\s*(?:&nbsp;|<br\s*\/?>|\s)*<\/\1>\s*$/gi, "")
      .trim();
  }
  return result;
}

function signatureToPlainText(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildMimeMessage(draft: DraftInput, signatureHtml: string) {
  const boundary = `tb-bulk-${crypto.randomUUID()}`;
  const messageHtml = trimTrailingEmailSpacing(sanitizeEmailHtml(draft.htmlBody));
  const html = `${messageHtml}<div>${signatureHtml}</div>`;
  const text = `${draft.textBody.trimEnd()}\n${signatureToPlainText(signatureHtml)}`;
  const message = [
    `To: ${sanitizeHeader(draft.to)}`,
    `Subject: ${sanitizeHeader(draft.subject)}`,
    ...(draft.inReplyTo ? [`In-Reply-To: ${sanitizeHeader(draft.inReplyTo)}`] : []),
    ...(draft.references ? [`References: ${sanitizeHeader(draft.references)}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
  ].join("\r\n");
  return base64Url(message);
}

async function fingerprintDraft(draft: DraftInput) {
  const source = `${draft.threadId ?? "new"}\n${draft.to.toLowerCase()}\n${draft.subject}\n${draft.htmlBody}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function createDraft(accessToken: string, draft: DraftInput, signatureHtml: string) {
  const fingerprint = await fingerprintDraft(draft);
  if (await hasDuplicate(fingerprint)) {
    return {
      rowId: draft.rowId,
      status: "skipped" as const,
      message: "Skipped because the same draft was created in the last 24 hours.",
      gmailDraftId: "",
    };
  }

  let lastMessage = "Gmail could not create the draft.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          raw: buildMimeMessage(draft, signatureHtml),
          ...(draft.threadId ? { threadId: draft.threadId } : {}),
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      error?: { message?: string };
    } | null;
    if (response.ok && payload?.id) {
      await rememberDuplicate(fingerprint);
      return {
        rowId: draft.rowId,
        status: "created" as const,
        message: "Draft created in Gmail.",
        gmailDraftId: payload.id,
      };
    }
    lastMessage = payload?.error?.message ?? `Gmail returned ${response.status}.`;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  return {
    rowId: draft.rowId,
    status: "failed" as const,
    message: lastMessage,
    gmailDraftId: "",
  };
}

async function failJob(job: StoredJob, message: string) {
  const updated: StoredJob = {
    ...job,
    status: "failed",
    failed: job.total - job.created - job.skipped,
    processed: job.total,
    message,
    updatedAt: new Date().toISOString(),
  };
  await writeJob(updated);
  await removeQueueHead();
  return updated;
}

async function processQueueChunk() {
  const lockToken = crypto.randomUUID();
  if (!(await acquireLock(lockToken))) return;

  try {
    const queuedJobId = await peekQueue();
    if (!queuedJobId) return;
    const job = await readJob(queuedJobId);
    if (!job) {
      await removeQueueHead();
      return;
    }

    let signatureHtml = job.signatureHtml;
    let accessToken: string;
    try {
      accessToken = await getGmailAccessToken();
      signatureHtml ??= await getDefaultGmailSignature(accessToken);
    } catch (error) {
      await failJob(job, error instanceof Error ? error.message : "Gmail setup failed.");
      return;
    }

    const pendingDrafts = job.drafts.slice(job.processed, job.processed + PROCESSING_CHUNK_SIZE);
    const results: DraftResult[] = [];
    for (const draft of pendingDrafts) {
      try {
        results.push(await createDraft(accessToken, draft, signatureHtml));
      } catch (error) {
        results.push({
          rowId: draft.rowId,
          status: "failed",
          message: error instanceof Error ? error.message : "Draft creation failed.",
          gmailDraftId: "",
        });
      }
    }

    const allResults = [...job.results, ...results];
    const processed = job.processed + results.length;
    const created = allResults.filter((result) => result.status === "created").length;
    const skipped = allResults.filter((result) => result.status === "skipped").length;
    const failed = allResults.filter((result) => result.status === "failed").length;
    const complete = processed >= job.total;
    const status: StoredJob["status"] = complete
      ? failed > 0
        ? "partial"
        : "completed"
      : "processing";
    const updated: StoredJob = {
      ...job,
      signatureHtml,
      status,
      processed,
      created,
      skipped,
      failed,
      results: allResults,
      message: complete
        ? `${created} created, ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped, ${failed} failed.`
        : `Creating drafts ${processed} of ${job.total}…`,
      updatedAt: new Date().toISOString(),
    };
    await writeJob(updated);
    if (complete) await removeQueueHead();
  } finally {
    await releaseLock(lockToken);
  }
}

export const submitBulkSenderJob = createServerFn({ method: "POST" })
  .inputValidator(submitJobSchema)
  .handler(async ({ data }): Promise<{ job: BulkSenderJob }> => {
    const { requireWritableDashboardAuth } = await import("@/lib/auth.server");
    const auth = await requireWritableDashboardAuth();
    const memberId = auth.user?.id;
    if (!memberId) throw new Error("Your member identity could not be verified.");
    if (!(await claimCooldown(memberId))) {
      throw new Error("Please wait 10 seconds before creating another batch.");
    }

    const now = new Date().toISOString();
    const job: StoredJob = {
      id: crypto.randomUUID(),
      memberId,
      status: "queued",
      total: data.drafts.length,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      message: "Queued for the connected Gmail account.",
      results: [],
      drafts: data.drafts,
      createdAt: now,
      updatedAt: now,
    };
    await writeJob(job);
    await enqueue(job.id);
    return { job: publicJob(job) };
  });

export const advanceBulkSenderQueue = createServerFn({ method: "POST" })
  .inputValidator(jobRequestSchema)
  .handler(async ({ data }): Promise<{ job: BulkSenderJob }> => {
    const { requireWritableDashboardAuth } = await import("@/lib/auth.server");
    const auth = await requireWritableDashboardAuth();
    const requestedJob = await readJob(data.jobId);
    if (!requestedJob) throw new Error("This Bulk Sender job expired or could not be found.");
    if (requestedJob.memberId !== auth.user?.id && !auth.isAdmin) throw new Error("Unauthorized");
    await processQueueChunk();
    const job = await readJob(data.jobId);
    if (!job) throw new Error("This Bulk Sender job expired or could not be found.");
    return { job: publicJob(job) };
  });

export const getBulkSenderJob = createServerFn({ method: "GET" })
  .inputValidator(jobRequestSchema)
  .handler(async ({ data }): Promise<{ job: BulkSenderJob }> => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    const auth = await requireDashboardAuth();
    const job = await readJob(data.jobId);
    if (!job) throw new Error("This Bulk Sender job expired or could not be found.");
    if (job.memberId !== auth.user?.id && !auth.isAdmin) throw new Error("Unauthorized");
    return { job: publicJob(job) };
  });
