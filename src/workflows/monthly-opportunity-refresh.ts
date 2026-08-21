type WorkflowState = {
  status: "queued" | "running" | "success" | "failed";
  stage: string;
};

function dashboardOrigin() {
  const configured = process.env.DASHBOARD_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost}`;
  throw new Error("DASHBOARD_PUBLIC_URL is not configured for the monthly workflow.");
}

async function runMonthlyRefreshBatch(runId: string) {
  "use step";

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET is not configured for the monthly workflow.");
  const response = await fetch(`${dashboardOrigin()}/api/monthly-opportunity-refresh-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ runId }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | { state?: WorkflowState; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Monthly refresh batch returned ${response.status}.`);
  }
  if (!payload?.state) throw new Error("Monthly refresh batch did not return its state.");
  return payload.state;
}

export async function monthlyOpportunityRefreshWorkflow(runId: string) {
  "use workflow";

  for (let stepNumber = 0; stepNumber < 500; stepNumber += 1) {
    const state = await runMonthlyRefreshBatch(runId);
    if (state.status === "success" || state.status === "failed") return state;
  }

  throw new Error("Monthly refresh exceeded its safe workflow step limit.");
}
