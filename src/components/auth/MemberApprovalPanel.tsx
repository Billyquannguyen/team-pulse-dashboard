import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ShieldCheck, UserRoundCheck, UserRoundX } from "lucide-react";
import {
  listDashboardMemberAccess,
  updateDashboardMemberAccess,
  type AuthRole,
  type DashboardMemberAccess,
  type MemberAccessStatus,
} from "@/lib/auth";
import { cn } from "@/lib/utils";

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

export function MemberApprovalPanel({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery(accessQuery);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AuthRole>>({});
  const mutation = useMutation({
    mutationFn: async (input: { member: DashboardMemberAccess; status: MemberAccessStatus }) => {
      const result = await updateDashboardMemberAccess({
        data: {
          userId: input.member.userId,
          status: input.status,
          role: roleDrafts[input.member.userId] ?? input.member.role,
        },
      });
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accessQuery.queryKey }),
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
  const pendingCount = orderedMembers.filter((member) => member.status === "pending").length;

  return (
    <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-black">Dashboard access requests</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve verified accounts and choose whether they are members or admins.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-black text-primary">
          {pendingCount} pending
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

      <div className="mt-5 max-h-[430px] overflow-auto rounded-2xl border border-border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted/95 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-4 py-3 font-black">Account</th>
              <th className="px-4 py-3 font-black">Status</th>
              <th className="px-4 py-3 font-black">Role</th>
              <th className="px-4 py-3 text-right font-black">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center font-bold text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading accounts...
                </td>
              </tr>
            ) : orderedMembers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center font-bold text-muted-foreground">
                  No registered accounts yet.
                </td>
              </tr>
            ) : (
              orderedMembers.map((member) => {
                const busy =
                  mutation.isPending && mutation.variables?.member.userId === member.userId;
                const isSelf = member.userId === currentUserId;
                return (
                  <tr
                    key={member.userId}
                    className={cn(member.status === "pending" && "bg-primary/[0.035]")}
                  >
                    <td className="px-4 py-3">
                      <div className="font-black">{member.displayName || "Unnamed member"}</div>
                      <div className="mt-0.5 text-xs font-semibold text-muted-foreground">
                        {member.email}
                        {isSelf ? " · You" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
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
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Role for ${member.email}`}
                        value={roleDrafts[member.userId] ?? member.role}
                        disabled={busy}
                        onChange={(event) =>
                          setRoleDrafts((current) => ({
                            ...current,
                            [member.userId]: event.target.value as AuthRole,
                          }))
                        }
                        className="h-9 rounded-xl border bg-background px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => mutation.mutate({ member, status: "approved" })}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-black text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : member.status === "approved" ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <UserRoundCheck className="h-3.5 w-3.5" />
                          )}
                          {member.status === "approved" ? "Save role" : "Approve"}
                        </button>
                        {!isSelf && member.status === "pending" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => mutation.mutate({ member, status: "rejected" })}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-muted px-3 text-xs font-black hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          >
                            <UserRoundX className="h-3.5 w-3.5" />
                            Decline
                          </button>
                        )}
                        {!isSelf && member.status === "approved" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => mutation.mutate({ member, status: "disabled" })}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-muted px-3 text-xs font-black hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          >
                            <UserRoundX className="h-3.5 w-3.5" />
                            Disable
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {mutation.error && (
        <p role="alert" className="mt-3 text-sm font-bold text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not update this account."}
        </p>
      )}
    </section>
  );
}
