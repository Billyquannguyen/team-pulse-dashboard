import { createServerFn } from "@tanstack/react-start";

export type MonthlyRefreshStage =
  | "queued"
  | "preparing"
  | "ingesting"
  | "finalizing"
  | "complete"
  | "failed";

export type MonthlyRefreshState = {
  runId: string;
  status: "queued" | "running" | "success" | "failed";
  stage: MonthlyRefreshStage;
  stageLabel: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
  startedBy: string;
  emailsScanned: number;
  pagesScanned: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  packageReady: boolean;
  packageBlobUrl: string;
  backupBlobUrl: string;
  error: string;
};

export const getMonthlyOpportunityRefreshStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getMonthlyOpportunityRefreshStatusServer } =
      await import("@/lib/monthly-opportunity-refresh.server");
    return getMonthlyOpportunityRefreshStatusServer();
  },
);

export const startMonthlyOpportunityRefresh = createServerFn({ method: "POST" }).handler(
  async () => {
    const { startMonthlyOpportunityRefreshServer } =
      await import("@/lib/monthly-opportunity-refresh.server");
    return startMonthlyOpportunityRefreshServer();
  },
);
