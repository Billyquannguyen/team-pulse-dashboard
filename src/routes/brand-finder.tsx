import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  Database,
  FileSpreadsheet,
  Inbox,
  Loader2,
  Mail,
  RotateCcw,
  Search,
  Send,
  Upload,
  UsersRound,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelectField } from "@/components/ui/dashboard-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { searchAleadsContacts, type AleadsContactResult } from "@/lib/a-leads";
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
        content: "Upload dream brand sheets, run A-Leads, and create Gmail drafts.",
      },
    ],
  }),
  component: BrandFinderPage,
});

const STORAGE_KEY = "team-billion-brand-finder-simple-v1";
const ALL_BRANDS = "All brands";

const DEFAULT_SUBJECT_TEMPLATE = "Creator partnership for {{brand_name}}";
const DEFAULT_BODY_TEMPLATE = `Hi {{contact_first_name}},

I'm reaching out from Team Billion about a potential paid creator partnership with {{brand_name}}.

Would you be open to reviewing this?
`;

const TEMPLATE_FIELDS = ["contact_first_name", "brand_name"] as const;

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

const searchTypeOptions = [
  { value: "total", label: "Total" },
  { value: "new", label: "Net new" },
  { value: "saved", label: "Saved" },
] as const;

type SearchType = "new" | "saved" | "total";
type TemplateTarget = "subject" | "body";
type BrandStatus = "none" | "database" | "contacted";

type AleadsFilterState = {
  jobTitlesText: string;
  departmentsText: string;
  seniorityText: string;
  searchType: SearchType;
  maxContactsPerBrand: number;
  requireEmail: boolean;
  enrichMissingEmails: boolean;
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
  source: "A-Leads API";
};

type SavedBrandFinderState = {
  sheetInput?: string;
  sheetFileName?: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
  filters?: AleadsFilterState;
  brandOverrides?: Record<string, BrandOverride>;
  brandSearchOverrides?: Record<string, boolean>;
  contacts?: ContactRow[];
  selectedContactIds?: string[];
  draftMessage?: string;
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

function getBrandDatabaseStatus(brand: BrandRow, contacts: ContactDatabaseContact[]) {
  const matches = contacts.filter((contact) => brandMatchesContact(brand, contact));
  const contacted = matches.some((contact) => contact.lastContactedAt);
  const status: BrandStatus = contacted ? "contacted" : matches.length > 0 ? "database" : "none";

  return {
    status,
    count: matches.length,
    label:
      status === "contacted"
        ? "Previously contacted"
        : status === "database"
          ? "Contacts already in database"
          : "No contacts found",
  };
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
  return match.lastContactedAt ? "Previously contacted" : "Already in database";
}

function contactFirstName(contactName: string, firstName = "") {
  if (firstName.trim()) return firstName.trim();
  return contactName.trim().split(/\s+/)[0] ?? "";
}

function contactId(contact: Pick<ContactRow, "brandName" | "contactName" | "email">) {
  return compactKey([contact.brandName, contact.email || contact.contactName].join("|"));
}

function apiContactToRow(contact: AleadsContactResult, brands: BrandRow[]): ContactRow {
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
    source: "A-Leads API",
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
  if (status === "contacted") return "border-fun-yellow/70 bg-fun-yellow/20 text-foreground";
  if (status === "database") return "border-fun-blue/60 bg-fun-blue/20 text-foreground";
  return "border-fun-lime/50 bg-fun-lime/20 text-foreground";
}

function metricValue(value: number) {
  return value.toLocaleString();
}

function BrandFinderPage() {
  const queryClient = useQueryClient();
  const saved = useMemo(readSavedState, []);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { data: contactDatabaseData } = useQuery(contactDatabaseQuery);
  const databaseContacts = contactDatabaseData?.contacts ?? [];
  const [sheetInput, setSheetInput] = useState(saved.sheetInput ?? "");
  const [sheetFileName, setSheetFileName] = useState(saved.sheetFileName ?? "");
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
  const [contacts, setContacts] = useState<ContactRow[]>(saved.contacts ?? []);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    () => new Set(saved.selectedContactIds ?? []),
  );
  const [q, setQ] = useState("");
  const [brandFilter, setBrandFilter] = useState(ALL_BRANDS);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreatingDrafts, setIsCreatingDrafts] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchError, setSearchError] = useState("");
  const [draftMessage, setDraftMessage] = useState(saved.draftMessage ?? "");
  const [draftError, setDraftError] = useState("");

  const parsedBrands = useMemo(() => parseDreamSheet(sheetInput), [sheetInput]);
  const brands = useMemo(
    () => applyBrandOverrides(parsedBrands, brandOverrides),
    [brandOverrides, parsedBrands],
  );
  const selectedBrands = useMemo(
    () => brands.filter((brand) => brandSearchOverrides[brand.id] ?? true),
    [brandSearchOverrides, brands],
  );
  const brandOptions = useMemo(
    () => [
      ALL_BRANDS,
      ...Array.from(new Set(contacts.map((contact) => contact.brandName)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    ],
    [contacts],
  );
  const filteredContacts = useMemo(() => {
    const query = q.trim().toLowerCase();
    return contacts.filter((contact) => {
      const searchable = [contact.brandName, contact.contactName, contact.email, contact.position]
        .join(" ")
        .toLowerCase();
      return (
        (!query || searchable.includes(query)) &&
        (brandFilter === ALL_BRANDS || contact.brandName === brandFilter)
      );
    });
  }, [brandFilter, contacts, q]);
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedContactIds.has(contact.id) && contact.email),
    [contacts, selectedContactIds],
  );
  const duplicateContactCount = contacts.filter((contact) =>
    Boolean(contactDuplicateLabel(contact, databaseContacts)),
  ).length;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const nextState: SavedBrandFinderState = {
      sheetInput,
      sheetFileName,
      subjectTemplate,
      bodyTemplate,
      filters,
      brandOverrides,
      brandSearchOverrides,
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
    draftMessage,
    filters,
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

  const runAleadsSearch = async () => {
    setSearchError("");
    setSearchMessage("");
    setDraftMessage("");
    setDraftError("");

    if (selectedBrands.length === 0) {
      setSearchError("Select at least one brand first.");
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchAleadsContacts({
        data: {
          brands: selectedBrands.map((brand) => ({
            id: brand.id,
            creatorName: "Brand Finder",
            name: brand.brandName,
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
      const incoming = result.contacts
        .map((contact) => apiContactToRow(contact, selectedBrands))
        .filter((contact) => !filters.requireEmail || contact.email);

      setContacts((current) => mergeContacts(current, incoming));
      setSearchMessage(`A-Leads returned ${incoming.length} contacts.`);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "A-Leads search failed.");
    } finally {
      setIsSearching(false);
    }
  };

  const createDrafts = async () => {
    setDraftError("");
    setDraftMessage("");

    if (selectedContacts.length === 0) {
      setDraftError("Select at least one contact with an email first.");
      return;
    }

    setIsCreatingDrafts(true);
    try {
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
      const successfulIds = new Set(successfulResults.map((result) => result.id));
      const threadById = new Map(
        successfulResults.map((result) => [result.id, result.gmailThreadId || result.gmailDraftId]),
      );
      const now = new Date().toISOString();
      const successfulContacts = selectedContacts.filter((contact) =>
        successfulIds.has(contact.id),
      );

      if (successfulContacts.length > 0) {
        await upsertContactDatabaseContacts({
          data: {
            contacts: successfulContacts.map((contact) => ({
              brandName: contact.brandName,
              contactName: contact.contactName,
              contactFirstName: contact.contactFirstName,
              email: contact.email,
              position: contact.position,
              source: "Brand Finder",
              firstFoundAt: now,
              lastContactedAt: now,
              gmailThreadId: threadById.get(contact.id) ?? "",
              notes: "Created Gmail draft from Brand Finder.",
            })),
          },
        });
        await queryClient.invalidateQueries({ queryKey: contactDatabaseQuery.queryKey });
      }

      const failedCount = draftResult.results.length - successfulResults.length;
      setDraftMessage(
        failedCount > 0
          ? `${successfulResults.length} drafts created. ${failedCount} failed.`
          : `${successfulResults.length} Gmail drafts created and saved to Contact Database.`,
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
    setContacts([]);
    setSelectedContactIds(new Set());
    setQ("");
    setBrandFilter(ALL_BRANDS);
    setSearchMessage("");
    setSearchError("");
    setDraftMessage("");
    setDraftError("");
    window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Brand Finder"
        subtitle="Upload dream brands, run A-Leads, select contacts, and create Gmail drafts."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          label="Brands parsed"
          value={metricValue(brands.length)}
          icon={FileSpreadsheet}
        />
        <MetricTile
          label="Brands selected"
          value={metricValue(selectedBrands.length)}
          icon={Inbox}
        />
        <MetricTile label="Contacts found" value={metricValue(contacts.length)} icon={UsersRound} />
        <MetricTile
          label="Duplicate flags"
          value={metricValue(duplicateContactCount)}
          icon={Database}
        />
        <MetricTile
          label="Selected contacts"
          value={metricValue(selectedContacts.length)}
          icon={Mail}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.52fr)]">
        <div className="space-y-4">
          <Panel
            title="Dream brand sheet"
            subtitle={
              sheetFileName ? sheetFileName : "Upload CSV/TSV export or paste Google Sheet rows."
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
            <Textarea
              value={sheetInput}
              onChange={(event) => {
                setSheetInput(event.target.value);
                setSheetFileName("");
              }}
              placeholder={
                "Dream Brand\tWebsite\nRhode\trhodeskin.com\nGymshark\tgymshark.com\nPoppi\tdrinkpoppi.com"
              }
              className="min-h-36 rounded-2xl bg-background text-sm"
            />
          </Panel>

          <Panel title="Parsed brands" subtitle={`${selectedBrands.length} selected for A-Leads.`}>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-left font-medium">Use</th>
                    <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                    <th className="px-3 py-2.5 text-left font-medium">Website</th>
                    <th className="px-3 py-2.5 text-left font-medium">Database status</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.length === 0 && (
                    <tr className="border-t border-border/60">
                      <td
                        colSpan={4}
                        className="px-3 py-8 text-center text-sm text-muted-foreground"
                      >
                        Upload a dream brand sheet to start.
                      </td>
                    </tr>
                  )}
                  {brands.map((brand) => {
                    const useInSearch = brandSearchOverrides[brand.id] ?? true;
                    const status = getBrandDatabaseStatus(brand, databaseContacts);

                    return (
                      <tr key={brand.id} className="tb-row-hover border-t border-border/60">
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={useInSearch}
                            onCheckedChange={(checked) => setBrandUse(brand.id, checked === true)}
                            aria-label={`Search ${brand.brandName}`}
                          />
                        </td>
                        <td className="min-w-[220px] px-3 py-3">
                          <input
                            value={brand.brandName}
                            onChange={(event) =>
                              updateBrandOverride(brand.id, { brandName: event.target.value })
                            }
                            className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </td>
                        <td className="min-w-[190px] px-3 py-3">
                          <input
                            value={brand.domain}
                            onChange={(event) =>
                              updateBrandOverride(brand.id, { domain: event.target.value })
                            }
                            placeholder="domain.com"
                            className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </td>
                        <td className="min-w-[260px] px-3 py-3">
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
                              {status.count} stored contact{status.count === 1 ? "" : "s"}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Contact approval"
            subtitle="Select the contacts you want to email."
            action={
              <button
                type="button"
                disabled={isSearching || selectedBrands.length === 0}
                onClick={() => void runAleadsSearch()}
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSearching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Run A-Leads
              </button>
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

            <div className="mb-4 grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(180px,0.28fr)]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Search contact, brand, email, position..."
                  className="tb-search h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <DashboardSelectField
                label="Brand"
                value={brandFilter}
                options={brandOptions}
                onChange={setBrandFilter}
              />
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-left font-medium">Select</th>
                    <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                    <th className="px-3 py-2.5 text-left font-medium">Contact</th>
                    <th className="px-3 py-2.5 text-left font-medium">Email</th>
                    <th className="px-3 py-2.5 text-left font-medium">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.length === 0 && (
                    <tr className="border-t border-border/60">
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-sm text-muted-foreground"
                      >
                        Run A-Leads to load contacts.
                      </td>
                    </tr>
                  )}
                  {filteredContacts.map((contact) => {
                    const duplicateLabel = contactDuplicateLabel(contact, databaseContacts);

                    return (
                      <tr key={contact.id} className="tb-row-hover border-t border-border/60">
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={selectedContactIds.has(contact.id)}
                            onCheckedChange={(checked) =>
                              setContactSelected(contact.id, checked === true)
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
                            {duplicateLabel && (
                              <span className="rounded-full bg-fun-yellow/20 px-2.5 py-1 text-xs font-bold text-foreground">
                                {duplicateLabel}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="min-w-[220px] px-3 py-3 text-muted-foreground">
                          {contact.position || "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-semibold text-muted-foreground">
                {selectedContacts.length} selected contact
                {selectedContacts.length === 1 ? "" : "s"} with email
              </div>
              <button
                type="button"
                disabled={isCreatingDrafts || selectedContacts.length === 0}
                onClick={() => void createDrafts()}
                className="tb-action inline-flex h-11 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingDrafts ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Create Gmail drafts
              </button>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="A-Leads filters" subtitle="Pre-saved settings for this browser.">
            <div className="grid gap-3 sm:grid-cols-2">
              <DashboardSelectField
                label="Search set"
                value={filters.searchType}
                options={[...searchTypeOptions]}
                onChange={(value) =>
                  setFilters((current) => ({ ...current, searchType: value as SearchType }))
                }
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
          </Panel>

          <Panel title="Email template" subtitle="Only brand and contact first name are filled.">
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTemplateTarget("subject")}
                className={cn(
                  "tb-action h-10 rounded-2xl px-3 text-xs font-bold",
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
                  "tb-action h-10 rounded-2xl px-3 text-xs font-bold",
                  templateTarget === "body"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                Body
              </button>
              {TEMPLATE_FIELDS.map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => insertTemplateField(field)}
                  className="tb-action h-10 rounded-2xl bg-muted px-3 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
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

          <Panel title="Contact Database" subtitle="Used for duplicate and previous-contact flags.">
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
