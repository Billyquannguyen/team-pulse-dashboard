import "@tanstack/react-start/server-only";

async function digest(value: string) {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function claimAuthAttempt(
  action: "sign-in" | "sign-up" | "password-reset",
  email: string,
  limit: number,
  windowSeconds: number,
) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new Error("Authentication rate limiting is not configured.");
  const key = `team-billion:auth-limit:${action}:${await digest(email)}`;
  const script =
    "local n=redis.call('incr',KEYS[1]); if n==1 then redis.call('expire',KEYS[1],ARGV[1]) end; if n>tonumber(ARGV[2]) then return 0 else return 1 end";
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", script, 1, key, windowSeconds, limit]),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: number;
    error?: string;
  } | null;
  if (!response.ok || payload?.error) throw new Error("Authentication protection is unavailable.");
  return payload?.result === 1;
}
