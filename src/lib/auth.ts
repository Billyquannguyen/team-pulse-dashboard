import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type AuthRole = "team" | "admin";

export type AuthState = {
  isAuthenticated: boolean;
  isAdmin: boolean;
  role: AuthRole | null;
  setupReady: boolean;
  setupIssue: string | null;
};

const loginInput = z.object({
  password: z.string().min(1).max(256),
});

export const AUTH_COOKIE_NAME = "tb_auth";
export const TEAM_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 2;
export const COOKIE_MAX_AGE_SECONDS = TEAM_SESSION_MAX_AGE_SECONDS;

export type AuthSessionData = {
  role?: AuthRole;
  expiresAt?: number;
};

export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  const { readAuthStateServer } = await import("@/lib/auth.server");
  return readAuthStateServer();
});

export const loginToDashboard = createServerFn({ method: "POST" })
  .inputValidator(loginInput)
  .handler(async ({ data }) => {
    const { loginToDashboardServer } = await import("@/lib/auth.server");
    return loginToDashboardServer(data.password);
  });

export const logoutFromDashboard = createServerFn({ method: "POST" }).handler(async () => {
  const { logoutFromDashboardServer } = await import("@/lib/auth.server");
  return logoutFromDashboardServer();
});
