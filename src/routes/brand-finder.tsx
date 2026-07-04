import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  Database,
  ListPlus,
  Loader2,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelectField } from "@/components/ui/dashboard-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { searchApolloContacts, type ApolloContactResult } from "@/lib/apollo";
import { contactDatabaseQuery, upsertContactDatabaseContacts } from "@/lib/contact-database";
import type { ContactDatabaseContact } from "@/lib/contact-database";
import { createGmailDrafts } from "@/lib/gmail-drafts";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/brand-finder")({
  head: () => ({
    meta: [
      { title: "Brand Finder - Team Billion" },
      {
        name: "description",
        content: "Upload dream brand sheets, run Apollo, and create Gmail drafts.",
      },
    ],
  }),
  component: BrandFinderPage,
});

const STORAGE_KEY = "team-billion-brand-finder-apollo-v1";
const ALL_BRANDS = "All brands";

const DEFAULT_SUBJECT_TEMPLATE = "Creator partnership for {{brand_name}}";
const DEFAULT_BODY_TEMPLATE = `Hi {{contact_first_name}},

I'm reaching out from Team Billion about a potential paid creator partnership with {{brand_name}}.

Would you be open to reviewing this?
`;

const TEMPLATE_FIELDS = ["contact_first_name", "brand_name"] as const;

const DEFAULT_JOB_TITLES = [
  "influencer marketing",
  "account manager",
  "creator partnerships",
];

const DEFAULT_EXCLUDE_TITLES = ["SEO", "Digital Marketing", "Analyst", "performance marketing"];
const DEFAULT_DEPARTMENTS = ["marketing"];
const DEFAULT_EMAIL_STATUSES = ["verified", "likely to engage"];

type TemplateTarget = "subject" | "body";
type BrandStatus = "unknown" | "none" | "database";

type ApolloFilterState = {
  jobTitlesText: string;
  excludeTitlesText: string;
  departmentsText: string;
  seniorityText: string;
  emailStatusesText: string;
  includeSimilarTitles: boolean;
  maxContactsPerBrand: number;
  requireEmail: boolean;
  enrichEmails: boolean;
};

type BrandRow = {
  id: string;
  rowNumber: number;
  rawName: string;
  brandName: string;
  domain: string;
};

type BrandOverride = {
  brandName?: string;
  domain?: string;
};

type ContactRow = {
  id: string;
  brandId: string;
  brandName: string;
  contactName: string;
  contactFirstName: string;
  email: string;
  position: string;
  emailStatus?: string;
  source?: string;
};

type SavedBrandFinderState = {
  sheetInput?: string;
  sheetFileName?: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
  filters?: ApolloFilterState;
  brandOverrides?: Record<string, BrandOverride>;
  brandSearchOverrides?: Record<string, boolean>;
  directSearchBrandIds?: string[];
  directSearchQuery?: string;
  directActiveSearch?: string;
  directSelectedContactIds?: string[];
  savedDraftContacts?: ContactRow[];
  contacts?: ContactRow[];
  selectedContactIds?: string[];
  draftMessage?: string;
};

const DEFAULT_FILTER_STATE: ApolloFilterState = {
  jobTitlesText: DEFAULT_JOB_TITLES.join("\n"),
  excludeTitlesText: DEFAULT_EXCLUDE_TITLES.join("\n"),
  departmentsText: DEFAULT_DEPARTMENTS.join("\n"),
  seniorityText: "",
  emailStatusesText: DEFAULT_EMAIL_STATUSES.join("\n"),
  includeSimilarTitles: true,
  maxContactsPerBrand: 2,
  requireEmail: true,
  enrichEmails: true,
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

function extractDomain(value: string) {
  const match =
    value.match(/https?:\/\/[^\s,|]+/i) ??
    value.match(/www\.[^\s,|]+/i) ??
    value.match(/[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s,|]*)?/i);

  return match ? normalizeDomain(match[0]) : "";
}

function domainToName(domain: string) {
  const firstPart = domain.split(".")[0] ?? "";
  return titleCase(firstPart.split(/[-_]/).filter(Boolean).join(" "));
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
    const looksLikeHeader = /\b(dream brand|brand|company|website|domain|url)\b/.test(firstRowText);

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
        header.includes("email");
      return looksLikeBrand && !denied;
    })
    .map(({ index }) => index);

  if (indexes.length > 0) return indexes;

  const fallback = pickColumn(headers, ["dream brand", "brand", "brand name", "company"]);
  return fallback >= 0 ? [fallback] : [];
}

function parseDreamSheet(input: string): BrandRow[] {
  const { headers, rows } = parseLooseTable(input);
  const domainIndex = pickColumn(headers, [
    "website",
    "domain",
    "brand website",
    "company website",
    "url",
  ]);
  const brandIndexes = brandColumnIndexes(headers);
  const seen = new Set<string>();
  const brands: BrandRow[] = [];

  rows.forEach((row, rowIndex) => {
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
      const extractedDomain = extractDomain(explicitDomain || brandCell || rowText);
      const rawName = brandCell.replace(extractedDomain, "").trim() || brandCell;
      const brandName = titleCase(rawName || domainToName(extractedDomain));
      const id = compactKey([brandName, extractedDomain, rowIndex, brandCellIndex].join("|"));
      const duplicateKey = compactKey(extractedDomain || brandName);

      if (!brandName || seen.has(duplicateKey)) return;
      seen.add(duplicateKey);

      brands.push({
        id,
        rowNumber: rowIndex + 2,
        rawName,
        brandName,
        domain: extractedDomain,
      });
    });
  });

  return brands;
}

function applyBrandOverrides(brands: BrandRow[], overrides: Record<string, BrandOverride>) {
  return brands.map((brand) => {
    const override = overrides[brand.id];
    if (!override) return brand;

    return {
      ...brand,
      brandName: override.brandName?.trim() || brand.brandName,
      domain: normalizeDomain(override.domain ?? brand.domain),
    };
  });
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

function brandMatchesContact(brand: Pick<BrandRow, "brandName">, contact: ContactDatabaseContact) {
  return compactKey(brand.brandName) === compactKey(contact.brandName);
}

function getBrandDatabaseStatus(
  brand: BrandRow,
  contacts: ContactDatabaseContact[],
  checked: boolean,
) {
  if (!checked) {
    return {
      status: "unknown" as BrandStatus,
      count: 0,
      label: "Not checked",
    };
  }

  const matches = contacts.filter((contact) => brandMatchesContact(brand, contact));
  const status: BrandStatus = matches.length > 0 ? "database" : "none";

  return {
    status,
    count: matches.length,
    label: status === "database" ? "Contacts found" : "No saved contacts",
  };
}

function contactMatchesBrandSearch(contact: ContactDatabaseContact | ContactRow, search: string) {
  const query = compactKey(search);
  if (!query) return false;
  const brandKey = compactKey(contact.brandName);
  return brandKey.includes(query) || query.includes(brandKey);
}

function findDuplicateContact(contact: ContactRow, contacts: ContactDatabaseContact[]) {
  const email = contact.email.trim().toLowerCase();
  const byEmail = email
    ? contacts.find((databaseContact) => databaseContact.email.trim().toLowerCase() === email)
    : null;

  if (byEmail) return byEmail;

  return contacts.find(
    (databaseContact) =>
      compactKey(databaseContact.brandName) === compactKey(contact.brandName) &&
      compactKey(databaseContact.contactName) === compactKey(contact.contactName),
  );
}

function contactDuplicateLabel(contact: ContactRow, contacts: ContactDatabaseContact[]) {
  const match = findDuplicateContact(contact, contacts);
  if (!match) return "";
  return "Already in database";
}

function contactFirstName(contactName: string, firstName = "") {
  if (firstName.trim()) return firstName.trim();
  return contactName.trim().split(/\s+/)[0] ?? "";
}

function contactId(contact: Pick<ContactRow, "brandName" | "contactName" | "email">) {
  return compactKey([contact.brandName, contact.email || contact.contactName].join("|"));
}

function apiContactToRow(contact: ApolloContactResult, brands: BrandRow[]): ContactRow {
  const brand =
    brands.find((item) => item.id === contact.brandId) ??
    brands.find((item) => compactKey(item.brandName) === compactKey(contact.brandName)) ??
    brands[0];
  const contactName =
    contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const row: Omit<ContactRow, "id"> = {
    brandId: brand?.id ?? compactKey(contact.brandName),
    brandName: brand?.brandName ?? contact.brandName,
    contactName: contactName || "Unknown contact",
    contactFirstName: contactFirstName(contactName, contact.firstName),
    email: contact.email,
    position: contact.title,
    emailStatus: contact.emailStatus,
    source: "Apollo",
  };

  return {
    ...row,
    id: contactId(row),
  };
}

function databaseContactToRow(contact: ContactDatabaseContact, brands: BrandRow[]): ContactRow {
  const brand =
    brands.find((item) => compactKey(item.brandName) === compactKey(contact.brandName)) ??
    brands[0];
  const row: Omit<ContactRow, "id"> = {
    brandId: brand?.id ?? compactKey(contact.brandName),
    brandName: brand?.brandName ?? contact.brandName,
    contactName: contact.contactName || "Unknown contact",
    contactFirstName: contactFirstName(contact.contactName, contact.contactFirstName),
    email: contact.email,
    position: contact.position,
    source: "Contact Database",
  };

  return {
    ...row,
    id: contactId(row),
  };
}

function mergeContacts(existing: ContactRow[], incoming: ContactRow[]) {
  const map = new Map(existing.map((contact) => [contact.id, contact]));
  incoming.forEach((contact) => map.set(contact.id, contact));
  return Array.from(map.values()).sort(
    (left, right) =>
      left.brandName.localeCompare(right.brandName) ||
      left.contactName.localeCompare(right.contactName),
  );
}

function fillTemplate(template: string, contact: ContactRow) {
  const replacements: Record<string, string> = {
    contact_first_name: contact.contactFirstName || contact.contactName || "there",
    brand_name: contact.brandName,
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return replacements[key] ?? `[${key}]`;
  });
}

function contactToDatabaseInput(contact: ContactRow) {
  return {
    brandName: contact.brandName,
    contactName: contact.contactName,
    contactFirstName: contact.contactFirstName,
    email: contact.email,
    position: contact.position,
  };
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

function statusTone(status: BrandStatus) {
  if (status === "database") return "border-fun-blue/60 bg-fun-blue/20 text-foreground";
  if (status === "unknown") return "border-border bg-muted text-muted-foreground";
  return "border-fun-lime/50 bg-fun-lime/20 text-foreground";
}

function metricValue(value: number) {
  return value.toLocaleString();
}

function BrandFinderPage() {
  const queryClient = useQueryClient();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { data: contactDatabaseData } = useQuery(contactDatabaseQuery);
  const databaseContacts = contactDatabaseData?.contacts ?? [];
  const contactDatabaseChecked = Boolean(contactDatabaseData);
  const [sheetInput, setSheetInput] = useState("");
  const [sheetFileName, setSheetFileName] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState(DEFAULT_SUBJECT_TEMPLATE);
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY_TEMPLATE);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget>("body");
  const [filters, setFilters] = useState<ApolloFilterState>({
    ...DEFAULT_FILTER_STATE,
  });
  const [brandOverrides, setBrandOverrides] = useState<Record<string, BrandOverride>>({});
  const [brandSearchOverrides, setBrandSearchOverrides] = useState<Record<string, boolean>>({});
  const [directSearchBrandIds, setDirectSearchBrandIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [directSearchQuery, setDirectSearchQuery] = useState("");
  const [directActiveSearch, setDirectActiveSearch] = useState("");
  const [directSelectedContactIds, setDirectSelectedContactIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [savedDraftContacts, setSavedDraftContacts] = useState<ContactRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [brandFilter, setBrandFilter] = useState(ALL_BRANDS);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreatingDrafts, setIsCreatingDrafts] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchError, setSearchError] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [draftError, setDraftError] = useState("");
  const [hasLoadedSavedState, setHasLoadedSavedState] = useState(false);

  const parsedBrands = useMemo(() => parseDreamSheet(sheetInput), [sheetInput]);
  const brands = useMemo(
    () => applyBrandOverrides(parsedBrands, brandOverrides),
    [brandOverrides, parsedBrands],
  );
  const selectedBrands = useMemo(
    () => brands.filter((brand) => brandSearchOverrides[brand.id] ?? true),
    [brandSearchOverrides, brands],
  );
  const directSearchBrands = useMemo(
    () => brands.filter((brand) => directSearchBrandIds.has(brand.id)),
    [brands, directSearchBrandIds],
  );
  const directSearchTerms = useMemo(() => {
    const activeSearch = directActiveSearch.trim();
    if (activeSearch) return [activeSearch];
    return directSearchBrands.map((brand) => brand.brandName);
  }, [directActiveSearch, directSearchBrands]);
  const directSearchContacts = useMemo(() => {
    if (directSearchTerms.length === 0) return [];

    const matched = databaseContacts.filter((contact) =>
      directSearchTerms.some((term) => contactMatchesBrandSearch(contact, term)),
    );
    const contactRows = matched.map((contact) =>
      databaseContactToRow(contact, directSearchBrands),
    );

    return Array.from(new Map(contactRows.map((contact) => [contact.id, contact])).values()).sort(
      (left, right) =>
        left.brandName.localeCompare(right.brandName) ||
        left.contactName.localeCompare(right.contactName),
    );
  }, [databaseContacts, directSearchBrands, directSearchTerms]);
  const approvalContacts = useMemo(
    () => mergeContacts(mergeContacts(contacts, directSearchContacts), savedDraftContacts),
    [contacts, directSearchContacts, savedDraftContacts],
  );
  const brandOptions = useMemo(
    () => [
      ALL_BRANDS,
      ...Array.from(new Set(approvalContacts.map((contact) => contact.brandName)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    ],
    [approvalContacts],
  );
  const filteredApprovalContacts = useMemo(() => {
    return approvalContacts.filter((contact) => {
      return brandFilter === ALL_BRANDS || contact.brandName === brandFilter;
    });
  }, [approvalContacts, brandFilter]);
  const selectedApolloContacts = useMemo(
    () => contacts.filter((contact) => selectedContactIds.has(contact.id)),
    [contacts, selectedContactIds],
  );
  const selectedDraftCandidates = useMemo(
    () => mergeContacts(selectedApolloContacts, savedDraftContacts),
    [savedDraftContacts, selectedApolloContacts],
  );
  const selectedContacts = useMemo(
    () => selectedDraftCandidates.filter((contact) => contact.email),
    [selectedDraftCandidates],
  );
  const skippedNoEmailCount = selectedDraftCandidates.length - selectedContacts.length;
  const duplicateContactCount = contacts.filter((contact) =>
    Boolean(contactDuplicateLabel(contact, databaseContacts)),
  ).length;
  const savedDraftContactIds = useMemo(
    () => new Set(savedDraftContacts.map((contact) => contact.id)),
    [savedDraftContacts],
  );
  const estimatedApolloEmailReveals = selectedBrands.length * filters.maxContactsPerBrand;

  useEffect(() => {
    const saved = readSavedState();
    const savedFilters = saved.filters ?? {};
    const hasCurrentFilterShape =
      "excludeTitlesText" in savedFilters && "departmentsText" in savedFilters;
    setSheetInput(saved.sheetInput ?? "");
    setSheetFileName(saved.sheetFileName ?? "");
    setSubjectTemplate(saved.subjectTemplate ?? DEFAULT_SUBJECT_TEMPLATE);
    setBodyTemplate(saved.bodyTemplate ?? DEFAULT_BODY_TEMPLATE);
    setFilters(hasCurrentFilterShape ? { ...DEFAULT_FILTER_STATE, ...savedFilters } : DEFAULT_FILTER_STATE);
    setBrandOverrides(saved.brandOverrides ?? {});
    setBrandSearchOverrides(saved.brandSearchOverrides ?? {});
    setDirectSearchBrandIds(new Set(saved.directSearchBrandIds ?? []));
    setDirectSearchQuery(saved.directSearchQuery ?? "");
    setDirectActiveSearch(saved.directActiveSearch ?? "");
    setDirectSelectedContactIds(new Set(saved.directSelectedContactIds ?? []));
    setSavedDraftContacts(saved.savedDraftContacts ?? []);
    setContacts(saved.contacts ?? []);
    setSelectedContactIds(new Set(saved.selectedContactIds ?? []));
    setDraftMessage(saved.draftMessage ?? "");
    setHasLoadedSavedState(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedState) return;
    if (typeof window === "undefined") return;

    const nextState: SavedBrandFinderState = {
      sheetInput,
      sheetFileName,
      subjectTemplate,
      bodyTemplate,
      filters,
      brandOverrides,
      brandSearchOverrides,
      directSearchBrandIds: Array.from(directSearchBrandIds),
      directSearchQuery,
      directActiveSearch,
      directSelectedContactIds: Array.from(directSelectedContactIds),
      savedDraftContacts,
      contacts,
      selectedContactIds: Array.from(selectedContactIds),
      draftMessage,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [
    bodyTemplate,
    brandOverrides,
    brandSearchOverrides,
    contacts,
    directActiveSearch,
    directSearchQuery,
    directSearchBrandIds,
    directSelectedContactIds,
    draftMessage,
    filters,
    hasLoadedSavedState,
    savedDraftContacts,
    selectedContactIds,
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

  const setBrandUse = (brandId: string, checked: boolean) => {
    setBrandSearchOverrides((current) => ({
      ...current,
      [brandId]: checked,
    }));
  };

  const addBrandsToDirectSearch = (items: BrandRow[]) => {
    setDirectSearchBrandIds((current) => {
      const next = new Set(current);
      items.forEach((brand) => next.add(brand.id));
      return next;
    });
  };

  const removeBrandFromDirectSearch = (brandId: string) => {
    setDirectSearchBrandIds((current) => {
      const next = new Set(current);
      next.delete(brandId);
      return next;
    });
  };

  const clearDirectSearch = () => {
    setDirectSearchBrandIds(new Set());
    setDirectActiveSearch("");
    setDirectSearchQuery("");
    setDirectSelectedContactIds(new Set());
  };

  const runDirectSearch = (search = directSearchQuery) => {
    setDirectActiveSearch(search.trim());
    setDirectSelectedContactIds(new Set());
  };

  const moveBrandToDirectSearchBar = (brand: BrandRow) => {
    setDirectSearchQuery(brand.brandName);
  };

  const searchQueuedBrand = (brand: BrandRow) => {
    setDirectSearchQuery(brand.brandName);
    runDirectSearch(brand.brandName);
  };

  const setContactSelected = (contactId: string, checked: boolean) => {
    setSelectedContactIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(contactId);
      } else {
        next.delete(contactId);
      }
      return next;
    });
  };

  const setDirectContactSelected = (contact: ContactRow, checked: boolean) => {
    setDirectSelectedContactIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(contact.id);
      } else {
        next.delete(contact.id);
      }
      return next;
    });
  };

  const setApprovalContactSelected = (contact: ContactRow, checked: boolean) => {
    if (contact.source === "Contact Database") {
      setDirectContactSelected(contact, checked);
      setSavedDraftContacts((current) => {
        if (checked) return mergeContacts(current, [contact]);
        return current.filter((item) => item.id !== contact.id);
      });
      setDraftError("");
      return;
    }

    setContactSelected(contact.id, checked);
  };

  const isApprovalContactSelected = (contact: ContactRow) => {
    if (contact.source === "Contact Database") return savedDraftContactIds.has(contact.id);
    return selectedContactIds.has(contact.id);
  };

  const resetApolloRules = () => {
    setFilters(DEFAULT_FILTER_STATE);
  };

  const runApolloSearch = async () => {
    setSearchError("");
    setSearchMessage("");
    setDraftMessage("");
    setDraftError("");

    if (selectedBrands.length === 0) {
      setSearchError("Select at least one brand first.");
      return;
    }

    if (filters.requireEmail && !filters.enrichEmails) {
      setSearchError(
        "Apollo search does not return emails by itself. Turn on email enrichment or turn off the email-only filter.",
      );
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchApolloContacts({
        data: {
          brands: selectedBrands.map((brand) => ({
            id: brand.id,
            name: brand.brandName,
            domain: brand.domain,
          })),
          filters: {
            jobTitles: splitList(filters.jobTitlesText),
            excludeTitles: splitList(filters.excludeTitlesText),
            departments: splitList(filters.departmentsText),
            seniority: splitList(filters.seniorityText),
            emailStatuses: splitList(filters.emailStatusesText),
            includeSimilarTitles: filters.includeSimilarTitles,
            maxContactsPerBrand: filters.maxContactsPerBrand,
            requireEmail: filters.requireEmail,
            enrichEmails: filters.enrichEmails,
          },
        },
      });
      const incoming = result.contacts
        .map((contact) => apiContactToRow(contact, selectedBrands))
        .filter((contact) => !filters.requireEmail || contact.email);

      setContacts((current) => mergeContacts(current, incoming));
      setSearchMessage(`Apollo returned ${incoming.length} contacts.`);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Apollo search failed.");
    } finally {
      setIsSearching(false);
    }
  };

  const createDrafts = async () => {
    setDraftError("");
    setDraftMessage("");

    if (selectedDraftCandidates.length === 0) {
      setDraftError("Select at least one contact first.");
      return;
    }

    if (selectedContacts.length === 0) {
      setDraftError(`${skippedNoEmailCount} skipped because no email. Select at least one contact with an email.`);
      return;
    }

    setIsCreatingDrafts(true);
    try {
      const databaseResult = await upsertContactDatabaseContacts({
        data: {
          contacts: selectedContacts.map(contactToDatabaseInput),
        },
      });
      await queryClient.invalidateQueries({ queryKey: contactDatabaseQuery.queryKey });

      const draftResult = await createGmailDrafts({
        data: {
          drafts: selectedContacts.map((contact) => ({
            id: contact.id,
            to: contact.email,
            subject: fillTemplate(subjectTemplate, contact),
            body: fillTemplate(bodyTemplate, contact),
          })),
        },
      });
      const successfulResults = draftResult.results.filter((result) => result.ok);
      const failedCount = draftResult.results.length - successfulResults.length;
      setDraftMessage(
        `${databaseResult.created} contacts added and ${databaseResult.updated} updated in Contact Database. ${successfulResults.length} drafts created. ${skippedNoEmailCount} skipped because no email. ${failedCount} failed.`,
      );
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
    setSubjectTemplate(DEFAULT_SUBJECT_TEMPLATE);
    setBodyTemplate(DEFAULT_BODY_TEMPLATE);
    setFilters(DEFAULT_FILTER_STATE);
    setBrandOverrides({});
    setBrandSearchOverrides({});
    setDirectSearchBrandIds(new Set());
    setDirectSearchQuery("");
    setDirectActiveSearch("");
    setDirectSelectedContactIds(new Set());
    setSavedDraftContacts([]);
    setContacts([]);
    setSelectedContactIds(new Set());
    setBrandFilter(ALL_BRANDS);
    setSearchMessage("");
    setSearchError("");
    setDraftMessage("");
    setDraftError("");
    window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="space-y-4">
      <AppHeader
        title="Brand Finder"
        subtitle="Upload dream brands, run Apollo, select contacts, and create Gmail drafts."
      />

      <CompactStatusBar
        items={[
          ["Brands", brands.length],
          ["Selected", selectedBrands.length],
          ["Saved matches", directSearchContacts.length],
          ["Apollo", contacts.length],
          ["Drafts", selectedContacts.length],
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-4">
          <Panel
            title="Dream Brands"
            subtitle={
              sheetFileName
                ? sheetFileName
                : `${brands.length} parsed. ${selectedBrands.length} selected for Apollo.`
            }
            action={
              <div className="flex flex-wrap gap-2">
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
                <button
                  type="button"
                  onClick={resetWorkspace}
                  className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
              </div>
            }
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)]">
              <Textarea
                value={sheetInput}
                onChange={(event) => {
                  setSheetInput(event.target.value);
                  setSheetFileName("");
                }}
                placeholder={
                  "Dream Brand\tWebsite\nRhode\trhodeskin.com\nGymshark\tgymshark.com\nPoppi\tdrinkpoppi.com"
                }
                className="min-h-32 rounded-2xl bg-background text-sm lg:min-h-full"
              />

              <div className="max-w-full overflow-x-auto rounded-2xl border border-border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-12 px-3 py-2.5 text-left font-medium">Use</th>
                      <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                      <th className="px-3 py-2.5 text-left font-medium">Website</th>
                      <th className="px-3 py-2.5 text-left font-medium">Saved status</th>
                      <th className="px-3 py-2.5 text-left font-medium">Saved search</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brands.length === 0 && (
                      <tr className="border-t border-border/60">
                        <td
                          colSpan={5}
                          className="px-3 py-8 text-center text-sm text-muted-foreground"
                        >
                          Upload or paste a dream brand sheet.
                        </td>
                      </tr>
                    )}
                    {brands.map((brand) => {
                      const useInSearch = brandSearchOverrides[brand.id] ?? true;
                      const inDirectQueue = directSearchBrandIds.has(brand.id);
                      const status = getBrandDatabaseStatus(
                        brand,
                        databaseContacts,
                        contactDatabaseChecked,
                      );

                      return (
                        <tr key={brand.id} className="tb-row-hover border-t border-border/60">
                          <td className="px-3 py-2.5">
                            <Checkbox
                              checked={useInSearch}
                              onCheckedChange={(checked) =>
                                setBrandUse(brand.id, checked === true)
                              }
                              aria-label={`Search ${brand.brandName}`}
                            />
                          </td>
                          <td className="min-w-[180px] px-3 py-2.5">
                            <input
                              value={brand.brandName}
                              onChange={(event) =>
                                updateBrandOverride(brand.id, { brandName: event.target.value })
                              }
                              className="h-8 w-full rounded-xl border border-border bg-background px-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          </td>
                          <td className="min-w-[170px] px-3 py-2.5">
                            <input
                              value={brand.domain}
                              onChange={(event) =>
                                updateBrandOverride(brand.id, { domain: event.target.value })
                              }
                              placeholder="domain.com"
                              className="h-8 w-full rounded-xl border border-border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          </td>
                          <td className="min-w-[180px] px-3 py-2.5">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2.5 py-1 text-xs font-bold",
                                statusTone(status.status),
                              )}
                            >
                              {status.label}
                            </span>
                            {status.count > 0 && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {status.count} stored
                              </div>
                            )}
                          </td>
                          <td className="min-w-[150px] px-3 py-2.5">
                            <button
                              type="button"
                              disabled={inDirectQueue}
                              onClick={() => addBrandsToDirectSearch([brand])}
                              className="tb-action inline-flex h-8 items-center gap-1.5 rounded-xl bg-muted px-2.5 text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <ListPlus className="h-3.5 w-3.5" />
                              {inDirectQueue ? "Queued" : "Queue"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-background p-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={directSearchQuery}
                    onChange={(event) => setDirectSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") runDirectSearch();
                    }}
                    placeholder="Search saved Contact Database by brand..."
                    className="tb-search h-10 w-full rounded-2xl border border-border bg-card pl-9 pr-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => runDirectSearch()}
                  className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Search className="h-4 w-4" />
                  Search saved
                </button>
                <button
                  type="button"
                  disabled={
                    directSearchBrandIds.size === 0 &&
                    !directSearchQuery.trim() &&
                    !directActiveSearch.trim()
                  }
                  onClick={clearDirectSearch}
                  className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {directSearchBrands.length === 0 && (
                  <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                    No queued brands yet
                  </span>
                )}
                {directSearchBrands.map((brand) => (
                  <div
                    key={brand.id}
                    className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2"
                  >
                    <span className="text-sm font-bold">{brand.brandName}</span>
                    <button
                      type="button"
                      onClick={() => searchQueuedBrand(brand)}
                      className="tb-action rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground hover:opacity-90"
                    >
                      Search
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBrandToDirectSearchBar(brand)}
                      className="tb-action rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Move to search bar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBrandFromDirectSearch(brand.id)}
                      className="tb-action rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel
            title="Contacts"
            subtitle={`${approvalContacts.length} loaded. ${selectedContacts.length} selected for drafts.`}
            action={
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <DashboardSelectField
                  label="Brand filter"
                  value={brandFilter}
                  options={brandOptions}
                  onChange={setBrandFilter}
                  className="min-w-[190px] sm:w-[210px]"
                />
                <button
                  type="button"
                  disabled={isSearching || selectedBrands.length === 0}
                  onClick={() => void runApolloSearch()}
                  className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Run Apollo
                </button>
                <button
                  type="button"
                  disabled={isCreatingDrafts || selectedContacts.length === 0}
                  onClick={() => void createDrafts()}
                  className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-4 text-sm font-semibold text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreatingDrafts ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Create drafts
                </button>
              </div>
            }
          >
            {(searchError || searchMessage || draftError || draftMessage) && (
              <div
                className={cn(
                  "mb-4 rounded-2xl border p-3 text-xs font-semibold",
                  searchError || draftError
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-fun-lime/50 bg-fun-lime/20 text-foreground",
                )}
              >
                {searchError || draftError || searchMessage || draftMessage}
              </div>
            )}

            <div className="max-w-full overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-left font-medium">Select</th>
                    <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                    <th className="px-3 py-2.5 text-left font-medium">Contact</th>
                    <th className="px-3 py-2.5 text-left font-medium">Email</th>
                    <th className="px-3 py-2.5 text-left font-medium">Position</th>
                    <th className="px-3 py-2.5 text-left font-medium">Source</th>
                    <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApprovalContacts.length === 0 && (
                    <tr className="border-t border-border/60">
                      <td
                        colSpan={7}
                        className="px-3 py-8 text-center text-sm text-muted-foreground"
                      >
                        Search saved contacts or run Apollo to load people.
                      </td>
                    </tr>
                  )}
                  {filteredApprovalContacts.map((contact) => {
                    const duplicateLabel =
                      contact.source === "Contact Database"
                        ? ""
                        : contactDuplicateLabel(contact, databaseContacts);
                    const isSelected = isApprovalContactSelected(contact);

                    return (
                      <tr key={contact.id} className="tb-row-hover border-t border-border/60">
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={isSelected}
                            disabled={!contact.email}
                            onCheckedChange={(checked) =>
                              setApprovalContactSelected(contact, checked === true)
                            }
                            aria-label={`Select ${contact.contactName}`}
                          />
                        </td>
                        <td className="min-w-[170px] px-3 py-3 font-semibold">
                          {contact.brandName}
                        </td>
                        <td className="min-w-[180px] px-3 py-3">{contact.contactName}</td>
                        <td className="min-w-[240px] px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {contact.email ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await navigator.clipboard.writeText(contact.email);
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
                              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
                                No email
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="min-w-[220px] px-3 py-3 text-muted-foreground">
                          {contact.position || "-"}
                        </td>
                        <td className="min-w-[150px] px-3 py-3">
                          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
                            {contact.source || "Apollo"}
                          </span>
                        </td>
                        <td className="min-w-[190px] px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
                              {contact.emailStatus || "Unknown"}
                            </span>
                            {!contact.email && (
                              <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-bold text-muted-foreground">
                                No email
                              </span>
                            )}
                            {duplicateLabel && (
                              <span className="rounded-full border border-fun-blue/60 bg-fun-blue/20 px-2.5 py-1 text-xs font-bold text-foreground">
                                {duplicateLabel}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-muted-foreground">
              <div className="text-xs font-semibold text-muted-foreground">
                Apollo cap: up to {metricValue(estimatedApolloEmailReveals)} email reveals this run.
              </div>
              <div>
                {duplicateContactCount} Apollo duplicate{duplicateContactCount === 1 ? "" : "s"} flagged.
              </div>
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Panel title="Apollo Search Rules" subtitle="Credit-safe default: 2 contacts per brand.">
            <div className="flex flex-wrap gap-2">
              <RuleChip label="Include" value={splitList(filters.jobTitlesText).join(", ")} />
              <RuleChip label="Exclude" value={splitList(filters.excludeTitlesText).join(", ")} />
              <RuleChip label="Function" value={splitList(filters.departmentsText).join(", ")} />
              <RuleChip label="Max" value={`${filters.maxContactsPerBrand} per brand`} />
            </div>

            <details className="mt-3 rounded-2xl border border-border bg-background p-3">
              <summary className="cursor-pointer text-sm font-bold text-foreground">
                Edit search rules
              </summary>
              <div className="mt-3 grid gap-3">
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
                    className="mt-1 h-9 w-full rounded-2xl border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </label>
                <FilterTextarea
                  label="Include titles"
                  value={filters.jobTitlesText}
                  onChange={(value) =>
                    setFilters((current) => ({ ...current, jobTitlesText: value }))
                  }
                />
                <FilterTextarea
                  label="Exclude titles"
                  value={filters.excludeTitlesText}
                  onChange={(value) =>
                    setFilters((current) => ({ ...current, excludeTitlesText: value }))
                  }
                />
                <FilterTextarea
                  label="Department / job function"
                  value={filters.departmentsText}
                  onChange={(value) =>
                    setFilters((current) => ({ ...current, departmentsText: value }))
                  }
                />
                <ToggleRow
                  label="Include similar job titles"
                  checked={filters.includeSimilarTitles}
                  onCheckedChange={(checked) =>
                    setFilters((current) => ({ ...current, includeSimilarTitles: checked }))
                  }
                />
                <ToggleRow
                  label="Only return contacts with emails"
                  checked={filters.requireEmail}
                  onCheckedChange={(checked) =>
                    setFilters((current) => ({ ...current, requireEmail: checked }))
                  }
                />
                <ToggleRow
                  label="Enrich emails after search"
                  checked={filters.enrichEmails}
                  onCheckedChange={(checked) =>
                    setFilters((current) => ({ ...current, enrichEmails: checked }))
                  }
                />
                <button
                  type="button"
                  onClick={resetApolloRules}
                  className="tb-action inline-flex h-9 items-center justify-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset rules
                </button>
              </div>
            </details>
          </Panel>

          <Panel title="Email Template" subtitle={subjectTemplate || "No subject set"}>
            <div className="rounded-2xl border border-border bg-background p-3 text-sm font-semibold">
              {bodyTemplate.split(/\r?\n/).filter(Boolean)[0] || "Template body empty"}
            </div>

            <details className="mt-3 rounded-2xl border border-border bg-background p-3">
              <summary className="cursor-pointer text-sm font-bold text-foreground">
                Edit template
              </summary>
              <div className="mt-3">
                <div className="mb-3 flex flex-wrap gap-2">
                  {TEMPLATE_FIELDS.map((field) => (
                    <button
                      key={field}
                      type="button"
                      onClick={() => insertTemplateField(field)}
                      className="tb-action h-9 rounded-2xl bg-muted px-3 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {`{{${field}}}`}
                    </button>
                  ))}
                </div>

                <label className="block text-sm font-semibold">
                  Subject
                  <input
                    ref={subjectRef}
                    value={subjectTemplate}
                    onFocus={() => setTemplateTarget("subject")}
                    onChange={(event) => setSubjectTemplate(event.target.value)}
                    className="mt-1 h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </label>

                <label className="mt-3 block text-sm font-semibold">
                  Body
                  <Textarea
                    ref={bodyRef}
                    value={bodyTemplate}
                    onFocus={() => setTemplateTarget("body")}
                    onChange={(event) => setBodyTemplate(event.target.value)}
                    className="mt-1 min-h-44 rounded-2xl bg-card text-sm"
                  />
                </label>
              </div>
            </details>
          </Panel>

          <Panel title="Contact Database" subtitle="Used for duplicate flags.">
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
              <Database className="h-5 w-5 text-primary" />
              <div>
                <div className="text-sm font-bold">{databaseContacts.length} stored contacts</div>
                <div className="text-xs text-muted-foreground">
                  {contactDatabaseData?.source === "google-sheet"
                    ? "Live Google Sheet"
                    : contactDatabaseData?.error || "Loading database"}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </section>
    </div>
  );
}

function CompactStatusBar({ items }: { items: Array<[string, number]> }) {
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-3xl bg-card p-3 ring-1 ring-border">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="flex min-h-10 items-center gap-2 rounded-2xl bg-background px-3"
        >
          <span className="text-xs font-semibold text-muted-foreground">{label}</span>
          <span className="text-sm font-bold tabular-nums">{metricValue(value)}</span>
        </div>
      ))}
    </section>
  );
}

function RuleChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
      <span className="text-foreground">{label}</span>
      <span className="truncate">{value || "None"}</span>
    </span>
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
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          {subtitle && <p className="mt-1 text-xs font-medium text-muted-foreground">{subtitle}</p>}
        </div>
        {action && <div className="w-full sm:w-auto sm:shrink-0">{action}</div>}
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
    <label className="block text-sm font-semibold">
      {label}
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-16 rounded-2xl bg-card text-sm"
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
