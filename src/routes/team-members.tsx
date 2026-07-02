import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import {
  Camera,
  Check,
  Edit3,
  ExternalLink,
  Globe2,
  Instagram,
  Loader2,
  Lock,
  Music2,
  Plus,
  Sparkles,
  UserCheck,
  UserRound,
  UserX,
  X,
  Youtube,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelect } from "@/components/ui/dashboard-select";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { loginToDashboard } from "@/lib/auth";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import {
  addTeamMember,
  createTeamMembersSheet,
  teamMembersQuery,
  updateTeamMember,
  updateTeamMemberProfile,
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
  originalId?: string;
  displayName: string;
  id: string;
  joinedMonth: string;
  status: TeamMemberStatus;
  avatarUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  websiteUrl: string;
};

type MemberModalState = {
  mode: "add" | "edit";
  draft: MemberDraft;
} | null;

type AdminAction =
  | { type: "add" }
  | { type: "edit"; member: TeamMemberConfig }
  | { type: "status"; member: TeamMemberConfig }
  | { type: "create-sheet" }
  | { type: "manage" };

type ProfileDraft = {
  avatarUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  websiteUrl: string;
};

type ProfileModalState = {
  member: TeamMemberConfig;
} | null;

function emptyDraft(): MemberDraft {
  return {
    displayName: "",
    id: "",
    joinedMonth: "",
    status: "active",
    avatarUrl: "",
    instagramUrl: "",
    tiktokUrl: "",
    youtubeUrl: "",
    websiteUrl: "",
  };
}

function draftFromMember(member: TeamMemberConfig): MemberDraft {
  return {
    rowNumber: member.rowNumber,
    originalId: member.id,
    displayName: member.displayName,
    id: member.id,
    joinedMonth: member.joinedMonth,
    status: member.status,
    avatarUrl: member.avatarUrl,
    instagramUrl: member.instagramUrl,
    tiktokUrl: member.tiktokUrl,
    youtubeUrl: member.youtubeUrl,
    websiteUrl: member.websiteUrl,
  };
}

function TeamMembersPage() {
  const router = useRouter();
  const auth = rootRoute.useLoaderData();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(teamMembersQuery);
  const [modal, setModal] = useState<MemberModalState>(null);
  const [profileModal, setProfileModal] = useState<ProfileModalState>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [adminAction, setAdminAction] = useState<AdminAction | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const activeMembers = useMemo(
    () => members.filter((member) => member.status === "active"),
    [members],
  );
  const activeCount = activeMembers.length;
  const isAdmin = auth.role === "admin";

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

  const runAdminAction = (action: AdminAction) => {
    if (action.type === "add") {
      openAdd();
      return;
    }

    if (action.type === "edit") {
      openEdit(action.member);
      return;
    }

    if (action.type === "status") {
      void toggleStatus(action.member);
      return;
    }

    if (action.type === "manage") {
      setIsManageOpen(true);
      return;
    }

    void createSheet();
  };

  const requestAdminAction = (action: AdminAction) => {
    if (isAdmin) {
      runAdminAction(action);
      return;
    }

    setAdminPassword("");
    setAdminError("");
    setAdminAction(action);
  };

  const submitAdminPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adminAction) return;

    setAdminError("");
    setIsUnlocking(true);

    try {
      const result = await loginToDashboard({ data: { password: adminPassword } });

      if (!result.ok) {
        setAdminError(result.message);
        return;
      }

      if (result.role !== "admin") {
        setAdminError("That unlocks team view only. Enter the admin password to edit members.");
        return;
      }

      const action = adminAction;
      setAdminAction(null);
      setAdminPassword("");
      await router.invalidate();
      runAdminAction(action);
    } catch {
      setAdminError("Admin unlock failed. Try again in a moment.");
    } finally {
      setIsUnlocking(false);
    }
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
        await updateTeamMember({
          data: { ...draft, rowNumber: draft.rowNumber, originalId: draft.originalId },
        });
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

  const saveProfile = async (member: TeamMemberConfig, profile: ProfileDraft) => {
    if (!member.rowNumber) return false;
    setSavingKey(`profile-${member.rowNumber}`);
    setMessage("");

    try {
      await updateTeamMemberProfile({
        data: {
          rowNumber: member.rowNumber,
          originalId: member.id,
          ...profile,
        },
      });
      setMessage(`${member.displayName}'s profile updated.`);
      await refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update this profile.");
      return false;
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
          originalId: member.id,
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

      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-fun-blue">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black">Team member list</h2>
              <p className="text-sm font-semibold text-muted-foreground">
                {isLoading
                  ? "Loading members..."
                  : `${members.length} members · ${activeCount} active`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="inline-flex h-10 items-center gap-1.5 rounded-2xl bg-muted px-3 text-xs font-bold text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              {isAdmin ? "Admin unlocked" : "Locked"}
            </div>
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
            {showMissingState ? (
              <button
                type="button"
                onClick={() => requestAdminAction({ type: "create-sheet" })}
                disabled={savingKey === "create-sheet"}
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {savingKey === "create-sheet" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create TeamMembers sheet
              </button>
            ) : (
              <button
                type="button"
                onClick={() => requestAdminAction({ type: "manage" })}
                className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-4 text-sm font-bold text-foreground hover:bg-accent"
              >
                {isAdmin ? <Edit3 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                Manage members
              </button>
            )}
          </div>
        </div>
      </section>

      {message && (
        <div className="rounded-2xl bg-muted/45 px-4 py-3 text-sm font-bold">{message}</div>
      )}

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
            onClick={() => requestAdminAction({ type: "create-sheet" })}
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
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Member profiles</h2>
              <p className="text-sm text-muted-foreground">
                Team members can update their own profiles and socials.
              </p>
            </div>
            <button
              type="button"
              onClick={() => requestAdminAction({ type: "add" })}
              className="tb-action inline-flex h-11 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              {isAdmin ? <Plus className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              Add Member
            </button>
          </div>

          {activeMembers.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {activeMembers.map((member) => (
                <MemberProfileCard
                  key={`${member.id}-${member.rowNumber ?? "profile"}`}
                  member={member}
                  onEdit={() => setProfileModal({ member })}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-3xl bg-card p-8 text-center ring-1 ring-border">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                <UserRound className="h-5 w-5 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-base font-black">No active member profiles.</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Offboarded members are still available in Manage members, but they stay hidden from
                the profile cards.
              </p>
            </div>
          )}
          <div className="rounded-3xl bg-card p-4 text-sm font-semibold text-muted-foreground ring-1 ring-border">
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-fun-yellow">
                <Sparkles className="h-4 w-4 text-amber-900" />
              </div>
              <p>
                Members can update their own avatars and social links. Only admins can add members,
                edit access details, or change active/offboarded status.
              </p>
            </div>
          </div>
        </section>
      )}

      {isManageOpen && (
        <ManageMembersModal
          members={members}
          isLoading={isLoading}
          isAdmin={isAdmin}
          savingKey={savingKey}
          onClose={() => setIsManageOpen(false)}
          onAdd={() => requestAdminAction({ type: "add" })}
          onEdit={(member) => requestAdminAction({ type: "edit", member })}
          onToggleStatus={(member) => requestAdminAction({ type: "status", member })}
        />
      )}

      {profileModal && (
        <ProfileModal
          member={profileModal.member}
          saving={savingKey === `profile-${profileModal.member.rowNumber}`}
          onClose={() => setProfileModal(null)}
          onSave={async (profile) => {
            const didSave = await saveProfile(profileModal.member, profile);
            if (didSave) setProfileModal(null);
          }}
        />
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

      {adminAction && (
        <AdminUnlockModal
          password={adminPassword}
          error={adminError}
          unlocking={isUnlocking}
          onPasswordChange={(value) => {
            setAdminPassword(value);
            setAdminError("");
          }}
          onClose={() => setAdminAction(null)}
          onSubmit={submitAdminPassword}
        />
      )}
    </div>
  );
}

function ManageMembersModal({
  members,
  isLoading,
  isAdmin,
  savingKey,
  onClose,
  onAdd,
  onEdit,
  onToggleStatus,
}: {
  members: TeamMemberConfig[];
  isLoading: boolean;
  isAdmin: boolean;
  savingKey: string | null;
  onClose: () => void;
  onAdd: () => void;
  onEdit: (member: TeamMemberConfig) => void;
  onToggleStatus: (member: TeamMemberConfig) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <section className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-black">Manage team members</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              View and manage member access, status, and profile details.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAdd}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              {isAdmin ? <Plus className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              Add Member
            </button>
            <button
              type="button"
              onClick={onClose}
              className="tb-action rounded-full p-2 hover:bg-accent"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[64vh] overflow-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
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
                  <td colSpan={5} className="px-5 py-8 text-center font-bold text-muted-foreground">
                    Loading TeamMembers...
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center font-bold text-muted-foreground">
                    No members yet.
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr
                    key={member.rowNumber ?? member.id}
                    className={cn(member.status === "offboarded" && "opacity-70")}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <TeamAvatar
                          name={member.displayName}
                          initials={member.id.slice(0, 2).toUpperCase()}
                          avatarUrl={member.avatarUrl}
                          className="h-9 w-9"
                          fallbackClassName="bg-fun-blue"
                        />
                        <span className="font-black">{member.displayName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 font-semibold text-muted-foreground">{member.id}</td>
                    <td className="px-5 py-4 font-semibold">{member.joinedMonth || "Not set"}</td>
                    <td className="px-5 py-4">
                      <StatusBadge status={member.status} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(member)}
                          className="tb-action inline-flex h-9 items-center gap-2 rounded-xl bg-muted px-3 text-xs font-bold text-foreground hover:bg-accent"
                        >
                          {isAdmin ? (
                            <Edit3 className="h-3.5 w-3.5" />
                          ) : (
                            <Lock className="h-3.5 w-3.5" />
                          )}
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={savingKey === `status-${member.rowNumber}`}
                          onClick={() => onToggleStatus(member)}
                          className="tb-action inline-flex h-9 items-center gap-2 rounded-xl bg-muted px-3 text-xs font-bold text-foreground hover:bg-accent disabled:opacity-50"
                        >
                          {savingKey === `status-${member.rowNumber}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : !isAdmin ? (
                            <Lock className="h-3.5 w-3.5" />
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

        <div className="border-t border-border px-5 py-4 text-center text-xs font-bold text-muted-foreground">
          <Lock className="mr-1 inline h-3.5 w-3.5" />
          Only admins can manage team members.
        </div>
      </section>
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
  const [imageMessage, setImageMessage] = useState("");
  const uploadId = `member-avatar-${(draft.rowNumber ?? draft.id) || "new"}`;

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImageMessage("");

    try {
      const avatarUrl = await resizeAvatar(file);
      onChange({ avatarUrl });
      setImageMessage("Avatar resized and ready to save.");
    } catch (error) {
      setImageMessage(error instanceof Error ? error.message : "Could not read this image.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border"
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

        <div className="max-h-[68vh] overflow-y-auto p-5">
          <div className="mb-5 flex items-center gap-4 rounded-3xl bg-muted/35 p-4">
            <TeamAvatar
              name={draft.displayName || "New member"}
              initials={(draft.id || draft.displayName || "TM").slice(0, 2).toUpperCase()}
              avatarUrl={draft.avatarUrl}
              className="h-16 w-16 rounded-2xl"
              fallbackClassName="bg-fun-blue text-base"
            />
            <div className="min-w-0 flex-1">
              <input
                id={uploadId}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <label
                htmlFor={uploadId}
                className="tb-action inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl bg-card px-4 text-sm font-bold hover:bg-accent"
              >
                <Camera className="h-4 w-4" />
                Change avatar
              </label>
              {imageMessage && (
                <p className="mt-2 text-xs font-bold text-muted-foreground">{imageMessage}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MemberInput
              label="Full name"
              value={draft.displayName}
              required
              onChange={(value) => onChange({ displayName: value })}
            />
            <MemberInput
              label="ID / Username"
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

          <div className="mt-5">
            <h3 className="text-sm font-black">Social links</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <MemberInput
                label="Instagram"
                value={draft.instagramUrl}
                onChange={(value) => onChange({ instagramUrl: value })}
              />
              <MemberInput
                label="TikTok"
                value={draft.tiktokUrl}
                onChange={(value) => onChange({ tiktokUrl: value })}
              />
              <MemberInput
                label="YouTube"
                value={draft.youtubeUrl}
                onChange={(value) => onChange({ youtubeUrl: value })}
              />
              <MemberInput
                label="Website"
                value={draft.websiteUrl}
                onChange={(value) => onChange({ websiteUrl: value })}
              />
            </div>
          </div>
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

function AdminUnlockModal({
  password,
  error,
  unlocking,
  onPasswordChange,
  onClose,
  onSubmit,
}: {
  password: string;
  error: string;
  unlocking: boolean;
  onPasswordChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-black">Unlock member editing</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the admin password to add members or edit member details.
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

        <div className="p-5">
          <label>
            <span className="text-xs font-bold text-muted-foreground">Admin password</span>
            <input
              autoFocus
              type="password"
              value={password}
              disabled={unlocking}
              onChange={(event) => onPasswordChange(event.target.value)}
              className="tb-search mt-1 h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Enter admin password"
            />
          </label>
          {error && <p className="mt-2 text-sm font-bold text-destructive">{error}</p>}
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
            disabled={unlocking || !password}
            className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {unlocking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ status }: { status: TeamMemberStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs font-black",
        status === "active" ? "bg-fun-lime text-emerald-950" : "bg-muted text-muted-foreground",
      )}
    >
      {status === "active" ? "Active" : "Offboarded"}
    </span>
  );
}

function ProfileModal({
  member,
  saving,
  onClose,
  onSave,
}: {
  member: TeamMemberConfig;
  saving: boolean;
  onClose: () => void;
  onSave: (profile: ProfileDraft) => void;
}) {
  const [draft, setDraft] = useState<ProfileDraft>({
    avatarUrl: member.avatarUrl ?? "",
    instagramUrl: member.instagramUrl ?? "",
    tiktokUrl: member.tiktokUrl ?? "",
    youtubeUrl: member.youtubeUrl ?? "",
    websiteUrl: member.websiteUrl ?? "",
  });
  const [imageMessage, setImageMessage] = useState("");
  const uploadId = `profile-avatar-upload-${member.rowNumber ?? member.id}`;

  const setField = (field: keyof ProfileDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImageMessage("");

    try {
      const avatarUrl = await resizeAvatar(file);
      setDraft((current) => ({ ...current, avatarUrl }));
      setImageMessage("Avatar resized and ready to save.");
    } catch (error) {
      setImageMessage(error instanceof Error ? error.message : "Could not read this image.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <section className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-black">Edit member profile</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Update avatar and public social links for {member.displayName}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tb-action rounded-full p-2 hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[68vh] overflow-y-auto p-5">
          <div className="mb-5 flex items-center gap-4 rounded-3xl bg-muted/35 p-4">
            <TeamAvatar
              name={member.displayName}
              initials={member.id.slice(0, 2).toUpperCase()}
              avatarUrl={draft.avatarUrl}
              className="h-16 w-16 rounded-2xl"
              fallbackClassName="bg-fun-blue text-base"
            />
            <div>
              <input
                id={uploadId}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <label
                htmlFor={uploadId}
                className="tb-action inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl bg-card px-4 text-sm font-bold hover:bg-accent"
              >
                <Camera className="h-4 w-4" />
                Change avatar
              </label>
              {imageMessage && (
                <p className="mt-2 text-xs font-bold text-muted-foreground">{imageMessage}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MemberInput
              label="Instagram"
              value={draft.instagramUrl}
              onChange={(value) => setField("instagramUrl", value)}
            />
            <MemberInput
              label="TikTok"
              value={draft.tiktokUrl}
              onChange={(value) => setField("tiktokUrl", value)}
            />
            <MemberInput
              label="YouTube"
              value={draft.youtubeUrl}
              onChange={(value) => setField("youtubeUrl", value)}
            />
            <MemberInput
              label="Website"
              value={draft.websiteUrl}
              onChange={(value) => setField("websiteUrl", value)}
            />
          </div>
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
            type="button"
            onClick={() =>
              onSave({
                avatarUrl: draft.avatarUrl,
                instagramUrl: normalizeExternalUrl(draft.instagramUrl),
                tiktokUrl: normalizeExternalUrl(draft.tiktokUrl),
                youtubeUrl: normalizeExternalUrl(draft.youtubeUrl),
                websiteUrl: normalizeExternalUrl(draft.websiteUrl),
              })
            }
            disabled={saving || !member.rowNumber}
            className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save profile
          </button>
        </div>
      </section>
    </div>
  );
}

function MemberProfileCard({ member, onEdit }: { member: TeamMemberConfig; onEdit: () => void }) {
  const socialLinks = [
    { label: "Instagram", value: normalizeExternalUrl(member.instagramUrl), Icon: Instagram },
    { label: "TikTok", value: normalizeExternalUrl(member.tiktokUrl), Icon: Music2 },
    { label: "YouTube", value: normalizeExternalUrl(member.youtubeUrl), Icon: Youtube },
    { label: "Website", value: normalizeExternalUrl(member.websiteUrl), Icon: Globe2 },
  ].filter((item) => item.value.trim());

  return (
    <article className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-border">
      <div className="h-20 bg-gradient-to-r from-fun-blue via-fun-pink to-fun-yellow" />
      <div className="p-5 pt-0">
        <div className="-mt-10 flex items-end justify-between gap-3">
          <TeamAvatar
            name={member.displayName}
            initials={member.id.slice(0, 2).toUpperCase()}
            avatarUrl={member.avatarUrl}
            className="h-20 w-20 rounded-3xl ring-4 ring-card"
            fallbackClassName="bg-fun-blue text-base"
          />
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge status={member.status} />
            <button
              type="button"
              onClick={onEdit}
              className="tb-action inline-flex h-8 items-center gap-1.5 rounded-xl bg-muted px-3 text-xs font-bold hover:bg-accent"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="text-lg font-black">{member.displayName}</h3>
          <p className="text-sm font-semibold text-muted-foreground">
            {member.id} · Joined {member.joinedMonth || "not set"}
          </p>
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          {socialLinks.length > 0 ? (
            socialLinks.map(({ label, value, Icon }) => (
              <a
                key={label}
                href={value}
                target="_blank"
                rel="noreferrer"
                title={label}
                aria-label={label}
                className="tb-action inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground hover:bg-accent"
              >
                <Icon className="h-5 w-5" />
              </a>
            ))
          ) : (
            <span className="text-xs font-semibold text-muted-foreground">
              No socials linked yet.
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function normalizeExternalUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function resizeAvatar(file: File) {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Choose an image file."));
  }

  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const size = 192;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Could not resize this image."));
        return;
      }

      const sourceSize = Math.min(image.width, image.height);
      const sourceX = (image.width - sourceSize) / 2;
      const sourceY = (image.height - sourceSize) / 2;

      context.fillStyle = "#f7f3ec";
      context.fillRect(0, 0, size, size);
      context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      if (dataUrl.length > 50000) {
        reject(new Error("This image is still too large. Try a simpler or smaller photo."));
        return;
      }

      resolve(dataUrl);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read this image."));
    };

    image.src = objectUrl;
  });
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
