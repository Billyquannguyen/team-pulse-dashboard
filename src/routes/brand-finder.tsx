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
  Mail,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelectField } from "@/components/ui/dashboard-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { activeBrandsQuery } from "@/lib/active-brands";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/brand-finder")({
  head: () => ({
    meta: [
      { title: "Creator Brand Outreach — Team Billion" },
      {
        name: "description",
        content: "Clean creator dream brands, find brand contacts, and prepare outreach drafts.",
      },
    ],
  }),
  component: BrandFinderPage,
});

const STORAGE_KEY = "team-billion-brand-finder-v2";
const MANUAL_CREATOR_ID = "manual";
const ALL_BRANDS = "All brands";
const ALL_CONFIDENCE = "All confidence";

const DEFAULT_SUBJECT_TEMPLATE = "Creator partnership for {{brand_name}}";
const DEFAULT_BODY_TEMPLATE = `Hi {{first_name}},

I'm reaching out from Team Billion. We manage {{creator_name}}, whose audience is a strong fit for {{brand_name}}.

Would you be open to reviewing a paid creator partnership?

Best,
{{sender_name}}`;

const ROLE_FILTERS = [
  "Influencer Marketing",
  "Creator Partnerships",
  "Brand Partnerships",
  "Partnerships",
  "Affiliate",
  "PR",
  "Public Relations",
  "Social Media",
  "Brand Manager",
  "Growth Marketing",
  "Head of Marketing",
  "Marketing Manager",
  "Founder",
];

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

const confidenceOptions = [ALL_CONFIDENCE, "High", "Medium", "Low"] as const;
type ConfidenceFilter = (typeof confidenceOptions)[number];
type ContactConfidence = "High" | "Medium" | "Low";
type TemplateTarget = "subject" | "body";
type BrandSearchStatus = "ready" | "needs-domain" | "already-found" | "existing-relationship";
type BrandHistorySource = "Active Brands" | "Deals" | "Current search";

type CreatorOption = {
  id: string;
  label: string;
  name: string;
  handle: string;
  owner: string;
  niche: string;
  platform: string;
  rate: string;
};

type KnownBrand = {
  name: string;
  domain: string;
  sources: Set<BrandHistorySource>;
  hasContacts: boolean;
  hasDeals: boolean;
};

type BrandSeed = {
  id: string;
  rawName: string;
  name: string;
  domain: string;
  creatorName: string;
  matchedKnownName: string;
  parserNote: string;
  status: BrandSearchStatus;
  statusMessage: string;
};

type ContactCandidate = {
  id: string;
  creatorName: string;
  brandName: string;
  domain: string;
  name: string;
  title: string;
  company: string;
  email: string;
  linkedin: string;
  confidence: ContactConfidence;
  reason: string;
  source: "A-Leads CSV" | "A-Leads API";
};

type SavedBrandFinderState = {
  selectedCreatorId?: string;
  manualCreatorName?: string;
  senderName?: string;
  dreamBrandInput?: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
  contacts?: ContactCandidate[];
  selectedIds?: string[];
  preparedDraftIds?: string[];
};

type DraftPreview = {
  id: string;
  email: string;
  subject: string;
  body: string;
  contact: ContactCandidate;
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

function parseLooseTable(text: string) {
  const cleaned = text.trim();
  if (!cleaned) return { headers: [] as string[], rows: [] as string[][] };

  const withOptionalHeader = (rows: string[][], defaultHeaders: string[]) => {
    const [firstRow = [], ...bodyRows] = rows;
    const firstRowText = firstRow.map(normalizedHeader).join(" ");
    const looksLikeHeader =
      /\b(creator|talent|dream brand|brand|company|website|domain|url)\b/.test(firstRowText);

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

function normalizedHeader(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function getDisplayCreatorName(creator: CreatorOption | null, manualCreatorName: string) {
  if (creator?.id && creator.id !== MANUAL_CREATOR_ID) return creator.handle || creator.name;
  return manualCreatorName.trim() || "Selected creator";
}

function buildCreatorOptions(
  creators: Array<{
    id: string;
    handle: string;
    owner: string;
    niche: string;
    platform: string;
    estimatedRate?: string;
  }>,
) {
  return [
    {
      id: MANUAL_CREATOR_ID,
      label: "Manual creator",
      name: "",
      handle: "",
      owner: "",
      niche: "",
      platform: "",
      rate: "",
    },
    ...creators.map((creator) => ({
      id: creator.id,
      label: `${creator.handle} · ${creator.owner}`,
      name: creator.handle.replace(/^@/, ""),
      handle: creator.handle,
      owner: creator.owner,
      niche: creator.niche,
      platform: creator.platform,
      rate: creator.estimatedRate ?? "",
    })),
  ];
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

function parseDreamBrands(
  input: string,
  selectedCreatorName: string,
  knownBrands: KnownBrand[],
  contacts: ContactCandidate[],
): BrandSeed[] {
  const { headers, rows } = parseLooseTable(input);
  const creatorIndex = pickColumn(headers, ["creator", "talent", "handle", "name"]);
  const brandIndex = pickColumn(headers, [
    "dream brand",
    "brand",
    "brand name",
    "company",
    "company name",
  ]);
  const domainIndex = pickColumn(headers, [
    "website",
    "domain",
    "brand website",
    "company website",
    "url",
  ]);
  const seen = new Set<string>();
  const sessionContactBrands = new Set(contacts.map((contact) => compactKey(contact.brandName)));

  return rows
    .map((row) => {
      const rowCreator = creatorIndex >= 0 ? (row[creatorIndex]?.trim() ?? "") : "";
      if (
        rowCreator &&
        selectedCreatorName !== "Selected creator" &&
        compactKey(rowCreator) !== compactKey(selectedCreatorName)
      ) {
        return null;
      }

      const fallbackLine = row.join(" | ");
      const rawBrand =
        (brandIndex >= 0 ? row[brandIndex]?.trim() : "") ||
        row.find((cell) => cell.trim() && !extractDomain(cell) && !/@/.test(cell))?.trim() ||
        fallbackLine;
      const explicitDomain = domainIndex >= 0 ? (row[domainIndex]?.trim() ?? "") : "";
      const extractedDomain = extractDomain(explicitDomain || fallbackLine);
      const fixedName = COMMON_BRAND_FIXES[normalizeText(rawBrand)] ?? rawBrand;
      const knownMatch = findKnownBrand(knownBrands, fixedName, extractedDomain);
      const cleanName =
        knownMatch?.brand.name || titleCase(fixedName.replace(extractedDomain, "").trim());
      const domain = knownMatch?.brand.domain || extractedDomain;
      const key = compactKey(domain || cleanName);
      const hasSessionContacts = sessionContactBrands.has(compactKey(cleanName));
      const hasKnownContacts = Boolean(knownMatch?.brand.hasContacts);
      const hasKnownDeals = Boolean(knownMatch?.brand.hasDeals);
      const parserNote =
        knownMatch && compactKey(knownMatch.brand.name) !== compactKey(rawBrand)
          ? `Cleaned "${rawBrand}" to "${knownMatch.brand.name}"`
          : cleanName !== rawBrand
            ? `Cleaned "${rawBrand}" to "${cleanName}"`
            : "";
      const status: BrandSearchStatus =
        hasSessionContacts || hasKnownContacts
          ? "already-found"
          : hasKnownDeals
            ? "existing-relationship"
            : domain
              ? "ready"
              : "needs-domain";
      const statusMessage =
        status === "already-found"
          ? "Contacts for this brand have already been found. Check email history or Active Brands before searching again."
          : status === "existing-relationship"
            ? "This brand appears in deal history. Check the relationship before searching again."
            : status === "needs-domain"
              ? "Add a website/domain to make the A-Leads match safer."
              : "Ready for A-Leads search.";

      if (!key || seen.has(key)) return null;
      seen.add(key);

      return {
        id: key,
        rawName: rawBrand,
        name: cleanName || rawBrand,
        domain,
        creatorName: selectedCreatorName,
        matchedKnownName: knownMatch?.brand.name ?? "",
        parserNote,
        status,
        statusMessage,
      };
    })
    .filter((brand): brand is BrandSeed => brand !== null);
}

function findMatchingBrand(brands: BrandSeed[], company: string, domain: string): BrandSeed | null {
  if (brands.length === 0) return null;

  const normalizedDomain = normalizeDomain(domain);
  if (normalizedDomain) {
    const domainMatch = brands.find((brand) => brand.domain && brand.domain === normalizedDomain);
    if (domainMatch) return domainMatch;
  }

  const companyKey = compactKey(company);
  if (companyKey) {
    const companyMatch = brands.find((brand) => {
      const brandKey = compactKey(brand.name);
      return (
        companyKey === brandKey || companyKey.includes(brandKey) || brandKey.includes(companyKey)
      );
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
  add(1, "growth/community", [/growth/, /community/]);
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

function parseAleadsContacts(csvText: string, brands: BrandSeed[]): ContactCandidate[] {
  const { headers, rows } = parseCsv(csvText);
  const contacts = rows
    .map((row) => {
      const firstName = getCell(headers, row, ["first name", "firstname"]);
      const lastName = getCell(headers, row, ["last name", "lastname"]);
      const fullName =
        getCell(headers, row, ["name", "full name", "contact name", "person name"]) ||
        [firstName, lastName].filter(Boolean).join(" ");
      const title = getCell(headers, row, [
        "job title",
        "title",
        "position",
        "current title",
        "role",
      ]);
      const company = getCell(headers, row, ["company", "company name", "organization", "account"]);
      const email = getCell(
        headers,
        row,
        ["email", "email address", "work email", "business email", "verified email"],
        ["status", "valid", "verification", "confidence"],
      );
      const linkedin = getCell(headers, row, [
        "linkedin",
        "linkedin url",
        "linkedin profile",
        "person linkedin",
        "profile url",
      ]);
      const rowDomain =
        getCell(headers, row, [
          "company domain",
          "domain",
          "website",
          "company website",
          "organization website",
        ]) || extractDomain(row.join(" "));
      const domain = normalizeDomain(rowDomain);
      const matchedBrand = findMatchingBrand(brands, company, domain);
      const brandName = matchedBrand?.name || company || domainToName(domain) || "Imported brand";
      const brandDomain = matchedBrand?.domain || domain;
      const score = scoreContact(title, email);
      const contactWithoutId: Omit<ContactCandidate, "id"> = {
        creatorName: matchedBrand?.creatorName || "Selected creator",
        brandName,
        domain: brandDomain,
        name: fullName || "Unknown contact",
        title: title || "Title missing",
        company: company || brandName,
        email,
        linkedin,
        confidence: score.confidence,
        reason: matchedBrand
          ? `${score.reason}; matched to ${matchedBrand.domain ? matchedBrand.domain : matchedBrand.name}`
          : score.reason,
        source: "A-Leads CSV",
      };

      return {
        ...contactWithoutId,
        id: buildContactId(contactWithoutId),
      };
    })
    .filter(
      (contact) =>
        contact.name !== "Unknown contact" || contact.email || contact.title !== "Title missing",
    );

  const seen = new Set<string>();
  return contacts.filter((contact) => {
    if (!contact.id || seen.has(contact.id)) return false;
    seen.add(contact.id);
    return true;
  });
}

function mergeContacts(existing: ContactCandidate[], incoming: ContactCandidate[]) {
  const byId = new Map(existing.map((contact) => [contact.id, contact]));
  incoming.forEach((contact) => {
    byId.set(contact.id, contact);
  });
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

function fillTemplate(
  template: string,
  contact: ContactCandidate,
  creator: CreatorOption | null,
  manualCreatorName: string,
  senderName: string,
) {
  const firstName = contact.name.split(/\s+/)[0] || contact.name;
  const creatorName = contact.creatorName || getDisplayCreatorName(creator, manualCreatorName);
  const replacements: Record<string, string> = {
    brand_name: contact.brandName,
    company_name: contact.company,
    contact_name: contact.name,
    first_name: firstName,
    title: contact.title,
    domain: contact.domain,
    creator_name: creatorName || "[creator name]",
    creator_handle: creator?.handle || creatorName || "[creator handle]",
    creator_niche: creator?.niche || "[creator niche]",
    creator_platform: creator?.platform || "[creator platform]",
    creator_owner: creator?.owner || "[creator owner]",
    creator_rate: creator?.rate || "[creator rate]",
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
  if (status === "needs-domain") return "border-fun-yellow/60 bg-fun-yellow/20 text-foreground";
  if (status === "existing-relationship")
    return "border-fun-blue/60 bg-fun-blue/20 text-foreground";
  return "border-destructive/25 bg-destructive/10 text-destructive";
}

function BrandFinderPage() {
  const saved = useMemo(readSavedState, []);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { data: dashboardData } = useQuery(dashboardSheetQuery);
  const { data: activeBrandsData } = useQuery(activeBrandsQuery);
  const creatorOptions = useMemo(
    () => buildCreatorOptions(dashboardData?.creators ?? []),
    [dashboardData?.creators],
  );
  const [selectedCreatorId, setSelectedCreatorId] = useState(
    saved.selectedCreatorId ?? MANUAL_CREATOR_ID,
  );
  const [manualCreatorName, setManualCreatorName] = useState(saved.manualCreatorName ?? "");
  const [senderName, setSenderName] = useState(saved.senderName ?? "");
  const [dreamBrandInput, setDreamBrandInput] = useState(saved.dreamBrandInput ?? "");
  const [subjectTemplate, setSubjectTemplate] = useState(
    saved.subjectTemplate ?? DEFAULT_SUBJECT_TEMPLATE,
  );
  const [bodyTemplate, setBodyTemplate] = useState(saved.bodyTemplate ?? DEFAULT_BODY_TEMPLATE);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget>("body");
  const [csvInput, setCsvInput] = useState("");
  const [contacts, setContacts] = useState<ContactCandidate[]>(saved.contacts ?? []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(saved.selectedIds ?? []),
  );
  const [preparedDraftIds, setPreparedDraftIds] = useState<Set<string>>(
    () => new Set(saved.preparedDraftIds ?? []),
  );
  const [q, setQ] = useState("");
  const [brandFilter, setBrandFilter] = useState(ALL_BRANDS);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>(ALL_CONFIDENCE);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const selectedCreator =
    creatorOptions.find((creator) => creator.id === selectedCreatorId) ?? creatorOptions[0] ?? null;
  const selectedCreatorName = getDisplayCreatorName(selectedCreator, manualCreatorName);

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

  const brands = useMemo(
    () => parseDreamBrands(dreamBrandInput, selectedCreatorName, knownBrands, contacts),
    [contacts, dreamBrandInput, knownBrands, selectedCreatorName],
  );
  const brandsToSearch = useMemo(
    () => brands.filter((brand) => brand.status !== "already-found"),
    [brands],
  );
  const alreadyFoundCount = brands.filter((brand) => brand.status === "already-found").length;
  const needsReviewCount = brands.filter(
    (brand) => brand.status === "needs-domain" || brand.status === "existing-relationship",
  ).length;
  const highConfidenceCount = contacts.filter((contact) => contact.confidence === "High").length;
  const brandOptions = useMemo(
    () => [
      ALL_BRANDS,
      ...Array.from(
        new Set([...brands.map((brand) => brand.name), ...contacts.map((c) => c.brandName)]),
      )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    ],
    [brands, contacts],
  );
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedIds.has(contact.id)),
    [contacts, selectedIds],
  );
  const draftPreviews: DraftPreview[] = useMemo(
    () =>
      contacts
        .filter((contact) => preparedDraftIds.has(contact.id))
        .map((contact) => ({
          id: contact.id,
          email: contact.email,
          subject: fillTemplate(
            subjectTemplate,
            contact,
            selectedCreator,
            manualCreatorName,
            senderName,
          ),
          body: fillTemplate(bodyTemplate, contact, selectedCreator, manualCreatorName, senderName),
          contact,
        })),
    [
      bodyTemplate,
      contacts,
      manualCreatorName,
      preparedDraftIds,
      selectedCreator,
      senderName,
      subjectTemplate,
    ],
  );
  const filteredContacts = useMemo(() => {
    const query = q.trim().toLowerCase();
    return contacts.filter((contact) => {
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
      const matchesConfidence =
        confidenceFilter === ALL_CONFIDENCE || contact.confidence === confidenceFilter;
      return matchesQuery && matchesBrand && matchesConfidence;
    });
  }, [brandFilter, confidenceFilter, contacts, q]);
  const contactsByBrand = useMemo(() => {
    const map = new Map<string, number>();
    contacts.forEach((contact) => {
      map.set(contact.brandName, (map.get(contact.brandName) ?? 0) + 1);
    });
    return map;
  }, [contacts]);
  const readySelectedCount = selectedContacts.filter((contact) => contact.email).length;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const nextState: SavedBrandFinderState = {
      selectedCreatorId,
      manualCreatorName,
      senderName,
      dreamBrandInput,
      subjectTemplate,
      bodyTemplate,
      contacts,
      selectedIds: Array.from(selectedIds),
      preparedDraftIds: Array.from(preparedDraftIds),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [
    bodyTemplate,
    contacts,
    dreamBrandInput,
    manualCreatorName,
    preparedDraftIds,
    selectedCreatorId,
    selectedIds,
    senderName,
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

  const importCsvText = (text: string) => {
    const imported = parseAleadsContacts(text, brands);
    setContacts((current) => mergeContacts(current, imported));
    setCsvInput("");
  };

  const handleFileImport = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    importCsvText(text);
  };

  const toggleContact = (contactId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(contactId);
      } else {
        next.delete(contactId);
      }
      return next;
    });

    if (!checked) {
      setPreparedDraftIds((current) => {
        const next = new Set(current);
        next.delete(contactId);
        return next;
      });
    }
  };

  const selectRecommended = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      contacts
        .filter((contact) => contact.email && contact.confidence !== "Low")
        .forEach((contact) => next.add(contact.id));
      return next;
    });
  };

  const clearSelections = () => {
    setSelectedIds(new Set());
    setPreparedDraftIds(new Set());
  };

  const prepareDrafts = () => {
    setPreparedDraftIds((current) => {
      const next = new Set(current);
      selectedContacts
        .filter((contact) => contact.email)
        .forEach((contact) => next.add(contact.id));
      return next;
    });
  };

  const resetWorkspace = () => {
    const confirmed = window.confirm("Clear the Brand Finder workspace?");
    if (!confirmed) return;

    setSelectedCreatorId(MANUAL_CREATOR_ID);
    setManualCreatorName("");
    setSenderName("");
    setDreamBrandInput("");
    setSubjectTemplate(DEFAULT_SUBJECT_TEMPLATE);
    setBodyTemplate(DEFAULT_BODY_TEMPLATE);
    setCsvInput("");
    setContacts([]);
    setSelectedIds(new Set());
    setPreparedDraftIds(new Set());
    setQ("");
    setBrandFilter(ALL_BRANDS);
    setConfidenceFilter(ALL_CONFIDENCE);
    window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Creator Brand Outreach"
        subtitle="Clean dream brands, avoid duplicate searches, and prepare creator-specific drafts."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Dream brands" value={brands.length.toLocaleString()} icon={Inbox} />
        <MetricTile
          label="Already found"
          value={alreadyFoundCount.toLocaleString()}
          icon={History}
        />
        <MetricTile
          label="Needs check"
          value={needsReviewCount.toLocaleString()}
          icon={AlertTriangle}
        />
        <MetricTile
          label="Drafts ready"
          value={draftPreviews.length.toLocaleString()}
          icon={Mail}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
        <div className="space-y-4">
          <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Creator setup</h2>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  Select the creator before adding dream brands.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={brandsToSearch.length === 0}
                  onClick={() =>
                    downloadCsv("creator-dream-brands-a-leads-search.csv", [
                      ["Creator", "Brand", "Website", "Status"],
                      ...brandsToSearch.map((brand) => [
                        brand.creatorName,
                        brand.name,
                        brand.domain,
                        brand.status,
                      ]),
                    ])
                  }
                  className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  A-Leads CSV
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await copyToClipboard(ROLE_FILTERS.join(", "));
                    flashCopied("filters");
                  }}
                  className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  {copiedKey === "filters" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Clipboard className="h-4 w-4" />
                  )}
                  Role filters
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.6fr)]">
              <DashboardSelectField
                label="Creator"
                value={selectedCreatorId}
                options={creatorOptions.map((creator) => ({
                  value: creator.id,
                  label: creator.label,
                }))}
                onChange={setSelectedCreatorId}
              />
              <label className="text-sm font-semibold">
                Sender
                <input
                  value={senderName}
                  onChange={(event) => setSenderName(event.target.value)}
                  placeholder="Your name"
                  className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
            </div>

            {selectedCreatorId === MANUAL_CREATOR_ID && (
              <label className="mt-3 block text-sm font-semibold">
                Creator name
                <input
                  value={manualCreatorName}
                  onChange={(event) => setManualCreatorName(event.target.value)}
                  placeholder="Creator name or handle"
                  className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
            )}

            {selectedCreator && selectedCreator.id !== MANUAL_CREATOR_ID && (
              <div className="mt-3 grid gap-2 rounded-2xl bg-muted/60 p-3 text-xs font-semibold text-muted-foreground sm:grid-cols-4">
                <span>Owner: {selectedCreator.owner || "-"}</span>
                <span>Niche: {selectedCreator.niche || "-"}</span>
                <span>Platform: {selectedCreator.platform || "-"}</span>
                <span>Rate: {selectedCreator.rate || "-"}</span>
              </div>
            )}

            <label className="mt-4 block text-sm font-semibold">
              Dream brands
              <Textarea
                value={dreamBrandInput}
                onChange={(event) => setDreamBrandInput(event.target.value)}
                placeholder="Rhode | rhodeskin.com&#10;Gym shark&#10;Popi | drinkpoppi.com"
                className="mt-1 min-h-36 rounded-2xl bg-background text-sm"
              />
            </label>
          </div>

          <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">A-Leads results</h2>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  Import the contacts after A-Leads runs.
                </p>
              </div>
              <label className="tb-action inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90">
                <FileSpreadsheet className="h-4 w-4" />
                Import CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    void handleFileImport(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            <Textarea
              value={csvInput}
              onChange={(event) => setCsvInput(event.target.value)}
              placeholder="Paste A-Leads CSV export here..."
              className="mt-4 min-h-28 rounded-2xl bg-background text-sm"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-medium text-muted-foreground">
                Contacts are matched back to the creator and dream brand.
              </div>
              <button
                type="button"
                disabled={!csvInput.trim()}
                onClick={() => importCsvText(csvInput)}
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                Import pasted CSV
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">Email template</h2>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                Edit once, then prepare drafts from approved contacts.
              </p>
            </div>
            <button
              type="button"
              onClick={resetWorkspace}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTemplateTarget("subject")}
              className={cn(
                "tb-action h-9 rounded-2xl px-3 text-xs font-bold",
                templateTarget === "subject"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              Subject fields
            </button>
            <button
              type="button"
              onClick={() => setTemplateTarget("body")}
              className={cn(
                "tb-action h-9 rounded-2xl px-3 text-xs font-bold",
                templateTarget === "body"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              Body fields
            </button>
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
              className="mt-1 min-h-64 rounded-2xl bg-background text-sm"
            />
          </label>

          <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-xs font-medium text-muted-foreground">
            Gmail draft creation can be wired after the A-Leads test search is stable.
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Dream brand review</h2>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              Parser cleanup and search warnings.
            </p>
          </div>
          <button
            type="button"
            disabled={brandsToSearch.length === 0}
            onClick={() =>
              downloadCsv("creator-dream-brands-a-leads-search.csv", [
                ["Creator", "Brand", "Website", "Status", "Note"],
                ...brandsToSearch.map((brand) => [
                  brand.creatorName,
                  brand.name,
                  brand.domain,
                  brand.status,
                  brand.parserNote || brand.statusMessage,
                ]),
              ])
            }
            className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export search list
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                <th className="px-3 py-2.5 text-left font-medium">Website</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="px-3 py-2.5 text-left font-medium">Parser</th>
                <th className="px-3 py-2.5 text-left font-medium">Contacts</th>
              </tr>
            </thead>
            <tbody>
              {brands.length === 0 && (
                <tr className="border-t border-border/60">
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No dream brands loaded yet.
                  </td>
                </tr>
              )}
              {brands.map((brand) => (
                <tr key={brand.id} className="tb-row-hover border-t border-border/60">
                  <td className="min-w-[180px] px-3 py-3">
                    <div className="font-semibold">{brand.name}</div>
                    {brand.rawName !== brand.name && (
                      <div className="text-xs text-muted-foreground">From: {brand.rawName}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{brand.domain || "-"}</td>
                  <td className="min-w-[280px] px-3 py-3">
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
                          : brand.status === "needs-domain"
                            ? "Needs website"
                            : "Ready"}
                    </span>
                    <div className="mt-1 text-xs text-muted-foreground">{brand.statusMessage}</div>
                  </td>
                  <td className="min-w-[220px] px-3 py-3 text-xs text-muted-foreground">
                    {brand.parserNote || "No cleanup needed"}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-bold",
                        contactsByBrand.has(brand.name)
                          ? "bg-fun-lime/25 text-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {contactsByBrand.get(brand.name) ?? 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Contact review</h2>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              Tick the people you want to reach.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={contacts.length === 0}
              onClick={selectRecommended}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Select recommended
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={clearSelections}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Clear selected
            </button>
            <button
              type="button"
              disabled={readySelectedCount === 0}
              onClick={prepareDrafts}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Prepare drafts
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search contact, title, brand, email..."
              className="tb-search h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
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
            <div className="text-xs font-medium text-muted-foreground">
              Showing <span className="text-foreground">{filteredContacts.length}</span> of{" "}
              <span className="text-foreground">{contacts.length}</span> contacts ·{" "}
              <span className="text-foreground">{selectedIds.size}</span> selected ·{" "}
              <span className="text-foreground">{highConfidenceCount}</span> high confidence
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-12 px-3 py-2.5 text-left font-medium">Use</th>
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
              {filteredContacts.map((contact) => (
                <tr
                  key={contact.id}
                  className="tb-row-hover border-t border-border/60 hover:bg-muted/40"
                >
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={selectedIds.has(contact.id)}
                      onCheckedChange={(checked) => toggleContact(contact.id, checked === true)}
                      aria-label={`Use ${contact.name}`}
                    />
                  </td>
                  <td className="min-w-[150px] px-3 py-3 text-muted-foreground">
                    {contact.creatorName}
                  </td>
                  <td className="min-w-[150px] px-3 py-3">
                    <div className="font-semibold">{contact.brandName}</div>
                    <div className="text-xs text-muted-foreground">
                      {contact.domain || contact.company}
                    </div>
                  </td>
                  <td className="min-w-[160px] px-3 py-3 font-medium">{contact.name}</td>
                  <td className="min-w-[220px] px-3 py-3 text-muted-foreground">{contact.title}</td>
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
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-bold",
                        preparedDraftIds.has(contact.id)
                          ? "bg-fun-lime/25 text-foreground"
                          : selectedIds.has(contact.id)
                            ? "bg-fun-yellow/20 text-foreground"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {preparedDraftIds.has(contact.id)
                        ? "Ready"
                        : selectedIds.has(contact.id)
                          ? "Selected"
                          : "Not selected"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Draft queue</h2>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              Review before Gmail creation.
            </p>
          </div>
          <button
            type="button"
            disabled={draftPreviews.length === 0}
            onClick={() =>
              downloadCsv("creator-brand-draft-queue.csv", [
                ["Creator", "Email", "Subject", "Body", "Brand", "Contact", "Title"],
                ...draftPreviews.map((draft) => [
                  draft.contact.creatorName,
                  draft.email,
                  draft.subject,
                  draft.body,
                  draft.contact.brandName,
                  draft.contact.name,
                  draft.contact.title,
                ]),
              ])
            }
            className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export drafts
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {draftPreviews.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm font-medium text-muted-foreground lg:col-span-2">
              Prepared drafts will appear here.
            </div>
          )}
          {draftPreviews.map((draft) => (
            <article key={draft.id} className="rounded-2xl border border-border bg-background p-4">
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
              <div className="mt-4 rounded-xl bg-card p-3 text-sm font-semibold">
                {draft.subject}
              </div>
              <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-card p-3 text-sm leading-relaxed text-muted-foreground">
                {draft.body}
              </pre>
            </article>
          ))}
        </div>
      </section>
    </div>
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
