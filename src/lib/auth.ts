import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type AuthRole = "member" | "admin";
export type MemberAccessStatus = "pending" | "approved" | "rejected" | "disabled";

export type AuthState = {
  isAuthenticated: boolean;
  isSignedIn: boolean;
  isAdmin: boolean;
  role: AuthRole | null;
  accessStatus: MemberAccessStatus | null;
  user: {
    id: string;
    email: string;
    displayName: string;
    teamMemberId: string | null;
  } | null;
  setupReady: boolean;
  setupIssue: string | null;
};

export type DashboardMemberAccess = {
  userId: string;
  email: string;
  displayName: string;
  status: MemberAccessStatus;
  role: AuthRole;
  teamMemberId: string | null;
  linkedAt: string | null;
  createdAt: string;
  approvedAt: string | null;
};

const emailSchema = z.string().trim().email().max(320);
const passwordSchema = z.string().min(8).max(256);

const signUpInput = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
});

const signInInput = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

const emailInput = z.object({ email: emailSchema });
const passwordUpdateInput = z.object({ password: passwordSchema });
const memberAccessInput = z.object({
  userId: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected", "disabled"]),
  role: z.enum(["member", "admin"]),
  teamMemberId: z.string().trim().min(1).max(80).nullable().optional(),
});

const approveWithNewMemberInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(["member", "admin"]),
  displayName: z.string().trim().min(1).max(80),
  teamMemberId: z.string().trim().min(1).max(80),
  joinedMonth: z.string().trim().max(20).optional().default(""),
  teamDepartment: z.string().trim().max(80).optional().default("Outreach"),
  gmailLabel: z.string().trim().max(200).optional().default(""),
});

export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  const { readAuthStateServer } = await import("@/lib/auth.server");
  return readAuthStateServer();
});

export const signUpToDashboard = createServerFn({ method: "POST" })
  .inputValidator(signUpInput)
  .handler(async ({ data }) => {
    const { signUpToDashboardServer } = await import("@/lib/auth.server");
    return signUpToDashboardServer(data);
  });

export const signInToDashboard = createServerFn({ method: "POST" })
  .inputValidator(signInInput)
  .handler(async ({ data }) => {
    const { signInToDashboardServer } = await import("@/lib/auth.server");
    return signInToDashboardServer(data);
  });

export const requestDashboardPasswordReset = createServerFn({ method: "POST" })
  .inputValidator(emailInput)
  .handler(async ({ data }) => {
    const { requestDashboardPasswordResetServer } = await import("@/lib/auth.server");
    return requestDashboardPasswordResetServer(data.email);
  });

export const updateDashboardPassword = createServerFn({ method: "POST" })
  .inputValidator(passwordUpdateInput)
  .handler(async ({ data }) => {
    const { updateDashboardPasswordServer } = await import("@/lib/auth.server");
    return updateDashboardPasswordServer(data.password);
  });

export const logoutFromDashboard = createServerFn({ method: "POST" }).handler(async () => {
  const { logoutFromDashboardServer } = await import("@/lib/auth.server");
  return logoutFromDashboardServer();
});

export const listDashboardMemberAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { listDashboardMemberAccessServer } = await import("@/lib/auth.server");
  return listDashboardMemberAccessServer();
});

export const updateDashboardMemberAccess = createServerFn({ method: "POST" })
  .inputValidator(memberAccessInput)
  .handler(async ({ data }) => {
    const { updateDashboardMemberAccessServer } = await import("@/lib/auth.server");
    return updateDashboardMemberAccessServer(data);
  });

export const approveDashboardMemberWithNewCard = createServerFn({ method: "POST" })
  .inputValidator(approveWithNewMemberInput)
  .handler(async ({ data }) => {
    const { approveDashboardMemberWithNewCardServer } = await import("@/lib/auth.server");
    return approveDashboardMemberWithNewCardServer(data);
  });
