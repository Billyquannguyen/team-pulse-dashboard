#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import {
  createSheetsClient,
  createSheetsTokenProvider,
  loadEnvFiles,
  normalizeKey,
} from "./runner.mjs";

const SPREADSHEET_ID = "1U-y2oiob1uenmvNiRGMILhmWWORMTye2mBxi2mgVxvs";
const INPUT = ".brand-contact-scan/active-contact-scan-result.json";
const OUTPUT = ".brand-contact-scan/active-contact-scan-reviewed.json";

// Only corrections that are clear from the email-derived text are automatic.
// Existing sheet brands are never removed or renamed by this review pass.
const RENAME_NEW_BRANDS = new Map(
  Object.entries({
    "Brand SHEGLAM HAIR One Touch Airflow Styler Pro": "Sheglam",
    "Chaptly Team": "Chaptly",
    "ONE PIECE promotional": "ONE PIECE",
    "Glacier Fresh Marketing": "Glacier Fresh",
    "DERMAL SEOUL FACE DERMAL SEOUL FACE wants you wanna": "DERMAL SEOUL FACE",
    "Embark on a magical adventure with AliExpress": "AliExpress",
    "AliExpress for UK TikTok Market": "AliExpress",
    "Customize Your Keyboard with Facemoji": "Facemoji",
    "Echo pro TikTok Video": "Echo Pro",
    "inGreens for Jord": "inGreens",
    "Jeeeun Comfort Pants for Hcake": "Jeeeun",
    "kyr4mari3 with Duet": "DUET dating",
    "lydia robberts for Promoting Dola": "Dola AI",
    "P.CALM for YesStyle August": "P.CALM",
    "Spotify for Your Channel": "Spotify",
  }).map(([from, to]) => [normalizeKey(from), to]),
);

const REMOVE_NEW_BRANDS = new Set(
  [
    "Mom Creator",
    "Big Miko creator",
    "Rising Suns Agency",
    "Jeeeun Women's Comfortable Casual Pants for Idil",
    "Earn with Our 3-in-1 Waterproof Phone Cases",
    "Judi Media",
    "IDH Media Limited",
    "Creed Media",
    "Likeable Media",
    "Casa Media",
    "YTK Media",
    "Creator Connect",
    "Tech Creator",
    "Fun POV Speaking Video for an Instagram Analytics",
    "Crispin LLC",
    "DR",
    "Spanish",
    "Essencerlab",
    "AI Video Tool",
    "casual lifestyle video",
    "Darkroom agency",
    "kyr4mari3 for Promoting lip balm",
    "Looking for Your 3-Video Package Rate",
    "Secure Your Spot",
    "Whatabar Linko Review for henripalms",
  ].map(normalizeKey),
);

loadEnvFiles([".env", ".env.local", ".env.brand-contact-scan", ".env.opportunity-ingestion"]);

const config = {
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: String(process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  spreadsheetId: SPREADSHEET_ID,
};
if (!config.serviceAccountEmail || !config.privateKey) {
  throw new Error("Missing Google Sheets service account settings.");
}

const sheets = createSheetsClient(config, createSheetsTokenProvider(config));
const [rawResult, active] = await Promise.all([
  readFile(INPUT, "utf8"),
  sheets.valuesGet("'Active Contacts'!A1:H2000"),
]);
const result = JSON.parse(rawResult);
const rows = active.values ?? [];
const headers = rows[0] ?? [];
const typeIndex = headers.indexOf("Record Type");
const brandIndex = headers.indexOf("Brand");
const legacyNames = new Map(
  rows
    .slice(1)
    .filter((row) => row[typeIndex] === "Brand" && row[brandIndex])
    .map((row) => [normalizeKey(row[brandIndex]), row[brandIndex]]),
);

const newNames = result.brands
  .map((brand) => brand.name)
  .filter((name) => !legacyNames.has(normalizeKey(name)));
const suspicious = newNames
  .map((name) => ({ name, reasons: suspectReasons(name) }))
  .filter((item) => item.reasons.length)
  .sort((a, b) => a.name.localeCompare(b.name));

if (!process.argv.includes("--write")) {
  console.log(
    JSON.stringify(
      {
        existingBrands: legacyNames.size,
        scannedBrands: result.brands.length,
        newBrands: newNames.length,
        explicitRenames: [...RENAME_NEW_BRANDS.entries()],
        explicitRemovals: [...REMOVE_NEW_BRANDS],
        suspicious,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const decisions = new Map();
for (const brand of result.brands) {
  const key = normalizeKey(brand.name);
  if (legacyNames.has(key)) decisions.set(key, legacyNames.get(key));
  else if (REMOVE_NEW_BRANDS.has(key)) decisions.set(key, "");
  else decisions.set(key, RENAME_NEW_BRANDS.get(key) ?? brand.name);
}

const keptBrands = new Map();
for (const brand of result.brands) {
  const targetName = decisions.get(normalizeKey(brand.name));
  if (!targetName) continue;
  const targetKey = normalizeKey(targetName);
  const renamed = renameBrandTree(brand, targetName);
  const current = keptBrands.get(targetKey);
  keptBrands.set(targetKey, current ? mergeBrands(current, renamed) : renamed);
}

const brands = [...keptBrands.values()]
  .map(rebuildBrand)
  .sort(compareBrands);
const contacts = brands.flatMap((brand) =>
  brand.agencies.flatMap((agency) => agency.contacts),
);
const agencies = brands.flatMap((brand) =>
  brand.agencies.map(({ contacts: _contacts, ...agency }) => agency),
);
const briefs = brands.map((brand) => ({ ...brand.brief, brand: brand.name }));
const reviewed = {
  ...result,
  report: {
    ...result.report,
    review: {
      legacyBrandsPreserved: legacyNames.size,
      removedNewBrands: [...REMOVE_NEW_BRANDS].filter((key) => decisions.has(key)).length,
      renamedNewBrands: [...RENAME_NEW_BRANDS].filter(([key]) => decisions.has(key)).length,
      finalBrands: brands.length,
      finalAgencies: agencies.length,
      finalContacts: contacts.length,
      finalBriefs: briefs.filter(hasBrief).length,
    },
  },
  brands,
  agencies,
  contacts,
  briefs,
};
await writeFile(OUTPUT, JSON.stringify(reviewed, null, 2));
console.log(JSON.stringify(reviewed.report.review, null, 2));
console.log(`Saved reviewed result: ${OUTPUT}`);

function renameBrandTree(brand, name) {
  return {
    ...brand,
    name,
    brief: { ...brand.brief, brand: name },
    agencies: brand.agencies.map((agency) => ({
      ...agency,
      brand: name,
      contacts: agency.contacts.map((contact) => ({ ...contact, brand: name })),
    })),
  };
}

function mergeBrands(left, right) {
  const agencies = new Map();
  for (const agency of [...left.agencies, ...right.agencies]) {
    const key = normalizeKey(agency.agency);
    const current = agencies.get(key);
    if (!current) {
      agencies.set(key, agency);
      continue;
    }
    const contacts = new Map(
      [...current.contacts, ...agency.contacts].map((contact) => [contact.contact.toLowerCase(), contact]),
    );
    agencies.set(key, { ...current, contacts: [...contacts.values()] });
  }
  const brief = latestBrief(left.brief, right.brief);
  return {
    ...left,
    niche: left.niche || right.niche,
    brief,
    hasBrief: hasBrief(brief),
    agencies: [...agencies.values()],
  };
}

function rebuildBrand(brand) {
  const agencies = brand.agencies
    .map((agency) => {
      const contacts = [...agency.contacts].sort(
        (a, b) => dateScore(b.lastActiveDate) - dateScore(a.lastActiveDate),
      );
      return {
        ...agency,
        contacts,
        topContact: contacts[0]?.contact ?? "",
        contactActiveDate: contacts[0]?.lastActiveDate ?? "",
      };
    })
    .sort((a, b) => dateScore(b.contactActiveDate) - dateScore(a.contactActiveDate));
  const bestActiveDate = agencies[0]?.contactActiveDate || brand.bestActiveDate || "2025-11-01";
  return { ...brand, agencies, bestActiveDate, hasBrief: hasBrief(brand.brief) };
}

function compareBrands(left, right) {
  const activity = dateScore(right.bestActiveDate) - dateScore(left.bestActiveDate);
  if (activity) return activity;
  const brief = Number(right.hasBrief) - Number(left.hasBrief);
  return brief || left.name.localeCompare(right.name);
}

function latestBrief(left, right) {
  if (!hasBrief(left)) return right;
  if (!hasBrief(right)) return left;
  return dateScore(right.briefDate) > dateScore(left.briefDate) ? right : left;
}

function hasBrief(brief) {
  return [
    brief?.platforms,
    brief?.creatorSize,
    brief?.location,
    brief?.language,
    brief?.creatorAge,
    brief?.gender,
    brief?.niches,
    brief?.creatorStyle,
    brief?.audience,
  ].some((value) => String(value ?? "").trim());
}

function dateScore(value) {
  const score = new Date(value).getTime();
  return Number.isFinite(score) ? score : 0;
}

function suspectReasons(name) {
  const reasons = [];
  const key = normalizeKey(name);
  if (REMOVE_NEW_BRANDS.has(key)) reasons.push("explicit removal");
  if (RENAME_NEW_BRANDS.has(key)) reasons.push(`rename to ${RENAME_NEW_BRANDS.get(key)}`);
  if (name.length > 45) reasons.push("long phrase");
  if (/\b(?:creator|influencer|agency|marketing|media|team)\b/i.test(name)) reasons.push("role or agency term");
  if (/\b(?:for|with|our|your|video|promotional|collaboration|campaign)\b/i.test(name)) reasons.push("sentence or campaign term");
  if (/^(?:dr|spanish|creator|brand|agency)$/i.test(name.trim())) reasons.push("generic or ambiguous");
  return [...new Set(reasons)];
}
