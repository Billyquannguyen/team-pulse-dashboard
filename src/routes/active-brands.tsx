import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  Mail,
  RotateCcw,
  Search,
  Store,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelectField } from "@/components/ui/dashboard-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  activeBrandsQuery,
  type ActiveBrand,
  type CreatorSourcingBrief,
} from "@/lib/active-brands";

const PAGE_SIZE = 25;
const EMPTY_BRANDS: ActiveBrand[] = [];
const briefFilters = ["All briefs", "Has brief", "No brief"] as const;
const sortOptions = ["Newest activity", "Oldest activity", "Brand A–Z"] as const;

type BriefFilter = (typeof briefFilters)[number];
type SortOption = (typeof sortOptions)[number];

export const Route = createFileRoute("/active-brands")({
  head: () => ({
    meta: [
      { title: "Active Contacts — Team Billion" },
      {
        name: "description",
        content: "Brand activity, agencies, contacts, and creator sourcing briefs.",
      },
    ],
  }),
  component: ActiveBrandsPage,
});

const briefFields: Array<[keyof CreatorSourcingBrief, string]> = [
  ["platforms", "Platforms"],
  ["creatorSize", "Creator size"],
  ["location", "Location"],
  ["language", "Language"],
  ["creatorAge", "Creator age"],
  ["gender", "Gender"],
  ["niches", "Niches"],
  ["creatorStyle", "Creator style"],
  ["audience", "Audience"],
];

function hasBrief(brief: CreatorSourcingBrief) {
  return briefFields.some(([key]) => brief[key].trim());
}

function dateScore(value: string) {
  const score = Date.parse(value);
  return Number.isFinite(score) ? score : 0;
}

function formatDate(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function agencyKey(brandName: string, agencyName: string) {
  return `${brandName}::${agencyName || "unknown"}`;
}

function toggleSet(current: Set<string>, key: string) {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function BriefDrawer({
  brand,
  onOpenChange,
}: {
  brand: ActiveBrand | null;
  onOpenChange: (open: boolean) => void;
}) {
  const brief = brand?.brief;

  return (
    <Sheet open={Boolean(brand)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-8">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-fun-pink">
            <FileText className="h-4 w-4" />
          </div>
          <SheetTitle>{brand?.name ?? "Creator sourcing brief"}</SheetTitle>
          <SheetDescription>
            The creator profile requested by the brand. Missing details stay explicit.
          </SheetDescription>
        </SheetHeader>

        {brief && (
          <div className="mt-7 space-y-3">
            {briefFields.map(([key, label]) => (
              <div key={key} className="rounded-2xl border border-border bg-card p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div className="mt-1 text-sm font-medium leading-relaxed">
                  {brief[key] || "Not specified"}
                </div>
              </div>
            ))}

            <div className="mt-5 border-t border-border pt-5 text-xs text-muted-foreground">
              <div>Brief date: {formatDate(brief.briefDate)}</div>
              <div className="mt-1">Source agency: {brief.sourceAgency || "Not specified"}</div>
              <div className="mt-1">Source email: {brief.sourceEmail || "Not specified"}</div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ActiveBrandsPage() {
  const [query, setQuery] = useState("");
  const [nicheFilter, setNicheFilter] = useState("All niches");
  const [briefFilter, setBriefFilter] = useState<BriefFilter>("All briefs");
  const [sort, setSort] = useState<SortOption>("Newest activity");
  const [page, setPage] = useState(1);
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [expandedAgencies, setExpandedAgencies] = useState<Set<string>>(new Set());
  const [selectedBriefBrand, setSelectedBriefBrand] = useState<ActiveBrand | null>(null);
  const [copiedContact, setCopiedContact] = useState<string | null>(null);
  const { data } = useQuery(activeBrandsQuery);
  const brands = data?.brands ?? EMPTY_BRANDS;

  const nicheOptions = useMemo(
    () => [
      "All niches",
      ...Array.from(new Set(brands.map((brand) => brand.niche).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    ],
    [brands],
  );

  const visibleBrands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return brands
      .filter((brand) => {
        const searchable = [
          brand.name,
          brand.niche,
          ...brand.agencies.flatMap((agency) => [
            agency.name,
            agency.topContact,
            ...agency.contacts.flatMap((contact) => [contact.contact, contact.notes]),
          ]),
        ]
          .join(" ")
          .toLowerCase();
        const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
        const matchesNiche = nicheFilter === "All niches" || brand.niche === nicheFilter;
        const briefAvailable = hasBrief(brand.brief);
        const matchesBrief =
          briefFilter === "All briefs" ||
          (briefFilter === "Has brief" && briefAvailable) ||
          (briefFilter === "No brief" && !briefAvailable);
        return matchesQuery && matchesNiche && matchesBrief;
      })
      .sort((left, right) => {
        if (sort === "Brand A–Z") return left.name.localeCompare(right.name);
        const direction = sort === "Newest activity" ? -1 : 1;
        const activity =
          direction * (dateScore(left.bestActiveDate) - dateScore(right.bestActiveDate));
        if (activity) return activity;
        const briefPriority = Number(hasBrief(right.brief)) - Number(hasBrief(left.brief));
        return briefPriority || left.name.localeCompare(right.name);
      });
  }, [brands, briefFilter, nicheFilter, query, sort]);

  const pageCount = Math.max(1, Math.ceil(visibleBrands.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageBrands = visibleBrands.slice(pageStart, pageStart + PAGE_SIZE);
  const agencyCount = brands.reduce((total, brand) => total + brand.agencies.length, 0);
  const contactCount = brands.reduce(
    (total, brand) =>
      total +
      brand.agencies.reduce((agencyTotal, agency) => agencyTotal + agency.contacts.length, 0),
    0,
  );
  const briefCount = brands.filter((brand) => hasBrief(brand.brief)).length;
  const hasFilters =
    query.trim() ||
    nicheFilter !== "All niches" ||
    briefFilter !== "All briefs" ||
    sort !== "Newest activity";

  useEffect(() => {
    setPage(1);
  }, [briefFilter, nicheFilter, query, sort]);

  const copyContact = async (contact: string) => {
    try {
      await navigator.clipboard.writeText(contact);
      setCopiedContact(contact);
      window.setTimeout(
        () => setCopiedContact((value) => (value === contact ? null : value)),
        1400,
      );
    } catch {
      setCopiedContact(null);
    }
  };

  const clearFilters = () => {
    setQuery("");
    setNicheFilter("All niches");
    setBriefFilter("All briefs");
    setSort("Newest activity");
  };

  const sourceLabel =
    data?.source === "google-sheet"
      ? "Live Google Sheet"
      : data?.source === "error"
        ? "Google Sheets connection error"
        : data?.source === "fallback"
          ? "Local fallback"
          : "Loading Google Sheet";

  return (
    <div className="space-y-6">
      <AppHeader
        title="Active Contacts"
        subtitle="Choose who to pitch using brand-level activity, briefs, agencies, and sender contacts."
      />

      <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-fun-pink">
              <Store className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-bold">Brand contact system</div>
              <div className="text-xs text-muted-foreground">{sourceLabel}</div>
            </div>
          </div>
          {data?.links.activeBrandsSheetUrl && (
            <a
              href={data.links.activeBrandsSheetUrl}
              target="_blank"
              rel="noreferrer"
              className="tb-action inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              Open Sheet <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {(data?.warning || data?.error) && (
          <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" /> Data notice
            </div>
            <p className="break-words text-xs leading-relaxed">{data.warning ?? data.error}</p>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [brands.length, "Brands", Store],
            [agencyCount, "Agency links", Building2],
            [contactCount, "Contacts", Users],
            [briefCount, "Briefs recorded", FileText],
          ].map(([value, label, Icon]) => (
            <div key={String(label)} className="rounded-2xl bg-muted/65 p-4">
              <Icon className="mb-3 h-4 w-4 text-primary" />
              <div className="text-2xl font-black tabular-nums">{String(value)}</div>
              <div className="text-xs font-semibold text-muted-foreground">{String(label)}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-4 border-t border-border pt-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search brand, agency, contact, or note..."
              className="tb-search h-11 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <DashboardSelectField
              label="Niche"
              value={nicheFilter}
              options={nicheOptions}
              onChange={setNicheFilter}
            />
            <DashboardSelectField
              label="Brief"
              value={briefFilter}
              options={[...briefFilters]}
              onChange={(value) => setBriefFilter(value as BriefFilter)}
            />
            <DashboardSelectField
              label="Sort"
              value={sort}
              options={[...sortOptions]}
              onChange={(value) => setSort(value as SortOption)}
            />
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-4 text-sm font-bold text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4" /> Clear
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl bg-card ring-1 ring-border">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_170px_120px] gap-4 border-b border-border bg-muted/55 px-5 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground md:grid">
          <div>Brand</div>
          <div>Niche</div>
          <div>Best active date</div>
          <div>Creator brief</div>
        </div>

        {pageBrands.map((brand) => {
          const brandExpanded = expandedBrands.has(brand.name);
          const briefAvailable = hasBrief(brand.brief);
          const brandPanelId = `brand-${brand.name.replace(/[^a-z0-9]/gi, "-")}`;

          return (
            <div key={brand.name} className="border-b border-border last:border-b-0">
              <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_170px_120px] md:items-center md:gap-4 md:px-5">
                <button
                  type="button"
                  onClick={() => setExpandedBrands((current) => toggleSet(current, brand.name))}
                  aria-expanded={brandExpanded}
                  aria-controls={brandPanelId}
                  className="flex min-w-0 items-center gap-3 text-left"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-fun-pink/70">
                    {brandExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black">{brand.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">
                      {brand.niche || "No niche"}
                    </span>
                  </span>
                </button>
                <div className="hidden text-sm font-semibold text-muted-foreground md:block">
                  {brand.niche || "Not specified"}
                </div>
                <div className="flex items-center gap-2 text-sm font-bold tabular-nums">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  {formatDate(brand.bestActiveDate)}
                </div>
                <div>
                  {briefAvailable ? (
                    <button
                      type="button"
                      onClick={() => setSelectedBriefBrand(brand)}
                      className="tb-action inline-flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/15"
                    >
                      <FileText className="h-3.5 w-3.5" /> View brief
                    </button>
                  ) : (
                    <span className="inline-flex rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                      No brief
                    </span>
                  )}
                </div>
              </div>

              {brandExpanded && (
                <div
                  id={brandPanelId}
                  className="border-t border-border bg-muted/25 px-3 py-3 sm:px-5"
                >
                  <div className="space-y-2">
                    {brand.agencies.map((agency) => {
                      const key = agencyKey(brand.name, agency.name);
                      const agencyExpanded = expandedAgencies.has(key);
                      const agencyPanelId = `agency-${key.replace(/[^a-z0-9]/gi, "-")}`;

                      return (
                        <div
                          key={key}
                          className="overflow-hidden rounded-2xl border border-border bg-background"
                        >
                          <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_170px] lg:items-center">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedAgencies((current) => toggleSet(current, key))
                              }
                              aria-expanded={agencyExpanded}
                              aria-controls={agencyPanelId}
                              className="flex min-w-0 items-center gap-3 text-left"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-fun-blue/30">
                                <Building2 className="h-4 w-4" />
                              </span>
                              <span>
                                <span className="block text-sm font-bold">
                                  {agency.name || "Agency not identified"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {agency.contacts.length} contact
                                  {agency.contacts.length === 1 ? "" : "s"}
                                </span>
                              </span>
                              {agencyExpanded ? (
                                <ChevronUp className="ml-auto h-4 w-4" />
                              ) : (
                                <ChevronDown className="ml-auto h-4 w-4" />
                              )}
                            </button>

                            <div className="min-w-0">
                              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                Top contact
                              </div>
                              <div className="mt-1 flex min-w-0 items-center gap-2">
                                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate text-sm font-semibold">
                                  {agency.topContact || "Not recorded"}
                                </span>
                                {agency.topContact && (
                                  <button
                                    type="button"
                                    onClick={() => copyContact(agency.topContact)}
                                    className="tb-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground"
                                    aria-label={`Copy ${agency.topContact}`}
                                  >
                                    {copiedContact === agency.topContact ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="text-sm font-bold tabular-nums">
                              {formatDate(agency.topContactLastActiveDate)}
                            </div>
                          </div>

                          {agencyExpanded && (
                            <div
                              id={agencyPanelId}
                              className="border-t border-border bg-muted/30 px-4 py-2"
                            >
                              {agency.contacts.map((contact, index) => (
                                <div
                                  key={`${contact.contact}-${index}`}
                                  className="grid gap-2 border-b border-border/70 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)] md:items-center"
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="truncate text-sm font-semibold">
                                      {contact.contact}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => copyContact(contact.contact)}
                                      className="tb-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground hover:text-foreground"
                                      aria-label={`Copy ${contact.contact}`}
                                    >
                                      {copiedContact === contact.contact ? (
                                        <Check className="h-3.5 w-3.5" />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </div>
                                  <div className="text-sm font-bold tabular-nums">
                                    {formatDate(contact.lastActiveDate)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {contact.notes || "No notes"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {pageBrands.length === 0 && (
          <div className="px-5 py-12 text-center text-sm font-semibold text-muted-foreground">
            No brands match these filters.
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-muted-foreground">
        <div>
          Showing {visibleBrands.length === 0 ? 0 : pageStart + 1}–
          {Math.min(pageStart + PAGE_SIZE, visibleBrands.length)} of {visibleBrands.length} brands
        </div>
        {visibleBrands.length > PAGE_SIZE && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={currentPage === 1}
              className="tb-action inline-flex h-10 items-center gap-1 rounded-2xl bg-muted px-3 text-sm font-bold text-foreground disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <span className="px-2">
              {currentPage} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={currentPage === pageCount}
              className="tb-action inline-flex h-10 items-center gap-1 rounded-2xl bg-primary px-3 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <BriefDrawer
        brand={selectedBriefBrand}
        onOpenChange={(open) => {
          if (!open) setSelectedBriefBrand(null);
        }}
      />
    </div>
  );
}
