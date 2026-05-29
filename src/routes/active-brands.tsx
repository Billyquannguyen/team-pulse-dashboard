import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Filter,
  RotateCcw,
  Search,
  Store,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { activeBrandsQuery } from "@/lib/active-brands";

const PAGE_SIZE = 20;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const contactFilters = ["All contacts", "Has email", "Missing email"] as const;
const linkFilters = ["All links", "Has link", "Missing link"] as const;

type ContactFilter = (typeof contactFilters)[number];
type LinkFilter = (typeof linkFilters)[number];

export const Route = createFileRoute("/active-brands")({
  head: () => ({
    meta: [
      { title: "Active Brands — Team Billion" },
      { name: "description", content: "Active brand contacts from Google Sheets." },
    ],
  }),
  component: ActiveBrandsPage,
});

function isLikelyUrl(value: string) {
  return /^https?:\/\//i.test(value) || /^www\./i.test(value);
}

function toHref(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getEmailValues(value: string) {
  return value.match(EMAIL_PATTERN) ?? [];
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-[150px] flex-1 sm:flex-none">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tb-search mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/30"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function isBrandColumn(header: string, index: number) {
  const normalized = normalizeHeader(header);
  return (
    normalized.includes("brand") ||
    normalized.includes("company") ||
    normalized.includes("business") ||
    (index === 0 && normalized.includes("name"))
  );
}

function isStatusColumn(header: string) {
  const normalized = normalizeHeader(header);
  return (
    normalized.includes("status") ||
    normalized.includes("stage") ||
    normalized.includes("type") ||
    normalized.includes("category") ||
    normalized.includes("niche")
  );
}

function isNumberValue(value: string) {
  const normalized = value.replace(/[£,$%\s]/g, "");
  return normalized.length > 0 && Number.isFinite(Number(normalized));
}

function getStatusTone(value: string) {
  const normalized = value.toLowerCase();
  if (/(active|yes|signed|partner|approved|live|warm)/.test(normalized)) {
    return "border-fun-lime/50 bg-fun-lime/20 text-foreground";
  }
  if (/(pending|maybe|follow|waiting|review)/.test(normalized)) {
    return "border-fun-yellow/60 bg-fun-yellow/20 text-foreground";
  }
  if (/(no|cold|lost|rejected|inactive)/.test(normalized)) {
    return "border-destructive/25 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted text-muted-foreground";
}

function getCellKey(rowIndex: number, columnIndex: number, value: string) {
  return `${rowIndex}-${columnIndex}-${value}`;
}

function ActiveBrandsPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [contactFilter, setContactFilter] = useState<ContactFilter>("All contacts");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("All links");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { data } = useQuery(activeBrandsQuery);
  const headers = data?.headers ?? [];
  const rows = data?.rows ?? [];
  const sourceLabel =
    data?.source === "google-sheet"
      ? "Live Active Contacts tab"
      : data?.source === "error"
        ? "Google Sheets connection error"
        : data?.source === "fallback"
          ? "Local fallback"
          : "Loading Sheet";
  const statusColumnIndexes = useMemo(
    () =>
      headers
        .map((header, index) => (isStatusColumn(header) ? index : -1))
        .filter((index) => index >= 0),
    [headers],
  );
  const statusOptions = useMemo(
    () => [
      "All statuses",
      ...uniqueSorted(
        rows.flatMap((row) =>
          statusColumnIndexes.map((index) => row[index] ?? "").filter((value) => value.trim()),
        ),
      ),
    ],
    [rows, statusColumnIndexes],
  );
  const hasActiveFilters =
    q.trim() !== "" ||
    statusFilter !== "All statuses" ||
    contactFilter !== "All contacts" ||
    linkFilter !== "All links";
  const clearFilters = () => {
    setQ("");
    setStatusFilter("All statuses");
    setContactFilter("All contacts");
    setLinkFilter("All links");
  };
  const filteredRows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((row) => {
      const rowText = row.join(" ").toLowerCase();
      const emails = getEmailValues(row.join(" "));
      const hasEmail = emails.length > 0;
      const hasLink = row.some((cell) => isLikelyUrl(cell.trim()));
      const statusValues = statusColumnIndexes.map((index) => row[index]?.trim() ?? "");
      const matchesQuery = !query || rowText.includes(query);
      const matchesStatus =
        statusFilter === "All statuses" || statusValues.some((value) => value === statusFilter);
      const matchesContact =
        contactFilter === "All contacts" ||
        (contactFilter === "Has email" && hasEmail) ||
        (contactFilter === "Missing email" && !hasEmail);
      const matchesLink =
        linkFilter === "All links" ||
        (linkFilter === "Has link" && hasLink) ||
        (linkFilter === "Missing link" && !hasLink);

      return matchesQuery && matchesStatus && matchesContact && matchesLink;
    });
  }, [contactFilter, linkFilter, q, rows, statusColumnIndexes, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);
  const showingStart = filteredRows.length === 0 ? 0 : pageStart + 1;
  const showingEnd = Math.min(pageStart + PAGE_SIZE, filteredRows.length);

  useEffect(() => {
    setPage(1);
  }, [contactFilter, linkFilter, q, rows, statusFilter]);

  const copyEmail = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1400);
    } catch {
      setCopiedKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Active Brands"
        subtitle="Brand contacts from the Active Contacts worksheet."
      />

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="tb-hover-icon flex h-9 w-9 items-center justify-center rounded-xl bg-fun-pink">
              <Store className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Active Contacts worksheet</div>
              <div className="text-xs text-muted-foreground">
                {sourceLabel} · {rows.length} rows
              </div>
            </div>
          </div>
          {data?.links.activeBrandsSheetUrl ? (
            <a
              href={data.links.activeBrandsSheetUrl}
              target="_blank"
              rel="noreferrer"
              className="tb-action tb-link-arrow inline-flex items-center gap-1.5 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Open in Sheets <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 rounded-2xl bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground"
            >
              Sheet link unavailable
            </button>
          )}
        </div>

        {(data?.warning || data?.error) && (
          <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" />
              Active Brands notice
            </div>
            <p className="break-words text-xs leading-relaxed">{data.warning ?? data.error}</p>
          </div>
        )}

        <div className="mt-5 space-y-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search active brands..."
              className="tb-search h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="tb-hover-lift flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-xs font-semibold text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Smart filters
            </div>
            <FilterSelect
              label="Status / type"
              value={statusFilter}
              options={statusOptions}
              onChange={setStatusFilter}
            />
            <FilterSelect
              label="Contact"
              value={contactFilter}
              options={[...contactFilters]}
              onChange={(value) => setContactFilter(value as ContactFilter)}
            />
            <FilterSelect
              label="Links"
              value={linkFilter}
              options={[...linkFilters]}
              onChange={(value) => setLinkFilter(value as LinkFilter)}
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-muted px-4 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4" />
                Clear
              </button>
            )}
          </div>

          <div className="text-xs font-medium text-muted-foreground">
            Showing{" "}
            <span className="text-foreground">
              {showingStart}-{showingEnd}
            </span>{" "}
            of <span className="text-foreground">{filteredRows.length.toLocaleString()}</span> of{" "}
            <span className="text-foreground">{rows.length.toLocaleString()}</span> brands
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {headers.length > 0 ? (
                  headers.map((header, index) => (
                    <th key={`${header}-${index}`} className="px-3 py-2.5 text-left font-medium">
                      {header || `Column ${index + 1}`}
                    </th>
                  ))
                ) : (
                  <th className="px-3 py-2.5 text-left font-medium">No columns loaded</th>
                )}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, pageRowIndex) => {
                const rowIndex = pageStart + pageRowIndex;

                return (
                <tr
                  key={`${rowIndex}-${row.join("|")}`}
                  className="tb-row-hover border-t border-border/60 hover:bg-muted/40"
                >
                  {headers.map((header, columnIndex) => {
                    const value = row[columnIndex] ?? "";
                    const trimmedValue = value.trim();
                    const emails = getEmailValues(trimmedValue);
                    const email = emails.length > 0;
                    const brand = isBrandColumn(header, columnIndex);
                    const status = isStatusColumn(header) && trimmedValue;
                    const number = isNumberValue(trimmedValue);
                    const copyValue = emails.join(", ");
                    const copyKey = getCellKey(rowIndex, columnIndex, copyValue);

                    return (
                      <td
                        key={columnIndex}
                        className={`px-3 py-3 align-middle ${
                          brand ? "min-w-[180px]" : "text-muted-foreground"
                        } ${number ? "text-right tabular-nums" : ""}`}
                      >
                        {brand && trimmedValue ? (
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-fun-pink shadow-sm" />
                            <span className="font-bold text-foreground">{trimmedValue}</span>
                          </div>
                        ) : email ? (
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{trimmedValue}</span>
                            <button
                              type="button"
                              onClick={() => copyEmail(copyKey, copyValue)}
                              className="tb-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label={`Copy ${copyValue}`}
                              title="Copy email"
                            >
                              {copiedKey === copyKey ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        ) : status ? (
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${getStatusTone(trimmedValue)}`}
                          >
                            {trimmedValue}
                          </span>
                        ) : isLikelyUrl(trimmedValue) ? (
                          <a
                            href={toHref(trimmedValue)}
                            target="_blank"
                            rel="noreferrer"
                            className="tb-action inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary hover:bg-primary/15"
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          trimmedValue || "-"
                        )}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr className="border-t border-border/60">
                  <td
                    colSpan={Math.max(headers.length, 1)}
                    className="px-3 py-8 text-center text-sm font-medium text-muted-foreground"
                  >
                    No active brand rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredRows.length > PAGE_SIZE && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-muted-foreground">
              Page {currentPage} of {pageCount} · {PAGE_SIZE} brands per page
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={currentPage === 1}
                className="tb-action inline-flex h-10 items-center gap-1.5 rounded-2xl bg-muted px-3 text-sm font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={currentPage === pageCount}
                className="tb-action inline-flex h-10 items-center gap-1.5 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
