import { Link } from "@tanstack/react-router";
import { recentDeals, type DealStatus } from "@/data/deals";
import { cn } from "@/lib/utils";

const statusStyles: Record<DealStatus, string> = {
  Won: "bg-fun-lime text-emerald-900",
  Pending: "bg-fun-yellow text-amber-900",
  Invoiced: "bg-fun-blue text-sky-900",
  Paid: "bg-fun-purple text-purple-900",
};

export function RecentDealsCard() {
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
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Closer</th>
              <th className="px-3 py-2 text-left font-medium">Brand</th>
              <th className="px-3 py-2 text-left font-medium">Creator</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">Comm.</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentDeals.map((d) => (
              <tr key={d.id} className="border-t border-border/60">
                <td className="px-3 py-3 text-muted-foreground">{d.date.slice(5)}</td>
                <td className="px-3 py-3 font-medium">{d.closer}</td>
                <td className="px-3 py-3">{d.brand}</td>
                <td className="px-3 py-3 text-muted-foreground">{d.creator}</td>
                <td className="px-3 py-3 text-right">${d.grossValue.toLocaleString()}</td>
                <td className="px-3 py-3 text-right font-semibold">${d.commission.toLocaleString()}</td>
                <td className="px-3 py-3">
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusStyles[d.status])}>
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
