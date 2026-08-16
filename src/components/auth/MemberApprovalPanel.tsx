import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import {
  approveDashboardMemberWithNewCard,
  listDashboardMemberAccess,
  updateDashboardMemberAccess,
  type AuthRole,
  type DashboardMemberAccess,
  type MemberAccessStatus,
} from "@/lib/auth";
import { teamMembersQuery } from "@/lib/team-members";
import { cn } from "@/lib/utils";

type LinkMode = "existing" | "new" | "none";

type NewCardDraft = {
  displayName: string;
  teamMemberId: string;
  joinedMonth: string;
  teamDepartment: string;
  gmailLabel: string;
};

function suggestedMemberId(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part[0]?.toUpperCase() : part))
    .join("")
    .slice(0, 80);
}

const accessQuery = {
  queryKey: ["dashboard-member-access"],
  queryFn: () => listDashboardMemberAccess(),
  staleTime: 15_000,
};

function statusLabel(status: MemberAccessStatus) {
  return status === "approved"
    ? "Approved"
    : status === "pending"
      ? "Pending"
      : status === "disabled"
        ? "Disabled"
        : "Declined";
}

function initials(name: string, email: string) {
  const value = name.trim() || email;
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function MemberApprovalPanel({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery(accessQuery);
  const { data: teamMembersData } = useQuery(teamMembersQuery);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AuthRole>>({});
  const [linkModes, setLinkModes] = useState<Record<string, LinkMode>>({});
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  const [newCardDrafts, setNewCardDrafts] = useState<Record<string, NewCardDraft>>({});
  const [successMessage, setSuccessMessage] = useState("");

  const mutation = useMutation({
    mutationFn: async (input: { member: DashboardMemberAccess; status: MemberAccessStatus }) => {
      const role = roleDrafts[input.member.userId] ?? input.member.role;
      const mode =
        linkModes[input.member.userId] ?? (input.member.teamMemberId ? "existing" : "none");
      const newCard = newCardDrafts[input.member.userId];
      const result =
        input.status === "approved" && mode === "new"
          ? await approveDashboardMemberWithNewCard({
              data: {
                userId: input.member.userId,
                role,
                displayName: newCard?.displayName || input.member.displayName,
                teamMemberId: newCard?.teamMemberId || suggestedMemberId(input.member.displayName),
                joinedMonth: newCard?.joinedMonth || "",
                teamDepartment: newCard?.teamDepartment || "Outreach",
                gmailLabel: newCard?.gmailLabel || "",
              },
            })
          : await updateDashboardMemberAccess({
              data: {
                userId: input.member.userId,
                status: input.status,
                role,
                teamMemberId:
                  input.status !== "approved"
                    ? input.member.teamMemberId
                    : mode === "existing"
                      ? linkDrafts[input.member.userId] || input.member.teamMemberId
                      : null,
              },
            });
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: async (_result, variables) => {
      setSuccessMessage(
        variables.status === "approved"
          ? `${variables.member.displayName || variables.member.email} saved.`
          : `${variables.member.displayName || variables.member.email} is now ${statusLabel(variables.status).toLowerCase()}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accessQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: teamMembersQuery.queryKey }),
      ]);
    },
  });

  const orderedMembers = useMemo(
    () =>
      [...data].sort((left, right) => {
        if (left.status === "pending" && right.status !== "pending") return -1;
        if (right.status === "pending" && left.status !== "pending") return 1;
        return right.createdAt.localeCompare(left.createdAt);
      }),
    [data],
  );
  const pendingMembers = orderedMembers.filter((member) => member.status === "pending");
  const managedMembers = orderedMembers.filter((member) => member.status !== "pending");
  const assignedIds = new Map(
    orderedMembers
      .filter((member) => member.teamMemberId)
      .map((member) => [member.teamMemberId!.toLowerCase(), member.userId]),
  );
  const teamMembers = teamMembersData?.members ?? [];

  const submitAccessChange = (member: DashboardMemberAccess, status: MemberAccessStatus) => {
    setSuccessMessage("");
    if (status === "rejected") {
      if (!window.confirm(`Decline access for ${member.displayName || member.email}?`)) return;
    }
    if (status === "disabled") {
      if (!window.confirm(`Disable dashboard access for ${member.displayName || member.email}?`)) {
        return;
      }
    }
    if (status === "approved" && member.teamMemberId) {
      const mode = linkModes[member.userId] ?? "existing";
      const nextId =
        mode === "existing" ? (linkDrafts[member.userId] ?? member.teamMemberId) : null;
      if (nextId?.toLowerCase() !== member.teamMemberId.toLowerCase()) {
        const message = nextId
          ? `Change this account from ${member.teamMemberId} to ${nextId}? Historical data will remain unchanged.`
          : `Revoke the connection to ${member.teamMemberId}? The account and member card will both remain available.`;
        if (!window.confirm(message)) return;
      }
    }
    mutation.mutate({ member, status });
  };

  const renderAccountCard = (member: DashboardMemberAccess) => {
    const busy = mutation.isPending && mutation.variables?.member.userId === member.userId;
    const isSelf = member.userId === currentUserId;
    const mode = linkModes[member.userId] ?? (member.teamMemberId ? "existing" : "none");
    const newCard = newCardDrafts[member.userId] ?? {
      displayName: member.displayName,
      teamMemberId: suggestedMemberId(member.displayName),
      joinedMonth: "",
      teamDepartment: "Outreach",
      gmailLabel: "",
    };
    const availableCards = teamMembers.filter(
      (card) =>
        !assignedIds.has(card.id.toLowerCase()) ||
        assignedIds.get(card.id.toLowerCase()) === member.userId,
    );

    return (
      <article
        key={member.userId}
        className={cn(
          "rounded-2xl border bg-background p-4 transition-colors sm:p-5",
          member.status === "pending" ? "border-primary/25 shadow-sm" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fun-blue text-sm font-black text-slate-900">
              {initials(member.displayName, member.email)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-black sm:text-base">
                  {member.displayName || "Unnamed member"}
                </h3>
                {isSelf && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                    You
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">
                {member.email}
              </p>
            </div>
          </div>
          <span
            className={cn(
              "inline-flex rounded-full px-2.5 py-1 text-xs font-black",
              member.status === "approved"
                ? "bg-success/15 text-success"
                : member.status === "pending"
                  ? "bg-warning/20 text-amber-800"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {statusLabel(member.status)}
          </span>
        </div>

        <div className="mt-4 grid gap-4 border-t border-border/70 pt-4 lg:grid-cols-[minmax(160px,0.7fr)_minmax(280px,1.5fr)]">
          <label className="grid gap-1.5">
            <span className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
              Account role
            </span>
            <select
              aria-label={`Role for ${member.email}`}
              value={roleDrafts[member.userId] ?? member.role}
              disabled={busy || isSelf}
              onChange={(event) =>
                setRoleDrafts((current) => ({
                  ...current,
                  [member.userId]: event.target.value as AuthRole,
                }))
              }
              className="h-11 w-full rounded-xl border bg-card px-3 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <div className="grid gap-2">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                Connected member profile
              </span>
              <select
                aria-label={`Member profile action for ${member.email}`}
                value={mode}
                disabled={busy}
                onChange={(event) =>
                  setLinkModes((current) => ({
                    ...current,
                    [member.userId]: event.target.value as LinkMode,
                  }))
                }
                className="h-11 w-full rounded-xl border bg-card px-3 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="none">No member profile</option>
                <option value="existing">Connect existing profile</option>
                {member.status === "pending" && <option value="new">Create new profile</option>}
              </select>
            </label>

            {mode === "existing" && (
              <select
                aria-label={`Existing member profile for ${member.email}`}
                value={linkDrafts[member.userId] ?? member.teamMemberId ?? ""}
                disabled={busy}
                onChange={(event) =>
                  setLinkDrafts((current) => ({
                    ...current,
                    [member.userId]: event.target.value,
                  }))
                }
                className="h-11 w-full rounded-xl border bg-card px-3 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <option value="">Select a profile</option>
                {availableCards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.displayName} ({card.id})
                  </option>
                ))}
              </select>
            )}

            {mode === "new" && (
              <div className="grid gap-2 rounded-xl bg-muted/55 p-3 sm:grid-cols-2">
                <input
                  aria-label="New member display name"
                  value={newCard.displayName}
                  placeholder="Display name"
                  onChange={(event) =>
                    setNewCardDrafts((current) => ({
                      ...current,
                      [member.userId]: { ...newCard, displayName: event.target.value },
                    }))
                  }
                  className="h-10 rounded-lg border bg-background px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  aria-label="New member ID"
                  value={newCard.teamMemberId}
                  placeholder="Member ID"
                  onChange={(event) =>
                    setNewCardDrafts((current) => ({
                      ...current,
                      [member.userId]: { ...newCard, teamMemberId: event.target.value },
                    }))
                  }
                  className="h-10 rounded-lg border bg-background px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  aria-label="Joined month"
                  type="month"
                  value={newCard.joinedMonth}
                  onChange={(event) =>
                    setNewCardDrafts((current) => ({
                      ...current,
                      [member.userId]: { ...newCard, joinedMonth: event.target.value },
                    }))
                  }
                  className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  aria-label="Team or department"
                  value={newCard.teamDepartment}
                  placeholder="Team"
                  onChange={(event) =>
                    setNewCardDrafts((current) => ({
                      ...current,
                      [member.userId]: { ...newCard, teamDepartment: event.target.value },
                    }))
                  }
                  className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}

            {isSelf && !member.teamMemberId && (
              <span className="text-xs font-semibold text-muted-foreground">
                Your admin account does not need a member profile.
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => submitAccessChange(member, "approved")}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : member.status === "approved" ? (
              <Check className="h-4 w-4" />
            ) : (
              <UserRoundCheck className="h-4 w-4" />
            )}
            {member.status === "approved" ? "Save changes" : "Approve access"}
          </button>
          {!isSelf && member.status === "pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => submitAccessChange(member, "rejected")}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-muted px-4 text-xs font-black transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <UserRoundX className="h-4 w-4" />
              Decline
            </button>
          )}
          {!isSelf && member.status === "approved" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => submitAccessChange(member, "disabled")}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-muted px-4 text-xs font-black transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <UserRoundX className="h-4 w-4" />
              Disable access
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black">Dashboard access</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                <LockKeyhole className="h-3 w-3" />
                Admin only
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Only approved admins can see this panel or manage account access. Members never see
              this list.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-black text-primary">
          {pendingMembers.length} pending
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive"
        >
          {error instanceof Error ? error.message : "Could not load access requests."}
        </div>
      )}
      {successMessage && (
        <div
          role="status"
          className="mt-4 rounded-2xl bg-success/12 px-4 py-3 text-sm font-bold text-success"
        >
          {successMessage}
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="mt-3 text-sm font-bold text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not update this account."}
        </p>
      )}

      <div className="mt-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-black">Waiting for your approval</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Review the account, role, and member-profile connection before approving.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm font-bold text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading accounts...
          </div>
        ) : pendingMembers.length ? (
          <div className="grid gap-3">{pendingMembers.map(renderAccountCard)}</div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/25 px-4 py-6 text-center">
            <Check className="mx-auto h-5 w-5 text-success" />
            <p className="mt-2 text-sm font-black">You are all caught up</p>
            <p className="mt-1 text-xs text-muted-foreground">
              New verified requests will appear here.
            </p>
          </div>
        )}
      </div>

      {!isLoading && managedMembers.length > 0 && (
        <details className="group mt-4 overflow-hidden rounded-2xl border border-border bg-background">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 outline-none transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <div>
              <span className="text-sm font-black">Manage existing accounts</span>
              <span className="ml-2 text-xs font-semibold text-muted-foreground">
                {managedMembers.length} account{managedMembers.length === 1 ? "" : "s"}
              </span>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid max-h-[620px] gap-3 overflow-y-auto border-t border-border bg-muted/20 p-3 sm:p-4">
            {managedMembers.map(renderAccountCard)}
          </div>
        </details>
      )}
    </section>
  );
}
