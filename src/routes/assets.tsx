import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, LinkIcon } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { AssetCard } from "@/components/assets/AssetCard";
import { teamAssetsQuery } from "@/lib/team-assets";

export const Route = createFileRoute("/assets")({
  head: () => ({
    meta: [
      { title: "Team Assets — Team Billion" },
      { name: "description", content: "Quick links to team tools." },
    ],
  }),
  component: AssetsPage,
});

function AssetsPage() {
  const { data } = useQuery(teamAssetsQuery);
  const assets = data?.assets ?? [];
  const sourceLabel =
    data?.source === "google-sheet"
      ? "Live Team Assets Sheet"
      : data?.source === "error"
        ? "Google Sheets connection error"
        : data?.source === "fallback"
          ? "Local fallback links"
          : "Loading Team Assets";

  return (
    <div className="space-y-6">
      <AppHeader title="Team assets 🔗" subtitle="One-tap access to all our tools." />

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="tb-hover-icon flex h-9 w-9 items-center justify-center rounded-xl bg-fun-yellow">
              <LinkIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Team Assets source</div>
              <div className="text-xs text-muted-foreground">
                {sourceLabel} · {assets.length} active links
              </div>
            </div>
          </div>
          {data?.links.teamAssetsSheetUrl ? (
            <a
              href={data.links.teamAssetsSheetUrl}
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
              Team Assets notice
            </div>
            <p className="break-words text-xs leading-relaxed">{data.warning ?? data.error}</p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((a) => (
          <AssetCard key={a.id} asset={a} />
        ))}
      </div>

      {assets.length === 0 && data?.source === "error" && (
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-sm font-semibold text-destructive">
          Team Assets could not be loaded from Google Sheets. Check the diagnostics page for the
          safe server-side status.
        </div>
      )}
    </div>
  );
}
