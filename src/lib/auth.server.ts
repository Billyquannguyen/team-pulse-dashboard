import "@tanstack/react-start/server-only";

import { getRequestUrl } from "@tanstack/react-start/server";
import type { AuthRole, AuthState, DashboardMemberAccess, MemberAccessStatus } from "@/lib/auth";
import { createDashboardSupabaseServerClient, readSupabaseEnv } from "@/lib/supabase.server";

type MemberRow = {
  user_id: string;
  email: string;
  display_name: string;
  status: MemberAccessStatus;
  role: AuthRole;
  created_at: string;
  approved_at: string | null;
};

function safeOrigin() {
  const configuredOrigin = process.env.DASHBOARD_PUBLIC_URL?.trim();
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      throw new Error("DASHBOARD_PUBLIC_URL must be a valid absolute URL.");
    }
  }

  try {
    return new URL(getRequestUrl()).origin;
  } catch {
    return process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000";
  }
}

function callbackUrl(next: "confirmed" | "recovery") {
  const url = new URL("/api/auth/callback", safeOrigin());
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
    role: null,
    accessStatus: null,
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
    .select("user_id,email,display_name,status,role,created_at,approved_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return {
      ...base,
      isSignedIn: true,
      user: { id: user.id, email: user.email ?? "", displayName: "" },
      setupIssue: "Your account exists, but its dashboard access record could not be loaded.",
    };
  }

  const member = memberData as MemberRow | null;
  const accessStatus = member?.status ?? "pending";
  const role = member?.role ?? "member";
  const approved = accessStatus === "approved";

  return {
    ...base,
    isAuthenticated: approved,
    isSignedIn: true,
    isAdmin: approved && role === "admin",
    role: approved ? role : null,
    accessStatus,
    user: {
      id: user.id,
      email: user.email ?? member?.email ?? "",
      displayName: member?.display_name ?? "",
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

export async function updateDashboardPasswordServer(password: string) {
  const supabase = createDashboardSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, message: "Your password has been updated." };
}

export async function logoutFromDashboardServer() {
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
  if (auth.role !== "admin") throw new Error("Admin access required");
  return auth;
}

export async function requireWritableDashboardAuth() {
  return requireDashboardAuth();
}

export async function listDashboardMemberAccessServer(): Promise<DashboardMemberAccess[]> {
  await requireAdminAuth();
  const supabase = createDashboardSupabaseServerClient();
  const { data, error } = await supabase
    .from("dashboard_members")
    .select("user_id,email,display_name,status,role,created_at,approved_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as MemberRow[]).map(mapMember);
}

export async function updateDashboardMemberAccessServer(input: {
  userId: string;
  status: MemberAccessStatus;
  role: AuthRole;
}) {
  const auth = await requireAdminAuth();
  if (input.userId === auth.user?.id && input.status !== "approved") {
    return { ok: false as const, message: "You cannot remove your own dashboard access." };
  }

  const supabase = createDashboardSupabaseServerClient();
  const approved = input.status === "approved";
  const { error } = await supabase
    .from("dashboard_members")
    .update({
      status: input.status,
      role: input.role,
      approved_at: approved ? new Date().toISOString() : null,
      approved_by: approved ? (auth.user?.id ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId);

  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const };
}
