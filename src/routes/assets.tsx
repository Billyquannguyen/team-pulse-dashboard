import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/layout/AppHeader";
import { AssetCard } from "@/components/assets/AssetCard";
import { assetLinks } from "@/data/assets";

export const Route = createFileRoute("/assets")({
  head: () => ({ meta: [{ title: "Team Assets — Team Billion" }, { name: "description", content: "Quick links to team tools." }] }),
  component: AssetsPage,
});

function AssetsPage() {
  return (
    <div className="space-y-6">
      <AppHeader title="Team assets 🔗" subtitle="One-tap access to all our tools." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {assetLinks.map((a) => <AssetCard key={a.id} asset={a} />)}
      </div>
    </div>
  );
}
