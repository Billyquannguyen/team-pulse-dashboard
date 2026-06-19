import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { Edit3, ExternalLink, Loader2, Plus, UserCheck, UserRound, UserX, X } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelect } from "@/components/ui/dashboard-select";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import {
  addTeamMember,
  createTeamMembersSheet,
  teamMembersQuery,
  updateTeamMember,
  type TeamMemberConfig,
  type TeamMemberStatus,
} from "@/lib/team-members";
import { cn } from "@/lib/utils";

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
  displayName: string;
  id: string;
  joinedMonth: string;
  status: TeamMemberStatus;
};

type MemberModalState = {
  mode: "add" | "edit";
  draft: MemberDraft;
} | null;

function emptyDraft(): MemberDraft {
  return {
    displayName: "",
    id: "",
    joinedMonth: "",
    status: "active",
  };
}

function draftFromMember(member: TeamMemberConfig): MemberDraft {
  return {
    rowNumber: member.rowNumber,
    displayName: member.displayName,
    id: member.id,
    joinedMonth: member.joinedMonth,
    status: member.status,
  };
}

function TeamMembersPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(teamMembersQuery);
  const [modal, setModal] = useState<MemberModalState>(null);
  const [message, setMessage] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const members = useMemo(() => data?.members ?? [], [data?.members]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: teamMembersQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: dashboardSheetQuery.queryKey }),
    ]);
  };

  const openAdd = () => {
    setMessage("");
    setModal({ mode: "add", draft: emptyDraft() });
  };

  const openEdit = (member: TeamMemberConfig) => {
    setMessage("");
    setModal({ mode: "edit", draft: draftFromMember(member) });
  };

  const updateModalDraft = (patch: Partial<MemberDraft>) => {
    setModal((current) =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );
  };

  const saveModal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modal) return;

    const draft = modal.draft;
    const key = modal.mode === "add" ? "add" : `save-${draft.rowNumber}`;
    setSavingKey(key);
    setMessage("");

    try {
      if (modal.mode === "add") {
        await addTeamMember({ data: draft });
        setMessage(`${draft.displayName} added.`);
      } else if (draft.rowNumber) {
        await updateTeamMember({ data: { ...draft, rowNumber: draft.rowNumber } });
        setMessage(`${draft.displayName} updated.`);
      }

      setModal(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this member.");
    } finally {
      setSavingKey(null);
    }
  };

  const createSheet = async () => {
    setSavingKey("create-sheet");
    setMessage("");

    try {
      await createTeamMembersSheet();
      setMessage("TeamMembers sheet created.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create TeamMembers sheet.");
    } finally {
      setSavingKey(null);
    }
  };

  const toggleStatus = async (member: TeamMemberConfig) => {
    if (!member.rowNumber) return;
    const nextStatus: TeamMemberStatus = member.status === "active" ? "offboarded" : "active";
    setSavingKey(`status-${member.rowNumber}`);
    setMessage("");

    try {
      await updateTeamMember({
        data: {
          rowNumber: member.rowNumber,
          displayName: member.displayName,
          id: member.id,
          joinedMonth: member.joinedMonth,
          status: nextStatus,
        },
      });
      setMessage(
        nextStatus === "active"
          ? `${member.displayName} reactivated.`
          : `${member.displayName} is now offboarded.`,
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update this member.");
    } finally {
      setSavingKey(null);
    }
  };

  const showMissingState = data?.setupNeeded;

  return (
    <div className="space-y-6">
      <AppHeader title="Team Members" subtitle="Control who appears in active dashboard views." />

      <section className="rounded-3xl bg-card p-5 ring-1 ring-border md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-fun-blue">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black">TeamMembers</h2>
              <p className="text-sm text-muted-foreground">
                Active members appear in dashboard cards, filters, goals, and leaderboard.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.links.teamMembersSheetUrl && (
              <a
                href={data.links.teamMembersSheetUrl}
                target="_blank"
                rel="noreferrer"
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-4 text-sm font-bold text-foreground hover:bg-accent"
              >
                Open Sheet <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {showMissingState && (
              <button
                type="button"
                onClick={createSheet}
                disabled={savingKey === "create-sheet"}
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-4 text-sm font-bold text-foreground hover:bg-accent disabled:opacity-50"
              >
                {savingKey === "create-sheet" && <Loader2 className="h-4 w-4 animate-spin" />}
                Create TeamMembers sheet
              </button>
            )}
            <button
              type="button"
              onClick={openAdd}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Add Member
            </button>
          </div>
        </div>

        {message && (
          <div className="mt-4 rounded-2xl bg-muted/45 px-4 py-3 text-sm font-bold">{message}</div>
        )}
      </section>

      {showMissingState ? (
        <section className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
            <UserRound className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="mt-4 text-lg font-black">TeamMembers sheet is missing.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Create it to control active and offboarded dashboard members.
          </p>
          <button
            type="button"
            onClick={createSheet}
            disabled={savingKey === "create-sheet"}
            className="tb-action mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {savingKey === "create-sheet" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create TeamMembers sheet
          </button>
        </section>
      ) : (
        <section className="overflow-hidden rounded-3xl bg-card ring-1 ring-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/45 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-4 font-black">Name</th>
                  <th className="px-5 py-4 font-black">ID</th>
                  <th className="px-5 py-4 font-black">Joined Month</th>
                  <th className="px-5 py-4 font-black">Status</th>
                  <th className="px-5 py-4 text-right font-black">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-8 text-center font-bold text-muted-foreground"
                    >
                      Loading TeamMembers...
                    </td>
                  </tr>
                ) : members.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-8 text-center font-bold text-muted-foreground"
                    >
                      No members yet.
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr
                      key={member.rowNumber ?? member.id}
                      className={cn(member.status === "offboarded" && "opacity-70")}
                    >
                      <td className="px-5 py-4 font-black">{member.displayName}</td>
                      <td className="px-5 py-4 font-semibold text-muted-foreground">{member.id}</td>
                      <td className="px-5 py-4 font-semibold">{member.joinedMonth || "Not set"}</td>
                      <td className="px-5 py-4">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-3 py-1 text-xs font-black",
                            member.status === "active"
                              ? "bg-fun-lime text-emerald-950"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {member.status === "active" ? "Active" : "Offboarded"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(member)}
                            className="tb-action inline-flex h-9 items-center gap-2 rounded-xl bg-muted px-3 text-xs font-bold text-foreground hover:bg-accent"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={savingKey === `status-${member.rowNumber}`}
                            onClick={() => toggleStatus(member)}
                            className="tb-action inline-flex h-9 items-center gap-2 rounded-xl bg-muted px-3 text-xs font-bold text-foreground hover:bg-accent disabled:opacity-50"
                          >
                            {savingKey === `status-${member.rowNumber}` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : member.status === "active" ? (
                              <UserX className="h-3.5 w-3.5" />
                            ) : (
                              <UserCheck className="h-3.5 w-3.5" />
                            )}
                            {member.status === "active" ? "Mark Offboarded" : "Reactivate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {modal && (
        <MemberModal
          mode={modal.mode}
          draft={modal.draft}
          saving={savingKey === "add" || savingKey === `save-${modal.draft.rowNumber}`}
          onChange={updateModalDraft}
          onClose={() => setModal(null)}
          onSubmit={saveModal}
        />
      )}
    </div>
  );
}

function MemberModal({
  mode,
  draft,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: "add" | "edit";
  draft: MemberDraft;
  saving: boolean;
  onChange: (patch: Partial<MemberDraft>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-xl overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-black">
              {mode === "add" ? "Add Member" : "Edit Member"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              ID is also the worksheet/tab name used for dashboard data.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tb-action rounded-full p-2 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 p-5">
          <MemberInput
            label="Name"
            value={draft.displayName}
            required
            onChange={(value) => onChange({ displayName: value })}
          />
          <MemberInput
            label="ID"
            value={draft.id}
            required
            onChange={(value) => onChange({ id: value })}
          />
          <MemberInput
            label="Joined Month"
            type="month"
            value={draft.joinedMonth}
            onChange={(value) => onChange({ joinedMonth: value })}
          />
          <label>
            <span className="text-xs font-bold text-muted-foreground">Status</span>
            <DashboardSelect
              value={draft.status}
              onChange={(value) => onChange({ status: value as TeamMemberStatus })}
              options={[
                { value: "active", label: "Active" },
                { value: "offboarded", label: "Offboarded" },
              ]}
              triggerClassName="mt-1 h-11"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-5">
          <button
            type="button"
            onClick={onClose}
            className="tb-action h-10 rounded-2xl bg-muted px-4 text-sm font-bold hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !draft.displayName.trim() || !draft.id.trim()}
            className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function MemberInput({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "month";
  required?: boolean;
}) {
  return (
    <label>
      <span className="text-xs font-bold text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="tb-search mt-1 h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}
