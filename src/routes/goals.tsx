import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Gift,
  Lock,
  SlidersHorizontal,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { TopExclusiveCreators } from "@/components/goals/TopExclusiveCreators";
import {
  team as fallbackTeam,
  totalCommission,
  totalDealsClosed,
  totalMonthCommission,
  type Teammate,
} from "@/data/team";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { type GoalSettings, useGoalSettings } from "@/lib/goal-settings";
import {
  getMemberExclusiveCreatorGoal,
  getMemberMonthlyGoal,
  getMemberProgressionGoal,
  getTeamExclusiveCreatorGoal,
  getTeamMonthlyGoal,
} from "@/lib/goal-targets";
import { cn } from "@/lib/utils";
import { loginToDashboard, type AuthRole } from "@/lib/auth";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/goals")({
  head: () => ({
    meta: [
      { title: "Goals & Analytics — Team Billion" },
      {
        name: "description",
        content: "Track Team Billion monthly goals, progression, and performance analytics.",
      },
    ],
  }),
  component: GoalsPage,
});

type Tone = "lime" | "yellow" | "pink" | "purple" | "blue" | "orange";

const barTone: Record<Tone, string> = {
  lime: "bg-gradient-to-r from-fun-lime to-fun-yellow",
  yellow: "bg-gradient-to-r from-fun-yellow to-fun-orange",
  pink: "bg-gradient-to-r from-fun-pink to-fun-purple",
  purple: "bg-gradient-to-r from-fun-purple to-fun-blue",
  blue: "bg-gradient-to-r from-fun-blue to-fun-lime",
  orange: "bg-gradient-to-r from-fun-orange to-fun-pink",
};

type MotivationCardData = {
  memberName: string;
  goalType: string;
  current: number;
  target: number;
  pct: number;
  stage: string;
  headline: string;
  message: string;
};

const confettiPieces = Array.from({ length: 26 }, (_, index) => ({
  id: index,
  left: 8 + ((index * 17) % 84),
  drift: ((index % 7) - 3) * 18,
  delay: (index % 9) * 58,
  duration: 900 + (index % 5) * 120,
  size: 6 + (index % 4) * 2,
  rotate: (index * 37) % 180,
}));

const confettiColors = [
  "var(--fun-lime)",
  "var(--fun-yellow)",
  "var(--fun-pink)",
  "var(--fun-purple)",
  "var(--fun-blue)",
  "var(--fun-orange)",
];

const milestoneVisuals: Record<
  string,
  {
    caption: string;
    image: string;
    alt: string;
    background: string;
  }
> = {
  "Starting line": {
    caption: "New start",
    image: "/motivation/starting-line.jpg",
    alt: "It's not hard, it's just new motivational illustration",
    background: "#f4eadc",
  },
  "Early traction": {
    caption: "Progress counts",
    image: "/motivation/early-traction.jpg",
    alt: "Any progress is progress motivational illustration",
    background: "#f2eadf",
  },
  "Momentum forming": {
    caption: "Trust the process",
    image: "/motivation/momentum-forming.jpg",
    alt: "Trust the process motivational illustration",
    background: "#efe3d3",
  },
  "Strong pace": {
    caption: "Keep growing",
    image: "/motivation/strong-pace.jpg",
    alt: "Keep going keep growing motivational illustration",
    background: "#f3e4cf",
  },
  "Final stretch": {
    caption: "Still trying",
    image: "/motivation/final-stretch.jpg",
    alt: "Crying but still trying motivational illustration",
    background: "#eeeeee",
  },
  "Goal cleared": {
    caption: "Stay sunny",
    image: "/motivation/goal-cleared.jpg",
    alt: "Stay sunny motivational illustration",
    background: "#6f91ed",
  },
};

function formatMoney(value: number) {
  return `£${Math.round(value).toLocaleString()}`;
}

function getProgressPct(current: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function getGoalGap(current: number, target: number) {
  const gap = Math.round(target - current);
  if (gap <= 0) return `${formatMoney(Math.abs(gap))} over`;
  return `${formatMoney(gap)} left`;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString();
}

function pluralizeCreator(value: number) {
  return `${formatCount(value)} creator${Math.round(value) === 1 ? "" : "s"}`;
}

function getCountGoalGap(current: number, target: number) {
  const gap = Math.round(target - current);
  if (gap <= 0) return `${pluralizeCreator(Math.abs(gap))} over`;
  return `${pluralizeCreator(gap)} left`;
}

function getMotivationStage(pct: number) {
  if (pct >= 100) {
    return {
      stage: "Goal cleared",
      headline: "You did it. Enjoy the win.",
      message: "Now make the winning habit repeatable.",
    };
  }

  if (pct >= 82) {
    return {
      stage: "Final stretch",
      headline: "You are close. Keep pushing.",
      message: "One focused move can change the finish.",
    };
  }

  if (pct >= 58) {
    return {
      stage: "Strong pace",
      headline: "The pace is real. Keep growing.",
      message: "Protect the rhythm that got you here.",
    };
  }

  if (pct >= 33) {
    return {
      stage: "Momentum forming",
      headline: "Momentum is building.",
      message: "Trust the process and keep showing up.",
    };
  }

  if (pct >= 12) {
    return {
      stage: "Early traction",
      headline: "Progress is still progress.",
      message: "Small wins count when you keep stacking them.",
    };
  }

  return {
    stage: "Starting line",
    headline: "It is not hard. It is just new.",
    message: "Start simple and take the next step.",
  };
}

function createMotivationCard(
  memberName: string,
  goalType: string,
  current: number,
  target: number,
): MotivationCardData {
  const pct = getProgressPct(current, target);
  const stage = getMotivationStage(pct);

  return {
    memberName,
    goalType,
    current,
    target,
    pct,
    ...stage,
  };
}

function GoalProgressPanel({
  title,
  label,
  current,
  target,
  tone,
  size = "normal",
  formatValue = formatMoney,
  formatGap = getGoalGap,
  onMotivationOpen,
}: {
  title: string;
  label: string;
  current: number;
  target: number;
  tone: Tone;
  icon?: LucideIcon;
  size?: "hero" | "normal";
  formatValue?: (value: number) => string;
  formatGap?: (current: number, target: number) => string;
  onMotivationOpen?: () => void;
}) {
  const pct = getProgressPct(current, target);
  const iconClassName = cn(
    "tb-hover-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted transition",
    onMotivationOpen &&
      "hover:bg-accent hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30",
  );

  return (
    <div
      className={cn(
        "tb-hover-lift rounded-3xl bg-card p-5 ring-1 ring-border",
        size === "hero" && "p-6 md:p-7",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          <div className={cn("mt-2 font-bold", size === "hero" ? "text-4xl" : "text-2xl")}>
            {formatValue(current)}
            <span className="text-base font-medium text-muted-foreground">
              {" "}
              / {formatValue(target)}
            </span>
          </div>
        </div>
        {onMotivationOpen ? (
          <button
            type="button"
            onClick={onMotivationOpen}
            className={iconClassName}
            aria-label={`Open ${label.toLowerCase()} motivation card for ${title}`}
            title="View motivation card"
          >
            <Gift className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <div className="mt-5 h-3 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barTone[tone])} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-foreground">{pct}%</span>
        <span className="text-right text-muted-foreground">
          {label} · {formatGap(current, target)}
        </span>
      </div>
    </div>
  );
}

function ConfettiBurst({ intense }: { intense: boolean }) {
  const visiblePieces = intense ? confettiPieces : confettiPieces.slice(0, 16);

  return (
    <>
      <style>{`
        @keyframes tb-confetti-fall {
          0% {
            opacity: 0;
            transform: translate3d(0, -18px, 0) rotate(0deg);
          }
          14% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--tb-drift), 180px, 0) rotate(260deg);
          }
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {visiblePieces.map((piece) => (
          <span
            key={piece.id}
            className="absolute top-0 rounded-sm"
            style={{
              left: `${piece.left}%`,
              width: `${piece.size}px`,
              height: `${piece.size * 1.5}px`,
              background: confettiColors[piece.id % confettiColors.length],
              opacity: 0,
              transform: `rotate(${piece.rotate}deg)`,
              animation: `tb-confetti-fall ${piece.duration}ms ease-out ${piece.delay}ms forwards`,
              ["--tb-drift" as string]: `${piece.drift}px`,
            }}
          />
        ))}
      </div>
    </>
  );
}

function MilestoneVisual({ card }: { card: MotivationCardData }) {
  const visual = milestoneVisuals[card.stage] ?? milestoneVisuals["Starting line"];

  return (
    <div
      className="tb-hover-lift rounded-2xl p-3 ring-1 ring-border"
      style={{ background: visual.background }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
          {visual.caption}
        </div>
        <div className="rounded-full bg-background/70 px-3 py-1 text-xs font-semibold ring-1 ring-border">
          {card.pct}%
        </div>
      </div>
      <div className="flex items-center justify-center rounded-xl bg-background/70 p-2">
        <img
          src={visual.image}
          alt={visual.alt}
          className="tb-hover-icon max-h-[46vh] max-w-full object-contain"
          loading="eager"
        />
      </div>
    </div>
  );
}

function MotivationCardDialog({
  card,
  onClose,
}: {
  card: MotivationCardData | null;
  onClose: () => void;
}) {
  if (!card) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm">
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-card shadow-2xl ring-1 ring-border">
        <ConfettiBurst intense={card.stage === "Goal cleared" || card.pct >= 82} />
        <div className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                {card.stage}
              </div>
              <h4 className="mt-3 text-xl font-bold">{card.memberName}</h4>
              <p className="mt-1 text-sm text-muted-foreground">{card.goalType}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="tb-action rounded-full p-2 hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <MilestoneVisual card={card} />

          <div className="tb-hover-lift rounded-2xl bg-muted/50 p-4">
            <div className="text-base font-semibold">{card.headline}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{card.message}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="tb-action inline-flex h-11 w-full items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  prefix = "£",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const nextValue = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(nextValue) || nextValue < 1) {
      setDraft(String(value));
      return;
    }

    const roundedValue = Math.round(nextValue);
    onChange(roundedValue);
    setDraft(String(roundedValue));
  };

  return (
    <label className="flex min-w-0 flex-col">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="tb-search mt-1 flex h-12 items-center rounded-2xl border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/30">
        {prefix && (
          <span className="mr-1 text-sm font-semibold text-muted-foreground">{prefix}</span>
        )}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraft(nextDraft);

            const nextValue = Number(nextDraft);
            if (nextDraft.trim() !== "" && Number.isFinite(nextValue) && nextValue >= 1) {
              onChange(Math.round(nextValue));
            }
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          className="h-full w-full bg-transparent text-sm font-semibold tabular-nums outline-none"
        />
      </div>
    </label>
  );
}

function GoalEditCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-background/75 p-4 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h5 className="text-sm font-bold">{title}</h5>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function AdminGoalControls({
  members,
  settings,
  onChange,
  authRole,
}: {
  members: Teammate[];
  settings: GoalSettings;
  onChange: (settings: GoalSettings) => void;
  authRole: AuthRole | null;
}) {
  const router = useRouter();
  const isAdmin = authRole === "admin";
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  const setField = (
    field: keyof Pick<
      GoalSettings,
      | "teamMonthlyGoal"
      | "memberMonthlyGoal"
      | "progressionGoal"
      | "teamExclusiveCreatorGoal"
      | "memberExclusiveCreatorGoal"
    >,
    value: number,
  ) => {
    onChange({ ...settings, [field]: value });
  };

  const setCustomGoal = (
    field: "customMemberMonthlyGoals" | "customProgressionGoals" | "customExclusiveCreatorGoals",
    memberId: string,
    value: number | null,
  ) => {
    const nextCustomGoals = { ...settings[field] };
    if (value === null) {
      delete nextCustomGoals[memberId];
    } else {
      nextCustomGoals[memberId] = value;
    }

    onChange({ ...settings, [field]: nextCustomGoals });
  };

  const resetCustomGoals = (memberId: string) => {
    const nextMemberMonthlyGoals = { ...settings.customMemberMonthlyGoals };
    const nextProgressionGoals = { ...settings.customProgressionGoals };
    const nextExclusiveCreatorGoals = { ...settings.customExclusiveCreatorGoals };
    delete nextMemberMonthlyGoals[memberId];
    delete nextProgressionGoals[memberId];
    delete nextExclusiveCreatorGoals[memberId];

    onChange({
      ...settings,
      customMemberMonthlyGoals: nextMemberMonthlyGoals,
      customProgressionGoals: nextProgressionGoals,
      customExclusiveCreatorGoals: nextExclusiveCreatorGoals,
    });
  };

  const submitPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    setIsUnlocking(true);

    try {
      const result = await loginToDashboard({ data: { password } });

      if (!result.ok) {
        setPasswordError(result.message);
        return;
      }

      if (result.role !== "admin") {
        setPasswordError("That unlocks team view only. Enter the admin password to edit goals.");
        return;
      }

      setPassword("");
      await router.invalidate();
    } catch {
      setPasswordError("Admin unlock failed. Try again in a moment.");
    } finally {
      setIsUnlocking(false);
    }
  };

  const openEditDialog = () => {
    setCustomOpen(false);
    setPassword("");
    setPasswordError("");
    setEditDialogOpen(true);
  };

  const closeEditDialog = () => {
    setEditDialogOpen(false);
    setCustomOpen(false);
    setPassword("");
    setPasswordError("");
  };

  return (
    <>
      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Admin goal controls</h3>
            <p className="text-xs text-muted-foreground">
              Edit the main targets here. Members can keep viewing without logging in.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            {isAdmin ? "Admin unlocked" : "Locked"}
          </div>
        </div>

        <div className="tb-hover-lift mt-5 rounded-2xl bg-muted/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Goals are view-only</div>
              <div className="text-xs text-muted-foreground">
                {isAdmin
                  ? "Click edit to change targets."
                  : "Click edit and enter the admin password to change targets."}
              </div>
            </div>
            <button
              type="button"
              onClick={openEditDialog}
              className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Lock className="h-4 w-4" />
              Edit goals
            </button>
          </div>
        </div>
      </div>

      {editDialogOpen && (
        <GoalModal
          title="Edit goals"
          description={
            isAdmin
              ? "Change the targets below. Values save in this browser."
              : "Enter the admin password to unlock goal editing."
          }
          onClose={closeEditDialog}
        >
          {!isAdmin ? (
            <form onSubmit={submitPassword} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
                <div className="rounded-3xl border border-border bg-background/75 p-4 shadow-sm">
                  <label className="block">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Admin password
                    </span>
                    <input
                      autoFocus
                      type="password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setPasswordError("");
                      }}
                      placeholder="Enter admin password"
                      disabled={isUnlocking}
                      className="tb-search mt-1 h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </label>
                  {passwordError && (
                    <p className="mt-2 text-sm font-medium text-destructive">{passwordError}</p>
                  )}
                </div>
              </div>

              <div className="grid shrink-0 gap-2 border-t border-border bg-card p-5 sm:grid-cols-2 md:p-6">
                <button
                  type="button"
                  onClick={closeEditDialog}
                  className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-muted px-4 text-sm font-semibold hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUnlocking || password.length === 0}
                  className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  {isUnlocking ? "Checking..." : "Unlock editing"}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-muted/40 p-3">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
                    <Check className="h-3.5 w-3.5" />
                    Admin unlocked
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Footer stays fixed. Scroll inside this panel only.
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <GoalEditCard
                    icon={Target}
                    title="Monthly commission"
                    description="Compare monthly targets against deals closed in the current month."
                  >
                    <div className="grid gap-3">
                      <NumberInput
                        label="Team monthly goal"
                        value={settings.teamMonthlyGoal}
                        onChange={(value) => setField("teamMonthlyGoal", value)}
                      />
                      <NumberInput
                        label="Member monthly goal"
                        value={settings.memberMonthlyGoal}
                        onChange={(value) => setField("memberMonthlyGoal", value)}
                      />
                    </div>
                  </GoalEditCard>

                  <GoalEditCard
                    icon={UserCheck}
                    title="Creator signing"
                    description="Set exclusive creator targets for the team and each member."
                  >
                    <div className="grid gap-3">
                      <NumberInput
                        label="Team exclusive creator goal"
                        value={settings.teamExclusiveCreatorGoal}
                        onChange={(value) => setField("teamExclusiveCreatorGoal", value)}
                        prefix=""
                      />
                      <NumberInput
                        label="Member exclusive creator goal"
                        value={settings.memberExclusiveCreatorGoal}
                        onChange={(value) => setField("memberExclusiveCreatorGoal", value)}
                        prefix=""
                      />
                    </div>
                  </GoalEditCard>

                  <div className="md:col-span-2">
                    <GoalEditCard
                      icon={TrendingUp}
                      title="Long-term progression"
                      description="Used by the leaderboard to track when a member is ready for the next commission level."
                    >
                      <div className="max-w-sm">
                        <NumberInput
                          label="Long-term progression goal"
                          value={settings.progressionGoal}
                          onChange={(value) => setField("progressionGoal", value)}
                        />
                      </div>
                    </GoalEditCard>
                  </div>
                </div>

                <section className="rounded-3xl border border-border bg-background/75 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
                        <Users className="h-4 w-4" />
                      </div>
                      <div>
                        <h5 className="text-sm font-bold">Custom member goals</h5>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Only use this when one member needs a different target from everyone else.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCustomOpen((value) => !value)}
                      className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-4 text-sm font-semibold hover:bg-accent"
                    >
                      {customOpen ? (
                        <X className="h-4 w-4" />
                      ) : (
                        <SlidersHorizontal className="h-4 w-4" />
                      )}
                      {customOpen ? "Hide custom goals" : "Open custom goals"}
                    </button>
                  </div>

                  {customOpen && (
                    <div className="mt-4 grid max-h-[34vh] gap-3 overflow-y-auto pr-1">
                      {members.map((member) => {
                        const hasMonthlyCustom =
                          settings.customMemberMonthlyGoals[member.id] !== undefined;
                        const hasProgressionCustom =
                          settings.customProgressionGoals[member.id] !== undefined;
                        const hasExclusiveCreatorCustom =
                          settings.customExclusiveCreatorGoals[member.id] !== undefined;

                        return (
                          <div
                            key={member.id}
                            className="rounded-2xl border border-border bg-card p-3"
                          >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-bold">{member.name}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <span>
                                    Current month closed {formatMoney(member.monthCommission)}
                                  </span>
                                  <span>All-time closed {formatMoney(member.commission)}</span>
                                  <span>Exclusive {formatCount(member.exclusiveCreators)}</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={
                                  !hasMonthlyCustom &&
                                  !hasProgressionCustom &&
                                  !hasExclusiveCreatorCustom
                                }
                                onClick={() => resetCustomGoals(member.id)}
                                className="tb-action rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Use default
                              </button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-3">
                              <NumberInput
                                label="Monthly"
                                value={
                                  settings.customMemberMonthlyGoals[member.id] ??
                                  settings.memberMonthlyGoal
                                }
                                onChange={(value) =>
                                  setCustomGoal("customMemberMonthlyGoals", member.id, value)
                                }
                              />
                              <NumberInput
                                label="Progression"
                                value={
                                  settings.customProgressionGoals[member.id] ??
                                  settings.progressionGoal
                                }
                                onChange={(value) =>
                                  setCustomGoal("customProgressionGoals", member.id, value)
                                }
                              />
                              <NumberInput
                                label="Exclusive"
                                value={
                                  settings.customExclusiveCreatorGoals[member.id] ??
                                  settings.memberExclusiveCreatorGoal
                                }
                                onChange={(value) =>
                                  setCustomGoal("customExclusiveCreatorGoals", member.id, value)
                                }
                                prefix=""
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>

              <div className="flex shrink-0 justify-end border-t border-border bg-card p-5 md:p-6">
                <button
                  type="button"
                  onClick={closeEditDialog}
                  className="tb-action inline-flex h-11 min-w-32 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </GoalModal>
      )}
    </>
  );
}

function GoalModal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
        <div className="shrink-0 border-b border-border p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="text-base font-semibold">{title}</h4>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="tb-action rounded-full p-2 hover:bg-accent"
              aria-label="Close edit goals"
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

function GoalsPage() {
  const auth = rootRoute.useLoaderData();
  const { data } = useQuery(dashboardSheetQuery);
  const [settings, setSettings] = useGoalSettings();
  const [motivationCard, setMotivationCard] = useState<MotivationCardData | null>(null);
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const team = data?.team ?? (canUseLocalFallback ? fallbackTeam : []);
  const totals = data?.totals ?? {
    totalPaid: canUseLocalFallback ? totalCommission : 0,
    totalPaidCommission: 0,
    paidThisMonth: canUseLocalFallback ? totalMonthCommission : 0,
    pendingOwed: 0,
    dealsClosed: canUseLocalFallback ? totalDealsClosed : 0,
    totalPricing: 0,
    averageDealSize: 0,
    averageProfitMargin: 0,
    paidGoal: 0,
    dealsGoal: 0,
  };
  const sortedByCurrentMonth = useMemo(
    () => [...team].sort((a, b) => b.monthCommission - a.monthCommission),
    [team],
  );
  const sortedByProgression = useMemo(
    () => [...team].sort((a, b) => b.commission - a.commission),
    [team],
  );
  const sortedByExclusiveCreators = useMemo(
    () => [...team].sort((a, b) => b.exclusiveCreators - a.exclusiveCreators),
    [team],
  );
  const teamExclusiveCreators = team.reduce((sum, member) => sum + member.exclusiveCreators, 0);
  const creators = data?.creators ?? [];
  const deals = data?.deals ?? [];

  const getMonthlyTarget = (member: Teammate) => getMemberMonthlyGoal(settings, member);
  const getProgressionTarget = (member: Teammate) => getMemberProgressionGoal(settings, member);
  const getExclusiveCreatorTarget = (member: Teammate) =>
    getMemberExclusiveCreatorGoal(settings, member);

  return (
    <div className="space-y-6">
      <AppHeader
        title="Goals & Analytics"
        subtitle="Current-month closed commission first, then long-term progression."
      />

      <GoalProgressPanel
        title="Team monthly goal"
        label="Current-month closed"
        current={totals.paidThisMonth}
        target={getTeamMonthlyGoal(settings)}
        tone="lime"
        icon={Target}
        size="hero"
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Individual monthly goals</h3>
            <p className="text-xs text-muted-foreground">
              Each member's current-month closed commission compared with their monthly goal.
            </p>
          </div>
          <div className="hidden rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground sm:inline-flex">
            {team.length} members
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {sortedByCurrentMonth.map((member, index) => (
            <GoalProgressPanel
              key={member.id}
              title={member.name}
              label="Current-month closed"
              current={member.monthCommission}
              target={getMonthlyTarget(member)}
              tone={(["yellow", "pink", "purple", "blue"] as Tone[])[index % 4]}
              icon={Users}
              onMotivationOpen={() =>
                setMotivationCard(
                  createMotivationCard(
                    member.name,
                    "Monthly commission goal",
                    member.monthCommission,
                    getMonthlyTarget(member),
                  ),
                )
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">Long-term progression goals</h3>
          <p className="text-xs text-muted-foreground">
            All-time closed commission compared with the level needed before moving up commission.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {sortedByProgression.map((member, index) => (
            <GoalProgressPanel
              key={member.id}
              title={member.name}
              label="All-time closed commission"
              current={member.commission}
              target={getProgressionTarget(member)}
              tone={(["lime", "orange", "blue", "purple"] as Tone[])[index % 4]}
              icon={TrendingUp}
              onMotivationOpen={() =>
                setMotivationCard(
                  createMotivationCard(
                    member.name,
                    "Long-term progression goal",
                    member.commission,
                    getProgressionTarget(member),
                  ),
                )
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">Exclusive creator signing goals</h3>
          <p className="text-xs text-muted-foreground">
            Exclusive creators are counted from the Signed & Partnered creator roster.
          </p>
        </div>

        <GoalProgressPanel
          title="Team exclusive creator goal"
          label="Exclusive signed"
          current={teamExclusiveCreators}
          target={getTeamExclusiveCreatorGoal(settings)}
          tone="orange"
          icon={UserCheck}
          size="hero"
          formatValue={formatCount}
          formatGap={getCountGoalGap}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {sortedByExclusiveCreators.map((member, index) => (
            <GoalProgressPanel
              key={member.id}
              title={member.name}
              label="Exclusive signed"
              current={member.exclusiveCreators}
              target={getExclusiveCreatorTarget(member)}
              tone={(["lime", "yellow", "pink", "blue"] as Tone[])[index % 4]}
              icon={UserCheck}
              formatValue={formatCount}
              formatGap={getCountGoalGap}
              onMotivationOpen={() =>
                setMotivationCard(
                  createMotivationCard(
                    member.name,
                    "Exclusive creator signing goal",
                    member.exclusiveCreators,
                    getExclusiveCreatorTarget(member),
                  ),
                )
              }
            />
          ))}
        </div>
      </section>

      <TopExclusiveCreators creators={creators} deals={deals} />

      <AdminGoalControls
        members={team}
        settings={settings}
        onChange={setSettings}
        authRole={auth.role}
      />
      <MotivationCardDialog card={motivationCard} onClose={() => setMotivationCard(null)} />
    </div>
  );
}
