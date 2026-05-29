import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CalendarDays,
  ChevronLeft,
  ClipboardList,
  FileText,
  Handshake,
  Loader2,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { PersonalReportPanel } from "@/components/assistant/PersonalReportPanel";
import { team as fallbackTeam } from "@/data/team";
import type { Teammate } from "@/data/team";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import {
  billyAssistantDiagnosticsQuery,
  meetingTopicsQuery,
  saveMeetingTopic,
  type MeetingTopic,
} from "@/lib/billy-assistant-hub";
import { useGoalSettings } from "@/lib/goal-settings";
import type { AuthRole } from "@/lib/auth";
import { teamAssetsQuery } from "@/lib/team-assets";
import { resolveExternalGptLinksFromTeamAssets } from "@/lib/team-asset-link-resolver";
import { cn } from "@/lib/utils";

type AssistantFeature = "home" | "meeting" | "report" | "contract" | "matching";
type MeetingMode = "menu" | "add" | "view";

const featureCards: Array<{
  id: Exclude<AssistantFeature, "home">;
  title: string;
  description: string;
  icon: typeof CalendarDays;
  tone: string;
}> = [
  {
    id: "meeting",
    title: "Meeting Content Memory",
    description: "Save weekly meeting topics before they disappear from your brain.",
    icon: CalendarDays,
    tone: "bg-fun-lime",
  },
  {
    id: "report",
    title: "Personal Report",
    description: "Generate a structured performance readout from dashboard metrics.",
    icon: ClipboardList,
    tone: "bg-fun-blue",
  },
  {
    id: "contract",
    title: "Contract Review",
    description: "Future shortcut for creator and brand contract review.",
    icon: FileText,
    tone: "bg-fun-yellow",
  },
  {
    id: "matching",
    title: "Creator–Brand Matching",
    description: "Future shortcut for matching creators with strong brand fits.",
    icon: Handshake,
    tone: "bg-fun-pink",
  },
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function FeatureCard({
  title,
  description,
  icon: Icon,
  tone,
  onClick,
}: {
  title: string;
  description: string;
  icon: typeof CalendarDays;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tb-action tb-hover-lift rounded-3xl border border-border bg-background/75 p-5 text-left transition hover:bg-background"
    >
      <div className="flex items-start gap-3">
        <div className={cn("tb-hover-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", tone)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-black">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
    </button>
  );
}

function HubShell({
  title,
  subtitle,
  children,
  footer,
  onClose,
  onBack,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  onBack?: () => void;
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
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
        <div className="shrink-0 border-b border-border p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="tb-action mt-0.5 rounded-full p-2 hover:bg-accent"
                  aria-label="Back to Billy GPT home"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : (
                <div className="tb-hover-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <Bot className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-lg font-black">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{subtitle}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="tb-action shrink-0 rounded-full p-2 hover:bg-accent"
              aria-label="Close Billy GPT"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">{children}</div>
        {footer ? <div className="shrink-0 border-t border-border p-5 md:p-6">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

function groupTopicsByMember(topics: MeetingTopic[]) {
  return topics.reduce<Record<string, MeetingTopic[]>>((acc, topic) => {
    acc[topic.memberName] = [...(acc[topic.memberName] ?? []), topic];
    return acc;
  }, {});
}

function MeetingMemoryPanel({ members }: { members: Teammate[] }) {
  const queryClient = useQueryClient();
  const { data: topicsData, isLoading } = useQuery(meetingTopicsQuery);
  const [mode, setMode] = useState<MeetingMode>("menu");
  const [memberName, setMemberName] = useState(members[0]?.name ?? "");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const topics = topicsData?.topics ?? [];
  const groupedTopics = groupTopicsByMember(topics);

  useEffect(() => {
    if (!memberName && members[0]?.name) {
      setMemberName(members[0].name);
    }
  }, [memberName, members]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const result = await saveMeetingTopic({
        data: {
          memberName,
          title,
          details,
        },
      });

      setMessage(result.message);

      if (result.ok) {
        setTitle("");
        setDetails("");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: meetingTopicsQuery.queryKey }),
          queryClient.invalidateQueries({ queryKey: billyAssistantDiagnosticsQuery.queryKey }),
        ]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the meeting topic.");
    } finally {
      setSaving(false);
    }
  };

  if (mode === "add") {
    return (
      <form onSubmit={handleSave} className="space-y-4">
        <button
          type="button"
          onClick={() => setMode("menu")}
          className="tb-action inline-flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-xs font-bold hover:bg-accent"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Meeting options
        </button>

        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="text-xs font-bold text-muted-foreground">Member name</span>
            <select
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              className="tb-search mt-1 h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/30"
            >
              {members.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-xs font-bold text-muted-foreground">Topic title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Better follow-up scripts"
              className="tb-search mt-1 h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-bold text-muted-foreground">Details / notes</span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="Add the context you want to remember for the weekly meeting..."
            rows={5}
            className="tb-search mt-1 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>

        {message && (
          <div
            className={cn(
              "rounded-2xl px-4 py-3 text-sm font-bold",
              message.startsWith("Noted")
                ? "bg-fun-lime/60 text-emerald-950"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !memberName || !title.trim()}
          className="tb-action inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Save topic
        </button>
      </form>
    );
  }

  if (mode === "view") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMode("menu")}
            className="tb-action inline-flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-xs font-bold hover:bg-accent"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Meeting options
          </button>
          <div className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
            {topicsData?.weekLabel ?? "Current week"}
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-2xl bg-muted/50 p-5 text-sm font-bold text-muted-foreground">
            Loading this week’s topics...
          </div>
        ) : topics.length === 0 ? (
          <div className="rounded-3xl border border-border bg-background/75 p-6 text-center">
            <div className="text-sm font-black">No meeting topics saved this week.</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Add one when something comes up, then it will appear here grouped by member.
            </p>
          </div>
        ) : (
          Object.entries(groupedTopics).map(([member, memberTopics]) => (
            <section key={member} className="rounded-3xl border border-border bg-background/75 p-4">
              <div className="mb-3 flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-black">{member}</h3>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                  {memberTopics.length}
                </span>
              </div>
              <div className="space-y-2">
                {memberTopics.map((topic) => (
                  <article key={topic.id} className="rounded-2xl bg-muted/45 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className="text-sm font-black">{topic.title}</h4>
                      <span className="text-[11px] font-bold text-muted-foreground">
                        {formatDateTime(topic.createdAt)}
                      </span>
                    </div>
                    {topic.details ? (
                      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                        {topic.details}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <button
        type="button"
        onClick={() => setMode("add")}
        className="tb-action tb-hover-lift rounded-3xl border border-border bg-fun-lime/45 p-5 text-left hover:bg-fun-lime/60"
      >
        <h3 className="text-sm font-black">Add Meeting Topic</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Save a topic now so it is ready for this week’s team meeting.
        </p>
      </button>
      <button
        type="button"
        onClick={() => setMode("view")}
        className="tb-action tb-hover-lift rounded-3xl border border-border bg-fun-blue/45 p-5 text-left hover:bg-fun-blue/60"
      >
        <h3 className="text-sm font-black">View This Week’s Meeting Topics</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Review saved topics grouped by team member.
        </p>
      </button>
    </div>
  );
}

function ExternalGptPanel({
  type,
  url,
}: {
  type: "contract" | "matching";
  url: string | null | undefined;
}) {
  const isContract = type === "contract";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
      <section className="rounded-3xl border border-border bg-background/75 p-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "tb-hover-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              isContract ? "bg-fun-yellow" : "bg-fun-pink",
            )}
          >
            {isContract ? <FileText className="h-5 w-5" /> : <Handshake className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="text-base font-black">
              {isContract ? "Contract Review" : "Creator–Brand Matching"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {isContract
                ? "Use this for reviewing creator or brand contracts."
                : "Use this to match creators with potential brands based on creator profile and brand briefs."}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-muted/45 p-6">
        <div className="text-sm font-black">External Custom GPT</div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This dashboard does not call an AI model here. It can open your external Custom GPT once a
          link is configured.
        </p>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="tb-action mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:opacity-90"
          >
            {isContract ? "Open Contract Review GPT" : "Open Creator–Brand Matching GPT"}
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-muted px-5 text-sm font-bold text-muted-foreground"
          >
            GPT link not connected yet.
          </button>
        )}
      </section>
    </div>
  );
}

export function AssistantPanel({ authRole }: { authRole: AuthRole | null }) {
  const [open, setOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState<AssistantFeature>("home");
  const [settings] = useGoalSettings();
  const { data } = useQuery(dashboardSheetQuery);
  const { data: diagnostics } = useQuery({
    ...billyAssistantDiagnosticsQuery,
    enabled: open,
  });
  const { data: teamAssetsData } = useQuery({
    ...teamAssetsQuery,
    enabled: open,
  });
  const canUseLocalFallback = data?.source === "fallback" || (!data && import.meta.env.DEV);
  const members = data?.team ?? (canUseLocalFallback ? fallbackTeam : []);
  const externalGptLinks = resolveExternalGptLinksFromTeamAssets(teamAssetsData?.assets ?? []);
  const selectedFeature = featureCards.find((feature) => feature.id === activeFeature);
  const isAdmin = authRole === "admin";

  const title = activeFeature === "home" ? "Billy GPT" : (selectedFeature?.title ?? "Billy GPT");
  const subtitle =
    activeFeature === "home"
      ? "A function-based assistant hub for useful Team Billion dashboard actions."
      : (selectedFeature?.description ?? "Choose an assistant action.");

  const resetPanel = () => {
    setActiveFeature("home");
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setActiveFeature("home");
          setOpen(true);
        }}
        className="tb-action fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-xl transition hover:scale-105 lg:bottom-6 lg:right-6"
      >
        <Sparkles className="h-4 w-4" />
        Billy GPT
      </button>

      {open && (
        <HubShell
          title={title}
          subtitle={subtitle}
          onClose={resetPanel}
          onBack={activeFeature === "home" ? undefined : () => setActiveFeature("home")}
          footer={
            activeFeature === "home" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-muted-foreground">
                <span>
                  Meeting week: {diagnostics?.currentWeekKey ?? "loading"} · Topics:{" "}
                  {diagnostics?.currentWeekTopicCount ?? 0}
                </span>
                <span>
                  Storage:{" "}
                  {diagnostics
                    ? diagnostics.storageMode === "redis"
                      ? "Redis"
                      : diagnostics.storageMode === "local-dev"
                        ? "Local dev server memory"
                        : "Not configured"
                    : "checking"}
                </span>
              </div>
            ) : undefined
          }
        >
          {activeFeature === "home" && (
            <div className="space-y-5">
              <div className="rounded-3xl bg-muted/45 p-5">
                <div className="text-sm font-black">Assistant command center</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  No chat, no paid AI call. Pick a function and Billy GPT will route you to the
                  right workflow.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {featureCards.map((feature) => (
                  <FeatureCard
                    key={feature.id}
                    title={feature.title}
                    description={feature.description}
                    icon={feature.icon}
                    tone={feature.tone}
                    onClick={() => setActiveFeature(feature.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {activeFeature === "meeting" && <MeetingMemoryPanel members={members} />}

          {activeFeature === "report" && (
            <PersonalReportPanel
              members={members}
              data={data}
              settings={settings}
              isAdmin={isAdmin}
            />
          )}

          {activeFeature === "contract" && (
            <ExternalGptPanel
              type="contract"
              url={externalGptLinks.contractReview.url}
            />
          )}

          {activeFeature === "matching" && (
            <ExternalGptPanel
              type="matching"
              url={externalGptLinks.creatorBrandMatching.url}
            />
          )}
        </HubShell>
      )}
    </>
  );
}
