#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  GENERIC_EMAIL_DOMAINS,
  SOURCE_ORG_HINTS,
  createGmailClient,
  createGmailTokenProvider,
  createSheetsClient,
  createSheetsTokenProvider,
  domainFromEmail,
  extractBrandContact,
  loadEnvFiles,
  normalizeGmailMessage,
  normalizeKey,
  parseSender,
  rootDomainName,
  toTitleCase,
} from "./runner.mjs";

const SPREADSHEET_ID = "1U-y2oiob1uenmvNiRGMILhmWWORMTye2mBxi2mgVxvs";
const DEFAULT_QUERY =
  'in:inbox -in:spam -in:trash -from:quan@stride-social.com {campaign collaboration partnership creator influencer sponsorship paid "brand brief" booking collab "creator campaign" "influencer campaign" "brand partnership" UGC KOL gifted ambassador casting}';
const OUTPUT_DIR = path.join(process.cwd(), ".brand-contact-scan");
const RESULT_FILE = path.join(OUTPUT_DIR, "active-contact-scan-result.json");
const REPORT_FILE = path.join(OUTPUT_DIR, "active-contact-scan-report.json");
const FALLBACK_DATE = "2025-11-01";

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

const INTERNAL_DOMAINS = new Set(["stride-social.com", "katlasmedia.com"]);
const SERVICE_DOMAINS = new Set([
  "gusto.com",
  "google.com",
  "calendly.com",
  "stripe.com",
  "docusign.net",
  "dropbox.com",
  "notion.so",
  "slack.com",
  "beehiiv.com",
  "substack.com",
]);
const GENERIC_BRAND_NAMES = new Set([
  "agency",
  "brand",
  "campaign",
  "finance",
  "marketing",
  "partnership",
  "creator",
  "influencer",
  "us",
  "uk",
]);
const KNOWN_AGENCY_ROOTS = new Set([
  "ahacreators-connect",
  "ahacreators-join",
  "amagency",
  "baocommunications",
  "biobyai",
  "brandnetworkinghub",
  "bwmcanada",
  "contentlab",
  "createsz",
  "creafluentor",
  "creatordeck",
  "creatoriq",
  "crevasse",
  "filify",
  "gmvmax",
  "growmaxvalue",
  "gimc-hk",
  "influencer",
  "kashtm",
  "lessie",
  "mail-biz",
  "msg-biz",
  "noxartist",
  "noxinfluencer",
  "perkinggroup",
  "publicrecordsmusic",
  "ssg",
  "ssgmcn",
  "tatam",
  "tec-do",
  "themesh",
  "wkmkt",
]);
const AGENCY_HINTS = [
  ...SOURCE_ORG_HINTS,
  "advertising",
  "communications",
  "creative",
  "digital",
  "group",
  "influence",
  "mcn",
  "outreach",
  "social",
];
GENERIC_EMAIL_DOMAINS.add("libero.it");
const PLATFORM_PATTERNS = [
  ["TikTok", /\btik\s*tok\b/i],
  ["Instagram", /\binstagram\b|\binsta\b/i],
  ["YouTube", /\byou\s*tube\b/i],
];
const LANGUAGE_PATTERNS = [
  ["English", /\benglish(?:-speaking)?\b/i],
  ["French", /\bfrench(?:-speaking)?\b|\bfrancophone\b/i],
  ["German", /\bgerman(?:-speaking)?\b/i],
  ["Spanish", /\bspanish(?:-speaking)?\b/i],
  ["Italian", /\bitalian(?:-speaking)?\b/i],
  ["Portuguese", /\bportuguese(?:-speaking)?\b/i],
  ["Korean", /\bkorean(?:-speaking)?\b/i],
  ["Japanese", /\bjapanese(?:-speaking)?\b/i],
  ["Arabic", /\barabic(?:-speaking)?\b/i],
  ["Dutch", /\bdutch(?:-speaking)?\b/i],
];
const COUNTRY_PATTERNS = [
  ["United Kingdom", /\b(?:uk|united kingdom|britain|british)\b/i],
  ["United States", /\b(?:us|usa|united states|american)\b/i],
  ["France", /\bfrance|french creators?\b/i],
  ["Germany", /\bgermany|german creators?\b/i],
  ["Spain", /\bspain|spanish creators?\b/i],
  ["Italy", /\bitaly|italian creators?\b/i],
  ["Canada", /\bcanada|canadian creators?\b/i],
  ["Australia", /\baustralia|australian creators?\b/i],
  ["Europe", /\beurope|european creators?\b/i],
  ["South Korea", /\bsouth korea|korean creators?\b/i],
  ["Japan", /\bjapan|japanese creators?\b/i],
  ["United Arab Emirates", /\buae|united arab emirates|dubai\b/i],
];
const NICHE_PATTERNS = [
  ["beauty", /\bbeauty\b/i],
  ["skincare", /\bskin\s*care\b/i],
  ["makeup", /\bmake\s*up\b|\bcosmetics?\b/i],
  ["fashion", /\bfashion\b|\bstreetwear\b/i],
  ["lifestyle", /\blifestyle\b/i],
  ["wellness", /\bwellness\b|\bwellbeing\b/i],
  ["fitness", /\bfitness\b|\bgym\b|\bathlete\b/i],
  ["technology", /\btech(?:nology)?\b|\bgadgets?\b/i],
  ["gaming", /\bgaming\b|\bgamers?\b/i],
  ["travel", /\btravel\b/i],
  ["food", /\bfood(?:ie)?\b|\bcooking\b/i],
  ["parenting", /\bparent(?:ing)?\b|\bmom\b|\bmum\b|\bbaby\b/i],
  ["home", /\bhome\b|\binteriors?\b/i],
  ["education", /\beducation\b|\bstudent\b|\blearning\b/i],
  ["finance", /\bfinance\b|\binvesting\b|\bmoney\b/i],
  ["music", /\bmusic\b|\bsinger\b|\bdance\b/i],
  ["books", /\bbooks?\b|\bbooktok\b|\breading\b/i],
];
const STYLE_PATTERNS = [
  ["authentic", /\bauthentic\b/i],
  ["educational", /\beducational\b|\binformative\b/i],
  ["conversational", /\bconversational\b/i],
  ["relatable", /\brelatable\b/i],
  ["storytelling", /\bstory\s*telling\b/i],
  ["comedic", /\bcomedic\b|\bfunny\b|\bhumou?r\b/i],
  ["aesthetic", /\baesthetic\b/i],
  ["polished", /\bpolished\b|\bhigh[- ]quality\b/i],
  ["natural", /\bnatural\b|\borganic content\b/i],
  ["high-energy", /\bhigh[- ]energy\b|\benergetic\b/i],
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles([".env", ".env.local", ".env.brand-contact-scan", ".env.opportunity-ingestion"]);
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options);
  const gmail = createGmailClient(createGmailTokenProvider(config));
  const sheets = createSheetsClient(config, createSheetsTokenProvider(config));
  const profile = await gmail.profile();
  const profileDomain = domainFromEmail(profile.emailAddress ?? "");
  if (profileDomain) INTERNAL_DOMAINS.add(profileDomain);

  const existing = await loadExistingSheet(sheets);
  const messages = await scanInbox(gmail, config);
  const result = await buildResult({ gmail, messages, existing, options });

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(RESULT_FILE, JSON.stringify(result, null, 2));
  await writeFile(REPORT_FILE, JSON.stringify(result.report, null, 2));

  console.log(`Saved normalized scan result: ${RESULT_FILE}`);
  console.log(JSON.stringify(result.report, null, 2));
}

function parseArgs(args) {
  const options = { maxEmails: 0, pageSize: 100, concurrency: 5, query: DEFAULT_QUERY };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--max-emails") {
      options.maxEmails = Number(next);
      index += 1;
    } else if (arg === "--page-size") {
      options.pageSize = Number(next);
      index += 1;
    } else if (arg === "--concurrency") {
      options.concurrency = Number(next);
      index += 1;
    } else if (arg === "--query") {
      options.query = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function loadConfig(options) {
  const required = [
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  return {
    gmailClientId: process.env.GMAIL_CLIENT_ID,
    gmailClientSecret: process.env.GMAIL_CLIENT_SECRET,
    gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: String(process.env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, "\n"),
    spreadsheetId: SPREADSHEET_ID,
    query: options.query,
    maxEmails: Number.isFinite(options.maxEmails) ? Math.max(0, options.maxEmails) : 0,
    pageSize: clamp(options.pageSize, 1, 500),
    concurrency: clamp(options.concurrency, 1, 8),
  };
}

async function loadExistingSheet(sheets) {
  const [active, agencies, contacts, briefs] = await Promise.all([
    sheets.valuesGet("'Active Contacts'!A1:H969"),
    sheets.valuesGet("'Agencies'!A1:D500"),
    sheets.valuesGet("'Contacts'!A1:E1000"),
    sheets.valuesGet("'Briefs'!A1:M500"),
  ]);
  const activeTable = table(active.values ?? []);
  const agencyTable = table(agencies.values ?? []);
  const contactTable = table(contacts.values ?? []);
  const briefTable = table(briefs.values ?? []);
  const brands = new Map();

  for (const row of activeTable.rows) {
    if (cell(activeTable, row, "Record Type") !== "Brand") continue;
    const name = cell(activeTable, row, "Brand") || row[0];
    if (!name) continue;
    brands.set(brandKey(name), {
      name,
      niche: cell(activeTable, row, "Niche"),
      fallbackBestActiveDate: cell(activeTable, row, "Best / Last Active") || FALLBACK_DATE,
    });
  }

  const contactsByBrandAndEmail = new Map();
  for (const row of contactTable.rows) {
    const brand = cell(contactTable, row, "Brand");
    const contact = cell(contactTable, row, "Contact Email / WhatsApp");
    if (!brand || !contact) continue;
    const record = {
      brand,
      agency: cell(contactTable, row, "Agency"),
      contact,
      lastActiveDate: isoDate(cell(contactTable, row, "Last Active Date")) || FALLBACK_DATE,
      notes: cell(contactTable, row, "Notes"),
      matchedDuringScan: false,
    };
    contactsByBrandAndEmail.set(contactKey(brand, contact), record);
  }

  const briefsByBrand = new Map();
  for (const row of briefTable.rows) {
    const brand = cell(briefTable, row, "Brand");
    if (!brand) continue;
    const brief = {
      brand,
      platforms: cell(briefTable, row, "Platforms"),
      creatorSize: cell(briefTable, row, "Creator Size"),
      location: cell(briefTable, row, "Location"),
      language: cell(briefTable, row, "Language"),
      creatorAge: cell(briefTable, row, "Creator Age"),
      gender: cell(briefTable, row, "Gender"),
      niches: cell(briefTable, row, "Niches"),
      creatorStyle: cell(briefTable, row, "Creator Style"),
      audience: cell(briefTable, row, "Audience"),
      briefDate: isoDate(cell(briefTable, row, "Brief Date")),
      sourceAgency: cell(briefTable, row, "Source Agency"),
      sourceEmail: cell(briefTable, row, "Source Email"),
      threadId: "",
    };
    briefsByBrand.set(brandKey(brand), brief);
  }

  return { brands, contactsByBrandAndEmail, briefsByBrand, agencyRows: agencyTable.rows.length };
}

async function scanInbox(gmail, config) {
  const messages = [];
  let pageToken = "";
  let pages = 0;
  do {
    const page = await gmail.searchMessages({
      query: config.query,
      maxResults: config.pageSize,
      pageToken: pageToken || undefined,
    });
    let ids = (page.messages ?? []).map((message) => message.id).filter(Boolean);
    if (config.maxEmails) ids = ids.slice(0, Math.max(0, config.maxEmails - messages.length));
    const batch = await mapWithConcurrency(ids, config.concurrency, (id) => gmail.getMessage(id));
    messages.push(...batch);
    pages += 1;
    pageToken = page.nextPageToken ?? "";
    console.log(
      `Read ${messages.length} inbox messages across ${pages} page${pages === 1 ? "" : "s"}.`,
    );
  } while (pageToken && (!config.maxEmails || messages.length < config.maxEmails));
  return messages.map(normalizeGmailMessage);
}

async function buildResult({ gmail, messages, existing, options }) {
  const knownBrands = existing.brands;
  const threadBrands = new Map();
  const parsed = messages.map((email) => {
    const sender = parseSender(email.from);
    const relevant = isRelevantIncoming(email, sender);
    if (!relevant) return { email, sender, extraction: null, brand: "", relevant: false };
    const extraction = extractBrandContact(email);
    const explicitBrand = inferBrandFromSubject(email.subject);
    const extractedBrand = cleanBrandAlias(extraction.ok ? extraction.contact.brandName : "");
    const existingExtractedBrand = matchExistingBrandCandidate(extractedBrand, knownBrands);
    const matchedKnown = findKnownBrand(email, knownBrands);
    const directDomainBrand = inferDirectBrandFromDomain(sender.email);
    let brand = explicitBrand || matchedKnown?.name || existingExtractedBrand || directDomainBrand;
    const senderRoot = rootDomainName(domainFromEmail(sender.email));
    if (
      explicitBrand &&
      KNOWN_AGENCY_ROOTS.has(senderRoot) &&
      compactKey(explicitBrand).includes(compactKey(senderRoot)) &&
      /^(?:re:\s*)?(?:stride social|team billion|katlas)\s+x\s+/i.test(email.subject)
    ) {
      brand = "";
    }
    if (isBadInferredBrand(brand)) brand = "";
    brand = canonicalBrandName(brand, knownBrands);
    if (GENERIC_BRAND_NAMES.has(brandKey(brand))) brand = "";
    if (brand) {
      if (!threadBrands.has(email.threadId)) threadBrands.set(email.threadId, new Set());
      threadBrands.get(email.threadId).add(brand);
    }
    return { email, sender, extraction, brand, relevant: true };
  });

  for (const item of parsed) {
    if (item.brand || !item.relevant) continue;
    const threadSet = threadBrands.get(item.email.threadId);
    if (threadSet?.size === 1) item.brand = [...threadSet][0];
  }

  let skippedMissingBrand = 0;
  let skippedInvalidSender = 0;
  let matchedMessages = 0;
  let newContacts = 0;
  let updatedContacts = 0;
  let newBrands = 0;
  let briefOccurrences = 0;
  const extractionSamples = [];

  for (const item of parsed) {
    const senderEmail = String(item.sender.email ?? "")
      .trim()
      .toLowerCase();
    if (!item.brand) {
      skippedMissingBrand += 1;
      continue;
    }
    if (!isValidExternalEmail(senderEmail)) {
      skippedInvalidSender += 1;
      continue;
    }
    matchedMessages += 1;
    const brandId = brandKey(item.brand);
    if (!knownBrands.has(brandId)) {
      knownBrands.set(brandId, {
        name: item.brand,
        niche: inferBrandNiche(item.email),
        fallbackBestActiveDate: "",
      });
      newBrands += 1;
    }
    const brandRecord = knownBrands.get(brandId);
    const agency = inferAgency(item.brand, senderEmail);
    const key = contactKey(brandRecord.name, senderEmail);
    const activityDate = isoDate(item.email.date);
    const existingContact = existing.contactsByBrandAndEmail.get(key);
    if (existingContact) {
      if (!existingContact.matchedDuringScan) {
        existingContact.lastActiveDate = activityDate;
        existingContact.matchedDuringScan = true;
        updatedContacts += 1;
      } else if (dateScore(activityDate) > dateScore(existingContact.lastActiveDate)) {
        existingContact.lastActiveDate = activityDate;
      }
      if (!existingContact.agency && agency) existingContact.agency = agency;
    } else {
      existing.contactsByBrandAndEmail.set(key, {
        brand: brandRecord.name,
        agency,
        contact: senderEmail,
        lastActiveDate: activityDate,
        notes: "",
        matchedDuringScan: true,
      });
      newContacts += 1;
    }

    const brief = extractBrief(item.email);
    if (brief) {
      briefOccurrences += 1;
      const current = existing.briefsByBrand.get(brandId);
      if (!current?.briefDate || dateScore(brief.briefDate) > dateScore(current.briefDate)) {
        existing.briefsByBrand.set(brandId, {
          brand: brandRecord.name,
          ...brief,
          sourceAgency: agency,
          sourceEmail: senderEmail,
          threadId: item.email.threadId,
        });
      }
    }

    if (extractionSamples.length < 30) {
      extractionSamples.push({
        date: activityDate,
        senderEmail,
        subject: item.email.subject,
        brand: brandRecord.name,
        agency,
        hasBrief: Boolean(brief),
      });
    }
  }

  const movedToWhatsapp = options.maxEmails
    ? 0
    : await markWhatsappMoves(gmail, existing.briefsByBrand, existing.contactsByBrandAndEmail);
  const contacts = [...existing.contactsByBrandAndEmail.values()].map(
    ({ matchedDuringScan, ...record }) => record,
  );
  const briefRows = [...knownBrands.values()].map(
    (brand) =>
      existing.briefsByBrand.get(brandKey(brand.name)) ?? {
        brand: brand.name,
        ...emptyBrief(),
        threadId: "",
      },
  );
  const agencies = buildAgencies(contacts);
  const brandRecords = buildBrands([...knownBrands.values()], contacts, agencies, briefRows);

  const report = {
    query: DEFAULT_QUERY,
    scannedAt: new Date().toISOString(),
    messagesScanned: messages.length,
    matchedMessages,
    skippedMissingBrand,
    skippedInvalidSender,
    brands: brandRecords.length,
    newBrands,
    contacts: contacts.length,
    newContacts,
    updatedContacts,
    agencyRelationships: agencies.length,
    briefOccurrences,
    latestBriefsKept: briefRows.filter(hasBrief).length,
    movedToWhatsapp,
    extractionSamples,
  };

  return { report, brands: brandRecords, agencies, contacts, briefs: briefRows.map(stripThreadId) };
}

function findKnownBrand(email, brands) {
  const text = normalizeKey(
    `${email.subject}\n${email.snippet}\n${currentMessageBody(email.body)}`,
  );
  const matches = [...brands.values()]
    .filter((brand) => {
      const key = normalizeKey(brand.name);
      return key.length >= 4 && !GENERIC_BRAND_NAMES.has(key) && ` ${text} `.includes(` ${key} `);
    })
    .sort((left, right) => right.name.length - left.name.length);
  return matches[0] ?? null;
}

function isRelevantIncoming(email, sender) {
  const subject = String(email.subject ?? "");
  const domain = domainFromEmail(sender.email);
  if (domainInSet(domain, SERVICE_DOMAINS)) return false;
  if (/\b.+\s+x\s+(?:stride social|team billion|katlas)(?::|\b).*secure deals/i.test(subject)) {
    return false;
  }
  if (
    /\b(?:invoice|payment|payroll|receipt|calendar invitation|password reset|verify your email)\b/i.test(
      subject,
    )
  ) {
    return false;
  }
  const text = `${subject}\n${email.snippet}\n${currentMessageBody(email.body)}`;
  return /\b(campaign|collab(?:oration)?|partnership|creator|influencer|sponsor(?:ship)?|brief|booking|ugc|kol|gift(?:ed|ing)?|ambassador|casting|promotion)\b/i.test(
    text,
  );
}

function inferBrandFromSubject(subjectValue) {
  const subject = String(subjectValue ?? "")
    .replace(/^(?:re|fw|fwd)\s*:\s*/i, "")
    .trim();
  const patterns = [
    /^\s*\[[^\]]*?(?:\||\/)\s*([^\]]{2,55})\]/i,
    /^\s*\[\s*([^\]]{2,45})\s*\]\s*(?:tik\s*tok|instagram|you\s*tube|paid|creator|influencer|collab)/i,
    /^[《<]\s*([^》>]{2,45}?)\s+(?:promotional|campaign|collab|partnership)[^》>]*[》>]/i,
    /\b(?:paid\s+)?collab(?:oration)?(?:\s+opportunity)?\s+(?:with|for)\s+([^|:,[\]–—-]{2,55})/i,
    /\b(?:paid\s+)?collab(?:oration)?\s*[–—-]\s*([^|:,[\]]{2,55})/i,
    /\b(?:campaign|partnership|promotion)\s+(?:with|for|from)\s+([^|:,[\]–—-]{2,55})/i,
    /\bsend you something from\s+([^|:,[\]–—-]{2,55})/i,
    /^([^|:,[\]–—-]{2,45})\s+for\s+@?[a-z0-9_.-]+,\s+a creator opportunity/i,
    /^(?:stride social|team billion|katlas)\s+x\s+([^:|]{2,55})\s*:/i,
    /^[^:|]{2,55}\s+x\s+([^:|]{2,55})\s+(?:campaign|collab|partnership)\b/i,
  ];
  for (const pattern of patterns) {
    const match = subject.match(pattern);
    const candidate = cleanSubjectBrand(match?.[1] ?? "");
    if (candidate && !GENERIC_BRAND_NAMES.has(brandKey(candidate))) return candidate;
  }
  return "";
}

function cleanSubjectBrand(value) {
  return String(value ?? "")
    .replace(/[^\p{L}\p{N}&'.+ -]+/gu, " ")
    .replace(/\s+(?:app|brand)\s*$/i, "")
    .replace(/\b(?:campaign|collaboration|collab|partnership|opportunity|invitation)\b.*$/i, "")
    .replace(/^[\s:|,-]+|[\s:|,!.?;-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBrandAlias(value) {
  return String(value ?? "")
    .replace(/\s+(?:promotional|deliverables?|campaign details?)\s*$/i, "")
    .replace(/[^\p{L}\p{N}&'.+ -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBadInferredBrand(value) {
  const normalized = brandKey(value);
  return (
    !normalized ||
    GENERIC_BRAND_NAMES.has(normalized) ||
    /^(free|paid|new|special|your|our|a|the)\b/i.test(normalized) ||
    /\b(?:a paid|paid collab|collaboration opportunity)$/.test(normalized)
  );
}

function inferDirectBrandFromDomain(email) {
  const domain = domainFromEmail(email);
  if (!domain || GENERIC_EMAIL_DOMAINS.has(domain) || domainInSet(domain, SERVICE_DOMAINS)) {
    return "";
  }
  const root = rootDomainName(domain);
  if (!root || KNOWN_AGENCY_ROOTS.has(root)) return "";
  if (AGENCY_HINTS.some((hint) => root.includes(hint))) return "";
  return toTitleCase(root.replace(/[-_.]+/g, " "));
}

function canonicalBrandName(value, knownBrands) {
  if (!value) return "";
  const exact = knownBrands.get(brandKey(value));
  if (exact) return exact.name;
  const compact = compactKey(value);
  const compactMatches = [...knownBrands.values()].filter(
    (brand) => compactKey(brand.name) === compact,
  );
  if (compactMatches.length === 1) return compactMatches[0].name;
  const normalizedValue = normalizeKey(value);
  const prefixMatches = [...knownBrands.values()]
    .filter((brand) => normalizedValue.startsWith(`${normalizeKey(brand.name)} `))
    .sort((left, right) => right.name.length - left.name.length);
  return prefixMatches[0]?.name ?? String(value).trim();
}

function matchExistingBrandCandidate(value, knownBrands) {
  if (!value) return "";
  const canonical = canonicalBrandName(value, knownBrands);
  return knownBrands.has(brandKey(canonical)) ? canonical : "";
}

function inferAgency(brand, email) {
  const domain = domainFromEmail(email);
  if (!domain || GENERIC_EMAIL_DOMAINS.has(domain)) return "";
  const root = rootDomainName(domain);
  if (!root) return "";
  const brandCompact = compactKey(brand);
  const rootCompact = compactKey(root);
  if (brandCompact.includes(rootCompact) || rootCompact.includes(brandCompact)) return "";
  const likelyAgency = AGENCY_HINTS.some((hint) => root.toLowerCase().includes(hint));
  return likelyAgency || brandCompact !== rootCompact
    ? toTitleCase(root.replace(/[-_.]+/g, " "))
    : "";
}

function extractBrief(email) {
  const currentBody = currentMessageBody(email.body);
  const sourceText = `${email.subject}\n${email.snippet}\n${currentBody}`.slice(0, 30_000);
  const signalMatch = sourceText.match(
    /\b(creator brief|campaign brief|brand brief|creator profile|ideal creator|target creators?|casting|looking for|seeking|creator requirements?|influencer requirements?)\b/i,
  );
  if (!signalMatch) return null;
  const signalIndex = signalMatch.index ?? 0;
  const text = sourceText.slice(Math.max(0, signalIndex - 400), signalIndex + 3200);
  const lower = text.toLowerCase();
  const creatorContext = text
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sentence) =>
        /\b(creator|influencer|talent)\b/i.test(sentence) &&
        /\b(profile|ideal|target|looking for|seeking|requirements?|niche|style|platform|audience|followers?|based|located|speaking)\b/i.test(
          sentence,
        ),
    )
    .join(" ");
  const platformLabel = text.match(/\bplatforms?\s*:\s*([^.!?\n]{2,100})/i)?.[1] ?? "";
  const platformCreatorPhrases = [
    ...(text.match(/\b(?:tik\s*tok|instagram|you\s*tube)\s+(?:creator|influencer)s?\b/gi) ?? []),
    ...(text.match(
      /\b(?:creator|influencer)s?\s+(?:on|for)\s+(?:tik\s*tok|instagram|you\s*tube)\b/gi,
    ) ?? []),
  ].join(" ");
  const platforms = PLATFORM_PATTERNS.filter(([, pattern]) =>
    pattern.test(`${platformLabel} ${platformCreatorPhrases}`),
  ).map(([label]) => label);
  const languages = LANGUAGE_PATTERNS.filter(([, pattern]) =>
    pattern.test(
      `${text.match(/\blanguages?\s*:\s*([^.!?\n]{2,100})/i)?.[1] ?? ""} ${
        text.match(/\b[a-z]+(?:-speaking)\s+(?:creator|influencer)s?\b/i)?.[0] ?? ""
      }`,
    ),
  ).map(([label]) => label);
  const locationContext = [
    text.match(/\blocations?\s*:\s*([^.!?\n]{2,120})/i)?.[1] ?? "",
    text.match(
      /\b(?:creator|influencer)s?\s+(?:based|located|living)\s+in\s+([^.!?\n]{2,120})/i,
    )?.[0] ?? "",
    text.match(
      /\blooking for\s+(?:creator|influencer)s?\s+(?:in|from)\s+([^.!?\n]{2,120})/i,
    )?.[0] ?? "",
  ].join(" ");
  const countries = COUNTRY_PATTERNS.filter(([, pattern]) => pattern.test(locationContext)).map(
    ([label]) => label,
  );
  const nicheContext = [
    text.match(/\bniches?\s*:\s*([^.!?\n]{2,180})/i)?.[1] ?? "",
    ...(text.match(
      /\b(?:beauty|skincare|makeup|fashion|lifestyle|wellness|fitness|technology|tech|gaming|travel|food|parenting|home|education|finance|music|books?)\s+(?:creator|influencer)s?\b/gi,
    ) ?? []),
  ].join(" ");
  const niches = NICHE_PATTERNS.filter(([, pattern]) => pattern.test(nicheContext)).map(
    ([label]) => label,
  );
  const styleContext = [
    text.match(/\b(?:creator\s+)?styles?\s*:\s*([^.!?\n]{2,180})/i)?.[1] ?? "",
    ...(text.match(
      /\b(?:authentic|educational|informative|conversational|relatable|storytelling|comedic|funny|aesthetic|polished|natural|high[- ]energy)\s+(?:creator|influencer|content|style)s?\b/gi,
    ) ?? []),
    creatorContext,
  ].join(" ");
  const styles = STYLE_PATTERNS.filter(([, pattern]) => pattern.test(styleContext)).map(
    ([label]) => label,
  );
  const sizeMatch = text.match(
    /\b(\d+(?:\.\d+)?\s*[kKmM]?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?\s*[kKmM]?)\s*(?:followers?|subscribers?|subs?)\b/i,
  );
  const tierMatch = text.match(
    /\b(nano|micro|mid[- ]tier|macro|mega)\s+(?:creator|influencer)s?\b/i,
  );
  const ageMatch = text.match(
    /\b(?:creator\s+)?age(?:d)?\s*(?::|is|between)?\s*(\d{2})\s*(?:-|–|—|to)\s*(\d{2})\b/i,
  );
  const ageSingle = text.match(/\b(?:creator\s+)?age(?:d)?\s*(?::|is)?\s*(\d{2})\+?\b/i);
  const gender = /\b(any|all) genders?\b/i.test(text)
    ? "Any"
    : /\b(?:female|women)\s+(?:creator|influencer)s?\b/i.test(text)
      ? "Female"
      : /\b(?:male|men)\s+(?:creator|influencer)s?\b/i.test(text)
        ? "Male"
        : "";
  const audienceMatch = text.match(/\b(?:target\s+)?audience\s*:\s*([^.!?\n]{8,180})/i);
  const demographicMatch = text.match(
    /\b(?:women|men|adults|gen\s*z|millennials?)\s+(?:aged?\s*)?\d{2}\s*(?:-|–|to)\s*\d{2}[^.!?\n]{0,90}/i,
  );
  const creatorSize = sizeMatch
    ? `${cleanInline(sizeMatch[1])}–${cleanInline(sizeMatch[2])} followers`
    : tierMatch
      ? toTitleCase(cleanInline(tierMatch[1]))
      : "";
  const creatorAge = ageMatch
    ? `${ageMatch[1]}–${ageMatch[2]}`
    : ageSingle
      ? `${ageSingle[1]}${ageSingle[0].includes("+") ? "+" : ""}`
      : "";
  const audience = cleanInline(audienceMatch?.[1] || demographicMatch?.[0] || "").slice(0, 220);
  const fieldCount = [
    platforms.length,
    creatorSize,
    countries.length,
    languages.length,
    creatorAge,
    gender,
    niches.length,
    styles.length,
    audience,
  ].filter(Boolean).length;
  if (fieldCount < 2) return null;
  if (/\bnewsletter|unsubscribe|job alert|receipt|order confirmation\b/i.test(lower)) return null;
  return {
    platforms: platforms.join(" / "),
    creatorSize,
    location: countries.join(" / "),
    language: languages.join(" / "),
    creatorAge,
    gender,
    niches: niches.join(", "),
    creatorStyle: styles.join(", "),
    audience,
    briefDate: isoDate(email.date),
  };
}

function currentMessageBody(bodyValue) {
  const body = String(bodyValue ?? "");
  const markers = [
    /\bon\s.{0,120}\bwrote\s*:/i,
    /\bfrom\s*:\s*[^\n]{2,120}\bsent\s*:/i,
    /-{3,}\s*original message\s*-{3,}/i,
    /_{5,}/,
    />{6,}/,
  ];
  let end = body.length;
  for (const marker of markers) {
    const match = marker.exec(body);
    if (match?.index >= 0) end = Math.min(end, match.index);
  }
  return body.slice(0, end).trim();
}

async function markWhatsappMoves(gmail, briefsByBrand, contactsByBrandAndEmail) {
  let marked = 0;
  for (const brief of briefsByBrand.values()) {
    if (!brief.threadId || !hasBrief(brief)) continue;
    const thread = await gmail.getThread(brief.threadId);
    const messages = (thread.messages ?? [])
      .map(normalizeGmailMessage)
      .sort((a, b) => a.date - b.date);
    const sentWhatsapp = messages
      .filter((message) => {
        const sender = parseSender(message.from);
        return (
          INTERNAL_DOMAINS.has(domainFromEmail(sender.email)) &&
          dateScore(message.date) >= dateScore(brief.briefDate) &&
          /\bwhats?app\b|wa\.me|(?:\+|00)\d[\d\s()-]{7,}/i.test(
            `${message.subject}\n${message.body}`,
          )
        );
      })
      .at(-1);
    if (!sentWhatsapp) continue;
    const laterIncoming = messages.some((message) => {
      const sender = parseSender(message.from);
      return (
        !INTERNAL_DOMAINS.has(domainFromEmail(sender.email)) && message.date > sentWhatsapp.date
      );
    });
    if (laterIncoming) continue;
    const contact = contactsByBrandAndEmail.get(contactKey(brief.brand, brief.sourceEmail));
    if (!contact) continue;
    contact.notes = appendNote(contact.notes, "moved to Whatsapp");
    marked += 1;
  }
  return marked;
}

function buildAgencies(contacts) {
  const groups = new Map();
  for (const contact of contacts) {
    const key = `${brandKey(contact.brand)}::${normalizeKey(contact.agency)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(contact);
  }
  return [...groups.values()].map((group) => {
    group.sort(
      (left, right) =>
        dateScore(right.lastActiveDate) - dateScore(left.lastActiveDate) ||
        left.contact.localeCompare(right.contact),
    );
    return {
      brand: group[0].brand,
      agency: group[0].agency,
      topContact: group[0].contact,
      contactActiveDate: group[0].lastActiveDate,
    };
  });
}

function buildBrands(brands, contacts, agencies, briefs) {
  const briefMap = new Map(briefs.map((brief) => [brandKey(brief.brand), brief]));
  return brands
    .map((brand) => {
      const brandContacts = contacts.filter(
        (contact) => brandKey(contact.brand) === brandKey(brand.name),
      );
      const brandAgencies = agencies.filter(
        (agency) => brandKey(agency.brand) === brandKey(brand.name),
      );
      const bestActiveDate =
        latestDate(brandContacts.map((contact) => contact.lastActiveDate)) ||
        brand.fallbackBestActiveDate ||
        FALLBACK_DATE;
      const brief = briefMap.get(brandKey(brand.name)) ?? { brand: brand.name, ...emptyBrief() };
      return {
        name: brand.name,
        niche: brand.niche || inferNicheFromBrief(brief),
        bestActiveDate,
        hasBrief: hasBrief(brief),
        brief,
        agencies: brandAgencies.map((agency) => ({
          ...agency,
          contacts: brandContacts.filter(
            (contact) => normalizeKey(contact.agency) === normalizeKey(agency.agency),
          ),
        })),
      };
    })
    .sort(
      (left, right) =>
        dateScore(right.bestActiveDate) - dateScore(left.bestActiveDate) ||
        Number(right.hasBrief) - Number(left.hasBrief) ||
        left.name.localeCompare(right.name),
    );
}

function inferBrandNiche(email) {
  const text = `${email.subject}\n${email.snippet}\n${email.body}`;
  if (/\bbeauty|skincare|makeup|cosmetic\b/i.test(text)) return "Makeup & Skincare";
  if (/\bfashion|apparel|clothing|streetwear\b/i.test(text)) return "Fashion";
  if (/\bapp|software|platform|dating\b/i.test(text)) return "Apps";
  if (/\btech|gadget|camera|electronic\b/i.test(text)) return "Technology";
  if (/\btravel|hotel|tourism|vacation\b/i.test(text)) return "Travel";
  if (/\bbaby|mom|mum|parent\b/i.test(text)) return "Mom";
  return "Other";
}

function inferNicheFromBrief(brief) {
  const niches = String(brief.niches ?? "").toLowerCase();
  if (/beauty|skincare|makeup/.test(niches)) return "Makeup & Skincare";
  if (/fashion/.test(niches)) return "Fashion";
  if (/tech/.test(niches)) return "Technology";
  if (/travel/.test(niches)) return "Travel";
  if (/parent|baby|mom/.test(niches)) return "Mom";
  return "Other";
}

function table(values) {
  return {
    headers: values[0] ?? [],
    rows: (values.slice(1) ?? []).filter((row) => row.some(Boolean)),
  };
}

function cell(data, row, header) {
  const wanted = normalizeKey(header);
  const index = data.headers.findIndex((value) => normalizeKey(value) === wanted);
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function emptyBrief() {
  return {
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
  ].some((value) => String(value ?? "").trim());
}

function stripThreadId(brief) {
  const { threadId, ...rest } = brief;
  return rest;
}

function appendNote(current, note) {
  const parts = String(current ?? "")
    .split(/\s*;\s*/)
    .filter(Boolean);
  if (!parts.some((part) => normalizeKey(part) === normalizeKey(note))) parts.push(note);
  return parts.join("; ");
}

function isValidExternalEmail(value) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  if (INTERNAL_DOMAINS.has(domainFromEmail(value))) return false;
  return !/^(no-?reply|donotreply|notifications?|mailer|calendar)@/i.test(value);
}

function brandKey(value) {
  return normalizeKey(value);
}

function contactKey(brand, contact) {
  return `${brandKey(brand)}::${String(contact ?? "")
    .trim()
    .toLowerCase()}`;
}

function compactKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, "");
}

function domainInSet(domain, values) {
  return [...values].some((value) => domain === value || domain.endsWith(`.${value}`));
}

function latestDate(values) {
  return values.filter(Boolean).sort((left, right) => dateScore(right) - dateScore(left))[0] ?? "";
}

function dateScore(value) {
  const score = new Date(value).getTime();
  return Number.isFinite(score) ? score : 0;
}

function isoDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const humanDate = text.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (humanDate) {
    const month = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    }[humanDate[2].toLowerCase()];
    if (month) return `${humanDate[3]}-${month}-${humanDate[1].padStart(2, "0")}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function cleanInline(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,-]+|[\s:;,.-]+$/g, "")
    .trim();
}

function clamp(value, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? Math.round(number) : min));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}
