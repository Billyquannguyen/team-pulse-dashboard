import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, Plus, Save, UserRound, UserX } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelect } from "@/components/ui/dashboard-select";
import { loginToDashboard } from "@/lib/auth";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import {
  addTeamMember,
  offboardTeamMember,
  teamMembersQuery,
  updateTeamMember,
  type TeamMemberConfig,
  type TeamMemberStatus,
} from "@/lib/team-members";
import { cn } from "@/lib/utils";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/team-members")({
  head: () => ({
    meta: [
      { title: "Team Members — Team Billion" },
      { name: "description", content: "Configure active Team Billion dashboard members." },
    ],
  }),
  component: TeamMembersPage,
});

type MemberDraft = {
  rowNumber?: number;
  id: string;
  displayName: string;
  shortCode: string;
  worksheetName: string;
  status: TeamMemberStatus;
  role: string;
  color: string;
  sortOrder: number;
  joinedMonth: string;
};

function emptyDraft(sortOrder = 10): MemberDraft {
  return {
    id: "",
    displayName: "",
    shortCode: "",
    worksheetName: "",
    status: "active",
    role: "Closer",
    color: "#7DD3FC",
    sortOrder,
    joinedMonth: "",
  };
}

function draftFromMember(member: TeamMemberConfig): MemberDraft {
  return {
    rowNumber: member.rowNumber,
    id: member.id,
    displayName: member.displayName,
    shortCode: member.shortCode,
    worksheetName: member.worksheetName,
    status: member.status,
    role: member.role,
    color: member.color,
    sortOrder: member.sortOrder,
    joinedMonth: member.joinedMonth,
  };
}

function nextSortOrder(members: TeamMemberConfig[]) {
  return members.reduce((max, member) => Math.max(max, member.sortOrder), 0) + 10 || 10;
}

function TeamMembersPage() {
  const auth = rootRoute.useLoaderData();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(teamMembersQuery);
  const [adminUnlocked, setAdminUnlocked] = useState(auth.isAdmin);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newMember, setNewMember] = useState<MemberDraft>(() => emptyDraft());
  const [drafts, setDrafts] = useState<MemberDraft[]>([]);
  const [statusView, setStatusView] = useState<TeamMemberStatus | "all">("active");
  const isAdminReady = auth.isAdmin || adminUnlocked;
  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const filteredDrafts = useMemo(
    () => (statusView === "all" ? drafts : drafts.filter((draft) => draft.status === statusView)),
    [drafts, statusView],
  );

  useEffect(() => {
    const nextDrafts = members.map(draftFromMember);
    setDrafts(nextDrafts);
    setNewMember(emptyDraft(nextSortOrder(members)));
  }, [members]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: teamMembersQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: dashboardSheetQuery.queryKey }),
    ]);
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    setSavingKey("unlock");

    try {
      const result = await loginToDashboard({ data: { password } });

      if (!result.ok) {
        setPasswordError(result.message);
        return;
      }

      if (result.role !== "admin") {
        setPasswordError("That password opens team view only. Enter the admin password to edit.");
        return;
      }

      setPassword("");
      setAdminUnlocked(true);
      await router.invalidate();
    } catch {
      setPasswordError("Admin unlock failed. Try again in a moment.");
    } finally {
      setSavingKey(null);
    }
  };

  const updateDraft = (rowNumber: number | undefined, patch: Partial<MemberDraft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.rowNumber === rowNumber ? { ...draft, ...patch } : draft)),
    );
  };

  const saveMember = async (draft: MemberDraft) => {
    if (!draft.rowNumber) return;
    setSavingKey(`save-${draft.rowNumber}`);
    setMessage("");

    try {
      await updateTeamMember({ data: { ...draft, rowNumber: draft.rowNumber } });
      setMessage(`${draft.displayName} updated.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update this member.");
    } finally {
      setSavingKey(null);
    }
  };

  const offboardMember = async (draft: MemberDraft) => {
    if (!draft.rowNumber) return;
    setSavingKey(`offboard-${draft.rowNumber}`);
    setMessage("");

    try {
      await offboardTeamMember({ data: { rowNumber: draft.rowNumber } });
      setMessage(`${draft.displayName} is now offboarded and hidden from active dashboard views.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not offboard this member.");
    } finally {
      setSavingKey(null);
    }
  };

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingKey("add");
    setMessage("");

    try {
      await addTeamMember({ data: newMember });
      setMessage(`${newMember.displayName} added to TeamMembers.`);
      setNewMember(emptyDraft(nextSortOrder(members) + 10));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add this member.");
    } finally {
      setSavingKey(null);
    }
  };

  const applySuggestion = (displayName: string, worksheetName: string, shortCode: string) => {
    setNewMember((current) => ({
      ...current,
      displayName,
      worksheetName,
      shortCode,
      id: displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    }));
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Team Members"
        subtitle="The single source of truth for active dashboard members."
      />

      <section className="rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-fun-blue">
                <UserRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black">TeamMembers source</h2>
                <p className="text-sm text-muted-foreground">
                  Active dashboard views use active rows only. Offboarded rows stay available for
                  historical reporting later.
                </p>
              </div>
            </div>
          </div>
          {data?.links.teamMembersSheetUrl && (
            <a
              href={data.links.teamMembersSheetUrl}
              target="_blank"
              rel="noreferrer"
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              Open Sheet <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        {(data?.setupNeeded || data?.warning || (data?.warnings?.length ?? 0) > 0) && (
          <div className="mt-5 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
            <div className="flex items-start gap-2 font-bold">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              Team member setup notice
            </div>
            <div className="mt-2 space-y-1 text-xs leading-6 text-muted-foreground">
              {data?.warning && <p>{data.warning}</p>}
              {data?.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        )}

        {!isAdminReady && (
          <form onSubmit={submitPassword} className="mt-5 rounded-2xl bg-muted/45 p-4">
            <div className="text-sm font-black">Admin unlock required to edit TeamMembers</div>
            <div className="mt-3 flex flex-wrap gap-3">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Admin password"
                className="tb-search h-11 min-w-[240px] flex-1 rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="submit"
                disabled={savingKey === "unlock" || !password.trim()}
                className="tb-action inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {savingKey === "unlock" && <Loader2 className="h-4 w-4 animate-spin" />}
                Unlock
              </button>
            </div>
            {passwordError && (
              <p className="mt-2 text-xs font-bold text-destructive">{passwordError}</p>
            )}
          </form>
        )}
      </section>

      <section className="rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black">Add member</h2>
            <p className="text-sm text-muted-foreground">
              Suggestions come from worksheet tabs, but nothing becomes active until you save it
              here.
            </p>
          </div>
        </div>

        {(data?.suggestions.length ?? 0) > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {data?.suggestions.slice(0, 12).map((suggestion) => (
              <button
                key={suggestion.worksheetName}
                type="button"
                disabled={!isAdminReady}
                onClick={() =>
                  applySuggestion(
                    suggestion.displayName,
                    suggestion.worksheetName,
                    suggestion.shortCode,
                  )
                }
                className="tb-action rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {suggestion.displayName}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={addMember} className="grid gap-3 lg:grid-cols-10">
          <MemberInput
            label="Name"
            value={newMember.displayName}
            onChange={(value) => setNewMember((current) => ({ ...current, displayName: value }))}
            className="lg:col-span-2"
          />
          <MemberInput
            label="ID"
            value={newMember.id}
            onChange={(value) => setNewMember((current) => ({ ...current, id: value }))}
          />
          <MemberInput
            label="Code"
            value={newMember.shortCode}
            onChange={(value) => setNewMember((current) => ({ ...current, shortCode: value }))}
          />
          <MemberInput
            label="Worksheet"
            value={newMember.worksheetName}
            onChange={(value) => setNewMember((current) => ({ ...current, worksheetName: value }))}
            className="lg:col-span-2"
          />
          <MemberInput
            label="Role"
            value={newMember.role}
            onChange={(value) => setNewMember((current) => ({ ...current, role: value }))}
          />
          <MemberInput
            label="Joined"
            type="month"
            value={newMember.joinedMonth}
            onChange={(value) => setNewMember((current) => ({ ...current, joinedMonth: value }))}
          />
          <MemberInput
            label="Order"
            type="number"
            value={String(newMember.sortOrder)}
            onChange={(value) =>
              setNewMember((current) => ({ ...current, sortOrder: Number(value) || 100 }))
            }
          />
          <div>
            <span className="text-xs font-bold text-muted-foreground">Color</span>
            <input
              type="color"
              value={newMember.color}
              onChange={(event) =>
                setNewMember((current) => ({ ...current, color: event.target.value }))
              }
              className="mt-1 h-11 w-full rounded-2xl border border-border bg-background px-2"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={!isAdminReady || savingKey === "add" || !newMember.displayName.trim()}
              className="tb-action inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {savingKey === "add" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black">Manage members</h2>
            <p className="text-sm text-muted-foreground">
              Dashboard pages only use active rows by default.
            </p>
          </div>
          <DashboardSelect
            value={statusView}
            onChange={(value) => setStatusView(value as TeamMemberStatus | "all")}
            options={[
              { value: "active", label: "Active only" },
              { value: "offboarded", label: "Offboarded only" },
              { value: "all", label: "All members" },
            ]}
            triggerClassName="w-[190px]"
          />
        </div>

        {message && (
          <div className="mb-4 rounded-2xl bg-muted/45 px-4 py-3 text-sm font-bold">{message}</div>
        )}

        {isLoading ? (
          <div className="rounded-2xl bg-muted/45 p-5 text-sm font-bold text-muted-foreground">
            Loading TeamMembers...
          </div>
        ) : filteredDrafts.length === 0 ? (
          <div className="rounded-2xl bg-muted/45 p-5 text-sm font-bold text-muted-foreground">
            No members in this view yet.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDrafts.map((draft) => (
              <div
                key={draft.rowNumber ?? draft.id}
                className={cn(
                  "grid gap-3 rounded-3xl border border-border bg-background/75 p-4 lg:grid-cols-12",
                  draft.status === "offboarded" && "opacity-75",
                )}
              >
                <MemberInput
                  label="Name"
                  value={draft.displayName}
                  disabled={!isAdminReady}
                  onChange={(value) => updateDraft(draft.rowNumber, { displayName: value })}
                  className="lg:col-span-2"
                />
                <MemberInput
                  label="ID"
                  value={draft.id}
                  disabled={!isAdminReady}
                  onChange={(value) => updateDraft(draft.rowNumber, { id: value })}
                />
                <MemberInput
                  label="Code"
                  value={draft.shortCode}
                  disabled={!isAdminReady}
                  onChange={(value) => updateDraft(draft.rowNumber, { shortCode: value })}
                />
                <MemberInput
                  label="Worksheet"
                  value={draft.worksheetName}
                  disabled={!isAdminReady}
                  onChange={(value) => updateDraft(draft.rowNumber, { worksheetName: value })}
                  className="lg:col-span-2"
                />
                <div>
                  <span className="text-xs font-bold text-muted-foreground">Status</span>
                  <DashboardSelect
                    value={draft.status}
                    onChange={(value) =>
                      updateDraft(draft.rowNumber, { status: value as TeamMemberStatus })
                    }
                    options={[
                      { value: "active", label: "Active" },
                      { value: "offboarded", label: "Offboarded" },
                    ]}
                    triggerClassName="h-11"
                  />
                </div>
                <MemberInput
                  label="Role"
                  value={draft.role}
                  disabled={!isAdminReady}
                  onChange={(value) => updateDraft(draft.rowNumber, { role: value })}
                />
                <MemberInput
                  label="Joined"
                  type="month"
                  value={draft.joinedMonth}
                  disabled={!isAdminReady}
                  onChange={(value) => updateDraft(draft.rowNumber, { joinedMonth: value })}
                />
                <MemberInput
                  label="Order"
                  type="number"
                  value={String(draft.sortOrder)}
                  disabled={!isAdminReady}
                  onChange={(value) =>
                    updateDraft(draft.rowNumber, { sortOrder: Number(value) || 100 })
                  }
                />
                <div>
                  <span className="text-xs font-bold text-muted-foreground">Color</span>
                  <input
                    type="color"
                    value={draft.color}
                    disabled={!isAdminReady}
                    onChange={(event) =>
                      updateDraft(draft.rowNumber, { color: event.target.value })
                    }
                    className="mt-1 h-11 w-full rounded-2xl border border-border bg-background px-2 disabled:opacity-60"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    disabled={!isAdminReady || savingKey === `save-${draft.rowNumber}`}
                    onClick={() => saveMember(draft)}
                    className="tb-action inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-3 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {savingKey === `save-${draft.rowNumber}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </button>
                  {draft.status === "active" && (
                    <button
                      type="button"
                      disabled={!isAdminReady || savingKey === `offboard-${draft.rowNumber}`}
                      onClick={() => offboardMember(draft)}
                      className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-muted px-3 text-sm font-bold text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      title="Offboard member"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MemberInput({
  label,
  value,
  onChange,
  className,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  type?: "text" | "number" | "month";
  disabled?: boolean;
}) {
  return (
    <label className={className}>
      <span className="text-xs font-bold text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="tb-search mt-1 h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
      />
    </label>
  );
}
