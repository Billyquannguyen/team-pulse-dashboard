import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Clipboard,
  Copy,
  Download,
  FileSpreadsheet,
  History,
  Inbox,
  Loader2,
  Mail,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Upload,
  X as XIcon,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelectField } from "@/components/ui/dashboard-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { activeBrandsQuery } from "@/lib/active-brands";
import { searchAleadsContacts, type AleadsContactResult } from "@/lib/a-leads";
import { createGmailDrafts, type GmailDraftResult } from "@/lib/gmail-drafts";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/brand-finder")({
  head: () => ({
    meta: [
      { title: "Brand Finder - Team Billion" },
      {
        name: "description",
        content:
          "Upload creator dream brand sheets, find A-Leads contacts, and create Gmail drafts.",
      },
    ],
  }),
  component: BrandFinderPage,
});

const STORAGE_KEY = "team-billion-brand-finder-v4";
const ALL_BRANDS = "All brands";
const ALL_DECISIONS = "All decisions";
const ALL_CREATORS = "All creators";

const DEFAULT_SUBJECT_TEMPLATE = "Creator partnership for {{brand_name}}";
const DEFAULT_BODY_TEMPLATE = `Hi {{first_name}},

I'm reaching out from Team Billion. We manage {{creator_name}}, whose audience is a strong fit for {{brand_name}}.

Would you be open to reviewing a paid creator partnership?

Best,
{{sender_name}}`;

const DEFAULT_JOB_TITLES = [
  "Influencer Marketing Manager",
  "Creator Partnerships Manager",
  "Brand Partnerships Manager",
  "Affiliate Manager",
  "PR Manager",
  "Social Media Manager",
  "Brand Manager",
  "Growth Marketing Manager",
  "Head of Marketing",
  "Founder",
];

const DEFAULT_DEPARTMENTS = [
  "Marketing",
  "Brand Marketing",
  "Partnerships",
  "Public Relations",
  "Social Media",
];

const DEFAULT_SENIORITY = ["Manager", "Director", "Head", "Founder", "Owner"];

const TEMPLATE_FIELDS = [
  "first_name",
  "contact_name",
  "brand_name",
  "company_name",
  "creator_name",
  "creator_handle",
  "creator_niche",
  "creator_platform",
  "creator_owner",
  "sender_name",
] as const;

const confidenceOptions = ["All confidence", "High", "Medium", "Low"] as const;
const decisionOptions = [ALL_DECISIONS, "Approved", "Rejected", "Needs review"] as const;
const searchTypeOptions = [
  { value: "total", label: "Total" },
  { value: "new", label: "Net new" },
  { value: "saved", label: "Saved" },
] as const;

type ConfidenceFilter = (typeof confidenceOptions)[number];
type DecisionFilter = (typeof decisionOptions)[number];
type ContactConfidence = "High" | "Medium" | "Low";
type ContactDecision = "pending" | "approved" | "rejected";
type TemplateTarget = "subject" | "body";
type BrandSearchStatus = "ready" | "name-only" | "already-found" | "existing-relationship";
type BrandHistorySource = "Active Brands" | "Deals" | "Current search";
type SearchType = "new" | "saved" | "total";

type KnownBrand = {
  name: string;
  domain: string;
  sources: Set<BrandHistorySource>;
  hasContacts: boolean;
  hasDeals: boolean;
};

type SheetBrand = {
  id: string;
  rowNumber: number;
  creatorName: string;
  rawName: string;
  name: string;
  domain: string;
  matchedKnownName: string;
  parserNote: string;
  status: BrandSearchStatus;
  statusMessage: string;
};

type BrandOverride = {
  name?: string;
  domain?: string;
};

type ContactCandidate = {
  id: string;
  brandId: string;
  creatorName: string;
  brandName: string;
  domain: string;
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  email: string;
  linkedin: string;
  confidence: ContactConfidence;
  reason: string;
  source: "A-Leads API" | "A-Leads CSV";
};

type AleadsFilterState = {
  jobTitlesText: string;
  departmentsText: string;
  seniorityText: string;
  searchType: SearchType;
  maxContactsPerBrand: number;
  requireEmail: boolean;
  enrichMissingEmails: boolean;
};

type SavedBrandFinderState = {
  sheetInput?: string;
  sheetFileName?: string;
  senderName?: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
  filters?: AleadsFilterState;
  brandOverrides?: Record<string, BrandOverride>;
  brandSearchOverrides?: Record<string, boolean>;
  contacts?: ContactCandidate[];
  contactDecisions?: Record<string, ContactDecision>;
  gmailResults?: Record<string, GmailDraftResult>;
};

type DraftPreview = {
  id: string;
  email: string;
  subject: string;
  body: string;
  contact: ContactCandidate;
};

type CreatorMeta = {
  handle: string;
  owner: string;
  niche: string;
  platform: string;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const COMMON_BRAND_FIXES: Record<string, string> = {
  gymshark: "Gymshark",
  "gym shark": "Gymshark",
  rhode: "Rhode",
  "rhode skin": "Rhode",
  popi: "Poppi",
  poppi: "Poppi",
  skims: "Skims",
  "rare beauty": "Rare Beauty",
  glossier: "Glossier",
  sephora: "Sephora",
  "alo yoga": "Alo Yoga",
  alo: "Alo Yoga",
  lululemon: "Lululemon",
  "my protein": "Myprotein",
  myprotein: "Myprotein",
  youngla: "YoungLA",
  "young la": "YoungLA",
  revolve: "Revolve",
  "white fox": "White Fox",
  cider: "Cider",
};

const DEFAULT_FILTER_STATE: AleadsFilterState = {
  jobTitlesText: DEFAULT_JOB_TITLES.join("\n"),
  departmentsText: DEFAULT_DEPARTMENTS.join("\n"),
  seniorityText: DEFAULT_SENIORITY.join("\n"),
  searchType: "total",
  maxContactsPerBrand: 3,
  requireEmail: true,
  enrichMissingEmails: true,
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 .@:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeDomain(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .trim();
  }
}

function domainToName(domain: string) {
  const firstPart = domain.split(".")[0] ?? "";
  return titleCase(firstPart.split(/[-_]/).filter(Boolean).join(" "));
}

function extractDomain(value: string) {
  const match =
    value.match(/https?:\/\/[^\s,|]+/i) ??
    value.match(/www\.[^\s,|]+/i) ??
    value.match(/[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s,|]*)?/i);

  return match ? normalizeDomain(match[0]) : "";
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      currentValue += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      currentRow.push(currentValue.trim());
      currentValue = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      currentRow.push(currentValue.trim());
      if (currentRow.some(Boolean)) rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  currentRow.push(currentValue.trim());
  if (currentRow.some(Boolean)) rows.push(currentRow);

  const [headers = [], ...bodyRows] = rows;
  return { headers, rows: bodyRows };
}

function normalizedHeader(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseLooseTable(text: string) {
  const cleaned = text.trim();
  if (!cleaned) return { headers: [] as string[], rows: [] as string[][] };

  const withOptionalHeader = (rows: string[][], defaultHeaders: string[]) => {
    const [firstRow = [], ...bodyRows] = rows;
    const firstRowText = firstRow.map(normalizedHeader).join(" ");
    const looksLikeHeader =
      /\b(creator|talent|influencer|handle|dream brand|brand|company|website|domain|url)\b/.test(
        firstRowText,
      );

    return looksLikeHeader
      ? { headers: firstRow, rows: bodyRows }
      : { headers: defaultHeaders, rows };
  };

  if (cleaned.includes("\t")) {
    const rows = cleaned
      .split(/\r?\n/)
      .map((line) => line.split("\t").map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean));
    return withOptionalHeader(rows, ["Brand", "Website"]);
  }

  if (cleaned.includes("|")) {
    const rows = cleaned
      .split(/\r?\n/)
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean));
    return withOptionalHeader(rows, ["Brand", "Website"]);
  }

  if (cleaned.includes(",")) {
    const parsed = parseCsv(cleaned);
    return withOptionalHeader([parsed.headers, ...parsed.rows], ["Brand", "Website"]);
  }

  return {
    headers: ["Brand"],
    rows: cleaned
      .split(/\r?\n/)
      .map((line) => [line.trim()])
      .filter((row) => row[0]),
  };
}

function pickColumn(headers: string[], aliases: string[], deniedTerms: string[] = []) {
  const normalizedAliases = aliases.map(normalizedHeader);
  const normalizedDenied = deniedTerms.map(normalizedHeader);
  const normalizedHeaders = headers.map(normalizedHeader);

  const exactIndex = normalizedHeaders.findIndex(
    (header) =>
      normalizedAliases.includes(header) && !normalizedDenied.some((term) => header.includes(term)),
  );
  if (exactIndex >= 0) return exactIndex;

  return normalizedHeaders.findIndex(
    (header) =>
      normalizedAliases.some((alias) => header.includes(alias)) &&
      !normalizedDenied.some((term) => header.includes(term)),
  );
}

function getCell(headers: string[], row: string[], aliases: string[], deniedTerms: string[] = []) {
  const index = pickColumn(headers, aliases, deniedTerms);
  return index >= 0 ? (row[index]?.trim() ?? "") : "";
}

function brandColumnIndexes(headers: string[]) {
  const indexes = headers
    .map((header, index) => ({ header: normalizedHeader(header), index }))
    .filter(({ header }) => {
      const looksLikeBrand =
        header.includes("brand") ||
        header.includes("company") ||
        header.includes("wishlist") ||
        header.includes("dream");
      const denied =
        header.includes("website") ||
        header.includes("domain") ||
        header.includes("url") ||
        header.includes("email") ||
        header.includes("creator") ||
        header.includes("talent") ||
        header.includes("influencer") ||
        header.includes("handle");
      return looksLikeBrand && !denied;
    })
    .map(({ index }) => index);

  if (indexes.length > 0) return indexes;

  const fallback = pickColumn(headers, ["dream brand", "brand", "brand name", "company"]);
  return fallback >= 0 ? [fallback] : [];
}

function levenshtein(left: string, right: string) {
  const a = compactKey(left);
  const b = compactKey(right);
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const distances = Array.from({ length: a.length + 1 }, (_, index) => index);

  for (let bIndex = 1; bIndex <= b.length; bIndex += 1) {
    let previous = distances[0];
    distances[0] = bIndex;

    for (let aIndex = 1; aIndex <= a.length; aIndex += 1) {
      const saved = distances[aIndex];
      const cost = a[aIndex - 1] === b[bIndex - 1] ? 0 : 1;
      distances[aIndex] = Math.min(
        distances[aIndex] + 1,
        distances[aIndex - 1] + 1,
        previous + cost,
      );
      previous = saved;
    }
  }

  return distances[a.length];
}

function similarity(left: string, right: string) {
  const a = compactKey(left);
  const b = compactKey(right);
  const length = Math.max(a.length, b.length);
  if (length === 0) return 1;
  return 1 - levenshtein(a, b) / length;
}

function csvEscape(value: string) {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function copyToClipboard(value: string) {
  return navigator.clipboard.writeText(value);
}

function splitList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function addKnownBrand(
  map: Map<string, KnownBrand>,
  name: string,
  domain: string,
  source: BrandHistorySource,
  options: { hasContacts?: boolean; hasDeals?: boolean } = {},
) {
  const cleanName = name.trim();
  const normalizedDomain = normalizeDomain(domain);
  const key = compactKey(normalizedDomain || cleanName);
  if (!key || (!cleanName && !normalizedDomain)) return;

  const current = map.get(key) ?? {
    name: cleanName || domainToName(normalizedDomain),
    domain: normalizedDomain,
    sources: new Set<BrandHistorySource>(),
    hasContacts: false,
    hasDeals: false,
  };

  current.name = current.name || cleanName;
  current.domain = current.domain || normalizedDomain;
  current.sources.add(source);
  current.hasContacts = current.hasContacts || Boolean(options.hasContacts);
  current.hasDeals = current.hasDeals || Boolean(options.hasDeals);
  map.set(key, current);
}

function findKnownBrand(knownBrands: KnownBrand[], rawName: string, domain: string) {
  const normalizedDomain = normalizeDomain(domain);
  if (normalizedDomain) {
    const byDomain = knownBrands.find((brand) => brand.domain === normalizedDomain);
    if (byDomain) return { brand: byDomain, score: 1 };
  }

  const fixedName = COMMON_BRAND_FIXES[normalizeText(rawName)] ?? rawName;
  const rawKey = compactKey(fixedName);
  const exact = knownBrands.find((brand) => compactKey(brand.name) === rawKey);
  if (exact) return { brand: exact, score: 1 };

  const best = knownBrands
    .map((brand) => ({ brand, score: similarity(fixedName, brand.name) }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score >= 0.84 ? best : null;
}

function statusForBrand(options: {
  domain: string;
  hasSessionContacts: boolean;
  hasKnownContacts: boolean;
  hasKnownDeals: boolean;
}) {
  if (options.hasSessionContacts || options.hasKnownContacts) return "already-found";
  if (options.hasKnownDeals) return "existing-relationship";
  return options.domain ? "ready" : "name-only";
}

function brandStatusMessage(status: BrandSearchStatus) {
  if (status === "already-found") {
    return "This brand's contacts have already been found. Check email history or Active Brands before searching again.";
  }
  if (status === "existing-relationship") {
    return "This brand is already in deal history. Check the relationship before searching again.";
  }
  if (status === "name-only") {
    return "Search will use the brand name. Add a website if you want tighter matching.";
  }
  return "Ready for A-Leads search.";
}

function defaultBrandUse(status: BrandSearchStatus) {
  return status === "ready" || status === "name-only";
}

function parseDreamSheet(
  input: string,
  knownBrands: KnownBrand[],
  contacts: ContactCandidate[],
): SheetBrand[] {
  const { headers, rows } = parseLooseTable(input);
  const creatorIndex = pickColumn(headers, ["creator", "talent", "influencer", "handle", "name"]);
  const domainIndex = pickColumn(headers, [
    "website",
    "domain",
    "brand website",
    "company website",
    "url",
  ]);
  const brandIndexes = brandColumnIndexes(headers);
  const sessionContactBrands = new Set(
    contacts.map((contact) => compactKey(contact.domain || contact.brandName)),
  );
  const parsed: SheetBrand[] = [];

  rows.forEach((row, rowIndex) => {
    const rowCreator = creatorIndex >= 0 ? (row[creatorIndex]?.trim() ?? "") : "";
    const creatorName = rowCreator || "Unassigned creator";
    const rowText = row.join(" | ");
    const explicitDomain = domainIndex >= 0 ? (row[domainIndex]?.trim() ?? "") : "";
    const brandCells =
      brandIndexes.length > 0
        ? brandIndexes.map((index) => row[index]?.trim() ?? "").filter(Boolean)
        : [
            row.find((cell) => cell.trim() && !extractDomain(cell) && !/@/.test(cell))?.trim() ||
              rowText,
          ];

    brandCells.forEach((brandCell, brandCellIndex) => {
      const rawBrand = brandCell.replace(extractDomain(brandCell), "").trim() || brandCell;
      const extractedDomain = extractDomain(explicitDomain || brandCell || rowText);
      const fixedName = COMMON_BRAND_FIXES[normalizeText(rawBrand)] ?? rawBrand;
      const knownMatch = findKnownBrand(knownBrands, fixedName, extractedDomain);
      const cleanName =
        knownMatch?.brand.name || titleCase(fixedName.replace(extractedDomain, "").trim());
      const domain = knownMatch?.brand.domain || extractedDomain;
      const hasSessionContacts = sessionContactBrands.has(compactKey(domain || cleanName));
      const status = statusForBrand({
        domain,
        hasSessionContacts,
        hasKnownContacts: Boolean(knownMatch?.brand.hasContacts),
        hasKnownDeals: Boolean(knownMatch?.brand.hasDeals),
      });
      const parserNote =
        knownMatch && compactKey(knownMatch.brand.name) !== compactKey(rawBrand)
          ? `Cleaned "${rawBrand}" to "${knownMatch.brand.name}"`
          : cleanName !== rawBrand
            ? `Cleaned "${rawBrand}" to "${cleanName}"`
            : "";
      const id = compactKey([creatorName, domain || cleanName, rowIndex, brandCellIndex].join("|"));

      if (!cleanName || !id) return;

      parsed.push({
        id,
        rowNumber: rowIndex + 2,
        creatorName,
        rawName: rawBrand,
        name: cleanName,
        domain,
        matchedKnownName: knownMatch?.brand.name ?? "",
        parserNote,
        status,
        statusMessage: brandStatusMessage(status),
      });
    });
  });

  return parsed;
}

function applyBrandOverrides(brands: SheetBrand[], overrides: Record<string, BrandOverride>) {
  return brands.map((brand) => {
    const override = overrides[brand.id];
    if (!override) return brand;

    const name = override.name?.trim() || brand.name;
    const domain = normalizeDomain(override.domain ?? brand.domain);
    const status =
      brand.status === "name-only" && domain
        ? "ready"
        : brand.status === "ready" && !domain
          ? "name-only"
          : brand.status;

    return {
      ...brand,
      name,
      domain,
      status,
      statusMessage: brandStatusMessage(status),
    };
  });
}

function brandKey(brand: Pick<SheetBrand, "name" | "domain">) {
  return compactKey(brand.domain || brand.name);
}

function findMatchingBrand(brands: SheetBrand[], company: string, domain: string) {
  const normalizedDomain = normalizeDomain(domain);
  if (normalizedDomain) {
    const domainMatch = brands.find((brand) => brand.domain && brand.domain === normalizedDomain);
    if (domainMatch) return domainMatch;
  }

  const companyKey = compactKey(company);
  if (companyKey) {
    const companyMatch = brands.find((brand) => {
      const key = compactKey(brand.name);
      return companyKey === key || companyKey.includes(key) || key.includes(companyKey);
    });
    if (companyMatch) return companyMatch;
  }

  return null;
}

function scoreContact(
  title: string,
  email: string,
): { confidence: ContactConfidence; reason: string } {
  const normalizedTitle = normalizeText(title);
  const matched: string[] = [];
  let score = 0;

  const add = (points: number, label: string, patterns: RegExp[]) => {
    if (patterns.some((pattern) => pattern.test(normalizedTitle))) {
      score += points;
      matched.push(label);
    }
  };

  add(4, "creator/influencer", [/influencer/, /creator/]);
  add(3, "partnerships", [/partnership/, /collab/]);
  add(3, "affiliate", [/affiliate/]);
  add(2, "PR/comms", [/\bpr\b/, /public relation/, /communication/]);
  add(2, "social", [/social/]);
  add(2, "brand", [/brand/]);
  add(2, "marketing", [/marketing/]);
  add(2, "senior contact", [/\bhead\b/, /director/, /\bvp\b/, /vice president/]);
  add(1, "manager/lead", [/manager/, /\blead\b/]);
  add(1, "founder fallback", [/founder/, /owner/]);

  if (/intern|assistant|student/.test(normalizedTitle)) score -= 2;
  if (!email) score -= 2;

  const confidence: ContactConfidence = score >= 5 ? "High" : score >= 3 ? "Medium" : "Low";
  const reason =
    matched.length > 0
      ? `Matched ${Array.from(new Set(matched)).join(", ")} from title`
      : "Title needs manual review";

  return {
    confidence,
    reason: email ? reason : `${reason}; missing email`,
  };
}

function buildContactId(contact: Omit<ContactCandidate, "id">) {
  return compactKey(
    [
      contact.creatorName,
      contact.brandName,
      contact.domain,
      contact.email,
      contact.name,
      contact.title,
      contact.company,
    ].join("|"),
  );
}

function apiContactToCandidate(contact: AleadsContactResult, brand: SheetBrand): ContactCandidate {
  const score = scoreContact(contact.title, contact.email);
  const withoutId: Omit<ContactCandidate, "id"> = {
    brandId: brand.id,
    creatorName: brand.creatorName,
    brandName: brand.name,
    domain: contact.domain || brand.domain,
    name: contact.name,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    company: contact.company || brand.name,
    email: contact.email,
    linkedin: contact.linkedin,
    confidence: score.confidence,
    reason: `${score.reason}; matched to ${brand.domain || brand.name}`,
    source: "A-Leads API",
  };

  return {
    ...withoutId,
    id: buildContactId(withoutId),
  };
}

function expandApiContacts(apiContacts: AleadsContactResult[], brands: SheetBrand[]) {
  return apiContacts.flatMap((contact) => {
    const matches = brands.filter((brand) => {
      if (contact.brandId === brand.id) return true;
      const contactDomain = normalizeDomain(contact.domain);
      if (contactDomain && brand.domain === contactDomain) return true;
      return compactKey(contact.brandName) === compactKey(brand.name);
    });
    const usableMatches = matches.length > 0 ? matches : brands.slice(0, 1);
    return usableMatches.map((brand) => apiContactToCandidate(contact, brand));
  });
}

function parseAleadsContacts(csvText: string, brands: SheetBrand[]): ContactCandidate[] {
  const { headers, rows } = parseCsv(csvText);
  return rows
    .map((row) => {
      const firstName = getCell(headers, row, ["first name", "firstname"]);
      const lastName = getCell(headers, row, ["last name", "lastname"]);
      const name =
        getCell(headers, row, ["name", "full name", "contact name", "person name"]) ||
        [firstName, lastName].filter(Boolean).join(" ");
      const title = getCell(headers, row, ["job title", "title", "position", "role"]);
      const company = getCell(headers, row, ["company", "company name", "organization"]);
      const email = getCell(
        headers,
        row,
        ["email", "email address", "work email", "business email", "verified email"],
        ["status", "valid", "verification"],
      );
      const linkedin = getCell(headers, row, [
        "linkedin",
        "linkedin url",
        "linkedin profile",
        "profile url",
      ]);
      const rowDomain =
        getCell(headers, row, ["company domain", "domain", "website", "company website"]) ||
        extractDomain(row.join(" "));
      const domain = normalizeDomain(rowDomain);
      const matchedBrand = findMatchingBrand(brands, company, domain);
      const brandName = matchedBrand?.name || company || domainToName(domain) || "Imported brand";
      const score = scoreContact(title, email);
      const withoutId: Omit<ContactCandidate, "id"> = {
        brandId: matchedBrand?.id || compactKey(brandName),
        creatorName: matchedBrand?.creatorName || "Unassigned creator",
        brandName,
        domain: matchedBrand?.domain || domain,
        name: name || "Unknown contact",
        firstName,
        lastName,
        title: title || "Title missing",
        company: company || brandName,
        email,
        linkedin,
        confidence: score.confidence,
        reason: matchedBrand
          ? `${score.reason}; matched to ${matchedBrand.domain || matchedBrand.name}`
          : score.reason,
        source: "A-Leads CSV",
      };

      return {
        ...withoutId,
        id: buildContactId(withoutId),
      };
    })
    .filter((contact) => contact.email || contact.name !== "Unknown contact");
}

function mergeContacts(existing: ContactCandidate[], incoming: ContactCandidate[]) {
  const byId = new Map(existing.map((contact) => [contact.id, contact]));
  incoming.forEach((contact) => byId.set(contact.id, contact));
  return Array.from(byId.values()).sort((a, b) => {
    const confidenceOrder = { High: 0, Medium: 1, Low: 2 };
    return (
      confidenceOrder[a.confidence] - confidenceOrder[b.confidence] ||
      a.creatorName.localeCompare(b.creatorName) ||
      a.brandName.localeCompare(b.brandName) ||
      a.name.localeCompare(b.name)
    );
  });
}

function readSavedState(): SavedBrandFinderState {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function creatorLookupKey(value: string) {
  return compactKey(value.replace(/^@/, ""));
}

function fillTemplate(
  template: string,
  contact: ContactCandidate,
  creatorMeta: CreatorMeta | null,
  senderName: string,
) {
  const firstName = contact.firstName || contact.name.split(/\s+/)[0] || contact.name;
  const replacements: Record<string, string> = {
    brand_name: contact.brandName,
    company_name: contact.company,
    contact_name: contact.name,
    first_name: firstName,
    title: contact.title,
    domain: contact.domain,
    creator_name: contact.creatorName || "[creator name]",
    creator_handle: creatorMeta?.handle || contact.creatorName || "[creator handle]",
    creator_niche: creatorMeta?.niche || "[creator niche]",
    creator_platform: creatorMeta?.platform || "[creator platform]",
    creator_owner: creatorMeta?.owner || "[creator owner]",
    sender_name: senderName || "[your name]",
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return replacements[key] ?? `[${key}]`;
  });
}

function statusTone(confidence: ContactConfidence) {
  if (confidence === "High") return "border-fun-lime/50 bg-fun-lime/20 text-foreground";
  if (confidence === "Medium") return "border-fun-yellow/60 bg-fun-yellow/20 text-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function brandStatusTone(status: BrandSearchStatus) {
  if (status === "ready") return "border-fun-lime/50 bg-fun-lime/20 text-foreground";
  if (status === "name-only") return "border-fun-yellow/60 bg-fun-yellow/20 text-foreground";
  if (status === "existing-relationship")
    return "border-fun-blue/60 bg-fun-blue/20 text-foreground";
  return "border-destructive/25 bg-destructive/10 text-destructive";
}

function decisionLabel(decision: ContactDecision) {
  if (decision === "approved") return "Approved";
  if (decision === "rejected") return "Rejected";
  return "Needs review";
}

function decisionTone(decision: ContactDecision) {
  if (decision === "approved") return "bg-fun-lime/25 text-foreground";
  if (decision === "rejected") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

function metricValue(value: number) {
  return value.toLocaleString();
}

function BrandFinderPage() {
  const saved = useMemo(readSavedState, []);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { data: dashboardData } = useQuery(dashboardSheetQuery);
  const { data: activeBrandsData } = useQuery(activeBrandsQuery);
  const [sheetInput, setSheetInput] = useState(saved.sheetInput ?? "");
  const [sheetFileName, setSheetFileName] = useState(saved.sheetFileName ?? "");
  const [senderName, setSenderName] = useState(saved.senderName ?? "");
  const [subjectTemplate, setSubjectTemplate] = useState(
    saved.subjectTemplate ?? DEFAULT_SUBJECT_TEMPLATE,
  );
  const [bodyTemplate, setBodyTemplate] = useState(saved.bodyTemplate ?? DEFAULT_BODY_TEMPLATE);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget>("body");
  const [filters, setFilters] = useState<AleadsFilterState>({
    ...DEFAULT_FILTER_STATE,
    ...(saved.filters ?? {}),
  });
  const [brandOverrides, setBrandOverrides] = useState<Record<string, BrandOverride>>(
    saved.brandOverrides ?? {},
  );
  const [brandSearchOverrides, setBrandSearchOverrides] = useState<Record<string, boolean>>(
    saved.brandSearchOverrides ?? {},
  );
  const [csvInput, setCsvInput] = useState("");
  const [contacts, setContacts] = useState<ContactCandidate[]>(saved.contacts ?? []);
  const [contactDecisions, setContactDecisions] = useState<Record<string, ContactDecision>>(
    saved.contactDecisions ?? {},
  );
  const [gmailResults, setGmailResults] = useState<Record<string, GmailDraftResult>>(
    saved.gmailResults ?? {},
  );
  const [q, setQ] = useState("");
  const [brandFilter, setBrandFilter] = useState(ALL_BRANDS);
  const [creatorFilter, setCreatorFilter] = useState(ALL_CREATORS);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("All confidence");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>(ALL_DECISIONS);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchError, setSearchError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isCreatingDrafts, setIsCreatingDrafts] = useState(false);

  const creatorLookup = useMemo(() => {
    const map = new Map<string, CreatorMeta>();
    dashboardData?.creators.forEach((creator) => {
      const meta = {
        handle: creator.handle,
        owner: creator.owner,
        niche: creator.niche,
        platform: creator.platform,
      };
      map.set(creatorLookupKey(creator.handle), meta);
      map.set(creatorLookupKey(creator.handle.replace(/^@/, "")), meta);
    });
    return map;
  }, [dashboardData?.creators]);

  const knownBrands = useMemo(() => {
    const map = new Map<string, KnownBrand>();
    dashboardData?.deals.forEach((deal) => {
      addKnownBrand(map, deal.brand, "", "Deals", { hasDeals: true });
    });

    const headers = activeBrandsData?.headers ?? [];
    const rows = activeBrandsData?.rows ?? [];
    const brandIndex = pickColumn(headers, ["brand", "brand name", "company", "company name"]);
    const domainIndex = pickColumn(headers, ["website", "domain", "url", "company website"]);

    rows.forEach((row) => {
      const rowText = row.join(" ");
      const brandName =
        (brandIndex >= 0 ? row[brandIndex]?.trim() : "") ||
        row.find(
          (cell) =>
            cell.trim() && !extractDomain(cell) && !(cell.match(EMAIL_PATTERN) ?? []).length,
        ) ||
        "";
      const domain =
        (domainIndex >= 0 ? row[domainIndex]?.trim() : "") || extractDomain(rowText) || "";
      addKnownBrand(map, brandName, domain, "Active Brands", {
        hasContacts: true,
      });
    });

    contacts.forEach((contact) => {
      addKnownBrand(map, contact.brandName, contact.domain, "Current search", {
        hasContacts: true,
      });
    });

    return Array.from(map.values());
  }, [activeBrandsData?.headers, activeBrandsData?.rows, contacts, dashboardData?.deals]);

  const parsedBrands = useMemo(
    () => parseDreamSheet(sheetInput, knownBrands, contacts),
    [contacts, knownBrands, sheetInput],
  );
  const brands = useMemo(
    () => applyBrandOverrides(parsedBrands, brandOverrides),
    [brandOverrides, parsedBrands],
  );
  const selectedSearchBrands = useMemo(
    () =>
      brands.filter((brand) => {
        const override = brandSearchOverrides[brand.id];
        return override ?? defaultBrandUse(brand.status);
      }),
    [brandSearchOverrides, brands],
  );
  const uniqueCreators = useMemo(
    () => Array.from(new Set(brands.map((brand) => brand.creatorName))).filter(Boolean),
    [brands],
  );
  const creatorOptions = useMemo(() => [ALL_CREATORS, ...uniqueCreators], [uniqueCreators]);
  const brandOptions = useMemo(
    () => [
      ALL_BRANDS,
      ...Array.from(
        new Set([
          ...brands.map((brand) => brand.name),
          ...contacts.map((contact) => contact.brandName),
        ]),
      )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    ],
    [brands, contacts],
  );
  const approvedContacts = useMemo(
    () => contacts.filter((contact) => contactDecisions[contact.id] === "approved"),
    [contactDecisions, contacts],
  );
  const approvedWithEmail = approvedContacts.filter((contact) => contact.email);
  const draftPreviews: DraftPreview[] = useMemo(
    () =>
      approvedWithEmail.map((contact) => {
        const creatorMeta = creatorLookup.get(creatorLookupKey(contact.creatorName)) ?? null;
        return {
          id: contact.id,
          email: contact.email,
          subject: fillTemplate(subjectTemplate, contact, creatorMeta, senderName),
          body: fillTemplate(bodyTemplate, contact, creatorMeta, senderName),
          contact,
        };
      }),
    [approvedWithEmail, bodyTemplate, creatorLookup, senderName, subjectTemplate],
  );
  const filteredContacts = useMemo(() => {
    const query = q.trim().toLowerCase();
    return contacts.filter((contact) => {
      const decision = contactDecisions[contact.id] ?? "pending";
      const searchable = [
        contact.creatorName,
        contact.brandName,
        contact.domain,
        contact.name,
        contact.title,
        contact.company,
        contact.email,
        contact.linkedin,
        contact.reason,
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !query || searchable.includes(query);
      const matchesBrand = brandFilter === ALL_BRANDS || contact.brandName === brandFilter;
      const matchesCreator =
        creatorFilter === ALL_CREATORS || contact.creatorName === creatorFilter;
      const matchesConfidence =
        confidenceFilter === "All confidence" || contact.confidence === confidenceFilter;
      const matchesDecision =
        decisionFilter === ALL_DECISIONS || decisionLabel(decision) === decisionFilter;
      return matchesQuery && matchesBrand && matchesCreator && matchesConfidence && matchesDecision;
    });
  }, [brandFilter, confidenceFilter, contactDecisions, contacts, creatorFilter, decisionFilter, q]);
  const contactsByBrand = useMemo(() => {
    const map = new Map<string, number>();
    contacts.forEach((contact) => {
      map.set(brandKey(contact), (map.get(brandKey(contact)) ?? 0) + 1);
    });
    return map;
  }, [contacts]);
  const alreadyFoundCount = brands.filter((brand) => brand.status === "already-found").length;
  const needsCheckCount = brands.filter(
    (brand) => brand.status === "name-only" || brand.status === "existing-relationship",
  ).length;
  const highConfidenceCount = contacts.filter((contact) => contact.confidence === "High").length;
  const createdDraftCount = Object.values(gmailResults).filter((result) => result.ok).length;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const nextState: SavedBrandFinderState = {
      sheetInput,
      sheetFileName,
      senderName,
      subjectTemplate,
      bodyTemplate,
      filters,
      brandOverrides,
      brandSearchOverrides,
      contacts,
      contactDecisions,
      gmailResults,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [
    bodyTemplate,
    brandOverrides,
    brandSearchOverrides,
    contactDecisions,
    contacts,
    filters,
    gmailResults,
    senderName,
    sheetFileName,
    sheetInput,
    subjectTemplate,
  ]);

  const flashCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1200);
  };

  const insertTemplateField = (field: (typeof TEMPLATE_FIELDS)[number]) => {
    const token = `{{${field}}}`;
    const isSubject = templateTarget === "subject";
    const input = isSubject ? subjectRef.current : bodyRef.current;
    const value = isSubject ? subjectTemplate : bodyTemplate;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;

    if (isSubject) {
      setSubjectTemplate(next);
    } else {
      setBodyTemplate(next);
    }

    window.setTimeout(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const handleDreamSheetFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setSheetInput(text);
    setSheetFileName(file.name);
    setSearchMessage("");
    setSearchError("");
  };

  const updateBrandOverride = (brandId: string, patch: BrandOverride) => {
    setBrandOverrides((current) => ({
      ...current,
      [brandId]: {
        ...(current[brandId] ?? {}),
        ...patch,
      },
    }));
  };

  const setBrandUse = (brandId: string, useInSearch: boolean) => {
    setBrandSearchOverrides((current) => ({
      ...current,
      [brandId]: useInSearch,
    }));
  };

  const setDecision = (contactId: string, decision: ContactDecision) => {
    setContactDecisions((current) => ({
      ...current,
      [contactId]: decision,
    }));
  };

  const approveRecommended = () => {
    setContactDecisions((current) => {
      const next = { ...current };
      contacts
        .filter((contact) => contact.email && contact.confidence !== "Low")
        .forEach((contact) => {
          next[contact.id] = "approved";
        });
      return next;
    });
  };

  const clearDecisions = () => {
    setContactDecisions({});
    setGmailResults({});
  };

  const importCsvText = (text: string) => {
    const imported = parseAleadsContacts(text, brands);
    setContacts((current) => mergeContacts(current, imported));
    setCsvInput("");
    setSearchMessage(`Imported ${imported.length} contacts from CSV.`);
  };

  const handleContactCsvImport = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    importCsvText(text);
  };

  const runAleadsSearch = async () => {
    setSearchError("");
    setSearchMessage("");

    if (selectedSearchBrands.length === 0) {
      setSearchError("Select at least one brand to search.");
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchAleadsContacts({
        data: {
          brands: selectedSearchBrands.map((brand) => ({
            id: brand.id,
            creatorName: brand.creatorName,
            name: brand.name,
            domain: brand.domain,
          })),
          filters: {
            jobTitles: splitList(filters.jobTitlesText),
            departments: splitList(filters.departmentsText),
            seniority: splitList(filters.seniorityText),
            searchType: filters.searchType,
            maxContactsPerBrand: filters.maxContactsPerBrand,
            requireEmail: filters.requireEmail,
            enrichMissingEmails: filters.enrichMissingEmails,
          },
        },
      });
      const candidates = expandApiContacts(result.contacts, selectedSearchBrands);
      setContacts((current) => mergeContacts(current, candidates));
      setSearchMessage(
        `A-Leads returned ${result.contacts.length} contacts for ${result.searchedBrands} brands.`,
      );
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "A-Leads search failed.");
    } finally {
      setIsSearching(false);
    }
  };

  const createDrafts = async () => {
    setDraftError("");

    if (draftPreviews.length === 0) {
      setDraftError("Approve at least one contact with an email first.");
      return;
    }

    setIsCreatingDrafts(true);
    try {
      const result = await createGmailDrafts({
        data: {
          drafts: draftPreviews.map((draft) => ({
            id: draft.id,
            to: draft.email,
            subject: draft.subject,
            body: draft.body,
          })),
        },
      });
      setGmailResults((current) => {
        const next = { ...current };
        result.results.forEach((item) => {
          next[item.id] = item;
        });
        return next;
      });
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Gmail draft creation failed.");
    } finally {
      setIsCreatingDrafts(false);
    }
  };

  const resetWorkspace = () => {
    const confirmed = window.confirm("Clear the Brand Finder workspace?");
    if (!confirmed) return;

    setSheetInput("");
    setSheetFileName("");
    setSenderName("");
    setSubjectTemplate(DEFAULT_SUBJECT_TEMPLATE);
    setBodyTemplate(DEFAULT_BODY_TEMPLATE);
    setFilters(DEFAULT_FILTER_STATE);
    setBrandOverrides({});
    setBrandSearchOverrides({});
    setCsvInput("");
    setContacts([]);
    setContactDecisions({});
    setGmailResults({});
    setQ("");
    setBrandFilter(ALL_BRANDS);
    setCreatorFilter(ALL_CREATORS);
    setConfidenceFilter("All confidence");
    setDecisionFilter(ALL_DECISIONS);
    setSearchMessage("");
    setSearchError("");
    setDraftError("");
    window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Brand Finder"
        subtitle="Upload dream brand sheets, run A-Leads, approve contacts, and create Gmail drafts."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Creators" value={metricValue(uniqueCreators.length)} icon={Inbox} />
        <MetricTile
          label="Brands parsed"
          value={metricValue(brands.length)}
          icon={FileSpreadsheet}
        />
        <MetricTile label="Already found" value={metricValue(alreadyFoundCount)} icon={History} />
        <MetricTile label="Contacts found" value={metricValue(contacts.length)} icon={Sparkles} />
        <MetricTile label="Gmail drafts" value={metricValue(createdDraftCount)} icon={Mail} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.64fr)]">
        <div className="space-y-4">
          <Panel
            title="Dream brand sheet"
            subtitle={
              sheetFileName ? sheetFileName : "Upload CSV/TSV export or paste Google Sheet rows."
            }
            action={
              <label className="tb-action inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90">
                <Upload className="h-4 w-4" />
                Upload sheet
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  className="sr-only"
                  onChange={(event) => {
                    void handleDreamSheetFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            }
          >
            <Textarea
              value={sheetInput}
              onChange={(event) => {
                setSheetInput(event.target.value);
                setSheetFileName("");
              }}
              placeholder={
                "Creator\tDream Brand 1\tDream Brand 2\tWebsite\n@creator\tRhode\tGym shark\trhodeskin.com"
              }
              className="min-h-40 rounded-2xl bg-background text-sm"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-muted-foreground">
              <span>
                {brands.length > 0
                  ? `${brands.length} brands parsed from ${uniqueCreators.length} creators.`
                  : "No sheet loaded yet."}
              </span>
              <button
                type="button"
                onClick={resetWorkspace}
                className="tb-action inline-flex h-9 items-center gap-2 rounded-2xl bg-muted px-3 text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>
          </Panel>

          <Panel
            title="Parsed brands"
            subtitle={`${selectedSearchBrands.length} selected for A-Leads search.`}
            action={
              <button
                type="button"
                disabled={brands.length === 0}
                onClick={() =>
                  downloadCsv("team-billion-brand-finder-search-list.csv", [
                    ["Use", "Creator", "Brand", "Website", "Status", "Note"],
                    ...brands.map((brand) => [
                      String(brandSearchOverrides[brand.id] ?? defaultBrandUse(brand.status)),
                      brand.creatorName,
                      brand.name,
                      brand.domain,
                      brand.status,
                      brand.parserNote || brand.statusMessage,
                    ]),
                  ])
                }
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Export list
              </button>
            }
          >
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-left font-medium">Use</th>
                    <th className="px-3 py-2.5 text-left font-medium">Creator</th>
                    <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                    <th className="px-3 py-2.5 text-left font-medium">Website</th>
                    <th className="px-3 py-2.5 text-left font-medium">Status</th>
                    <th className="px-3 py-2.5 text-left font-medium">Contacts</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.length === 0 && (
                    <tr className="border-t border-border/60">
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center text-sm text-muted-foreground"
                      >
                        Upload a dream brand sheet to start.
                      </td>
                    </tr>
                  )}
                  {brands.map((brand) => {
                    const useInSearch =
                      brandSearchOverrides[brand.id] ?? defaultBrandUse(brand.status);
                    return (
                      <tr key={brand.id} className="tb-row-hover border-t border-border/60">
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={useInSearch}
                            onCheckedChange={(checked) => setBrandUse(brand.id, checked === true)}
                            aria-label={`Search ${brand.name}`}
                          />
                        </td>
                        <td className="min-w-[160px] px-3 py-3 text-muted-foreground">
                          {brand.creatorName}
                        </td>
                        <td className="min-w-[190px] px-3 py-3">
                          <input
                            value={brand.name}
                            onChange={(event) =>
                              updateBrandOverride(brand.id, { name: event.target.value })
                            }
                            className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          {brand.parserNote && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {brand.parserNote}
                            </div>
                          )}
                        </td>
                        <td className="min-w-[180px] px-3 py-3">
                          <input
                            value={brand.domain}
                            onChange={(event) =>
                              updateBrandOverride(brand.id, { domain: event.target.value })
                            }
                            placeholder="domain.com"
                            className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </td>
                        <td className="min-w-[300px] px-3 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2.5 py-1 text-xs font-bold",
                              brandStatusTone(brand.status),
                            )}
                          >
                            {brand.status === "already-found"
                              ? "Already found"
                              : brand.status === "existing-relationship"
                                ? "Seen before"
                                : brand.status === "name-only"
                                  ? "Name only"
                                  : "Ready"}
                          </span>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {brand.statusMessage}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-bold",
                              contactsByBrand.has(brandKey(brand))
                                ? "bg-fun-lime/25 text-foreground"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {contactsByBrand.get(brandKey(brand)) ?? 0}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel
            title="A-Leads filters"
            subtitle="Saved locally in this browser."
            action={
              <button
                type="button"
                disabled={isSearching || selectedSearchBrands.length === 0}
                onClick={() => void runAleadsSearch()}
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Find contacts
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <DashboardSelectField
                label="Search set"
                value={filters.searchType}
                options={[...searchTypeOptions]}
                onChange={(value) =>
                  setFilters((current) => ({ ...current, searchType: value as SearchType }))
                }
                className="sm:col-span-1"
              />
              <label className="text-xs font-semibold text-muted-foreground">
                Max per brand
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={filters.maxContactsPerBrand}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      maxContactsPerBrand: Math.max(
                        1,
                        Math.min(25, Number(event.target.value) || 1),
                      ),
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
            </div>

            <FilterTextarea
              label="Job titles"
              value={filters.jobTitlesText}
              onChange={(value) => setFilters((current) => ({ ...current, jobTitlesText: value }))}
            />
            <FilterTextarea
              label="Departments"
              value={filters.departmentsText}
              onChange={(value) =>
                setFilters((current) => ({ ...current, departmentsText: value }))
              }
            />
            <FilterTextarea
              label="Seniority"
              value={filters.seniorityText}
              onChange={(value) => setFilters((current) => ({ ...current, seniorityText: value }))}
            />

            <div className="mt-4 grid gap-2">
              <ToggleRow
                label="Only return contacts with emails"
                checked={filters.requireEmail}
                onCheckedChange={(checked) =>
                  setFilters((current) => ({ ...current, requireEmail: checked }))
                }
              />
              <ToggleRow
                label="Find missing emails after search"
                checked={filters.enrichMissingEmails}
                onCheckedChange={(checked) =>
                  setFilters((current) => ({ ...current, enrichMissingEmails: checked }))
                }
              />
            </div>

            {(searchError || searchMessage) && (
              <div
                className={cn(
                  "mt-4 rounded-2xl border p-3 text-xs font-semibold",
                  searchError
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-fun-lime/50 bg-fun-lime/20 text-foreground",
                )}
              >
                {searchError || searchMessage}
              </div>
            )}
          </Panel>

          <Panel title="Email template" subtitle="Field buttons insert into subject or body.">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Sender
                <input
                  value={senderName}
                  onChange={(event) => setSenderName(event.target.value)}
                  placeholder="Your name"
                  className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => setTemplateTarget("subject")}
                  className={cn(
                    "tb-action h-10 flex-1 rounded-2xl px-3 text-xs font-bold",
                    templateTarget === "subject"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  Subject
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateTarget("body")}
                  className={cn(
                    "tb-action h-10 flex-1 rounded-2xl px-3 text-xs font-bold",
                    templateTarget === "body"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  Body
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {TEMPLATE_FIELDS.map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => insertTemplateField(field)}
                  className="tb-action rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {`{{${field}}}`}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-sm font-semibold">
              Subject
              <input
                ref={subjectRef}
                value={subjectTemplate}
                onChange={(event) => setSubjectTemplate(event.target.value)}
                className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>

            <label className="mt-4 block text-sm font-semibold">
              Body
              <Textarea
                ref={bodyRef}
                value={bodyTemplate}
                onChange={(event) => setBodyTemplate(event.target.value)}
                className="mt-1 min-h-56 rounded-2xl bg-background text-sm"
              />
            </label>
          </Panel>
        </div>
      </section>

      <Panel
        title="Contact approval"
        subtitle={`${approvedContacts.length} approved, ${contacts.length} total contacts.`}
        action={
          <div className="flex flex-wrap gap-2">
            <label className="tb-action inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground">
              <FileSpreadsheet className="h-4 w-4" />
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  void handleContactCsvImport(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              disabled={contacts.length === 0}
              onClick={approveRecommended}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Approve recommended
            </button>
            <button
              type="button"
              disabled={Object.keys(contactDecisions).length === 0}
              onClick={clearDecisions}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Clear
            </button>
          </div>
        }
      >
        <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_repeat(4,minmax(150px,0.2fr))]">
          <div className="relative min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search contact, title, brand, email..."
              className="tb-search h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <DashboardSelectField
            label="Creator"
            value={creatorFilter}
            options={creatorOptions}
            onChange={setCreatorFilter}
          />
          <DashboardSelectField
            label="Brand"
            value={brandFilter}
            options={brandOptions}
            onChange={setBrandFilter}
          />
          <DashboardSelectField
            label="Confidence"
            value={confidenceFilter}
            options={[...confidenceOptions]}
            onChange={(value) => setConfidenceFilter(value as ConfidenceFilter)}
          />
          <DashboardSelectField
            label="Decision"
            value={decisionFilter}
            options={[...decisionOptions]}
            onChange={(value) => setDecisionFilter(value as DecisionFilter)}
          />
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Decision</th>
                <th className="px-3 py-2.5 text-left font-medium">Creator</th>
                <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                <th className="px-3 py-2.5 text-left font-medium">Contact</th>
                <th className="px-3 py-2.5 text-left font-medium">Title</th>
                <th className="px-3 py-2.5 text-left font-medium">Email</th>
                <th className="px-3 py-2.5 text-left font-medium">Confidence</th>
                <th className="px-3 py-2.5 text-left font-medium">Match</th>
                <th className="px-3 py-2.5 text-left font-medium">Draft</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.length === 0 && (
                <tr className="border-t border-border/60">
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No contacts loaded yet.
                  </td>
                </tr>
              )}
              {filteredContacts.map((contact) => {
                const decision = contactDecisions[contact.id] ?? "pending";
                const gmailResult = gmailResults[contact.id];
                return (
                  <tr key={contact.id} className="tb-row-hover border-t border-border/60">
                    <td className="min-w-[140px] px-3 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          title="Approve"
                          onClick={() => setDecision(contact.id, "approved")}
                          className={cn(
                            "tb-action flex h-9 w-9 items-center justify-center rounded-full border",
                            decision === "approved"
                              ? "border-fun-lime bg-fun-lime/35 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-accent",
                          )}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Reject"
                          onClick={() => setDecision(contact.id, "rejected")}
                          className={cn(
                            "tb-action flex h-9 w-9 items-center justify-center rounded-full border",
                            decision === "rejected"
                              ? "border-destructive/40 bg-destructive/15 text-destructive"
                              : "border-border bg-background text-muted-foreground hover:bg-accent",
                          )}
                        >
                          <XIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <span
                        className={cn(
                          "mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold",
                          decisionTone(decision),
                        )}
                      >
                        {decisionLabel(decision)}
                      </span>
                    </td>
                    <td className="min-w-[160px] px-3 py-3 text-muted-foreground">
                      {contact.creatorName}
                    </td>
                    <td className="min-w-[160px] px-3 py-3">
                      <div className="font-semibold">{contact.brandName}</div>
                      <div className="text-xs text-muted-foreground">
                        {contact.domain || contact.company}
                      </div>
                    </td>
                    <td className="min-w-[170px] px-3 py-3 font-medium">{contact.name}</td>
                    <td className="min-w-[220px] px-3 py-3 text-muted-foreground">
                      {contact.title}
                    </td>
                    <td className="min-w-[220px] px-3 py-3">
                      {contact.email ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await copyToClipboard(contact.email);
                            flashCopied(`email-${contact.id}`);
                          }}
                          className="tb-action inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground hover:bg-accent"
                        >
                          {copiedKey === `email-${contact.id}` ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {contact.email}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">Missing email</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2.5 py-1 text-xs font-bold",
                          statusTone(contact.confidence),
                        )}
                      >
                        {contact.confidence}
                      </span>
                    </td>
                    <td className="min-w-[260px] px-3 py-3 text-xs text-muted-foreground">
                      {contact.reason}
                    </td>
                    <td className="min-w-[150px] px-3 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-bold",
                          gmailResult?.ok
                            ? "bg-fun-lime/25 text-foreground"
                            : gmailResult && !gmailResult.ok
                              ? "bg-destructive/10 text-destructive"
                              : decision === "approved"
                                ? "bg-fun-yellow/20 text-foreground"
                                : "bg-muted text-muted-foreground",
                        )}
                      >
                        {gmailResult?.ok
                          ? "Created"
                          : gmailResult
                            ? "Failed"
                            : decision === "approved"
                              ? "Queued"
                              : "Not queued"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {csvInput && (
          <div className="mt-4 rounded-2xl border border-border bg-background p-4">
            <Textarea
              value={csvInput}
              onChange={(event) => setCsvInput(event.target.value)}
              className="min-h-28 rounded-2xl bg-background text-sm"
            />
            <button
              type="button"
              onClick={() => importCsvText(csvInput)}
              className="tb-action mt-3 inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Upload className="h-4 w-4" />
              Import pasted CSV
            </button>
          </div>
        )}
      </Panel>

      <Panel
        title="Draft queue"
        subtitle={`${draftPreviews.length} approved contacts ready for Gmail.`}
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={draftPreviews.length === 0}
              onClick={() =>
                downloadCsv("team-billion-gmail-draft-queue.csv", [
                  ["Email", "Subject", "Body", "Creator", "Brand", "Contact", "Title"],
                  ...draftPreviews.map((draft) => [
                    draft.email,
                    draft.subject,
                    draft.body,
                    draft.contact.creatorName,
                    draft.contact.brandName,
                    draft.contact.name,
                    draft.contact.title,
                  ]),
                ])
              }
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              type="button"
              disabled={isCreatingDrafts || draftPreviews.length === 0}
              onClick={() => void createDrafts()}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreatingDrafts ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Create Gmail drafts
            </button>
          </div>
        }
      >
        {draftError && (
          <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
            {draftError}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {draftPreviews.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm font-medium text-muted-foreground lg:col-span-2">
              Approved contacts will appear here.
            </div>
          )}
          {draftPreviews.map((draft) => {
            const gmailResult = gmailResults[draft.id];
            return (
              <article
                key={draft.id}
                className="rounded-2xl border border-border bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">{draft.contact.brandName}</div>
                    <div className="text-xs text-muted-foreground">
                      {draft.contact.creatorName} · {draft.contact.name} · {draft.email}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await copyToClipboard(
                        `To: ${draft.email}\nSubject: ${draft.subject}\n\n${draft.body}`,
                      );
                      flashCopied(`draft-${draft.id}`);
                    }}
                    className="tb-action inline-flex h-9 items-center gap-2 rounded-2xl bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  >
                    {copiedKey === `draft-${draft.id}` ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Copy
                  </button>
                </div>
                {gmailResult && (
                  <div
                    className={cn(
                      "mt-3 rounded-xl p-2 text-xs font-semibold",
                      gmailResult.ok
                        ? "bg-fun-lime/20 text-foreground"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {gmailResult.message}
                  </div>
                )}
                <div className="mt-4 rounded-xl bg-card p-3 text-sm font-semibold">
                  {draft.subject}
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-card p-3 text-sm leading-relaxed text-muted-foreground">
                  {draft.body}
                </pre>
              </article>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {subtitle && <p className="mt-1 text-xs font-medium text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function FilterTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-4 block text-sm font-semibold">
      {label}
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-24 rounded-2xl bg-background text-sm"
      />
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-3 py-2 text-sm font-semibold">
      <span>{label}</span>
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
    </label>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Inbox;
}) {
  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-5 ring-1 ring-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
        </div>
        <div className="tb-hover-icon flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
