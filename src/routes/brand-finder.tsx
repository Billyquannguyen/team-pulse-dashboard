import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  Copy,
  Download,
  FileSpreadsheet,
  Inbox,
  Mail,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Upload,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelectField } from "@/components/ui/dashboard-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/brand-finder")({
  head: () => ({
    meta: [
      { title: "Brand Finder — Team Billion" },
      {
        name: "description",
        content: "Review A-Leads brand contacts and prepare Gmail outreach drafts.",
      },
    ],
  }),
  component: BrandFinderPage,
});

const STORAGE_KEY = "team-billion-brand-finder-v1";
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

const confidenceOptions = ["All confidence", "High", "Medium", "Low"] as const;
type ConfidenceFilter = (typeof confidenceOptions)[number];
type ContactConfidence = "High" | "Medium" | "Low";

type BrandSeed = {
  id: string;
  name: string;
  domain: string;
};

type ContactCandidate = {
  id: string;
  brandName: string;
  domain: string;
  name: string;
  title: string;
  company: string;
  email: string;
  linkedin: string;
  confidence: ContactConfidence;
  reason: string;
  source: "A-Leads CSV";
};

type SavedBrandFinderState = {
  brandInput?: string;
  creatorName?: string;
  senderName?: string;
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

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 .@:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
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
  return firstPart
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractDomain(value: string) {
  const match =
    value.match(/https?:\/\/[^\s,|]+/i) ??
    value.match(/www\.[^\s,|]+/i) ??
    value.match(/[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s,|]*)?/i);

  return match ? normalizeDomain(match[0]) : "";
}

function parseBrandInput(input: string): BrandSeed[] {
  const seen = new Set<string>();

  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const normalized = normalizeText(line);
      return (
        normalized !== "brand" && normalized !== "brand website" && normalized !== "brand domain"
      );
    })
    .map((line) => {
      const parts = line
        .split(/\t|\||,/)
        .map((part) => part.trim())
        .filter(Boolean);
      const domain = extractDomain(line);
      const namePart =
        parts.find((part) => !extractDomain(part) && !/@/.test(part)) ??
        line.replace(domain, "").replace(/[|,]/g, " ").trim();
      const name = namePart || domainToName(domain) || line;
      const id = compactKey(domain || name);

      return {
        id,
        name,
        domain,
      };
    })
    .filter((brand) => {
      if (!brand.id || seen.has(brand.id)) return false;
      seen.add(brand.id);
      return true;
    });
}

function csvEscape(value: string) {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
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
  creatorName: string,
  senderName: string,
) {
  const firstName = contact.name.split(/\s+/)[0] || contact.name;
  const replacements: Record<string, string> = {
    brand_name: contact.brandName,
    company_name: contact.company,
    contact_name: contact.name,
    first_name: firstName,
    title: contact.title,
    domain: contact.domain,
    creator_name: creatorName || "[creator name]",
    sender_name: senderName || "[your name]",
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return replacements[key] ?? `[${key}]`;
  });
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

function statusTone(confidence: ContactConfidence) {
  if (confidence === "High") return "border-fun-lime/50 bg-fun-lime/20 text-foreground";
  if (confidence === "Medium") return "border-fun-yellow/60 bg-fun-yellow/20 text-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function BrandFinderPage() {
  const saved = useMemo(readSavedState, []);
  const [brandInput, setBrandInput] = useState(saved.brandInput ?? "");
  const [creatorName, setCreatorName] = useState(saved.creatorName ?? "");
  const [senderName, setSenderName] = useState(saved.senderName ?? "");
  const [subjectTemplate, setSubjectTemplate] = useState(
    saved.subjectTemplate ?? DEFAULT_SUBJECT_TEMPLATE,
  );
  const [bodyTemplate, setBodyTemplate] = useState(saved.bodyTemplate ?? DEFAULT_BODY_TEMPLATE);
  const [csvInput, setCsvInput] = useState("");
  const [contacts, setContacts] = useState<ContactCandidate[]>(saved.contacts ?? []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(saved.selectedIds ?? []),
  );
  const [preparedDraftIds, setPreparedDraftIds] = useState<Set<string>>(
    () => new Set(saved.preparedDraftIds ?? []),
  );
  const [q, setQ] = useState("");
  const [brandFilter, setBrandFilter] = useState("All brands");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("All confidence");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const brands = useMemo(() => parseBrandInput(brandInput), [brandInput]);
  const brandOptions = useMemo(
    () => [
      "All brands",
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
          subject: fillTemplate(subjectTemplate, contact, creatorName, senderName),
          body: fillTemplate(bodyTemplate, contact, creatorName, senderName),
          contact,
        })),
    [bodyTemplate, contacts, creatorName, preparedDraftIds, senderName, subjectTemplate],
  );
  const filteredContacts = useMemo(() => {
    const query = q.trim().toLowerCase();
    return contacts.filter((contact) => {
      const searchable = [
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
      const matchesBrand = brandFilter === "All brands" || contact.brandName === brandFilter;
      const matchesConfidence =
        confidenceFilter === "All confidence" || contact.confidence === confidenceFilter;
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
  const highConfidenceCount = contacts.filter((contact) => contact.confidence === "High").length;
  const readySelectedCount = selectedContacts.filter((contact) => contact.email).length;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const nextState: SavedBrandFinderState = {
      brandInput,
      creatorName,
      senderName,
      subjectTemplate,
      bodyTemplate,
      contacts,
      selectedIds: Array.from(selectedIds),
      preparedDraftIds: Array.from(preparedDraftIds),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [
    bodyTemplate,
    brandInput,
    contacts,
    creatorName,
    preparedDraftIds,
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

    setBrandInput("");
    setCreatorName("");
    setSenderName("");
    setSubjectTemplate(DEFAULT_SUBJECT_TEMPLATE);
    setBodyTemplate(DEFAULT_BODY_TEMPLATE);
    setCsvInput("");
    setContacts([]);
    setSelectedIds(new Set());
    setPreparedDraftIds(new Set());
    setQ("");
    setBrandFilter("All brands");
    setConfidenceFilter("All confidence");
    window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Brand Finder"
        subtitle="Turn A-Leads exports into approved contacts and Gmail-ready drafts."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Brands submitted" value={brands.length.toLocaleString()} icon={Inbox} />
        <MetricTile label="Contacts found" value={contacts.length.toLocaleString()} icon={Upload} />
        <MetricTile
          label="High confidence"
          value={highConfidenceCount.toLocaleString()}
          icon={Sparkles}
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
                <h2 className="text-base font-bold">Brand list</h2>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  Brand name plus website works best.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={brands.length === 0}
                  onClick={() =>
                    downloadCsv("brand-finder-a-leads-import.csv", [
                      ["Brand", "Website"],
                      ...brands.map((brand) => [brand.name, brand.domain]),
                    ])
                  }
                  className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  Brand CSV
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

            <Textarea
              value={brandInput}
              onChange={(event) => setBrandInput(event.target.value)}
              placeholder="Rhode | rhodeskin.com&#10;Gymshark | gymshark.com&#10;Poppi | drinkpoppi.com"
              className="mt-4 min-h-36 rounded-2xl bg-background text-sm"
            />

            {brands.length > 0 && (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                      <th className="px-3 py-2.5 text-left font-medium">Domain</th>
                      <th className="px-3 py-2.5 text-left font-medium">Contacts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brands.map((brand) => (
                      <tr key={brand.id} className="border-t border-border/60">
                        <td className="px-3 py-3 font-semibold">{brand.name}</td>
                        <td className="px-3 py-3 text-muted-foreground">{brand.domain || "-"}</td>
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
            )}
          </div>

          <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">A-Leads export</h2>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  Upload the downloaded CSV or paste it below.
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
                Imported contacts merge by brand, email, name, and title.
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
                Use variables like {"{{first_name}}"} and {"{{brand_name}}"}.
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Creator
              <input
                value={creatorName}
                onChange={(event) => setCreatorName(event.target.value)}
                placeholder="Creator name"
                className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
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

          <label className="mt-4 block text-sm font-semibold">
            Subject
            <input
              value={subjectTemplate}
              onChange={(event) => setSubjectTemplate(event.target.value)}
              className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>

          <label className="mt-4 block text-sm font-semibold">
            Body
            <Textarea
              value={bodyTemplate}
              onChange={(event) => setBodyTemplate(event.target.value)}
              className="mt-1 min-h-64 rounded-2xl bg-background text-sm"
            />
          </label>

          <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-xs font-medium text-muted-foreground">
            Gmail drafts are prepared here first. Direct Gmail creation needs the Gmail draft
            permission wired in.
          </div>
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
              <span className="text-foreground">{selectedIds.size}</span> selected
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-12 px-3 py-2.5 text-left font-medium">Use</th>
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
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
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
              downloadCsv("brand-finder-draft-queue.csv", [
                ["Email", "Subject", "Body", "Brand", "Contact", "Title"],
                ...draftPreviews.map((draft) => [
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
                    {draft.contact.name} · {draft.email}
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
