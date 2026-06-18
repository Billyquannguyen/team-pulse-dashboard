#!/usr/bin/env node

import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets",
};

const DEFAULT_SHEET_NAME = "Calendly Reminders";
const DUE_WINDOW_HOURS = 24;
const REMINDER_HEADERS = [
  "id",
  "calendlyInviteeUri",
  "creatorName",
  "creatorEmail",
  "meetingName",
  "meetingStartTime",
  "bookedAt",
  "reminderSendAt",
  "status",
  "sentAt",
  "retryCount",
  "lastError",
];

function nowIso() {
  return new Date().toISOString();
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizePrivateKey(value) {
  return value.replace(/^"|"$/g, "").replace(/\\n/g, "\n").trim();
}

function getSpreadsheetId() {
  return (
    process.env.CALENDLY_REMINDERS_SPREADSHEET_ID?.trim() ||
    process.env.TEAM_BILLION_SPREADSHEET_ID?.trim() ||
    requiredEnv("CALENDLY_REMINDERS_SPREADSHEET_ID")
  );
}

function getSheetName() {
  return process.env.CALENDLY_REMINDERS_SHEET_NAME?.trim() || DEFAULT_SHEET_NAME;
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.CALENDLY_REMINDER_TIMEZONE || "Europe/London",
  }).format(date);
}

function minutesBetween(startValue, endValue) {
  if (!startValue || !endValue) return null;

  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  return Math.max(0, Math.round((end - start) / 60000));
}

function delayLabel(createdAt, sentAt) {
  const minutes = minutesBetween(createdAt, sentAt);
  if (minutes === null) return "Unknown";
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToBuffer(pem) {
  return Buffer.from(
    pem
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s/g, ""),
    "base64",
  );
}

async function signJwt(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: config.serviceAccountEmail,
    scope: SCOPES.sheets,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBuffer(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken),
  );

  return `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;
}

async function getAccessToken(config) {
  const assertion = await signJwt(config);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.access_token) {
    throw new Error(
      `Google service account auth failed (${response.status}): ${
        result.error_description || result.error || "No access token returned"
      }`,
    );
  }

  return result.access_token;
}

function quoteSheet(sheetName) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function columnName(index) {
  let column = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    current = Math.floor((current - 1) / 26);
  }

  return column;
}

async function googleFetch(config, url, init = {}) {
  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${await getAccessToken(config)}`,
    },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Google Sheets API failed (${response.status}) ${url.pathname}: ${body.error?.message || response.statusText}`,
    );
  }

  return body;
}

async function getSpreadsheetMetadata(config) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}`);
  url.searchParams.set("includeGridData", "false");
  url.searchParams.set("fields", "sheets.properties(sheetId,title,hidden)");
  return googleFetch(config, url);
}

async function createSheet(config, sheetName) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}:batchUpdate`,
  );
  await googleFetch(config, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    }),
  });
}

async function getSheetRows(config, sheetName) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(
      quoteSheet(sheetName),
    )}`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const result = await googleFetch(config, url);
  return result.values || [];
}

async function updateRow(config, sheetName, rowNumber, values) {
  const endColumn = columnName(Math.max(values.length - 1, 0));
  const range = `${quoteSheet(sheetName)}!A${rowNumber}:${endColumn}${rowNumber}`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  await googleFetch(config, url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      majorDimension: "ROWS",
      values: [values],
    }),
  });
}

async function ensureReminderSheet(config) {
  const sheetName = getSheetName();
  let metadata = await getSpreadsheetMetadata(config);
  let sheet = metadata.sheets?.find((candidate) => candidate.properties?.title === sheetName);

  if (!sheet) {
    await createSheet(config, sheetName);
    metadata = await getSpreadsheetMetadata(config);
    sheet = metadata.sheets?.find((candidate) => candidate.properties?.title === sheetName);
  }

  if (!sheet) throw new Error(`Could not create or open sheet "${sheetName}".`);

  const rows = await getSheetRows(config, sheetName);
  const existingHeaders = rows[0] || [];
  const headersMatch = REMINDER_HEADERS.every((header, index) => existingHeaders[index] === header);

  if (!headersMatch) {
    await updateRow(config, sheetName, 1, REMINDER_HEADERS);
  }

  return sheetName;
}

function cell(row, headers, name) {
  const index = headers.indexOf(name);
  return index >= 0 ? String(row[index] || "") : "";
}

function rowToReminder(row, headers, rowNumber) {
  return {
    rowNumber,
    id: cell(row, headers, "id"),
    calendlyInviteeUri: cell(row, headers, "calendlyInviteeUri"),
    creatorName: cell(row, headers, "creatorName"),
    creatorEmail: cell(row, headers, "creatorEmail"),
    meetingName: cell(row, headers, "meetingName"),
    meetingStartTime: cell(row, headers, "meetingStartTime"),
    bookedAt: cell(row, headers, "bookedAt"),
    reminderSendAt: cell(row, headers, "reminderSendAt"),
    status: cell(row, headers, "status") || "pending",
    sentAt: cell(row, headers, "sentAt"),
    retryCount: cell(row, headers, "retryCount") || "0",
    lastError: cell(row, headers, "lastError"),
  };
}

function reminderToRow(record) {
  return REMINDER_HEADERS.map((header) => String(record[header] || ""));
}

async function loadReminders(config, sheetName) {
  const rows = await getSheetRows(config, sheetName);
  const headers = rows[0] || REMINDER_HEADERS;

  return rows
    .slice(1)
    .map((row, index) => rowToReminder(row, headers, index + 2))
    .filter((record) => record.id && record.calendlyInviteeUri);
}

function selectDueReminders(records, nowValue) {
  const now = new Date(nowValue).getTime();
  const windowStart = now - DUE_WINDOW_HOURS * 60 * 60 * 1000;
  const pending = records.filter((record) => record.status === "pending");
  const skippedExpired = [];
  const due = [];

  for (const record of pending) {
    const sendAt = new Date(record.reminderSendAt).getTime();
    if (Number.isNaN(sendAt)) continue;
    if (sendAt < windowStart) {
      skippedExpired.push(record);
      continue;
    }
    if (sendAt <= now) due.push(record);
  }

  return { pending, due, skippedExpired };
}

function buildDiscordMessage(record, sentAt) {
  return [
    "**Calendly meeting recap needed**",
    "",
    `Creator: ${record.creatorName || "Unknown"}`,
    `Email: ${record.creatorEmail || "Unknown"}`,
    `Meeting: ${record.meetingName || "Calendly meeting"}`,
    `Meeting time: ${formatDateTime(record.meetingStartTime)}`,
    `Booking created: ${formatDateTime(record.bookedAt)} (${record.bookedAt || "unknown"})`,
    `Reminder due: ${formatDateTime(record.reminderSendAt)} (${record.reminderSendAt || "unknown"})`,
    `Workflow ran: ${formatDateTime(sentAt)} (${sentAt})`,
    `Notification delay: ${delayLabel(record.bookedAt, sentAt)}`,
    "",
    "Please revisit Gmail, find the latest email thread for this creator, and compose a short recap for Billy.",
  ].join("\n");
}

async function sendDiscordMessage(webhookUrl, content) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Calendly Reminder",
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }
}

async function writeSummary(summary) {
  const summaryPath =
    process.env.CALENDLY_REMINDER_SUMMARY_FILE?.trim() ||
    path.join(".calendly-reminder-state", "last-run-summary.json");
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

async function writeGithubOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;

  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  await appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

async function processDueReminders({ config, webhookUrl, now }) {
  const sheetName = await ensureReminderSheet(config);
  const records = await loadReminders(config, sheetName);
  const { pending, due, skippedExpired } = selectDueReminders(records, now);
  const sentReminderIds = [];
  const failedReminderIds = [];

  for (const record of due) {
    const sentAt = nowIso();

    try {
      await sendDiscordMessage(webhookUrl, buildDiscordMessage(record, sentAt));
      await updateRow(
        config,
        sheetName,
        record.rowNumber,
        reminderToRow({ ...record, status: "sent", sentAt, lastError: "" }),
      );
      sentReminderIds.push(record.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryCount = String(Number(record.retryCount || "0") + 1);
      await updateRow(
        config,
        sheetName,
        record.rowNumber,
        reminderToRow({
          ...record,
          status: "pending",
          retryCount,
          lastError: message.slice(0, 500),
        }),
      );
      failedReminderIds.push(record.id);
    }
  }

  return {
    now,
    totalPendingReminders: pending.length,
    dueRemindersSelected: due.length,
    skippedExpiredReminders: skippedExpired.length,
    skippedExpiredReminderIds: skippedExpired.map((record) => record.id),
    sentReminderIds,
    failedReminderIds,
  };
}

function getConfigFromEnv() {
  return {
    spreadsheetId: getSpreadsheetId(),
    serviceAccountEmail: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
  };
}

function fakeRecord(id, bookedAt) {
  return {
    rowNumber: Number(id.replace(/\D/g, "")) || 2,
    id,
    calendlyInviteeUri: `calendly://test-invitee/${id}`,
    creatorName: `Creator ${id}`,
    creatorEmail: `${id}@example.com`,
    meetingName: "Creator intro call",
    meetingStartTime: bookedAt,
    bookedAt,
    reminderSendAt: new Date(new Date(bookedAt).getTime() + 15 * 60_000).toISOString(),
    status: "pending",
    sentAt: "",
    retryCount: "0",
    lastError: "",
  };
}

function runSelfTest() {
  const bookingA = fakeRecord("A", "2026-06-18T10:00:00.000Z");
  const bookingB = fakeRecord("B", "2026-06-18T10:30:00.000Z");

  const first = selectDueReminders([bookingA, bookingB], "2026-06-18T10:16:00.000Z");
  assert.deepEqual(
    first.due.map((record) => record.id),
    ["A"],
    "10:16 should select only fake booking A.",
  );

  bookingA.status = "sent";
  bookingA.sentAt = "2026-06-18T10:16:00.000Z";

  const second = selectDueReminders([bookingA, bookingB], "2026-06-18T10:46:00.000Z");
  assert.deepEqual(
    second.due.map((record) => record.id),
    ["B"],
    "10:46 should select only fake booking B.",
  );

  bookingB.status = "sent";
  bookingB.sentAt = "2026-06-18T10:46:00.000Z";

  const third = selectDueReminders([bookingA, bookingB], "2026-06-18T10:47:00.000Z");
  assert.deepEqual(third.due, [], "10:47 should select nothing after A and B are sent.");

  console.log("Calendly reminder self-test passed.");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const summary = await processDueReminders({
    config: getConfigFromEnv(),
    webhookUrl: requiredEnv("CALENDLY_DISCORD_WEBHOOK_URL"),
    now: nowIso(),
  });

  await writeSummary(summary);
  await writeGithubOutputs({
    sent_count: String(summary.sentReminderIds.length),
    failed_count: String(summary.failedReminderIds.length),
    due_count: String(summary.dueRemindersSelected),
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
