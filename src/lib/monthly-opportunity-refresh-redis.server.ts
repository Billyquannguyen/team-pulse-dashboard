import "@tanstack/react-start/server-only";

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token)
    throw new Error("Monthly refresh requires the existing Upstash Redis connection.");
  return { url, token };
}

export async function monthlyRefreshRedisCommand<T>(command: Array<string | number>) {
  const config = redisConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: T;
    error?: string;
  } | null;

  if (!response.ok || payload?.error) {
    throw new Error(payload?.error ?? `Monthly refresh storage returned ${response.status}.`);
  }

  return payload?.result as T;
}

export async function claimMonthlyRefreshLock(runId: string) {
  const key = `team-billion:monthly-refresh:worker-lock:${runId}`;
  const token = crypto.randomUUID();
  const claimed = await monthlyRefreshRedisCommand<"OK" | null>([
    "SET",
    key,
    token,
    "NX",
    "EX",
    290,
  ]);

  return claimed === "OK" ? { key, token } : null;
}

export async function releaseMonthlyRefreshLock(lock: { key: string; token: string }) {
  const script =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await monthlyRefreshRedisCommand<number>(["EVAL", script, 1, lock.key, lock.token]).catch(
    () => undefined,
  );
}
