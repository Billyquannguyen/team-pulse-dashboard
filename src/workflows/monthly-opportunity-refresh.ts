import { runMonthlyOpportunityRefreshWorkflowStep } from "@/lib/monthly-opportunity-refresh.server";

export async function monthlyOpportunityRefreshWorkflow(runId: string) {
  "use workflow";

  for (let stepNumber = 0; stepNumber < 500; stepNumber += 1) {
    const state = await runMonthlyOpportunityRefreshWorkflowStep(runId);
    if (state.status === "success" || state.status === "failed") return state;
  }

  throw new Error("Monthly refresh exceeded its safe workflow step limit.");
}
