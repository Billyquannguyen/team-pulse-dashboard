import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Search, Store } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { activeBrandsQuery } from "@/lib/active-brands";

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

function ActiveBrandsPage() {
  const [q, setQ] = useState("");
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
  const filteredRows = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.join(" ").toLowerCase().includes(query));
  }, [q, rows]);

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

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search active brands..."
              className="tb-search h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
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
              {filteredRows.map((row, rowIndex) => (
                <tr
                  key={`${rowIndex}-${row.join("|")}`}
                  className="tb-row-hover border-t border-border/60 hover:bg-muted/40"
                >
                  {headers.map((_, columnIndex) => {
                    const value = row[columnIndex] ?? "";
                    return (
                      <td key={columnIndex} className="px-3 py-3 text-muted-foreground">
                        {isLikelyUrl(value) ? (
                          <a
                            href={toHref(value)}
                            target="_blank"
                            rel="noreferrer"
                            className="tb-action font-medium text-primary hover:underline"
                          >
                            {value}
                          </a>
                        ) : (
                          value || "-"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
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
      </div>
    </div>
  );
}
