import "@tanstack/react-start/server-only";

const DEFAULT_ADMIN_EMAIL = "anhquan2016048@gmail.com";

function requiredGmailEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodedSubject(value: string) {
  return `=?UTF-8?B?${Buffer.from(cleanHeader(value), "utf8").toString("base64")}?=`;
}

async function gmailAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredGmailEnv("BRAND_FINDER_GMAIL_CLIENT_ID"),
      client_secret: requiredGmailEnv("BRAND_FINDER_GMAIL_CLIENT_SECRET"),
      refresh_token: requiredGmailEnv("BRAND_FINDER_GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    error_description?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || "Gmail access token could not be created.");
  }
  return payload.access_token;
}

export async function notifyAdminOfVerifiedMember(input: {
  email: string;
  displayName: string;
  dashboardOrigin: string;
}) {
  const recipient = process.env.DASHBOARD_APPROVAL_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL;
  const name = input.displayName.trim() || input.email;
  const approvalUrl = new URL("/team-members", input.dashboardOrigin).toString();
  const textBody = [
    "A verified member is waiting for dashboard approval.",
    "",
    `Name: ${name}`,
    `Email: ${input.email}`,
    "",
    `Review request: ${approvalUrl}`,
  ].join("\n");
  const htmlBody = [
    "<p>A verified member is waiting for dashboard approval.</p>",
    `<p><strong>Name:</strong> ${escapeHtml(name)}<br><strong>Email:</strong> ${escapeHtml(input.email)}</p>`,
    `<p><a href="${escapeHtml(approvalUrl)}">Review approval request</a></p>`,
  ].join("");
  const boundary = `team-billion-approval-${crypto.randomUUID()}`;
  const raw = base64Url(
    [
      `To: ${cleanHeader(recipient)}`,
      `Subject: ${encodedSubject(`Dashboard approval needed: ${name}`)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      textBody,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      htmlBody,
      "",
      `--${boundary}--`,
    ].join("\r\n"),
  );

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await gmailAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error?.message || `Gmail returned ${response.status}.`);
  }
}
