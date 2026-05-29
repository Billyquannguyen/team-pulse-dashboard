"use client";

import * as React from "react";
import { ArrowUpRight, Target } from "lucide-react";
import { cn } from "@/lib/utils";

type TiltStyle = React.CSSProperties & {
  "--tb-glare-x"?: string;
  "--tb-glare-y"?: string;
};

type TeamMonthlyGoalCardProps = React.HTMLAttributes<HTMLDivElement> & {
  current: number;
  target: number;
  label?: string;
};

function formatMoney(value: number) {
  return `£${Math.round(value).toLocaleString()}`;
}

function getProgressPct(current: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function getGoalStatus(current: number, target: number) {
  const gap = Math.round(target - current);

  if (gap <= 0) {
    return {
      label: "Goal cleared",
      detail: `${formatMoney(Math.abs(gap))} over`,
    };
  }

  return {
    label: "Keep pushing",
    detail: `${formatMoney(gap)} left`,
  };
}

export function TeamMonthlyGoalCard({
  className,
  current,
  target,
  label = "Team monthly goal",
  ...props
}: TeamMonthlyGoalCardProps) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [style, setStyle] = React.useState<TiltStyle>({
    transform: "perspective(900px) rotateX(0deg) rotateY(0deg)",
    "--tb-glare-x": "50%",
    "--tb-glare-y": "50%",
  });
  const pct = getProgressPct(current, target);
  const status = getGoalStatus(current, target);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const { left, top, width, height } = cardRef.current.getBoundingClientRect();
    const x = event.clientX - left;
    const y = event.clientY - top;
    const rotateX = ((y - height / 2) / (height / 2)) * -7;
    const rotateY = ((x - width / 2) / (width / 2)) * 7;

    setStyle({
      transform: `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.035, 1.035, 1.035)`,
      transition: "transform 80ms ease-out",
      "--tb-glare-x": `${(x / width) * 100}%`,
      "--tb-glare-y": `${(y / height) * 100}%`,
    });
  };

  const handleMouseLeave = () => {
    setStyle({
      transform: "perspective(900px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
      transition: "transform 360ms ease",
      "--tb-glare-x": "50%",
      "--tb-glare-y": "50%",
    });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        ...style,
        transformStyle: "preserve-3d",
      }}
      className={cn(
        "group relative overflow-hidden rounded-3xl bg-card p-5 text-foreground shadow-sm ring-1 ring-border",
        className,
      )}
      {...props}
    >
      <div
        className="absolute inset-0 opacity-95"
        style={{
          background:
            "radial-gradient(circle at 18% 18%, color-mix(in oklch, var(--fun-lime) 70%, white), transparent 36%), radial-gradient(circle at 86% 20%, color-mix(in oklch, var(--fun-yellow) 68%, white), transparent 32%), linear-gradient(145deg, color-mix(in oklch, var(--card) 78%, var(--fun-lime)), color-mix(in oklch, var(--card) 84%, var(--fun-orange)))",
          transform: "translateZ(-18px) scale(1.08)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-70"
        style={{
          background:
            "radial-gradient(circle at var(--tb-glare-x) var(--tb-glare-y), oklch(1 0 0 / 0.22), transparent 34%)",
        }}
      />
      <div className="absolute -bottom-8 -right-6 h-28 w-28 rounded-full bg-fun-yellow/35 blur-2xl" />

      <div className="relative" style={{ transform: "translateZ(42px)" }}>
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-white/55 bg-white/40 p-3 backdrop-blur-md">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-foreground/60">
              {label}
            </div>
            <div className="mt-1 text-lg font-bold text-foreground">{status.label}</div>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card/75 text-primary shadow-sm">
            <Target className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-4xl font-black leading-none text-foreground">{pct}%</div>
              <div className="mt-1 text-xs font-semibold text-foreground/65">Pending vs target</div>
            </div>
            <div className="rounded-full bg-card/65 px-3 py-1.5 text-xs font-bold text-foreground shadow-sm backdrop-blur">
              {status.detail}
            </div>
          </div>

          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-card/70">
            <div
              className="h-full rounded-full bg-primary shadow-[0_0_14px_color-mix(in_oklch,var(--primary)_30%,transparent)] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 text-xs font-semibold text-foreground/70">
            <span>{formatMoney(current)}</span>
            <span>/ {formatMoney(target)}</span>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-2xl bg-card/55 px-3 py-2 text-xs font-bold text-foreground shadow-sm backdrop-blur">
          <span>Open Goals & Analytics</span>
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
      </div>
    </div>
  );
}
