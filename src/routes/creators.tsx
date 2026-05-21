import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search, Users } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { OutreachSummaryCard } from "@/components/dashboard/OutreachSummaryCard";
import { creators, type CreatorRelationship } from "@/data/creators";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/creators")({
  head: () => ({
    meta: [
      { title: "Signed & Partnered — Team Billion" },
      { name: "description", content: "Signed and partnered creator roster." },
    ],
  }),
  component: CreatorsPage,
});

const relationshipStyles: Record<CreatorRelationship, string> = {
  Exclusive: "bg-fun-lime text-emerald-900",
  "Non-exclusive": "bg-fun-blue text-sky-900",
};

function CreatorsPage() {
  const [q, setQ] = useState("");
  const [relationship, setRelationship] = useState<CreatorRelationship | "All">("All");
  const { data } = useQuery(dashboardSheetQuery);
  const liveCreators = data ? data.creators : creators;
  const sourceLabel =
    data?.source === "error"
      ? "Google Sheets connection error"
      : data?.outreach?.source === "google-sheet"
        ? "Live Signed creators tab"
        : "Demo fallback data";
  const filtered = useMemo(
    () =>
      liveCreators.filter(
        (creator) =>
          (relationship === "All" || creator.relationship === relationship) &&
          (q === "" ||
            [
              creator.handle,
              creator.owner,
              creator.niche,
              creator.platform,
              creator.email,
              creator.base,
              creator.estimatedRate,
            ]
              .join(" ")
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [liveCreators, q, relationship],
  );

  return (
    <div className="space-y-6">
      <AppHeader
        title="Signed & Partnered"
        subtitle="Creators already signed as exclusive or partnered with the team."
      />

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="tb-hover-icon flex h-9 w-9 items-center justify-center rounded-xl bg-fun-blue">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Signed creators worksheet</div>
              <div className="text-xs text-muted-foreground">
                {sourceLabel} · {liveCreators.length} rows
              </div>
            </div>
          </div>
          {data?.links.creatorSourcingSheetUrl ? (
            <a
              href={data.links.creatorSourcingSheetUrl}
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

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search creator, owner, niche, platform..."
              className="tb-search h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {(["All", "Exclusive", "Non-exclusive"] as const).map((item) => (
            <button
              key={item}
              onClick={() => setRelationship(item)}
              className={cn(
                "tb-action rounded-full px-3 py-1.5 text-xs font-medium transition",
                relationship === item
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {[
                  "No.",
                  "Creator",
                  "Owner",
                  "Platform",
                  "Niche",
                  "Email",
                  "Relationship",
                  "Base",
                  "Rate",
                  "Links",
                ].map((header) => (
                  <th key={header} className="px-3 py-2.5 text-left font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((creator, index) => (
                <tr
                  key={creator.id}
                  className="tb-row-hover border-t border-border/60 hover:bg-muted/40"
                >
                  <td className="px-3 py-3 text-muted-foreground">{index + 1}</td>
                  <td className="px-3 py-3 font-medium">{creator.handle}</td>
                  <td className="px-3 py-3">{creator.owner}</td>
                  <td className="px-3 py-3 text-muted-foreground">{creator.platform}</td>
                  <td className="px-3 py-3">{creator.niche}</td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {creator.email ? (
                      <a
                        href={`mailto:${creator.email}`}
                        className="tb-action font-medium text-primary hover:underline"
                      >
                        {creator.email}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium",
                        relationshipStyles[creator.relationship],
                      )}
                    >
                      {creator.relationship}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{creator.base || "-"}</td>
                  <td className="px-3 py-3">
                    {creator.estimatedRate || creator.songPromoRate || "-"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-[180px] flex-wrap gap-2">
                      {[
                        { label: "TikTok", url: creator.tiktokLink },
                        { label: "Instagram", url: creator.instagramLink },
                        { label: "YouTube", url: creator.youtubeLink },
                      ].map(({ label, url }) =>
                        url ? (
                          <a
                            key={label}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            title={url}
                            className="tb-action tb-link-arrow inline-flex max-w-[120px] items-center gap-1 truncate rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-primary hover:underline"
                          >
                            {label}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : null,
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <OutreachSummaryCard
        data={data}
        title="Outreach pipeline"
        subtitle="Creator sourcing, replies, booked calls, and signed or partnered creators by member."
      />
    </div>
  );
}
