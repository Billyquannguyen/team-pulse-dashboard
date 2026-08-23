import { runMonthlyOpportunityRefreshStep } from "@/lib/monthly-opportunity-refresh.server";

type WorkflowState = {
  status: "queued" | "running" | "success" | "failed";
  stage: string;
};

async function runMonthlyRefreshBatch(runId: string) {
  "use step";

  const state = await runMonthlyOpportunityRefreshStep(runId);
  if (!state) throw new Error("Monthly refresh batch did not return its state.");
  return { status: state.status, stage: state.stage } satisfies WorkflowState;
}

export async function monthlyOpportunityRefreshWorkflow(runId: string) {
  "use workflow";

  for (let stepNumber = 0; stepNumber < 500; stepNumber += 1) {
    const state = await runMonthlyRefreshBatch(runId);
    if (state.status === "success" || state.status === "failed") return state;
  }

  throw new Error("Monthly refresh exceeded its safe workflow step limit.");
}
