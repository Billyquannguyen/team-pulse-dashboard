import { Link } from "@tanstack/react-router";
import { isActiveDashboardDeal, recentDeals, type Deal, type DealStatus } from "@/data/deals";
import { cn } from "@/lib/utils";

const statusStyles: Record<DealStatus, string> = {
  Posted: "bg-fun-lime text-emerald-900",
  Pending: "bg-fun-yellow text-amber-900",
  Paid: "bg-fun-purple text-purple-900",
  Overdue: "bg-fun-pink text-rose-900",
  Cancelled: "bg-muted text-muted-foreground line-through",
};

export function RecentDealsCard({ deals = recentDeals }: { deals?: Deal[] }) {
  const rows = deals.filter(isActiveDashboardDeal).slice(0, 8);

  return (
    <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Recent closed deals 💸</h3>
        <Link to="/deals" className="text-xs font-medium text-primary hover:underline">
          See sheet
        </Link>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">No.</th>
              <th className="px-3 py-2 text-left font-medium">Member</th>
              <th className="px-3 py-2 text-left font-medium">Brand</th>
              <th className="px-3 py-2 text-left font-medium">Creator</th>
              <th className="px-3 py-2 text-left font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Manager total</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-border/60">
                <td className="px-3 py-3 text-muted-foreground">#{d.rowNumber}</td>
                <td className="px-3 py-3 font-medium">{d.manager}</td>
                <td className="px-3 py-3">{d.brand}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.creator}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.month || "-"}</td>
                <td className="px-3 py-3 text-right">£{d.managerTotalGbp.toLocaleString()}</td>
                <td className="px-3 py-3">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      statusStyles[d.status],
                    )}
                  >
                    {d.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
