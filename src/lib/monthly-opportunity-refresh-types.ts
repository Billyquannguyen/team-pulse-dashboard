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
  reportPeriodLabel: string;
  reportPeriodStart: string;
  reportPeriodEndExclusive: string;
  emailsScanned: number;
  pagesScanned: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  packageReady: boolean;
  packageBlobUrl: string;
  backupBlobUrl: string;
  error: string;
};
