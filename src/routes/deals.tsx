import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { FileSpreadsheet, ExternalLink, Search } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { deals, type DealStatus } from "@/data/deals";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/deals")({
  head: () => ({ meta: [{ title: "Deals — Team Billion" }, { name: "description", content: "Live mock deal sheet." }] }),
  component: DealsPage,
});

const statusStyles: Record<DealStatus, string> = {
  Won: "bg-fun-lime text-emerald-900",
  Pending: "bg-fun-yellow text-amber-900",
  Invoiced: "bg-fun-blue text-sky-900",
  Paid: "bg-fun-purple text-purple-900",
};

function DealsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<DealStatus | "All">("All");
  const filtered = useMemo(
    () => deals.filter((d) =>
      (status === "All" || d.status === status) &&
      (q === "" || [d.brand, d.creator, d.closer].join(" ").toLowerCase().includes(q.toLowerCase()))
    ),
    [q, status]
  );
  return (
    <div className="space-y-6">
      <AppHeader title="Deals 📒" subtitle="Synced from the Team Billion Google Sheet." />

      <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-fun-lime"><FileSpreadsheet className="h-4 w-4" /></div>
            <div>
              <div className="text-sm font-semibold">team-billion-deals.xlsx</div>
              <div className="text-xs text-muted-foreground">Synced 2 minutes ago · {deals.length} rows</div>
            </div>
          </div>
          <a
            href="https://docs.google.com/spreadsheets/d/PLACEHOLDER_SHEET_ID"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Open in Sheets <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search brand, creator, closer…"
              className="h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {(["All", "Won", "Pending", "Invoiced", "Paid"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                status === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {["Date", "Closer", "Brand", "Creator", "Platform", "Type", "Value", "%", "Comm.", "Status"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-t border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-3 text-muted-foreground">{d.date}</td>
                  <td className="px-3 py-3 font-medium">{d.closer}</td>
                  <td className="px-3 py-3">{d.brand}</td>
                  <td className="px-3 py-3 text-muted-foreground">{d.creator}</td>
                  <td className="px-3 py-3">{d.platform}</td>
                  <td className="px-3 py-3 text-muted-foreground">{d.dealType}</td>
                  <td className="px-3 py-3">${d.grossValue.toLocaleString()}</td>
                  <td className="px-3 py-3">{d.commissionPct}%</td>
                  <td className="px-3 py-3 font-semibold">${d.commission.toLocaleString()}</td>
                  <td className="px-3 py-3">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusStyles[d.status])}>{d.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          {/* Integration note */}
          🔌 This table currently uses mock rows from <code className="rounded bg-muted px-1">src/data/deals.ts</code>. Replace with the Google Sheets API at the TODO comment.
        </p>
      </div>
    </div>
  );
}
