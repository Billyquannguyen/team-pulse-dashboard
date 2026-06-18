import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHeaderLookup, getHeaderCell, type HeaderLookup } from "@/lib/sheet-headers";

export const CONTACT_DATABASE_TAB_NAME = "Contact Database";
export const CONTACT_DATABASE_SPREADSHEET_ENV = "TEAM_ASSETS_SPREADSHEET_ID";

const CONTACT_DATABASE_HEADERS = [
  "id",
  "brandName",
  "contactName",
  "contactFirstName",
  "email",
  "position",
  "source",
  "firstFoundAt",
  "lastContactedAt",
  "gmailThreadId",
  "notes",
];

const CONTACT_DATABASE_CACHE_TTL_MS = 2 * 60 * 1000;
const QUERY_STALE_TIME_MS = CONTACT_DATABASE_CACHE_TTL_MS;
const QUERY_REFETCH_INTERVAL_MS = CONTACT_DATABASE_CACHE_TTL_MS;

type GoogleSheetsConfig = {
  serviceAccountEmail: string;
  privateKey: string;
  teamSpreadsheetId: string;
  creatorSourcingSpreadsheetId: string;
};

type ContactDatabaseCacheEntry = {
  data: ContactDatabaseSheetData;
  cachedAt: number;
  expiresAt: number;
};

type ContactDatabaseField =
  | "id"
  | "brandName"
  | "contactName"
  | "contactFirstName"
  | "email"
  | "position"
  | "source"
  | "firstFoundAt"
  | "lastContactedAt"
  | "gmailThreadId"
  | "notes";

type ContactDatabaseWorksheet = {
  sheet: {
    memberName: string;
    sheetName: string;
    gid?: string;
  };
  headers: string[];
  rows: string[][];
  availableTabs: string[];
};

export type ContactDatabaseContact = {
  id: string;
  rowNumber?: number;
  brandName: string;
  contactName: string;
  contactFirstName: string;
  email: string;
  position: string;
  source: string;
  firstFoundAt: string;
  lastContactedAt: string;
  gmailThreadId: string;
  notes: string;
};

export type ContactDatabaseSheetData = {
  contacts: ContactDatabaseContact[];
  source: "google-sheet" | "error";
  error?: string;
  warning?: string;
  links: {
    contactDatabaseSheetUrl?: string;
  };
  updatedAt: string;
};

const CONTACT_COLUMN_ALIASES: Record<ContactDatabaseField, string[]> = {
  id: ["id", "contact id"],
  brandName: ["brandName", "brand name", "brand", "company", "company name"],
  contactName: ["contactName", "contact name", "name", "full name"],
  contactFirstName: ["contactFirstName", "contact first name", "first name", "firstname"],
  email: ["email", "email address", "work email", "business email"],
  position: ["position", "title", "job title", "role"],
  source: ["source", "found from"],
  firstFoundAt: ["firstFoundAt", "first found at", "found at", "created at"],
  lastContactedAt: ["lastContactedAt", "last contacted at", "contacted at"],
  gmailThreadId: ["gmailThreadId", "gmail thread id", "thread id"],
  notes: ["notes", "note"],
};

const emailSchema = z
  .string()
  .trim()
  .max(320)
  .refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: "Enter a valid email or leave it blank.",
  });

const contactInput = z.object({
  brandName: z.string().trim().min(1).max(180),
  contactName: z.string().trim().max(180).optional().default(""),
  contactFirstName: z.string().trim().max(120).optional().default(""),
  email: emailSchema.optional().default(""),
  position: z.string().trim().max(220).optional().default(""),
  source: z.string().trim().max(120).optional().default("Manual"),
  firstFoundAt: z.string().trim().max(80).optional().default(""),
  lastContactedAt: z.string().trim().max(80).optional().default(""),
  gmailThreadId: z.string().trim().max(220).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

const updateContactInput = contactInput.extend({
  rowNumber: z.number().int().min(2),
  id: z.string().trim().min(1).max(220),
});

const deleteContactInput = z.object({
  rowNumber: z.number().int().min(2),
});

const upsertContactsInput = z.object({
  contacts: z.array(contactInput).min(1).max(250),
});

type ContactInput = z.infer<typeof contactInput>;
type UpdateContactInput = z.infer<typeof updateContactInput>;

let contactDatabaseCache: ContactDatabaseCacheEntry | null = null;
let contactDatabaseRefreshPromise: Promise<ContactDatabaseCacheEntry> | null = null;

const getGoogleSheetsServer = createServerOnlyFn(async () => import("@/lib/google-sheets.server"));

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getContactDatabaseSpreadsheetId() {
  return process.env[CONTACT_DATABASE_SPREADSHEET_ENV]?.trim() ?? "";
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[_–—-]+/g, " ")
    .replace(/[^\p{L}\p{N}@. ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value: string) {
  return normalizeKey(value).replace(/[^a-z0-9@.]+/g, "");
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function splitFirstName(contactName: string, explicitFirstName: string) {
  if (explicitFirstName.trim()) return explicitFirstName.trim();
  return contactName.trim().split(/\s+/)[0] ?? "";
}

function dedupeKey(contact: Pick<ContactDatabaseContact, "brandName" | "contactName" | "email">) {
  const email = normalizeEmail(contact.email);
  if (email) return `email:${email}`;
  return `name:${compactKey(contact.brandName)}:${compactKey(contact.contactName)}`;
}

function idFromContact(
  contact: Pick<ContactDatabaseContact, "brandName" | "contactName" | "email">,
) {
  const key = dedupeKey(contact)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return key || `contact-${Date.now()}`;
}

function buildLookup(headers: string[]): HeaderLookup<ContactDatabaseField> {
  return createHeaderLookup(headers, CONTACT_COLUMN_ALIASES);
}

function getCell(
  row: string[],
  lookup: HeaderLookup<ContactDatabaseField>,
  field: ContactDatabaseField,
) {
  return getHeaderCell(row, lookup, field);
}

function hasRequiredHeaders(headers: string[]) {
  const lookup = buildLookup(headers);
  return ["brandName", "email", "contactName"].every((field) => {
    const index = lookup[field as ContactDatabaseField];
    return index !== undefined && index >= 0;
  });
}

function sheetUrl(spreadsheetId: string, gid?: string) {
  if (!spreadsheetId) return undefined;
  const suffix = gid ? `#gid=${gid}` : "";
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${suffix}`;
}

async function loadContactDatabaseWorksheet(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
): Promise<ContactDatabaseWorksheet> {
  const googleSheets = await getGoogleSheetsServer();

  if (!spreadsheetId) {
    throw new Error(`Missing required Google Sheets env var: ${CONTACT_DATABASE_SPREADSHEET_ENV}`);
  }

  let tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
  let matchedTab = tabs.find(
    (tab) => compactKey(tab.sheetName) === compactKey(CONTACT_DATABASE_TAB_NAME),
  );

  if (!matchedTab) {
    await googleSheets.createSheetTab(config, spreadsheetId, CONTACT_DATABASE_TAB_NAME);
    tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);
    matchedTab = tabs.find(
      (tab) => compactKey(tab.sheetName) === compactKey(CONTACT_DATABASE_TAB_NAME),
    );
  }

  if (!matchedTab) {
    throw new Error(`Could not find or create "${CONTACT_DATABASE_TAB_NAME}".`);
  }

  const sheet = {
    memberName: CONTACT_DATABASE_TAB_NAME,
    sheetName: matchedTab.sheetName,
    gid: matchedTab.gid,
  };
  let rows = await googleSheets.fetchSheetRows(config, spreadsheetId, sheet);

  if (rows.headers.length === 0) {
    await googleSheets.updateSheetRow(config, spreadsheetId, sheet, 1, CONTACT_DATABASE_HEADERS);
    rows = {
      headers: CONTACT_DATABASE_HEADERS,
      rows: [],
    };
  }

  if (!hasRequiredHeaders(rows.headers)) {
    throw new Error(
      `${CONTACT_DATABASE_TAB_NAME} needs these columns: ${CONTACT_DATABASE_HEADERS.join(", ")}`,
    );
  }

  return {
    sheet,
    headers: rows.headers,
    rows: rows.rows,
    availableTabs: tabs.map((tab) => tab.sheetName),
  };
}

function normalizeContactRow(
  row: string[],
  index: number,
  lookup: HeaderLookup<ContactDatabaseField>,
): ContactDatabaseContact | null {
  const brandName = getCell(row, lookup, "brandName");
  const contactName = getCell(row, lookup, "contactName");
  const email = normalizeEmail(getCell(row, lookup, "email"));

  if (!brandName && !contactName && !email) return null;

  const contactFirstName = splitFirstName(contactName, getCell(row, lookup, "contactFirstName"));
  const contact: ContactDatabaseContact = {
    id: getCell(row, lookup, "id"),
    rowNumber: index + 2,
    brandName,
    contactName,
    contactFirstName,
    email,
    position: getCell(row, lookup, "position"),
    source: getCell(row, lookup, "source") || "Contact Database",
    firstFoundAt: getCell(row, lookup, "firstFoundAt"),
    lastContactedAt: getCell(row, lookup, "lastContactedAt"),
    gmailThreadId: getCell(row, lookup, "gmailThreadId"),
    notes: getCell(row, lookup, "notes"),
  };

  return {
    ...contact,
    id: contact.id || idFromContact(contact),
  };
}

function normalizeContactRows(headers: string[], rows: string[][]) {
  const lookup = buildLookup(headers);
  return rows
    .map((row, index) => normalizeContactRow(row, index, lookup))
    .filter((contact): contact is ContactDatabaseContact => contact !== null);
}

function contactFromInput(input: ContactInput): ContactDatabaseContact {
  const now = new Date().toISOString();
  const contactName = input.contactName.trim();
  const contact: ContactDatabaseContact = {
    id: "",
    brandName: input.brandName.trim(),
    contactName,
    contactFirstName: splitFirstName(contactName, input.contactFirstName),
    email: normalizeEmail(input.email),
    position: input.position.trim(),
    source: input.source.trim() || "Manual",
    firstFoundAt: input.firstFoundAt.trim() || now,
    lastContactedAt: input.lastContactedAt.trim(),
    gmailThreadId: input.gmailThreadId.trim(),
    notes: input.notes.trim(),
  };

  return {
    ...contact,
    id: idFromContact(contact),
  };
}

function mergedContact(existing: ContactDatabaseContact, incoming: ContactDatabaseContact) {
  return {
    ...existing,
    brandName: incoming.brandName || existing.brandName,
    contactName: incoming.contactName || existing.contactName,
    contactFirstName: incoming.contactFirstName || existing.contactFirstName,
    email: incoming.email || existing.email,
    position: incoming.position || existing.position,
    source: incoming.source || existing.source,
    firstFoundAt: existing.firstFoundAt || incoming.firstFoundAt,
    lastContactedAt: incoming.lastContactedAt || existing.lastContactedAt,
    gmailThreadId: incoming.gmailThreadId || existing.gmailThreadId,
    notes: incoming.notes || existing.notes,
  };
}

function buildContactRow(headers: string[], contact: ContactDatabaseContact) {
  const lookup = buildLookup(headers);
  const values: Record<ContactDatabaseField, string> = {
    id: contact.id,
    brandName: contact.brandName,
    contactName: contact.contactName,
    contactFirstName: contact.contactFirstName,
    email: contact.email,
    position: contact.position,
    source: contact.source,
    firstFoundAt: contact.firstFoundAt,
    lastContactedAt: contact.lastContactedAt,
    gmailThreadId: contact.gmailThreadId,
    notes: contact.notes,
  };
  const row = Array.from({ length: headers.length }, () => "");

  (Object.keys(values) as ContactDatabaseField[]).forEach((field) => {
    const index = lookup[field];
    if (index !== undefined && index >= 0) row[index] = values[field];
  });

  return row;
}

function invalidateContactDatabaseCache() {
  contactDatabaseCache = null;
  contactDatabaseRefreshPromise = null;
}

async function readContactDatabaseData(): Promise<ContactDatabaseSheetData> {
  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();
  const spreadsheetId = getContactDatabaseSpreadsheetId();
  const worksheet = await loadContactDatabaseWorksheet(config, spreadsheetId);
  const contacts = normalizeContactRows(worksheet.headers, worksheet.rows);

  return {
    contacts,
    source: "google-sheet",
    links: {
      contactDatabaseSheetUrl: sheetUrl(spreadsheetId, worksheet.sheet.gid),
    },
    updatedAt: new Date().toISOString(),
  };
}

async function refreshContactDatabaseCache(): Promise<ContactDatabaseCacheEntry> {
  const data = await readContactDatabaseData();
  const entry = {
    data,
    cachedAt: Date.now(),
    expiresAt: Date.now() + CONTACT_DATABASE_CACHE_TTL_MS,
  };

  contactDatabaseCache = entry;
  return entry;
}

async function getContactDatabaseWithCache() {
  if (contactDatabaseCache && contactDatabaseCache.expiresAt > Date.now()) {
    return contactDatabaseCache.data;
  }

  if (!contactDatabaseRefreshPromise) {
    contactDatabaseRefreshPromise = refreshContactDatabaseCache().finally(() => {
      contactDatabaseRefreshPromise = null;
    });
  }

  return (await contactDatabaseRefreshPromise).data;
}

export async function getContactDatabaseDataForServer(): Promise<ContactDatabaseSheetData> {
  const googleSheets = await getGoogleSheetsServer();
  const productionRuntime = googleSheets.isProductionRuntime();
  const spreadsheetId = getContactDatabaseSpreadsheetId();

  try {
    return await getContactDatabaseWithCache();
  } catch (error) {
    const message = `${errorMessage(error)}. Check ${CONTACT_DATABASE_SPREADSHEET_ENV} and the "${CONTACT_DATABASE_TAB_NAME}" tab.`;

    if (!productionRuntime) {
      return {
        contacts: [],
        source: "error",
        error: message,
        warning: "Local development: Contact Database could not be loaded from Google Sheets.",
        links: {
          contactDatabaseSheetUrl: sheetUrl(spreadsheetId),
        },
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      contacts: [],
      source: "error",
      error: message,
      links: {
        contactDatabaseSheetUrl: sheetUrl(spreadsheetId),
      },
      updatedAt: new Date().toISOString(),
    };
  }
}

async function writeContact(contact: ContactDatabaseContact, rowNumber?: number) {
  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();
  const spreadsheetId = getContactDatabaseSpreadsheetId();
  const worksheet = await loadContactDatabaseWorksheet(config, spreadsheetId);
  const row = buildContactRow(worksheet.headers, contact);

  if (rowNumber) {
    await googleSheets.updateSheetRow(config, spreadsheetId, worksheet.sheet, rowNumber, row);
  } else {
    await googleSheets.appendSheetRow(config, spreadsheetId, worksheet.sheet, row);
  }

  invalidateContactDatabaseCache();
}

async function upsertContacts(inputs: ContactInput[]) {
  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();
  const spreadsheetId = getContactDatabaseSpreadsheetId();
  const worksheet = await loadContactDatabaseWorksheet(config, spreadsheetId);
  const existing = normalizeContactRows(worksheet.headers, worksheet.rows);
  const byKey = new Map(existing.map((contact) => [dedupeKey(contact), contact]));
  let created = 0;
  let updated = 0;

  for (const input of inputs) {
    const incoming = contactFromInput(input);
    const key = dedupeKey(incoming);
    const match = byKey.get(key);

    if (match?.rowNumber) {
      const next = mergedContact(match, incoming);
      await googleSheets.updateSheetRow(
        config,
        spreadsheetId,
        worksheet.sheet,
        match.rowNumber,
        buildContactRow(worksheet.headers, next),
      );
      byKey.set(key, next);
      updated += 1;
    } else {
      await googleSheets.appendSheetRow(
        config,
        spreadsheetId,
        worksheet.sheet,
        buildContactRow(worksheet.headers, incoming),
      );
      byKey.set(key, incoming);
      created += 1;
    }
  }

  invalidateContactDatabaseCache();
  return { created, updated };
}

export const fetchContactDatabaseData = createServerFn({ method: "GET" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  return getContactDatabaseDataForServer();
});

export const addContactDatabaseContact = createServerFn({ method: "POST" })
  .inputValidator(contactInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    const result = await upsertContacts([data]);
    return { ok: true as const, ...result };
  });

export const updateContactDatabaseContact = createServerFn({ method: "POST" })
  .inputValidator(updateContactInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    const contact: ContactDatabaseContact = {
      ...contactFromInput(data),
      id: data.id,
      rowNumber: data.rowNumber,
    };

    await writeContact(contact, data.rowNumber);
    return { ok: true as const };
  });

export const deleteContactDatabaseContact = createServerFn({ method: "POST" })
  .inputValidator(deleteContactInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    const googleSheets = await getGoogleSheetsServer();
    const config = googleSheets.getGoogleSheetsConfig();
    const spreadsheetId = getContactDatabaseSpreadsheetId();
    const worksheet = await loadContactDatabaseWorksheet(config, spreadsheetId);
    const blankRow = Array.from({ length: worksheet.headers.length }, () => "");

    await googleSheets.updateSheetRow(
      config,
      spreadsheetId,
      worksheet.sheet,
      data.rowNumber,
      blankRow,
    );
    invalidateContactDatabaseCache();

    return { ok: true as const };
  });

export const upsertContactDatabaseContacts = createServerFn({ method: "POST" })
  .inputValidator(upsertContactsInput)
  .handler(async ({ data }) => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();
    const result = await upsertContacts(data.contacts);
    return { ok: true as const, ...result };
  });

export const deduplicateContactDatabase = createServerFn({ method: "POST" }).handler(async () => {
  const { requireDashboardAuth } = await import("@/lib/auth.server");
  await requireDashboardAuth();
  const googleSheets = await getGoogleSheetsServer();
  const config = googleSheets.getGoogleSheetsConfig();
  const spreadsheetId = getContactDatabaseSpreadsheetId();
  const worksheet = await loadContactDatabaseWorksheet(config, spreadsheetId);
  const contacts = normalizeContactRows(worksheet.headers, worksheet.rows);
  const seen = new Set<string>();
  let removed = 0;

  for (const contact of contacts) {
    const key = dedupeKey(contact);
    if (!key || !contact.rowNumber) continue;

    if (seen.has(key)) {
      await googleSheets.updateSheetRow(
        config,
        spreadsheetId,
        worksheet.sheet,
        contact.rowNumber,
        Array.from({ length: worksheet.headers.length }, () => ""),
      );
      removed += 1;
    } else {
      seen.add(key);
    }
  }

  invalidateContactDatabaseCache();
  return { ok: true as const, removed };
});

export const contactDatabaseQuery = {
  queryKey: ["team-billion-contact-database", "google-sheet-v1"],
  queryFn: () => fetchContactDatabaseData(),
  refetchInterval: QUERY_REFETCH_INTERVAL_MS,
  staleTime: QUERY_STALE_TIME_MS,
};
