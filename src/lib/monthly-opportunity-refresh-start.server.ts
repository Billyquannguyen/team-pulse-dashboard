import "@tanstack/react-start/server-only";

import {
  failMonthlyOpportunityRefreshStart,
  getLatestMonthlyOpportunityRefreshState,
  prepareMonthlyOpportunityRefreshRun,
} from "@/lib/monthly-opportunity-refresh.server";

export async function getMonthlyOpportunityRefreshStatusServer() {
  const { requireAdminAuth } = await import("@/lib/auth.server");
  await requireAdminAuth();
  return getLatestMonthlyOpportunityRefreshState();
}

export async function startMonthlyOpportunityRefreshServer() {
  const { requireAdminAuth } = await import("@/lib/auth.server");
  const auth = await requireAdminAuth();
  return startMonthlyOpportunityRefreshRun(auth.user?.email || "Dashboard admin");
}

export async function startMonthlyOpportunityRefreshRun(startedBy: string) {
  const prepared = await prepareMonthlyOpportunityRefreshRun(startedBy);
  if (prepared.alreadyRunning) {
    return { ok: true as const, ...prepared };
  }

  try {
    const [{ start }, { monthlyOpportunityRefreshWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("@/workflows/monthly-opportunity-refresh"),
    ]);
    await start(monthlyOpportunityRefreshWorkflow, [prepared.state.runId]);
  } catch (error) {
    await failMonthlyOpportunityRefreshStart(prepared.state.runId, error);
    throw error;
  }

  return { ok: true as const, ...prepared };
}
