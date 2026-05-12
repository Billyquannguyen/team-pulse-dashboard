import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  delta: number; // percentage
  icon: LucideIcon;
  tone: "lime" | "yellow" | "pink" | "purple" | "blue" | "orange";
  emoji?: string;
};

const toneMap: Record<Props["tone"], string> = {
  lime: "bg-fun-lime",
  yellow: "bg-fun-yellow",
  pink: "bg-fun-pink",
  purple: "bg-fun-purple",
  blue: "bg-fun-blue",
  orange: "bg-fun-orange",
};

export function KpiCard({ label, value, delta, icon: Icon, tone, emoji }: Props) {
  const positive = delta >= 0;
  return (
    <div className={cn("relative overflow-hidden rounded-3xl p-5 text-foreground", toneMap[tone])}>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/60 backdrop-blur">
          <Icon className="h-5 w-5" />
        </div>
        <span
          className={cn(
            "flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-xs font-semibold",
            positive ? "text-emerald-700" : "text-rose-700"
          )}
        >
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {Math.abs(delta)}%
        </span>
      </div>
      <div className="mt-6 text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-1 text-sm font-medium opacity-80">
        {label} {emoji && <span>{emoji}</span>}
      </div>
    </div>
  );
}
