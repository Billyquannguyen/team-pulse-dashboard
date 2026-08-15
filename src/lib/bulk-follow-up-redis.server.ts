import "@tanstack/react-start/server-only";

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new Error("Bulk Follow-up requires Upstash Redis.");
  return { url, token };
}

export async function followUpRedisCommand<T>(command: Array<string | number>) {
  const config = redisConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: T;
    error?: string;
  } | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error ?? `Bulk Follow-up queue storage returned ${response.status}.`);
  }
  return payload?.result as T;
}

export async function withFollowUpLock<T>(
  name: string,
  ttlSeconds: number,
  operation: () => Promise<T>,
) {
  const key = `team-billion:bulk-follow-up:lock:${name}`;
  const token = crypto.randomUUID();
  const claimed = await followUpRedisCommand<"OK" | null>([
    "SET",
    key,
    token,
    "NX",
    "EX",
    ttlSeconds,
  ]);
  if (claimed !== "OK") throw new Error("This shared record is being changed by another member.");

  try {
    return await operation();
  } finally {
    const script =
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    await followUpRedisCommand<number>(["EVAL", script, 1, key, token]).catch(() => undefined);
  }
}
