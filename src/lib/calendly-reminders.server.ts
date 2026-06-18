import "@tanstack/react-start/server-only";

import {
  appendSheetRow,
  createSheetTab,
  fetchSheetRows,
  fetchSpreadsheetTabs,
  updateSheetRow,
  type GoogleSheetRef,
  type GoogleSheetsConfig,
} from "@/lib/google-sheets.server";

export const CALENDLY_REMINDER_HEADERS = [
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
] as const;

export type CalendlyReminderStatus = "pending" | "sent" | "failed";

export type CalendlyReminderRecord = {
  id: string;
  calendlyInviteeUri: string;
  creatorName: string;
  creatorEmail: string;
  meetingName: string;
  meetingStartTime: string;
  bookedAt: string;
  reminderSendAt: string;
  status: CalendlyReminderStatus;
  sentAt: string;
  retryCount: string;
  lastError: string;
};

type StoredReminder = CalendlyReminderRecord & {
  rowNumber: number;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required Calendly reminder env var: ${name}`);
  return value;
}

function normalizePrivateKey(value: string) {
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
  return process.env.CALENDLY_REMINDERS_SHEET_NAME?.trim() || "Calendly Reminders";
}

function getSheetsConfig(spreadsheetId: string): GoogleSheetsConfig {
  return {
    serviceAccountEmail: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
    teamSpreadsheetId: spreadsheetId,
    creatorSourcingSpreadsheetId:
      process.env.CREATOR_SOURCING_SPREADSHEET_ID?.trim() || spreadsheetId,
  };
}

function normalizeIso(value: unknown, fallback = new Date()) {
  const date = value ? new Date(String(value)) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function stableReminderId(calendlyInviteeUri: string) {
  return `CAL-${encodeURIComponent(calendlyInviteeUri).replace(/%/g, "").slice(-48)}`;
}

function cell(row: string[], headers: string[], name: string) {
  const index = headers.indexOf(name);
  return index >= 0 ? row[index] || "" : "";
}

function rowToReminder(row: string[], headers: string[], rowNumber: number): StoredReminder {
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
    status: (cell(row, headers, "status") || "pending") as CalendlyReminderStatus,
    sentAt: cell(row, headers, "sentAt"),
    retryCount: cell(row, headers, "retryCount") || "0",
    lastError: cell(row, headers, "lastError"),
  };
}

function reminderToRow(record: CalendlyReminderRecord) {
  return CALENDLY_REMINDER_HEADERS.map((header) => record[header]);
}

async function ensureReminderSheet(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
): Promise<GoogleSheetRef> {
  const sheetName = getSheetName();
  let sheets = await fetchSpreadsheetTabs(config, spreadsheetId);
  let sheet = sheets.find((candidate) => candidate.sheetName === sheetName);

  if (!sheet) {
    await createSheetTab(config, spreadsheetId, sheetName);
    sheets = await fetchSpreadsheetTabs(config, spreadsheetId);
    sheet = sheets.find((candidate) => candidate.sheetName === sheetName);
  }

  if (!sheet) throw new Error(`Could not open Calendly reminder sheet "${sheetName}".`);

  const worksheet = await fetchSheetRows(config, spreadsheetId, sheet);
  const headersMatch =
    worksheet.headers.length >= CALENDLY_REMINDER_HEADERS.length &&
    CALENDLY_REMINDER_HEADERS.every((header, index) => worksheet.headers[index] === header);

  if (!headersMatch) {
    await updateSheetRow(config, spreadsheetId, sheet, 1, [...CALENDLY_REMINDER_HEADERS]);
  }

  return sheet;
}

async function loadReminderRows(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  sheet: GoogleSheetRef,
) {
  const worksheet = await fetchSheetRows(config, spreadsheetId, sheet);
  const headers = worksheet.headers.length ? worksheet.headers : [...CALENDLY_REMINDER_HEADERS];

  return worksheet.rows
    .map((row, index) => rowToReminder(row, headers, index + 2))
    .filter((record) => record.calendlyInviteeUri);
}

export async function upsertCalendlyReminder(record: CalendlyReminderRecord) {
  const spreadsheetId = getSpreadsheetId();
  const config = getSheetsConfig(spreadsheetId);
  const sheet = await ensureReminderSheet(config, spreadsheetId);
  const rows = await loadReminderRows(config, spreadsheetId, sheet);
  const existing = rows.find((row) => row.calendlyInviteeUri === record.calendlyInviteeUri);

  if (!existing) {
    await appendSheetRow(config, spreadsheetId, sheet, reminderToRow(record));
    return { ok: true, action: "created", id: record.id };
  }

  if (existing.status === "sent") {
    return { ok: true, action: "ignored_already_sent", id: existing.id };
  }

  const updated: CalendlyReminderRecord = {
    ...record,
    id: existing.id || record.id,
    status: existing.status || "pending",
    sentAt: existing.sentAt,
    retryCount: existing.retryCount || "0",
    lastError: existing.lastError,
  };

  await updateSheetRow(config, spreadsheetId, sheet, existing.rowNumber, reminderToRow(updated));
  return { ok: true, action: "updated", id: updated.id };
}

export function reminderFromCalendlyWebhook(body: Record<string, unknown>): CalendlyReminderRecord {
  const payload = (
    body.payload && typeof body.payload === "object" ? body.payload : body
  ) as Record<string, unknown>;
  const scheduledEvent =
    payload.scheduled_event && typeof payload.scheduled_event === "object"
      ? (payload.scheduled_event as Record<string, unknown>)
      : {};

  const calendlyInviteeUri = String(payload.uri || payload.invitee_uri || "");
  if (!calendlyInviteeUri) throw new Error("Calendly webhook did not include payload.uri.");

  const bookedAt = normalizeIso(payload.created_at);
  const reminderSendAt = addMinutes(bookedAt, 15);

  return {
    id: stableReminderId(calendlyInviteeUri),
    calendlyInviteeUri,
    creatorName: String(payload.name || ""),
    creatorEmail: String(payload.email || ""),
    meetingName: String(scheduledEvent.name || payload.event_type_name || "Calendly meeting"),
    meetingStartTime: normalizeIso(scheduledEvent.start_time, new Date(bookedAt)),
    bookedAt,
    reminderSendAt,
    status: "pending",
    sentAt: "",
    retryCount: "0",
    lastError: "",
  };
}
