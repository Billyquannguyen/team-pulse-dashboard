#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { createInterface } from "node:readline";
import {
  createSheetsClient,
  createSheetsTokenProvider,
  loadEnvFiles,
  normalizeKey,
} from "./runner.mjs";

const SPREADSHEET_ID = "1U-y2oiob1uenmvNiRGMILhmWWORMTye2mBxi2mgVxvs";
const PRE_SCAN_BACKUP_ID = "1a8Sl4p_ixoS56TuEsG0PBsHgIx0HH79BcZlHFPjFGXY";
const OUTPUT = ".brand-contact-scan/qualified-contact-audit.json";

loadEnvFiles([".env", ".env.local", ".env.brand-contact-scan", ".env.opportunity-ingestion"]);
const config = {
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: String(process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  spreadsheetId: SPREADSHEET_ID,
};
if (!config.serviceAccountEmail || !config.privateKey) {
  throw new Error("Missing Google Sheets service account settings.");
}

const supplied = await readStdin();
const qualifiedEmails = new Set(
  supplied.map((item) => String(item.email ?? item).trim().toLowerCase()).filter(Boolean),
);
const sheets = createSheetsClient(config, createSheetsTokenProvider(config));
const backupSheets = createSheetsClient(
  { ...config, spreadsheetId: PRE_SCAN_BACKUP_ID },
  createSheetsTokenProvider({ ...config, spreadsheetId: PRE_SCAN_BACKUP_ID }),
);
const [activeResult, agencyResult, contactResult, briefResult, backupContactResult] = await Promise.all([
  sheets.valuesGet("'Active Contacts'!A:I"),
  sheets.valuesGet("'Agencies'!A:D"),
  sheets.valuesGet("'Contacts'!A:E"),
  sheets.valuesGet("'Briefs'!A:M"),
  backupSheets.valuesGet("'Contacts'!A:E"),
]);
const active = table(activeResult.values ?? []);
const agenciesTable = table(agencyResult.values ?? []);
const contactsTable = table(contactResult.values ?? []);
const briefsTable = table(briefResult.values ?? []);
const backupContactsTable = table(backupContactResult.values ?? []);
const protectedLegacyContacts = new Set(
  backupContactsTable.rows
    .map((row) => ({
      brand: value(backupContactsTable, row, "Brand"),
      contact: value(backupContactsTable, row, "Contact Email / WhatsApp"),
    }))
    .filter((contact) => contact.brand && contact.contact)
    .map(contactKey),
);

const brandMeta = new Map();
for (const row of active.rows) {
  if (value(active, row, "Record Type") !== "Brand") continue;
  const name = value(active, row, "Brand") || row[0];
  if (!name) continue;
  brandMeta.set(normalizeKey(name), {
    name,
    niche: value(active, row, "Niche"),
  });
}

const briefs = new Map();
for (const row of briefsTable.rows) {
  const brand = value(briefsTable, row, "Brand");
  if (!brand) continue;
  briefs.set(normalizeKey(brand), {
    brand,
    platforms: value(briefsTable, row, "Platforms"),
    creatorSize: value(briefsTable, row, "Creator Size"),
    location: value(briefsTable, row, "Location"),
    language: value(briefsTable, row, "Language"),
    creatorAge: value(briefsTable, row, "Creator Age"),
    gender: value(briefsTable, row, "Gender"),
    niches: value(briefsTable, row, "Niches"),
    creatorStyle: value(briefsTable, row, "Creator Style"),
    audience: value(briefsTable, row, "Audience"),
    briefDate: isoDate(value(briefsTable, row, "Brief Date")),
    sourceAgency: value(briefsTable, row, "Source Agency"),
    sourceEmail: value(briefsTable, row, "Source Email"),
  });
}

const allContacts = contactsTable.rows
  .map((row) => ({
    brand: value(contactsTable, row, "Brand"),
    agency: normalizeAgency(value(contactsTable, row, "Agency")),
    contact: value(contactsTable, row, "Contact Email / WhatsApp"),
    lastActiveDate: isoDate(value(contactsTable, row, "Last Active Date")),
    notes: value(contactsTable, row, "Notes"),
  }))
  .filter((contact) => contact.brand && contact.contact);

let preservedNonEmailContacts = 0;
let preservedLegacyContacts = 0;
const contacts = allContacts.filter((contact) => {
  if (protectedLegacyContacts.has(contactKey(contact))) {
    preservedLegacyContacts += 1;
    return true;
  }
  const emails = extractEmails(contact.contact);
  if (emails.length === 0) {
    preservedNonEmailContacts += 1;
    return true;
  }
  return emails.some((email) => qualifiedEmails.has(email));
});
const removedContacts = allContacts.filter(
  (contact) => !contacts.some((kept) => contactKey(kept) === contactKey(contact)),
);

const contactsByBrand = groupBy(contacts, (contact) => normalizeKey(contact.brand));
const brands = [];
for (const [brandKey, brandContacts] of contactsByBrand) {
  const meta = brandMeta.get(brandKey) ?? { name: brandContacts[0].brand, niche: "" };
  const byAgency = groupBy(brandContacts, (contact) => normalizeKey(contact.agency));
  const agencyRecords = [...byAgency.values()]
    .map((agencyContacts) => {
      const sorted = [...agencyContacts].sort(
        (left, right) => dateScore(right.lastActiveDate) - dateScore(left.lastActiveDate),
      );
      return {
        brand: meta.name,
        agency: sorted[0].agency,
        topContact: sorted[0].contact,
        contactActiveDate: sorted[0].lastActiveDate,
        contacts: sorted.map((contact) => ({ ...contact, brand: meta.name })),
      };
    })
    .sort(
      (left, right) =>
        dateScore(right.contactActiveDate) - dateScore(left.contactActiveDate) ||
        left.agency.localeCompare(right.agency),
    );
  const brief = briefs.get(brandKey) ?? emptyBrief(meta.name);
  brands.push({
    name: meta.name,
    niche: meta.niche,
    bestActiveDate: agencyRecords[0]?.contactActiveDate ?? "2025-11-01",
    hasBrief: hasBrief(brief),
    brief: { ...brief, brand: meta.name },
    agencies: agencyRecords,
  });
}

brands.sort((left, right) => {
  const activity = dateScore(right.bestActiveDate) - dateScore(left.bestActiveDate);
  if (activity) return activity;
  const brief = Number(right.hasBrief) - Number(left.hasBrief);
  return brief || left.name.localeCompare(right.name);
});

const brandKeys = new Set(brands.map((brand) => normalizeKey(brand.name)));
const removedBrands = [...brandMeta.values()].filter((brand) => !brandKeys.has(normalizeKey(brand.name)));
const agencyRowsBefore = agenciesTable.rows.filter((row) => value(agenciesTable, row, "Brand"));
const agencies = brands.flatMap((brand) =>
  brand.agencies.map(({ contacts: _contacts, ...agency }) => agency),
);
const keptContacts = brands.flatMap((brand) =>
  brand.agencies.flatMap((agency) => agency.contacts),
);
const keptBriefs = brands.map((brand) => brand.brief);
const result = {
  report: {
    auditedAt: new Date().toISOString(),
    qualification: "Incoming sender appears in a thread labelled Brand outreach or Brand inbound",
    qualifiedGmailSenders: qualifiedEmails.size,
    before: {
      brands: brandMeta.size,
      agencies: agencyRowsBefore.length,
      contacts: allContacts.length,
    },
    after: {
      brands: brands.length,
      agencies: agencies.length,
      contacts: keptContacts.length,
      briefs: keptBriefs.filter(hasBrief).length,
    },
    removed: {
      brands: removedBrands.length,
      agencies: agencyRowsBefore.length - agencies.length,
      contacts: removedContacts.length,
    },
    preservedNonEmailContacts,
    preservedLegacyContacts,
    removedBrandNames: removedBrands.map((brand) => brand.name).sort(),
    removedContactSample: removedContacts.slice(0, 100),
  },
  brands,
  agencies,
  contacts: keptContacts,
  briefs: keptBriefs,
};

await mkdir(".brand-contact-scan", { recursive: true });
await writeFile(OUTPUT, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.report, null, 2));
console.log(`Saved audit result: ${OUTPUT}`);

function table(values) {
  return { headers: values[0] ?? [], rows: values.slice(1).filter((row) => row.some(Boolean)) };
}

function value(source, row, header) {
  const wanted = normalizeKey(header);
  const index = source.headers.findIndex((item) => normalizeKey(item) === wanted);
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function normalizeAgency(valueToNormalize) {
  return normalizeKey(valueToNormalize) === "agency not identified" ? "" : valueToNormalize;
}

function extractEmails(valueToParse) {
  return [...String(valueToParse).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(
    (match) => match[0].toLowerCase(),
  );
}

function contactKey(contact) {
  return `${normalizeKey(contact.brand)}::${String(contact.contact).trim().toLowerCase()}`;
}

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function emptyBrief(brand) {
  return {
    brand,
    platforms: "",
    creatorSize: "",
    location: "",
    language: "",
    creatorAge: "",
    gender: "",
    niches: "",
    creatorStyle: "",
    audience: "",
    briefDate: "",
    sourceAgency: "",
    sourceEmail: "",
  };
}

function hasBrief(brief) {
  return [
    brief.platforms,
    brief.creatorSize,
    brief.location,
    brief.language,
    brief.creatorAge,
    brief.gender,
    brief.niches,
    brief.creatorStyle,
    brief.audience,
  ].some((entry) => String(entry ?? "").trim());
}

function isoDate(inputValue) {
  const input = String(inputValue ?? "").trim();
  if (!input) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const match = input.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (match) {
    const month = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    }[match[2].toLowerCase()];
    if (month) return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dateScore(valueToScore) {
  const score = Date.parse(valueToScore);
  return Number.isFinite(score) ? score : 0;
}

async function readStdin() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const values = [];
  for await (const line of lines) {
    if (line.trim() === "__END__") {
      lines.close();
      return values;
    }
    if (line.trim()) values.push(line.trim());
  }
  if (values.length) return values;
  throw new Error("Expected qualified sender emails on stdin.");
}
