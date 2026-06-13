#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const CALENDLY_API_BASE = "https://api.calendly.com";
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_LOOKAHEAD_DAYS = 90;
const MAX_STATE_ITEMS = 5000;

function nowIso() {
  return new Date().toISOString();
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalIntegerEnv(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(name) {
  return ["1", "true", "yes"].includes((process.env[name] ?? "").trim().toLowerCase());
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

function stateFilePath() {
  return (
    process.env.CALENDLY_REMINDER_STATE_FILE?.trim() ||
    path.join(".calendly-reminder-state", "processed.json")
  );
}

async function readState(filePath) {
  if (!existsSync(filePath)) {
    return {
      exists: false,
      state: {
        version: 1,
        createdAt: nowIso(),
        lastCheckedAt: null,
        processedInvitees: {},
      },
    };
  }

  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  return {
    exists: true,
    state: {
      version: 1,
      createdAt: parsed.createdAt || nowIso(),
      lastCheckedAt: parsed.lastCheckedAt || null,
      processedInvitees: parsed.processedInvitees || {},
    },
  };
}

async function writeState(filePath, state) {
  const entries = Object.entries(state.processedInvitees)
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .slice(0, MAX_STATE_ITEMS);

  const compactState = {
    ...state,
    processedInvitees: Object.fromEntries(entries),
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(compactState, null, 2)}\n`);
}

async function writeSummary(filePath, summary) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(summary, null, 2)}\n`);
}

async function writeGithubOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;

  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  await appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

async function calendlyFetch(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`Calendly API failed (${response.status}) ${url}: ${text}`);
  }

  return json;
}

async function fetchAllPages(firstUrl, token) {
  const items = [];
  let nextUrl = firstUrl;

  while (nextUrl) {
    const json = await calendlyFetch(nextUrl, token);
    if (Array.isArray(json.collection)) items.push(...json.collection);
    nextUrl = json.pagination?.next_page || "";
  }

  return items;
}

async function getCurrentCalendlyUser(token) {
  const json = await calendlyFetch(`${CALENDLY_API_BASE}/users/me`, token);
  if (!json.resource?.uri) throw new Error("Calendly /users/me did not return a user URI.");

  return {
    userUri: json.resource.uri,
    organizationUri: json.resource.current_organization || "",
    name: json.resource.name || "",
    email: json.resource.email || "",
  };
}

async function getScheduledEvents(token, userUri) {
  const lookbackHours = optionalIntegerEnv(
    "CALENDLY_REMINDER_LOOKBACK_HOURS",
    DEFAULT_LOOKBACK_HOURS,
  );
  const lookaheadDays = optionalIntegerEnv(
    "CALENDLY_REMINDER_LOOKAHEAD_DAYS",
    DEFAULT_LOOKAHEAD_DAYS,
  );
  const minStartTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const maxStartTime = new Date(Date.now() + lookaheadDays * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL(`${CALENDLY_API_BASE}/scheduled_events`);

  url.searchParams.set("user", userUri);
  url.searchParams.set("min_start_time", minStartTime);
  url.searchParams.set("max_start_time", maxStartTime);
  url.searchParams.set("status", "active");
  url.searchParams.set("sort", "start_time:asc");
  url.searchParams.set("count", "100");

  return fetchAllPages(url.toString(), token);
}

async function getEventInvitees(token, eventUri) {
  const url = new URL(`${eventUri}/invitees`);
  url.searchParams.set("status", "active");
  url.searchParams.set("count", "100");
  return fetchAllPages(url.toString(), token);
}

function inviteeKey(invitee) {
  return invitee.uri || `${invitee.email || "unknown"}::${invitee.created_at || ""}`;
}

function isRecentInvitee(invitee) {
  const lookbackHours = optionalIntegerEnv(
    "CALENDLY_REMINDER_LOOKBACK_HOURS",
    DEFAULT_LOOKBACK_HOURS,
  );
  const createdAt = invitee.created_at ? new Date(invitee.created_at).getTime() : Date.now();
  if (Number.isNaN(createdAt)) return true;
  return createdAt >= Date.now() - lookbackHours * 60 * 60 * 1000;
}

function buildDiscordMessage({ event, invitee }) {
  return [
    "**New Calendly meeting booked**",
    "",
    `Creator: ${invitee.name || "Unknown"}`,
    `Email: ${invitee.email || "Unknown"}`,
    `Meeting: ${event.name || "Calendly meeting"}`,
    `Meeting time: ${formatDateTime(event.start_time)}`,
    `Booked at: ${formatDateTime(invitee.created_at)}`,
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

async function sendTestNotification(webhookUrl) {
  await sendDiscordMessage(
    webhookUrl,
    [
      "**Test Calendly reminder**",
      "",
      "Creator: Test Creator",
      "Email: creator@example.com",
      "Meeting: Creator intro call",
      `Meeting time: ${formatDateTime(new Date(Date.now() + 60 * 60 * 1000).toISOString())}`,
      `Booked at: ${formatDateTime(nowIso())}`,
      "",
      "Please revisit Gmail, find the latest email thread for this creator, and compose a short recap for Billy.",
    ].join("\n"),
  );
}

async function main() {
  const discordWebhookUrl = requiredEnv("CALENDLY_DISCORD_WEBHOOK_URL");
  const filePath = stateFilePath();
  const summaryPath =
    process.env.CALENDLY_REMINDER_SUMMARY_FILE?.trim() ||
    path.join(path.dirname(filePath), "last-run-summary.json");
  const sendTest = boolEnv("SEND_TEST_NOTIFICATION") || process.argv.includes("--test");
  const notifyExistingRecent = boolEnv("NOTIFY_EXISTING_RECENT");

  if (sendTest) {
    await sendTestNotification(discordWebhookUrl);
    await writeSummary(summaryPath, {
      ok: true,
      checkedAt: nowIso(),
      mode: "test",
      notificationsSent: 1,
    });
    await writeGithubOutputs({
      state_changed: "false",
      notifications_sent: "1",
    });
    console.log("Sent test Discord notification.");
    return;
  }

  const token = requiredEnv("CALENDLY_API_TOKEN");
  const { exists: stateExists, state } = await readState(filePath);
  const user = await getCurrentCalendlyUser(token);
  const events = await getScheduledEvents(token, user.userUri);
  const newBookings = [];
  let inviteesScanned = 0;
  let processedAdded = 0;

  for (const event of events) {
    if (!event.uri) continue;

    const invitees = await getEventInvitees(token, event.uri);
    inviteesScanned += invitees.length;

    for (const invitee of invitees) {
      const key = inviteeKey(invitee);
      if (state.processedInvitees[key]) continue;

      state.processedInvitees[key] = nowIso();
      processedAdded += 1;

      if (!stateExists && !notifyExistingRecent) continue;
      if (!isRecentInvitee(invitee)) continue;

      newBookings.push({ event, invitee });
    }
  }

  for (const booking of newBookings) {
    await sendDiscordMessage(discordWebhookUrl, buildDiscordMessage(booking));
  }

  state.lastCheckedAt = nowIso();
  const stateChanged = !stateExists || processedAdded > 0;
  if (stateChanged) {
    await writeState(filePath, state);
  }

  const summary = {
    ok: true,
    checkedAt: state.lastCheckedAt,
    calendlyUser: {
      name: user.name,
      email: user.email,
    },
    stateExistedBeforeRun: stateExists,
    bootstrapOnly: !stateExists && !notifyExistingRecent,
    eventsScanned: events.length,
    inviteesScanned,
    processedAdded,
    stateChanged,
    notificationsSent: newBookings.length,
    newBookings: newBookings.map(({ event, invitee }) => ({
      creatorName: invitee.name || null,
      creatorEmail: invitee.email || null,
      meetingName: event.name || null,
      meetingTime: event.start_time || null,
      bookedAt: invitee.created_at || null,
    })),
  };

  await writeSummary(summaryPath, summary);
  await writeGithubOutputs({
    state_changed: String(stateChanged),
    notifications_sent: String(newBookings.length),
  });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
