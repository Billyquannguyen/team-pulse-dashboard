import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getGmailReadAccessToken,
  revalidateFollowUpCandidate,
  sanitizeFollowUpTemplateHtml,
  type FollowUpCandidate,
  type FollowUpScanInput,
} from "@/lib/bulk-follow-up";

const candidateSchema = z.object({
  threadId: z.string().min(1).max(220),
  recipientEmail: z.string().email().max(320),
  recipientName: z.string().max(500),
  subject: z.string().min(1).max(500),
  interactionLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  lastSentAt: z.string().datetime(),
  lastSentMessageId: z.string().min(1).max(1000),
  references: z.string().max(5000),
  labelIds: z.array(z.string().max(200)).max(100),
});

const filterSchema = z.object({
  labelIds: z.array(z.string().min(1).max(200)).min(1).max(10),
  interactionLevel: z.number().int().min(1).max(5),
  minimumDaysSinceLastSent: z.union([z.literal(3), z.literal(7), z.literal(14), z.literal(30)]),
});

const submitSchema = z.object({
  candidates: z.array(candidateSchema).min(1).max(100),
  filter: filterSchema,
  htmlBody: z.string().trim().min(1).max(60_000),
  textBody: z.string().trim().min(1).max(20_000),
});

const jobRequestSchema = z.object({ jobId: z.string().uuid() });

export type FollowUpDraftResult = {
  threadId: string;
  recipientEmail: string;
  status: "created" | "skipped" | "failed";
  message: string;
  gmailDraftId: string;
};

export type BulkFollowUpJob = {
  id: string;
  memberId: string;
  status: "queued" | "processing" | "completed" | "partial" | "failed";
  total: number;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  message: string;
  results: FollowUpDraftResult[];
  createdAt: string;
  updatedAt: string;
};

export type BulkFollowUpAuditEntry = {
  id: string;
  memberId: string;
  created: number;
  skipped: number;
  failed: number;
  finishedAt: string;
};

type StoredJob = BulkFollowUpJob & {
  candidates: FollowUpCandidate[];
  filter: FollowUpScanInput;
  htmlBody: string;
  textBody: string;
};

const PREFIX = "team-billion:bulk-follow-up";
const QUEUE_KEY = `${PREFIX}:queue:v1`;
const LOCK_KEY = `${PREFIX}:worker-lock:v1`;
const JOB_TTL_SECONDS = 24 * 60 * 60;
const AUDIT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const ACTIVE_TTL_SECONDS = 24 * 60 * 60;
const CHUNK_SIZE = 5;

const getFollowUpRedisServer = createServerOnlyFn(
  async () => import("@/lib/bulk-follow-up-redis.server"),
);

async function followUpRedisCommand<T>(command: Array<string | number>) {
  const redis = await getFollowUpRedisServer();
  return redis.followUpRedisCommand<T>(command);
}

function jobKey(id: string) {
  return `${PREFIX}:job:${id}`;
}

function activeKey(memberId: string) {
  return `${PREFIX}:active:${memberId}`;
}

function publicJob(job: StoredJob): BulkFollowUpJob {
  const {
    candidates: _candidates,
    filter: _filter,
    htmlBody: _html,
    textBody: _text,
    ...safe
  } = job;
  return safe;
}

async function readJob(jobId: string) {
  const raw = await followUpRedisCommand<string | null>(["GET", jobKey(jobId)]);
  return raw ? (JSON.parse(raw) as StoredJob) : null;
}

async function writeJob(job: StoredJob) {
  await followUpRedisCommand<"OK">([
    "SET",
    jobKey(job.id),
    JSON.stringify(job),
    "EX",
    JOB_TTL_SECONDS,
  ]);
}

const getGmailOAuthServer = createServerOnlyFn(async () => import("@/lib/gmail-oauth.server"));

async function getComposeAccessToken() {
  const { getMasterGmailAccessToken } = await getGmailOAuthServer();
  return getMasterGmailAccessToken();
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeSubject(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function messageId(jobId: string, threadId: string) {
  const safeThread = threadId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 80);
  return `<bulk-follow-up-${jobId}-${safeThread}@team-billion.local>`;
}

function buildMime(
  job: StoredJob,
  candidate: FollowUpCandidate,
  htmlBody: string,
  textBody: string,
) {
  const boundary = `follow-up-${crypto.randomUUID()}`;
  return base64Url(
    [
      `To: ${cleanHeader(candidate.recipientEmail)}`,
      `Subject: ${encodeSubject(cleanHeader(candidate.subject))}`,
      `Message-ID: ${messageId(job.id, candidate.threadId)}`,
      `In-Reply-To: ${cleanHeader(candidate.lastSentMessageId)}`,
      `References: ${cleanHeader(candidate.references)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      textBody,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      htmlBody,
      `--${boundary}--`,
    ].join("\r\n"),
  );
}

async function gmailRequest<T>(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error?.message ?? `Gmail returned ${response.status}.`);
  }
  return payload;
}

async function existingDraftId(token: string, id: string) {
  const params = new URLSearchParams({ q: `in:drafts rfc822msgid:${id}`, maxResults: "1" });
  const found = await gmailRequest<{ drafts?: Array<{ id?: string }> }>(token, `drafts?${params}`);
  return found.drafts?.[0]?.id ?? "";
}

async function createOneDraft(job: StoredJob, expected: FollowUpCandidate) {
  const fresh = await revalidateFollowUpCandidate(expected, job.filter);
  if (!fresh) {
    return {
      threadId: expected.threadId,
      recipientEmail: expected.recipientEmail,
      status: "skipped" as const,
      message: "Skipped because the thread changed, received a reply, or is suppressed.",
      gmailDraftId: "",
    };
  }
  const token = await getComposeAccessToken();
  const id = messageId(job.id, fresh.threadId);
  const duplicate = await existingDraftId(token, id);
  if (duplicate) {
    return {
      threadId: fresh.threadId,
      recipientEmail: fresh.recipientEmail,
      status: "created" as const,
      message: "Draft already existed and was not duplicated.",
      gmailDraftId: duplicate,
    };
  }
  let created: { id?: string };
  try {
    created = await gmailRequest<{ id?: string }>(token, "drafts", {
      method: "POST",
      body: JSON.stringify({
        message: {
          raw: buildMime(job, fresh, job.htmlBody, job.textBody),
          threadId: fresh.threadId,
        },
      }),
    });
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const recoveredDraftId = await existingDraftId(token, id).catch(() => "");
    if (!recoveredDraftId) throw error;
    created = { id: recoveredDraftId };
  }
  return {
    threadId: fresh.threadId,
    recipientEmail: fresh.recipientEmail,
    status: "created" as const,
    message: "Follow-up draft created.",
    gmailDraftId: created.id ?? "",
  };
}

async function reserveDailyCapacity(memberId: string, amount: number) {
  const day = new Date().toISOString().slice(0, 10);
  const script =
    "local m=tonumber(redis.call('get',KEYS[1]) or '0'); local t=tonumber(redis.call('get',KEYS[2]) or '0'); local n=tonumber(ARGV[1]); if m+n>300 or t+n>1000 then return 0 end; redis.call('incrby',KEYS[1],n); redis.call('expire',KEYS[1],172800); redis.call('incrby',KEYS[2],n); redis.call('expire',KEYS[2],172800); return 1";
  return (
    (await followUpRedisCommand<number>([
      "EVAL",
      script,
      2,
      `${PREFIX}:daily:member:${memberId}:${day}`,
      `${PREFIX}:daily:team:${day}`,
      amount,
    ])) === 1
  );
}

export async function processFollowUpQueueTick() {
  const lockToken = crypto.randomUUID();
  const claimed = await followUpRedisCommand<"OK" | null>([
    "SET",
    LOCK_KEY,
    lockToken,
    "NX",
    "EX",
    90,
  ]);
  if (claimed !== "OK") return { processed: 0 };
  try {
    const jobId = await followUpRedisCommand<string | null>(["LINDEX", QUEUE_KEY, 0]);
    if (!jobId) return { processed: 0 };
    const job = await readJob(jobId);
    if (!job) {
      await followUpRedisCommand(["LPOP", QUEUE_KEY]);
      return { processed: 0 };
    }
    job.status = "processing";
    for (const candidate of job.candidates.slice(job.processed, job.processed + CHUNK_SIZE)) {
      try {
        const result = await createOneDraft(job, candidate);
        job.results.push(result);
        job[result.status] += 1;
      } catch (error) {
        job.failed += 1;
        job.results.push({
          threadId: candidate.threadId,
          recipientEmail: candidate.recipientEmail,
          status: "failed",
          message: error instanceof Error ? error.message : "Draft creation failed.",
          gmailDraftId: "",
        });
      }
      job.processed += 1;
      job.updatedAt = new Date().toISOString();
      await writeJob(job);
    }
    if (job.processed >= job.total) {
      job.status = job.failed ? (job.created || job.skipped ? "partial" : "failed") : "completed";
      job.message = `${job.created} created, ${job.skipped} safely skipped, ${job.failed} failed.`;
      job.updatedAt = new Date().toISOString();
      await writeJob(job);
      await followUpRedisCommand(["LPOP", QUEUE_KEY]);
      await followUpRedisCommand(["DEL", activeKey(job.memberId)]);
      await followUpRedisCommand([
        "ZADD",
        `${PREFIX}:audit:v1`,
        Date.now(),
        JSON.stringify({
          id: job.id,
          memberId: job.memberId,
          created: job.created,
          skipped: job.skipped,
          failed: job.failed,
          finishedAt: job.updatedAt,
        }),
      ]);
      await followUpRedisCommand([
        "ZREMRANGEBYSCORE",
        `${PREFIX}:audit:v1`,
        0,
        Date.now() - AUDIT_RETENTION_SECONDS * 1000,
      ]);
    } else {
      job.message = `Creating follow-up drafts ${job.processed} of ${job.total}…`;
      await writeJob(job);
    }
    return { processed: Math.min(CHUNK_SIZE, job.total - (job.processed - CHUNK_SIZE)) };
  } finally {
    const release =
      "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
    await followUpRedisCommand(["EVAL", release, 1, LOCK_KEY, lockToken]).catch(() => undefined);
  }
}

export const submitBulkFollowUpJob = createServerFn({ method: "POST" })
  .inputValidator(submitSchema)
  .handler(async ({ data }) => {
    const { requireWritableDashboardAuth } = await import("@/lib/auth.server");
    const auth = await requireWritableDashboardAuth();
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
      if (process.env.ALLOW_PREVIEW_BULK_FOLLOW_UP !== "true") {
        throw new Error("Bulk Follow-up is read-only outside Production.");
      }
    }
    const htmlBody = await sanitizeFollowUpTemplateHtml(data.htmlBody);
    if (!htmlBody) throw new Error("The follow-up message is empty after safety checks.");
    const active = await followUpRedisCommand<"OK" | null>([
      "SET",
      activeKey(auth.user!.id),
      "reserved",
      "NX",
      "EX",
      ACTIVE_TTL_SECONDS,
    ]);
    if (active !== "OK") throw new Error("You already have an active follow-up job.");
    try {
      if (!(await reserveDailyCapacity(auth.user!.id, data.candidates.length))) {
        throw new Error("Daily limit reached: 300 per member or 1,000 for the team.");
      }
      const now = new Date().toISOString();
      const job: StoredJob = {
        id: crypto.randomUUID(),
        memberId: auth.user!.id,
        status: "queued",
        total: data.candidates.length,
        processed: 0,
        created: 0,
        skipped: 0,
        failed: 0,
        message: "Follow-up drafts queued safely.",
        results: [],
        candidates: data.candidates,
        filter: data.filter,
        htmlBody,
        textBody: data.textBody,
        createdAt: now,
        updatedAt: now,
      };
      await writeJob(job);
      await followUpRedisCommand([
        "SET",
        activeKey(auth.user!.id),
        job.id,
        "EX",
        ACTIVE_TTL_SECONDS,
      ]);
      await followUpRedisCommand(["RPUSH", QUEUE_KEY, job.id]);
      return { job: publicJob(job) };
    } catch (error) {
      await followUpRedisCommand(["DEL", activeKey(auth.user!.id)]);
      throw error;
    }
  });

export const getBulkFollowUpJob = createServerFn({ method: "POST" })
  .inputValidator(jobRequestSchema)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    const auth = await requireDashboardAuth();
    const job = await readJob(data.jobId);
    if (!job || (job.memberId !== auth.user!.id && !auth.isAdmin)) {
      throw new Error("Follow-up job not found.");
    }
    return { job: publicJob(job) };
  });

export const advanceBulkFollowUpQueue = createServerFn({ method: "POST" })
  .inputValidator(jobRequestSchema)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    const auth = await requireDashboardAuth();
    const job = await readJob(data.jobId);
    if (!job || (job.memberId !== auth.user!.id && !auth.isAdmin)) {
      throw new Error("Follow-up job not found.");
    }
    await processFollowUpQueueTick();
    return { job: publicJob((await readJob(data.jobId)) ?? job) };
  });

export const fetchBulkFollowUpAudit = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdminAuth } = await import("@/lib/auth.server");
  await requireAdminAuth();
  const records = await followUpRedisCommand<string[]>(["ZREVRANGE", `${PREFIX}:audit:v1`, 0, 49]);
  return records.flatMap((record) => {
    try {
      return [JSON.parse(record) as BulkFollowUpAuditEntry];
    } catch {
      return [];
    }
  });
});
