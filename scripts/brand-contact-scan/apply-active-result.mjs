#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  createSheetsClient,
  createSheetsTokenProvider,
  loadEnvFiles,
} from "./runner.mjs";

const SPREADSHEET_ID = "1U-y2oiob1uenmvNiRGMILhmWWORMTye2mBxi2mgVxvs";
const LEGACY_BACKUP_ID = "1a8Sl4p_ixoS56TuEsG0PBsHgIx0HH79BcZlHFPjFGXY";
const INPUT = ".brand-contact-scan/active-contact-scan-reviewed.json";
const TITLES = ["Active Contacts", "Agencies", "Contacts", "Briefs"];
const ACTIVE_HEADERS = [
  "Brand / Agency / Contact",
  "Niche",
  "Best / Last Active",
  "Brief",
  "Notes",
  "Record Type",
  "Brand",
  "Agency",
  "Data Last Updated",
];
const AGENCY_HEADERS = ["Brand", "Agency", "Top Contact Email / WhatsApp", "Contact Active Date"];
const CONTACT_HEADERS = [
  "Brand",
  "Agency",
  "Contact Email / WhatsApp",
  "Last Active Date",
  "Notes",
];
const BRIEF_HEADERS = [
  "Brand",
  "Platforms",
  "Creator Size",
  "Location",
  "Language",
  "Creator Age",
  "Gender",
  "Niches",
  "Creator Style",
  "Audience",
  "Brief Date",
  "Source Agency",
  "Source Email",
];

loadEnvFiles([".env", ".env.local", ".env.brand-contact-scan", ".env.opportunity-ingestion"]);
const config = {
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: String(process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  spreadsheetId: SPREADSHEET_ID,
};
if (!config.serviceAccountEmail || !config.privateKey) {
  throw new Error("Missing Google Sheets service account settings.");
}

const result = JSON.parse(await readFile(INPUT, "utf8"));
const sheets = createSheetsClient(config, createSheetsTokenProvider(config));
const backupConfig = { ...config, spreadsheetId: LEGACY_BACKUP_ID };
const backupSheets = createSheetsClient(backupConfig, createSheetsTokenProvider(backupConfig));
const backupContacts = await backupSheets.valuesGet("'Contacts'!A1:E500");
correctLegacyFallbackDates(result, backupContacts.values ?? []);
const metadata = await sheets.metadata();
const byTitle = new Map(metadata.sheets.map((sheet) => [sheet.properties.title, sheet]));
for (const title of TITLES) {
  if (!byTitle.has(title)) throw new Error(`Missing required sheet: ${title}`);
}

const active = buildActiveRows(result.brands, result.report?.scannedAt ?? new Date().toISOString());
const agencyRows = [
  AGENCY_HEADERS,
  ...result.agencies.map((agency) => [
    agency.brand,
    agency.agency || "Agency not identified",
    agency.topContact,
    dateSerial(agency.contactActiveDate),
  ]),
];
const contactRows = [
  CONTACT_HEADERS,
  ...result.contacts.map((contact) => [
    contact.brand,
    contact.agency || "Agency not identified",
    contact.contact,
    dateSerial(contact.lastActiveDate),
    contact.notes,
  ]),
];
const briefRows = [
  BRIEF_HEADERS,
  ...result.briefs.map((brief) => [
    brief.brand,
    brief.platforms,
    brief.creatorSize,
    brief.location,
    brief.language,
    brief.creatorAge,
    brief.gender,
    brief.niches,
    brief.creatorStyle,
    brief.audience,
    brief.briefDate ? dateSerial(brief.briefDate) : "",
    brief.sourceAgency,
    brief.sourceEmail,
  ]),
];
const rowCounts = {
  "Active Contacts": active.rows.length,
  Agencies: agencyRows.length,
  Contacts: contactRows.length,
  Briefs: briefRows.length,
};

const plan = {
  rows: rowCounts,
  outerBrandGroups: active.outerGroups.length,
  innerAgencyGroups: active.innerGroups.length,
  populatedBriefs: result.briefs.filter(hasBrief).length,
  existingGroupsToReplace: byTitle.get("Active Contacts").rowGroups?.length ?? 0,
};
if (!process.argv.includes("--write")) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const activeSheet = byTitle.get("Active Contacts");
const deleteGroups = [...(activeSheet.rowGroups ?? [])]
  .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0))
  .map((group) => ({ deleteDimensionGroup: { range: group.range } }));
await batchRequests(sheets, deleteGroups, 350);

const structuralRequests = [];
for (const title of TITLES) {
  const sheet = byTitle.get(title);
  if (sheet.basicFilter) structuralRequests.push({ clearBasicFilter: { sheetId: sheet.properties.sheetId } });
  structuralRequests.push({
    updateSheetProperties: {
      properties: {
        sheetId: sheet.properties.sheetId,
        gridProperties: {
          rowCount: Math.max(rowCounts[title], 100),
          columnCount: Math.max(sheet.properties.gridProperties.columnCount, columnCount(title)),
          frozenRowCount: 1,
        },
      },
      fields: "gridProperties(rowCount,columnCount,frozenRowCount)",
    },
  });
}
for (let index = (activeSheet.conditionalFormats?.length ?? 0) - 1; index >= 0; index -= 1) {
  structuralRequests.push({
    deleteConditionalFormatRule: { sheetId: activeSheet.properties.sheetId, index },
  });
}
await sheets.batchUpdate(structuralRequests);

await Promise.all([
  sheets.valuesClear("'Active Contacts'!A:I"),
  sheets.valuesClear("'Agencies'!A:D"),
  sheets.valuesClear("'Contacts'!A:E"),
  sheets.valuesClear("'Briefs'!A:M"),
]);
await sheets.valuesBatchUpdate([
  { range: `'Active Contacts'!A1:I${active.rows.length}`, majorDimension: "ROWS", values: active.rows },
  { range: `'Agencies'!A1:D${agencyRows.length}`, majorDimension: "ROWS", values: agencyRows },
  { range: `'Contacts'!A1:E${contactRows.length}`, majorDimension: "ROWS", values: contactRows },
  { range: `'Briefs'!A1:M${briefRows.length}`, majorDimension: "ROWS", values: briefRows },
]);

await sheets.batchUpdate(formatRequests(byTitle, rowCounts));
await batchRequests(
  sheets,
  active.outerGroups.map((range) => ({ addDimensionGroup: { range } })),
  350,
);
await batchRequests(
  sheets,
  active.innerGroups.map((range) => ({ addDimensionGroup: { range } })),
  350,
);

console.log(JSON.stringify({ ...plan, status: "updated" }, null, 2));

function buildActiveRows(brands, updatedAt) {
  const rows = [ACTIVE_HEADERS];
  const outerGroups = [];
  const innerGroups = [];
  const sheetId = byTitle.get("Active Contacts").properties.sheetId;
  let updateTimestampWritten = false;
  for (const brand of brands) {
    const brandRowIndex = rows.length;
    rows.push([
      brand.name,
      brand.niche,
      dateSerial(brand.bestActiveDate),
      hasBrief(brand.brief) ? "View brief" : "No brief",
      "",
      "Brand",
      brand.name,
      "",
      updateTimestampWritten ? "" : updatedAt,
    ]);
    updateTimestampWritten = true;
    for (const agency of brand.agencies) {
      const agencyRowIndex = rows.length;
      rows.push([
        `↳ ${agency.agency || "Agency not identified"}`,
        "",
        dateSerial(agency.contactActiveDate),
        agency.topContact ? `Top contact: ${agency.topContact}` : "",
        "",
        "Agency",
        brand.name,
        agency.agency,
      ]);
      const contactStart = rows.length;
      for (const contact of agency.contacts) {
        rows.push([
          `↳ ${contact.contact}`,
          "",
          dateSerial(contact.lastActiveDate),
          "",
          contact.notes,
          "Contact",
          brand.name,
          agency.agency,
        ]);
      }
      if (rows.length > contactStart) {
        innerGroups.push({
          sheetId,
          dimension: "ROWS",
          startIndex: contactStart,
          endIndex: rows.length,
        });
      }
      if (agencyRowIndex + 1 === rows.length) continue;
    }
    if (rows.length > brandRowIndex + 1) {
      outerGroups.push({
        sheetId,
        dimension: "ROWS",
        startIndex: brandRowIndex + 1,
        endIndex: rows.length,
      });
    }
  }
  return { rows, outerGroups, innerGroups };
}

function formatRequests(sheetMap, counts) {
  const activeId = sheetMap.get("Active Contacts").properties.sheetId;
  const requests = [];
  for (const title of TITLES) {
    const sheetId = sheetMap.get(title).properties.sheetId;
    const rows = counts[title];
    const cols = columnCount(title);
    requests.push(
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: cols },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 1, green: 1, blue: 1 },
              textFormat: { foregroundColor: { red: 0.12, green: 0.15, blue: 0.2 }, fontSize: 10 },
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.08, green: 0.12, blue: 0.2 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
              horizontalAlignment: "LEFT",
              verticalAlignment: "MIDDLE",
              wrapStrategy: "WRAP",
            },
          },
          fields: "userEnteredFormat",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 38 },
          fields: "pixelSize",
        },
      },
      {
        setBasicFilter: {
          filter: { range: { sheetId, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: cols } },
        },
      },
    );
  }

  requests.push(
    {
      repeatCell: {
        range: { sheetId: activeId, startRowIndex: 1, endRowIndex: counts["Active Contacts"], startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd mmm yyyy" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    conditionalRule(activeId, counts["Active Contacts"], '=$F2="Brand"', {
      backgroundColor: { red: 0.88, green: 0.94, blue: 1 },
      textFormat: { bold: true, foregroundColor: { red: 0.05, green: 0.2, blue: 0.38 } },
    }),
    conditionalRule(activeId, counts["Active Contacts"], '=$F2="Agency"', {
      backgroundColor: { red: 0.95, green: 0.97, blue: 1 },
      textFormat: { bold: true, foregroundColor: { red: 0.16, green: 0.27, blue: 0.42 } },
    }),
    dimensionSize(activeId, "COLUMNS", 0, 1, 285),
    dimensionSize(activeId, "COLUMNS", 1, 2, 150),
    dimensionSize(activeId, "COLUMNS", 2, 3, 125),
    dimensionSize(activeId, "COLUMNS", 3, 4, 245),
    dimensionSize(activeId, "COLUMNS", 4, 5, 190),
    {
      updateDimensionProperties: {
        range: { sheetId: activeId, dimension: "COLUMNS", startIndex: 5, endIndex: 9 },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
    {
      repeatCell: {
        range: { sheetId: activeId, startRowIndex: 1, endRowIndex: counts["Active Contacts"], startColumnIndex: 3, endColumnIndex: 5 },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat.wrapStrategy",
      },
    },
  );

  addTableFormatting(requests, sheetMap.get("Agencies").properties.sheetId, counts.Agencies, 3, [230, 190, 265, 130]);
  addTableFormatting(requests, sheetMap.get("Contacts").properties.sheetId, counts.Contacts, 3, [230, 190, 270, 130, 220]);
  addTableFormatting(requests, sheetMap.get("Briefs").properties.sheetId, counts.Briefs, 10, [220, 155, 140, 170, 120, 110, 100, 180, 180, 300, 125, 175, 250]);
  return requests;
}

function addTableFormatting(requests, sheetId, rowCount, dateColumn, widths) {
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: dateColumn, endColumnIndex: dateColumn + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd mmm yyyy" } } },
      fields: "userEnteredFormat.numberFormat",
    },
  });
  widths.forEach((width, index) => requests.push(dimensionSize(sheetId, "COLUMNS", index, index + 1, width)));
}

function conditionalRule(sheetId, rowCount, formula, format) {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 9 }],
        booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: formula }] }, format },
      },
    },
  };
}

function dimensionSize(sheetId, dimension, startIndex, endIndex, pixelSize) {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension, startIndex, endIndex },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  };
}

async function batchRequests(client, requests, size) {
  for (let index = 0; index < requests.length; index += size) {
    await client.batchUpdate(requests.slice(index, index + size));
  }
}

function dateSerial(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

function correctLegacyFallbackDates(data, backupRows) {
  const legacyKeys = new Set(
    backupRows
      .slice(1)
      .filter((row) => row[0] && row[2] && row[3] === "01 Nov 2025")
      .map((row) => contactKey(row[0], row[2])),
  );
  const fix = (contact) => {
    if (contact.lastActiveDate === "2025-10-31" && legacyKeys.has(contactKey(contact.brand, contact.contact))) {
      contact.lastActiveDate = "2025-11-01";
    }
  };
  data.contacts.forEach(fix);
  for (const brand of data.brands) {
    for (const agency of brand.agencies) {
      agency.contacts.forEach(fix);
      agency.contacts.sort((a, b) => new Date(b.lastActiveDate) - new Date(a.lastActiveDate));
      agency.topContact = agency.contacts[0]?.contact ?? "";
      agency.contactActiveDate = agency.contacts[0]?.lastActiveDate ?? "";
    }
    brand.agencies.sort((a, b) => new Date(b.contactActiveDate) - new Date(a.contactActiveDate));
    brand.bestActiveDate = brand.agencies[0]?.contactActiveDate || brand.bestActiveDate;
  }
  data.brands.sort((left, right) => {
    const activity = new Date(right.bestActiveDate) - new Date(left.bestActiveDate);
    if (activity) return activity;
    const brief = Number(hasBrief(right.brief)) - Number(hasBrief(left.brief));
    return brief || left.name.localeCompare(right.name);
  });
  data.agencies = data.brands.flatMap((brand) =>
    brand.agencies.map(({ contacts: _contacts, ...agency }) => agency),
  );
}

function contactKey(brand, contact) {
  return `${String(brand).trim().toLowerCase()}::${String(contact).trim().toLowerCase()}`;
}

function hasBrief(brief) {
  return [brief.platforms, brief.creatorSize, brief.location, brief.language, brief.creatorAge, brief.gender, brief.niches, brief.creatorStyle, brief.audience]
    .some((value) => String(value ?? "").trim());
}

function columnCount(title) {
  return { "Active Contacts": 9, Agencies: 4, Contacts: 5, Briefs: 13 }[title];
}
