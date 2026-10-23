// Current Gmail costs: https://developers.google.com/workspace/gmail/api/reference/quota
export function gmailReadCost(path: string, params?: URLSearchParams) {
  if (path.startsWith("threads/")) return params?.get("format") === "full" ? 120 : 40;
  if (path === "threads") return 10;
  if (path === "messages") return 5;
  return 1;
}

export function gmailRetryDelay(header: string | null, fallback: number, now = Date.now()) {
  if (!header) return fallback;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - now;
  return Number.isFinite(delay) ? Math.max(fallback, delay) : fallback;
}

// 3,600 units/minute leaves headroom under the 6,000-unit user quota.
// All concurrent callers share one queue; a quota response pauses that queue.
export function createGmailReadBudget(
  now = () => Date.now(),
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  let nextStart = 0;
  let blockedUntil = 0;
  let queue = Promise.resolve();
  return {
    wait(cost: number) {
      const turn = queue.then(async () => {
        // Recheck after sleep: another in-flight response may extend the cooldown.
        while (Math.max(nextStart, blockedUntil) > now()) {
          await sleep(Math.max(nextStart, blockedUntil) - now());
        }
        nextStart = now() + Math.ceil((cost * 1_000) / 60);
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
    pause(ms: number) {
      blockedUntil = Math.max(blockedUntil, now() + ms);
    },
  };
}
