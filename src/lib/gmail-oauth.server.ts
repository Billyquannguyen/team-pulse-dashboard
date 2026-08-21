import "@tanstack/react-start/server-only";

function requiredGmailEnv(
  name: "MASTER_GMAIL_CLIENT_ID" | "MASTER_GMAIL_CLIENT_SECRET" | "MASTER_GMAIL_REFRESH_TOKEN",
) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in Vercel Environment Variables.`);
  return value;
}

export async function getMasterGmailAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredGmailEnv("MASTER_GMAIL_CLIENT_ID"),
      client_secret: requiredGmailEnv("MASTER_GMAIL_CLIENT_SECRET"),
      refresh_token: requiredGmailEnv("MASTER_GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description ?? payload?.error ?? "Gmail authentication failed.");
  }
  return payload.access_token;
}

const REQUIRED_MASTER_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];

export async function validateMasterGmailScopes() {
  const accessToken = await getMasterGmailAccessToken();
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    { signal: AbortSignal.timeout(20_000), cache: "no-store" },
  );
  const payload = (await response.json().catch(() => null)) as {
    scope?: string;
    error_description?: string;
  } | null;
  if (!response.ok || !payload?.scope) {
    throw new Error(
      payload?.error_description ?? "Google could not verify the master Gmail token.",
    );
  }
  const granted = new Set(payload.scope.split(/\s+/).filter(Boolean));
  const missing = REQUIRED_MASTER_GMAIL_SCOPES.filter((scope) => !granted.has(scope));
  if (missing.length) {
    throw new Error(`The master Gmail token is missing required scopes: ${missing.join(", ")}`);
  }
  return { ok: true as const, scopes: REQUIRED_MASTER_GMAIL_SCOPES };
}
