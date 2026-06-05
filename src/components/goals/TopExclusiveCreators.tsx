import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BarChart3, ExternalLink, Search, Sparkles, X } from "lucide-react";
import type { Creator } from "@/data/creators";
import type { Deal } from "@/data/deals";
import {
  buildExclusiveCreatorPerformance,
  type CreatorPerformance,
} from "@/lib/exclusive-creator-performance";
import { cn } from "@/lib/utils";

function formatMoney(value: number) {
  return `£${Math.round(value).toLocaleString()}`;
}

function formatPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function CreatorValueBar({
  creator,
  maxValue,
  compact = false,
  onViewDetails,
}: {
  creator: CreatorPerformance;
  maxValue: number;
  compact?: boolean;
  onViewDetails: (creator: CreatorPerformance) => void;
}) {
  const totalWidth =
    maxValue > 0 && creator.totalDealValue > 0
      ? Math.max(2, (creator.totalDealValue / maxValue) * 100)
      : 0;
  const liveWidth =
    maxValue > 0 && creator.liveDealValue > 0
      ? Math.min(totalWidth, (creator.liveDealValue / maxValue) * 100)
      : 0;

  return (
    <div className="tb-row-hover rounded-2xl border border-border bg-background/70 p-4 transition hover:bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-bold">{creator.displayName}</h4>
            <span className="rounded-full bg-fun-lime/80 px-2.5 py-1 text-[11px] font-bold text-emerald-900">
              Exclusive
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {creator.totalDeals.toLocaleString()} total deals · {creator.liveDeals.toLocaleString()}{" "}
            live
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <div className="text-sm font-black">{formatMoney(creator.totalDealValue)}</div>
            <div className="text-[11px] font-semibold text-muted-foreground">
              {formatMoney(creator.liveDealValue)} live
            </div>
          </div>
          <button
            type="button"
            onClick={() => onViewDetails(creator)}
            className="tb-action rounded-2xl bg-muted px-3 py-2 text-xs font-bold hover:bg-accent"
          >
            View Details
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div
          className={cn("relative overflow-hidden rounded-full bg-muted", compact ? "h-3" : "h-4")}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary/20"
            style={{ width: `${totalWidth}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-fun-blue via-fun-purple to-fun-pink shadow-sm"
            style={{ width: `${liveWidth}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-muted-foreground">
          <span>Total deal value</span>
          <span>Live share {formatPercent(creator.liveDealValue, creator.totalDealValue)}</span>
        </div>
      </div>
    </div>
  );
}

function ModalShell({
  title,
  description,
  size = "lg",
  children,
  onClose,
}: {
  title: string;
  description?: string;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, []);

  const width = size === "xl" ? "max-w-6xl" : size === "lg" ? "max-w-3xl" : "max-w-xl";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div
        className={cn(
          "flex max-h-[85vh] w-full flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border",
          width,
        )}
      >
        <div className="shrink-0 border-b border-border p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="text-lg font-black">{title}</h4>
              {description ? (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="tb-action shrink-0 rounded-full p-2 hover:bg-accent"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function CreatorDetailsModal({
  creator,
  onClose,
}: {
  creator: CreatorPerformance;
  onClose: () => void;
}) {
  const highestDeal = creator.highestValueDeal;

  return (
    <ModalShell
      title={creator.displayName}
      description="Deal performance matched from exclusive creators and member deal tabs."
      size="lg"
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Total Deal Value", formatMoney(creator.totalDealValue)],
            ["Live Deal Value", formatMoney(creator.liveDealValue)],
            ["Total Deals", creator.totalDeals.toLocaleString()],
            ["Live Deals", creator.liveDeals.toLocaleString()],
            ["Avg Deal Value", formatMoney(creator.avgDealValue)],
            [
              "Highest Value Deal",
              highestDeal
                ? `${highestDeal.brand} · ${formatMoney(highestDeal.totalPricingGbp)}`
                : "-",
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-border bg-background/75 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {label}
              </div>
              <div className="mt-2 text-base font-black">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-background/75 p-4">
            <h5 className="text-sm font-black">Platform Mix</h5>
            <div className="mt-3 space-y-3">
              {creator.platformMix.length > 0 ? (
                creator.platformMix.map((platform) => (
                  <div key={platform.platform}>
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                      <span>{platform.platform}</span>
                      <span className="text-muted-foreground">
                        {platform.count} · {formatMoney(platform.value)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-fun-blue"
                        style={{
                          width: `${formatPercent(platform.value, creator.totalDealValue)}`,
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No matched deal platform data yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-background/75 p-4">
            <h5 className="text-sm font-black">Top Brands</h5>
            <div className="mt-3 space-y-2">
              {creator.topBrands.length > 0 ? (
                creator.topBrands.map((brand) => (
                  <div
                    key={brand.brand}
                    className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2 text-sm"
                  >
                    <span className="font-semibold">{brand.brand}</span>
                    <span className="text-xs font-bold text-muted-foreground">
                      {brand.deals} · {formatMoney(brand.value)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No matched brand data yet.</p>
              )}
            </div>
          </section>
        </div>
      </div>
      <div className="shrink-0 border-t border-border p-5 md:p-6">
        <button
          type="button"
          onClick={onClose}
          className="tb-action inline-flex h-11 w-full items-center justify-center rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:opacity-90 sm:w-auto"
        >
          Done
        </button>
      </div>
    </ModalShell>
  );
}

function AllCreatorsModal({
  creators,
  maxValue,
  onViewDetails,
  onClose,
}: {
  creators: CreatorPerformance[];
  maxValue: number;
  onViewDetails: (creator: CreatorPerformance) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return creators;

    return creators.filter((creator) =>
      [
        creator.displayName,
        creator.creator.owner,
        creator.creator.platform,
        creator.creator.niche,
        creator.creator.email,
        creator.topBrands.map((brand) => brand.brand).join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [creators, query]);

  return (
    <ModalShell
      title="All Exclusive Creators"
      description="Same deal-value visualization for every exclusive creator in the signed roster."
      size="xl"
      onClose={onClose}
    >
      <div className="shrink-0 border-b border-border bg-card p-5 md:p-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search creator, owner, platform, niche, brand..."
            className="tb-search h-11 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
        <div className="grid gap-3">
          {filtered.length > 0 ? (
            filtered.map((creator) => (
              <CreatorValueBar
                key={creator.creator.id}
                creator={creator}
                maxValue={maxValue}
                onViewDetails={onViewDetails}
              />
            ))
          ) : (
            <div className="rounded-2xl border border-border bg-background/75 p-6 text-center text-sm text-muted-foreground">
              No exclusive creators match that search.
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-border p-5 text-xs font-semibold text-muted-foreground md:p-6">
        Showing {filtered.length.toLocaleString()} of {creators.length.toLocaleString()} exclusive
        creators
      </div>
    </ModalShell>
  );
}

export function TopExclusiveCreators({ creators, deals }: { creators: Creator[]; deals: Deal[] }) {
  const [allOpen, setAllOpen] = useState(false);
  const [selectedCreator, setSelectedCreator] = useState<CreatorPerformance | null>(null);
  const performance = useMemo(
    () => buildExclusiveCreatorPerformance(creators, deals),
    [creators, deals],
  );
  const maxValue = Math.max(1, ...performance.all.map((creator) => creator.totalDealValue));
  const topRows = performance.topFive;
  const matchedCreatorCount = performance.all.filter((creator) => creator.totalDeals > 0).length;

  return (
    <section className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="tb-hover-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fun-pink">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-black">Top Exclusive Creators</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Ranked by total deal value, with posted live deal value highlighted inside each bar.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAllOpen(true)}
          className="tb-action inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90"
        >
          View All Exclusive Creators
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 grid gap-3">
        {topRows.length > 0 ? (
          topRows.map((creator) => (
            <CreatorValueBar
              key={creator.creator.id}
              creator={creator}
              maxValue={maxValue}
              compact
              onViewDetails={setSelectedCreator}
            />
          ))
        ) : (
          <div className="rounded-2xl border border-border bg-background/75 p-6 text-center text-sm text-muted-foreground">
            No exclusive creators found yet.
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-fun-lime/60 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-900/70">
            Exclusive creators
          </div>
          <div className="mt-1 text-2xl font-black">{performance.all.length}</div>
        </div>
        <div className="rounded-2xl bg-fun-blue/60 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-sky-900/70">
            With matched deals
          </div>
          <div className="mt-1 text-2xl font-black">{matchedCreatorCount}</div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-muted/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold">
          <Sparkles className="h-4 w-4 text-primary" />
          Bar legend
        </div>
        <div className="grid gap-2 text-xs font-semibold text-muted-foreground sm:grid-cols-2">
          <div>
            <span className="mr-2 inline-block h-2 w-8 rounded-full bg-primary/20" />
            Faded bar = total all-deal value
          </div>
          <div>
            <span className="mr-2 inline-block h-2 w-8 rounded-full bg-gradient-to-r from-fun-blue to-fun-pink" />
            Bold bar = posted live deal value
          </div>
        </div>
      </div>

      {allOpen && (
        <AllCreatorsModal
          creators={performance.all}
          maxValue={maxValue}
          onViewDetails={setSelectedCreator}
          onClose={() => setAllOpen(false)}
        />
      )}

      {selectedCreator && (
        <CreatorDetailsModal creator={selectedCreator} onClose={() => setSelectedCreator(null)} />
      )}
    </section>
  );
}
