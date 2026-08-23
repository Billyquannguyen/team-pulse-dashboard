import { createServerFn } from "@tanstack/react-start";

export type {
  MonthlyRefreshStage,
  MonthlyRefreshState,
} from "@/lib/monthly-opportunity-refresh-types";

export const getMonthlyOpportunityRefreshStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getMonthlyOpportunityRefreshStatusServer } =
      await import("@/lib/monthly-opportunity-refresh-start.server");
    return getMonthlyOpportunityRefreshStatusServer();
  },
);

export const startMonthlyOpportunityRefresh = createServerFn({ method: "POST" }).handler(
  async () => {
    const { startMonthlyOpportunityRefreshServer } =
      await import("@/lib/monthly-opportunity-refresh-start.server");
    return startMonthlyOpportunityRefreshServer();
  },
);
