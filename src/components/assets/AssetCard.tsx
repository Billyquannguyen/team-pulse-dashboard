import { ExternalLink } from "lucide-react";
import type { AssetLink } from "@/data/assets";

export function AssetCard({ asset }: { asset: AssetLink }) {
  const Icon = asset.icon;
  return (
    <a
      href={asset.url}
      target="_blank"
      rel="noreferrer"
      className={`tb-hover-lift tb-stat-tile group relative overflow-hidden rounded-3xl bg-gradient-to-br ${asset.accent} p-6 ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-lg`}
    >
      <div className="tb-hover-icon flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80">
        <Icon className="h-6 w-6 text-foreground" />
      </div>
      <div className="mt-5 text-lg font-semibold">{asset.title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{asset.description}</div>
      <ExternalLink className="tb-hover-icon absolute right-5 top-5 h-4 w-4 opacity-50 transition group-hover:opacity-100" />
    </a>
  );
}
