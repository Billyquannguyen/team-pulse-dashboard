import "@tanstack/react-start/server-only";

import { getCookies, getRequestUrl, setCookie } from "@tanstack/react-start/server";
import type { AuthRole, AuthState, DashboardMemberAccess, MemberAccessStatus } from "@/lib/auth";
import { createDashboardSupabaseServerClient, readSupabaseEnv } from "@/lib/supabase.server";

type MemberRow = {
  user_id: string;
  email: string;
  display_name: string;
  status: MemberAccessStatus;
  role: AuthRole;
  team_member_id: string | null;
  linked_at: string | null;
  created_at: string;
  approved_at: string | null;
};

const ADMIN_PREVIEW_COOKIE = "tb_admin_preview_member";

function clearAdminPreviewCookie() {
  setCookie(ADMIN_PREVIEW_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function dashboardPublicOrigin() {
  const configuredOrigin = process.env.DASHBOARD_PUBLIC_URL?.trim();
  if (configuredOrigin) {
    try {
      const origin = new URL(configuredOrigin).origin;
      if (process.env.VERCEL_ENV === "production" && new URL(origin).hostname === "localhost") {
        throw new Error("DASHBOARD_PUBLIC_URL cannot use localhost in production.");
      }
      return origin;
    } catch {
      throw new Error("DASHBOARD_PUBLIC_URL must be a valid absolute URL.");
    }
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new Error("DASHBOARD_PUBLIC_URL is required in production.");
  }

  try {
    return new URL(getRequestUrl()).origin;
  } catch {
    return "http://localhost:3000";
  }
}

function callbackUrl(next: "confirmed" | "recovery") {
  const url = new URL("/api/auth/callback", dashboardPublicOrigin());
  url.searchParams.set("next", next);
  return url.toString();
}

function mapMember(row: MemberRow): DashboardMemberAccess {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    role: row.role,
    teamMemberId: row.team_member_id,
    linkedAt: row.linked_at,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

export async function readAuthStateServer(): Promise<AuthState> {
  const env = readSupabaseEnv();
  const base: AuthState = {
    isAuthenticated: false,
    isSignedIn: false,
    isAdmin: false,
    isActualAdmin: false,
    isPreviewing: false,
    role: null,
    actualRole: null,
    accessStatus: null,
    previewMember: null,
    user: null,
    setupReady: env.setupReady,
    setupIssue: env.setupIssue,
  };

  if (!env.setupReady) return base;

  const supabase = createDashboardSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return base;

  const { data: memberData, error: memberError } = await supabase
    .from("dashboard_members")
    .select(
      "user_id,email,display_name,status,role,team_member_id,linked_at,created_at,approved_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return {
      ...base,
      isSignedIn: true,
      user: { id: user.id, email: user.email ?? "", displayName: "", teamMemberId: null },
      setupIssue: "Your account exists, but its dashboard access record could not be loaded.",
    };
  }

  const member = memberData as MemberRow | null;
  const accessStatus = member?.status ?? "pending";
  const role = member?.role ?? "member";
  const approved = accessStatus === "approved";

  const isActualAdmin = approved && role === "admin";
  const requestedPreviewId = isActualAdmin ? getCookies()[ADMIN_PREVIEW_COOKIE]?.trim() : "";
  let previewMember: AuthState["previewMember"] = null;

  if (requestedPreviewId) {
    try {
      const { getTeamMembersDataForServer } = await import("@/lib/team-members");
      const teamMembers = await getTeamMembersDataForServer();
      const matchedMember = teamMembers.activeMembers.find(
        (item) => item.id.toLowerCase() === requestedPreviewId.toLowerCase(),
      );
      if (matchedMember) {
        previewMember = { id: matchedMember.id, displayName: matchedMember.displayName };
      } else {
        clearAdminPreviewCookie();
      }
    } catch (error) {
      console.error("Could not validate the admin member preview:", error);
      clearAdminPreviewCookie();
    }
  }

  const isPreviewing = Boolean(previewMember);
  const effectiveRole = isPreviewing ? "member" : approved ? role : null;

  return {
    ...base,
    isAuthenticated: approved,
    isSignedIn: true,
    isAdmin: effectiveRole === "admin",
    isActualAdmin,
    isPreviewing,
    role: effectiveRole,
    actualRole: approved ? role : null,
    accessStatus,
    previewMember,
    user: {
      id: user.id,
      email: user.email ?? member?.email ?? "",
      displayName: member?.display_name ?? "",
      teamMemberId: previewMember?.id ?? member?.team_member_id ?? null,
    },
  };
}

export async function signUpToDashboardServer(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  const { claimAuthAttempt } = await import("@/lib/rate-limit.server");
  if (!(await claimAuthAttempt("sign-up", input.email, 5, 60 * 60))) {
    return { ok: false as const, message: "Too many attempts. Try again later." };
  }
  const supabase = createDashboardSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { display_name: input.displayName },
      emailRedirectTo: callbackUrl("confirmed"),
    },
  });

  if (error) return { ok: false as const, message: error.message };

  return {
    ok: true as const,
    signedIn: Boolean(data.session),
    message:
      "If this is a new account, check your email to verify it. After verification, your access will wait for admin approval.",
  };
}

export async function signInToDashboardServer(input: { email: string; password: string }) {
  const { claimAuthAttempt } = await import("@/lib/rate-limit.server");
  if (!(await claimAuthAttempt("sign-in", input.email, 10, 10 * 60))) {
    return { ok: false as const, message: "Too many attempts. Try again later." };
  }
  const supabase = createDashboardSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(input);

  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const };
}

export async function requestDashboardPasswordResetServer(email: string) {
  const { claimAuthAttempt } = await import("@/lib/rate-limit.server");
  if (!(await claimAuthAttempt("password-reset", email, 5, 60 * 60))) {
    return {
      ok: true as const,
      message: "If an account exists for this email, a password-reset link has been sent.",
    };
  }
  const supabase = createDashboardSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: callbackUrl("recovery"),
  });

  if (error) return { ok: false as const, message: error.message };
  return {
    ok: true as const,
    message: "If an account exists for this email, a password-reset link has been sent.",
  };
}

export async function resendDashboardVerificationServer(email: string) {
  const { claimAuthAttempt } = await import("@/lib/rate-limit.server");
  if (!(await claimAuthAttempt("resend-verification", email, 5, 60 * 60))) {
    return {
      ok: true as const,
      message: "If this account still needs verification, a new email has been sent.",
    };
  }
  const supabase = createDashboardSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: callbackUrl("confirmed") },
  });
  if (error) return { ok: false as const, message: error.message };
  return {
    ok: true as const,
    message: "If this account still needs verification, a new email has been sent.",
  };
}

export async function updateDashboardPasswordServer(password: string) {
  const supabase = createDashboardSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, message: "Your password has been updated." };
}

export async function logoutFromDashboardServer() {
  clearAdminPreviewCookie();
  const supabase = createDashboardSupabaseServerClient();
  await supabase.auth.signOut();
  return { ok: true as const };
}

export async function requireDashboardAuth() {
  const auth = await readAuthStateServer();
  if (!auth.isAuthenticated || !auth.role || !auth.user) throw new Error("Unauthorized");
  return auth;
}

export async function requireAdminAuth() {
  const auth = await requireDashboardAuth();
  if (!auth.isActualAdmin || auth.isPreviewing) throw new Error("Admin access required");
  return auth;
}

export async function requireWritableDashboardAuth() {
  const auth = await requireDashboardAuth();
  if (auth.isPreviewing) {
    throw new Error("Exit member preview before making changes.");
  }
  return auth;
}

export async function startAdminMemberPreviewServer(teamMemberId: string) {
  const auth = await readAuthStateServer();
  if (!auth.isAuthenticated || !auth.isActualAdmin || auth.isPreviewing) {
    throw new Error("Admin access required");
  }

  const { getTeamMembersDataForServer } = await import("@/lib/team-members");
  const teamMembers = await getTeamMembersDataForServer();
  const member = teamMembers.activeMembers.find(
    (item) => item.id.toLowerCase() === teamMemberId.trim().toLowerCase(),
  );
  if (!member) throw new Error("That active member profile could not be found.");

  setCookie(ADMIN_PREVIEW_COOKIE, member.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return { ok: true as const, memberId: member.id, displayName: member.displayName };
}

export async function stopAdminMemberPreviewServer() {
  const auth = await readAuthStateServer();
  if (!auth.isAuthenticated || !auth.isActualAdmin) throw new Error("Admin access required");
  clearAdminPreviewCookie();
  return { ok: true as const };
}

export async function requireLinkedMemberAuth() {
  const auth = await requireDashboardAuth();
  if (auth.isAdmin) return auth;
  if (!auth.user?.teamMemberId) {
    throw new Error("Your dashboard account is not connected to a member profile yet.");
  }
  return auth;
}

export async function requireTeamMemberAccess(teamMemberId: string) {
  const auth = await requireLinkedMemberAuth();
  if (auth.isAdmin) return auth;
  if (auth.user?.teamMemberId?.toLowerCase() !== teamMemberId.trim().toLowerCase()) {
    throw new Error("You can only access your own member data.");
  }
  return auth;
}

export async function listDashboardMemberAccessServer(): Promise<DashboardMemberAccess[]> {
  await requireAdminAuth();
  const supabase = createDashboardSupabaseServerClient();
  const { data, error } = await supabase
    .from("dashboard_members")
    .select(
      "user_id,email,display_name,status,role,team_member_id,linked_at,created_at,approved_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as MemberRow[]).map(mapMember);
}

export async function updateDashboardMemberAccessServer(input: {
  userId: string;
  status: MemberAccessStatus;
  role: AuthRole;
  teamMemberId?: string | null;
}) {
  const auth = await requireAdminAuth();
  if (input.userId === auth.user?.id && input.status !== "approved") {
    return { ok: false as const, message: "You cannot remove your own dashboard access." };
  }
  if (input.userId === auth.user?.id && input.role !== "admin") {
    return { ok: false as const, message: "You cannot remove your own admin role." };
  }

  const supabase = createDashboardSupabaseServerClient();
  const { data: existingMember, error: existingMemberError } = await supabase
    .from("dashboard_members")
    .select("team_member_id")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existingMemberError) return { ok: false as const, message: existingMemberError.message };
  const requestedTeamMemberId =
    input.teamMemberId === undefined
      ? (existingMember?.team_member_id ?? null)
      : input.teamMemberId?.trim() || null;
  const linkChanged =
    requestedTeamMemberId?.toLowerCase() !== existingMember?.team_member_id?.toLowerCase();

  if (input.status === "approved" && requestedTeamMemberId && linkChanged) {
    const { getTeamMembersDataForServer } = await import("@/lib/team-members");
    const teamMembers = await getTeamMembersDataForServer();
    const matchedMember = teamMembers.members.find(
      (member) => member.id.toLowerCase() === requestedTeamMemberId.toLowerCase(),
    );
    if (!matchedMember) {
      return { ok: false as const, message: "That member card no longer exists." };
    }
  }
  const approved = input.status === "approved";
  const accessUpdate = {
    status: input.status,
    role: input.role,
    approved_at: approved ? new Date().toISOString() : null,
    approved_by: approved ? (auth.user?.id ?? null) : null,
    updated_at: new Date().toISOString(),
    ...(approved && input.teamMemberId !== undefined
      ? {
          team_member_id: requestedTeamMemberId,
          linked_at: linkChanged
            ? requestedTeamMemberId
              ? new Date().toISOString()
              : null
            : undefined,
          linked_by: linkChanged
            ? requestedTeamMemberId
              ? (auth.user?.id ?? null)
              : null
            : undefined,
        }
      : {}),
  };
  const { error } = await supabase
    .from("dashboard_members")
    .update(accessUpdate)
    .eq("user_id", input.userId);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false as const,
        message: "That member card is already connected to another account.",
      };
    }
    return { ok: false as const, message: error.message };
  }
  return { ok: true as const };
}

export async function approveDashboardMemberWithNewCardServer(input: {
  userId: string;
  role: AuthRole;
  displayName: string;
  teamMemberId: string;
  joinedMonth?: string;
  teamDepartment?: string;
  gmailLabel?: string;
}) {
  await requireAdminAuth();
  const { createTeamMemberRecordForServer } = await import("@/lib/team-members");
  await createTeamMemberRecordForServer({
    displayName: input.displayName,
    id: input.teamMemberId,
    joinedMonth: input.joinedMonth ?? "",
    status: "active",
    teamDepartment: input.teamDepartment ?? "Outreach",
    gmailLabel: input.gmailLabel ?? "",
    weeklyReportEnabled: true,
  });

  const result = await updateDashboardMemberAccessServer({
    userId: input.userId,
    status: "approved",
    role: input.role,
    teamMemberId: input.teamMemberId,
  });
  if (!result.ok) {
    return {
      ...result,
      message: `${result.message} The new member card was created but could not be connected.`,
    };
  }
  return result;
}
