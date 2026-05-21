import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
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

export function KpiCard({ label, value, icon: Icon, tone, emoji }: Props) {
  return (
    <div
      className={cn(
        "tb-hover-lift tb-stat-tile relative overflow-hidden rounded-3xl p-5 text-foreground",
        toneMap[tone],
      )}
    >
      <div className="flex items-start justify-between">
        <div className="tb-hover-icon flex h-10 w-10 items-center justify-center rounded-2xl bg-white/60 backdrop-blur">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-6 text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-1 text-sm font-medium opacity-80">
        {label} {emoji && <span>{emoji}</span>}
      </div>
    </div>
  );
}
