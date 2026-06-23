/* eslint-disable react-hooks/rules-of-hooks */
import { useSession } from "@tanstack/react-start/server";
import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
  TEAM_SESSION_MAX_AGE_SECONDS,
  type AuthRole,
  type AuthSessionData,
  type AuthState,
} from "@/lib/auth";

function readAuthEnv() {
  const teamPassword = process.env.TEAM_DASHBOARD_PASSWORD ?? "";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  const hermesPassword = process.env.HERMES_DASHBOARD_PASSWORD ?? "";

  if (!teamPassword || !adminPassword) {
    const location = process.env.VERCEL === "1" ? "in Vercel" : "for this environment";

    return {
      teamPassword,
      adminPassword,
      hermesPassword,
      setupReady: false,
      setupIssue: `Missing TEAM_DASHBOARD_PASSWORD or ADMIN_PASSWORD environment variables ${location}.`,
    };
  }

  if (teamPassword === adminPassword) {
    return {
      teamPassword,
      adminPassword,
      hermesPassword,
      setupReady: false,
      setupIssue: "Team and admin passwords must be different.",
    };
  }

  return {
    teamPassword,
    adminPassword,
    hermesPassword,
    setupReady: true,
    setupIssue: null,
  };
}

async function sha256Bytes(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

async function passwordMatches(candidate: string, expected: string) {
  if (!expected) return false;
  const [candidateHash, expectedHash] = await Promise.all([
    sha256Bytes(candidate),
    sha256Bytes(expected),
  ]);

  return timingSafeEqualBytes(candidateHash, expectedHash);
}

async function sessionSecret() {
  const { teamPassword, adminPassword } = readAuthEnv();
  const bytes = await sha256Bytes(
    `team-billion-dashboard-auth:v1:${teamPassword}:${adminPassword}`,
  );

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function useAuthSession() {
  return useSession<AuthSessionData>({
    name: AUTH_COOKIE_NAME,
    password: await sessionSecret(),
    maxAge: COOKIE_MAX_AGE_SECONDS,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    },
  });
}

function normalizeRole(value: unknown): AuthRole | null {
  return value === "team" || value === "admin" || value === "hermes_readonly" ? value : null;
}

function getRoleSessionMaxAge(role: AuthRole) {
  return role === "admin" ? ADMIN_SESSION_MAX_AGE_SECONDS : TEAM_SESSION_MAX_AGE_SECONDS;
}

function getSessionExpiry(role: AuthRole) {
  return Date.now() + getRoleSessionMaxAge(role) * 1000;
}

function isValidExpiry(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > Date.now();
}

export async function readAuthStateServer(): Promise<AuthState> {
  const session = await useAuthSession();
  const role = normalizeRole(session.data.role);
  const sessionExpired = role !== null && !isValidExpiry(session.data.expiresAt);
  const { setupReady, setupIssue } = readAuthEnv();

  if (sessionExpired) {
    await session.clear();
  }

  const activeRole = sessionExpired ? null : role;

  return {
    isAuthenticated: activeRole !== null,
    isAdmin: activeRole === "admin",
    isHermesReadOnly: activeRole === "hermes_readonly",
    role: activeRole,
    setupReady,
    setupIssue,
  };
}

export async function loginToDashboardServer(password: string) {
  const env = readAuthEnv();

  if (!env.setupReady) {
    return {
      ok: false as const,
      message: env.setupIssue ?? "Login is not configured yet.",
    };
  }

  let role: AuthRole | null = null;

  // Passwords are checked only on the server. The client never receives the
  // configured passwords, only the role saved in the signed session cookie.
  if (await passwordMatches(password, env.adminPassword)) {
    role = "admin";
  } else if (await passwordMatches(password, env.teamPassword)) {
    role = "team";
  } else if (await passwordMatches(password, env.hermesPassword)) {
    // Hermes gets its own read-only role so it can inspect analytics without
    // being allowed to create drafts, edit sheets, or trigger admin actions.
    role = "hermes_readonly";
  }

  if (!role) {
    return {
      ok: false as const,
      message: "That password did not match.",
    };
  }

  const session = await useAuthSession();
  await session.update({ role, expiresAt: getSessionExpiry(role) });

  return {
    ok: true as const,
    role,
  };
}

export async function logoutFromDashboardServer() {
  const session = await useAuthSession();
  await session.clear();

  return { ok: true as const };
}

export async function requireDashboardAuth() {
  const auth = await readAuthStateServer();

  if (!auth.role) {
    throw new Error("Unauthorized");
  }

  return auth;
}

export async function requireAdminAuth() {
  const auth = await requireDashboardAuth();

  if (auth.role !== "admin") {
    throw new Error("Admin access required");
  }

  return auth;
}

export async function requireWritableDashboardAuth() {
  const auth = await requireDashboardAuth();

  if (auth.role === "hermes_readonly") {
    throw new Error("Read-only access cannot modify dashboard data");
  }

  return auth;
}
