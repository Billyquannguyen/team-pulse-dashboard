import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { FileSpreadsheet, ExternalLink, Filter, RotateCcw, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/layout/AppHeader";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/deals")({
  head: () => ({
    meta: [
      { title: "Deals — Team Billion" },
      { name: "description", content: "Live Team Billion deal sheet." },
    ],
  }),
  component: DealsPage,
});

const statusStyles: Record<string, string> = {
  Posted: "bg-fun-lime text-emerald-900",
  Pending: "bg-fun-yellow text-amber-900",
  Paid: "bg-fun-purple text-purple-900",
  Overdue: "bg-fun-pink text-rose-900",
};

const yesNoStyles = {
  yes: "bg-fun-lime text-emerald-900",
  no: "bg-muted text-muted-foreground",
};

const paymentFilters = [
  "All payments",
  "Paid total",
  "Unpaid total",
  "Paid this month",
  "Not paid this month",
] as const;

const linkFilters = [
  "All links",
  "Has contract",
  "Missing contract",
  "Has live link",
  "Missing live link",
] as const;

type PaymentFilter = (typeof paymentFilters)[number];
type LinkFilter = (typeof linkFilters)[number];

function formatLinkLabel(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
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

function DealsPage() {
  const [q, setQ] = useState("");
  const [member, setMember] = useState("All members");
  const [status, setStatus] = useState("All statuses");
  const [platform, setPlatform] = useState("All platforms");
  const [payment, setPayment] = useState<PaymentFilter>("All payments");
  const [links, setLinks] = useState<LinkFilter>("All links");
  const { data } = useQuery(dashboardSheetQuery);
  const deals = data?.deals ?? [];
  const sourceLabel =
    data?.source === "google-sheet"
      ? "Live Google Sheet"
      : data?.source === "fallback"
        ? "Demo fallback data"
        : "Loading Sheet";
  const members = useMemo(
    () => ["All members", ...uniqueSorted(deals.map((d) => d.manager))],
    [deals],
  );
  const statuses = useMemo(
    () => ["All statuses", ...uniqueSorted(deals.map((d) => d.status))],
    [deals],
  );
  const platforms = useMemo(
    () => ["All platforms", ...uniqueSorted(deals.map((d) => d.platform))],
    [deals],
  );
  const hasActiveFilters =
    q.trim() !== "" ||
    member !== "All members" ||
    status !== "All statuses" ||
    platform !== "All platforms" ||
    payment !== "All payments" ||
    links !== "All links";
  const clearFilters = () => {
    setQ("");
    setMember("All members");
    setStatus("All statuses");
    setPlatform("All platforms");
    setPayment("All payments");
    setLinks("All links");
  };
  const filtered = useMemo(
    () =>
      deals.filter((d) => {
        const query = q.trim().toLowerCase();
        const searchable = [
          d.rowNumber,
          d.brand,
          d.creator,
          d.manager,
          d.platform,
          d.status,
          d.netTerms,
          d.profitMargin,
          d.notes,
          d.contractLink,
          d.liveLink,
          d.totalPricingGbp.toString(),
          d.creatorTotalGbp.toString(),
          d.managerTotalGbp.toString(),
          d.managerTotalPaid ? "paid total paid yes" : "unpaid total unpaid no",
          d.managerPaidCurrentMonth
            ? "paid this month current month yes"
            : "not paid this month current month no",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const matchesQuery = query === "" || searchable.includes(query);
        const matchesMember = member === "All members" || d.manager === member;
        const matchesStatus = status === "All statuses" || d.status === status;
        const matchesPlatform = platform === "All platforms" || d.platform === platform;
        const matchesPayment =
          payment === "All payments" ||
          (payment === "Paid total" && d.managerTotalPaid) ||
          (payment === "Unpaid total" && !d.managerTotalPaid) ||
          (payment === "Paid this month" && d.managerPaidCurrentMonth) ||
          (payment === "Not paid this month" && !d.managerPaidCurrentMonth);
        const matchesLinks =
          links === "All links" ||
          (links === "Has contract" && Boolean(d.contractLink)) ||
          (links === "Missing contract" && !d.contractLink) ||
          (links === "Has live link" && Boolean(d.liveLink)) ||
          (links === "Missing live link" && !d.liveLink);

        return (
          matchesQuery &&
          matchesMember &&
          matchesStatus &&
          matchesPlatform &&
          matchesPayment &&
          matchesLinks
        );
      }),
    [deals, links, member, payment, platform, q, status],
  );
  return (
    <div className="space-y-6">
      <AppHeader title="Deals 📒" subtitle="Synced from the Team Billion Google Sheet." />

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="tb-hover-icon flex h-9 w-9 items-center justify-center rounded-xl bg-fun-lime">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Team member deal tabs</div>
              <div className="text-xs text-muted-foreground">
                {sourceLabel} · {deals.length} rows
              </div>
            </div>
          </div>
          <a
            href="https://docs.google.com/spreadsheets/d/1oetKgRHC6ucAAvr4G99UGgqWJyWrNCZcc8mhcDwMULI/edit?usp=sharing"
            target="_blank"
            rel="noreferrer"
            className="tb-action tb-link-arrow inline-flex items-center gap-1.5 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Open in Sheets <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-5 space-y-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search brand, creator, member, platform, note, pricing..."
              className="tb-search h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="tb-hover-lift flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-xs font-semibold text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Smart filters
            </div>
            <FilterSelect label="Member" value={member} options={members} onChange={setMember} />
            <FilterSelect label="Status" value={status} options={statuses} onChange={setStatus} />
            <FilterSelect
              label="Platform"
              value={platform}
              options={platforms}
              onChange={setPlatform}
            />
            <FilterSelect
              label="Payment"
              value={payment}
              options={[...paymentFilters]}
              onChange={(value) => setPayment(value as PaymentFilter)}
            />
            <FilterSelect
              label="Links"
              value={links}
              options={[...linkFilters]}
              onChange={(value) => setLinks(value as LinkFilter)}
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
            Showing <span className="text-foreground">{filtered.length.toLocaleString()}</span> of{" "}
            <span className="text-foreground">{deals.length.toLocaleString()}</span> deals
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {[
                  "No.",
                  "Member",
                  "Creator",
                  "Platform",
                  "Brand",
                  "Status",
                  "Total pricing",
                  "Creator total",
                  "Manager total",
                  "Paid total?",
                  "Paid this month?",
                  "Profit margin",
                  "Net terms",
                  "Contract",
                  "Live link",
                  "Note",
                ].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr className="tb-row-hover border-t border-border/60">
                  <td colSpan={16} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No deals match those filters.
                  </td>
                </tr>
              )}
              {filtered.map((d, index) => (
                <tr key={d.id} className="tb-row-hover border-t border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-3 text-muted-foreground">{index + 1}</td>
                  <td className="px-3 py-3 font-medium">{d.manager}</td>
                  <td className="px-3 py-3 text-muted-foreground">{d.creator}</td>
                  <td className="px-3 py-3">{d.platform}</td>
                  <td className="px-3 py-3">{d.brand}</td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium",
                        statusStyles[d.status] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">£{d.totalPricingGbp.toLocaleString()}</td>
                  <td className="px-3 py-3">£{d.creatorTotalGbp.toLocaleString()}</td>
                  <td className="px-3 py-3 font-semibold">£{d.managerTotalGbp.toLocaleString()}</td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium",
                        d.managerTotalPaid ? yesNoStyles.yes : yesNoStyles.no,
                      )}
                    >
                      {d.managerTotalPaid ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium",
                        d.managerPaidCurrentMonth ? yesNoStyles.yes : yesNoStyles.no,
                      )}
                    >
                      {d.managerPaidCurrentMonth ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-3 py-3">{d.profitMargin}</td>
                  <td className="px-3 py-3 text-muted-foreground">{d.netTerms}</td>
                  <td className="px-3 py-3">
                    {d.contractLink ? (
                      <a
                        href={d.contractLink}
                        target="_blank"
                        rel="noreferrer"
                        className="tb-action text-xs font-semibold text-primary hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {d.liveLink ? (
                      <a
                        href={d.liveLink}
                        target="_blank"
                        rel="noreferrer"
                        title={d.liveLink}
                        className="tb-action block max-w-[240px] truncate text-xs font-semibold text-primary hover:underline"
                      >
                        {formatLinkLabel(d.liveLink)}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{d.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          {/* Integration note */}
          Data is read from the four member tabs: KTrang, HYen, BNgan, and LNgoc. The table
          refreshes automatically.
        </p>
      </div>
    </div>
  );
}
