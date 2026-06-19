import {
  team,
  type Teammate,
  totalCommission,
  totalDealsClosed,
  totalDealsGoal,
  totalRevenueGoal,
  totalMonthCommission,
  totalPendingOwed,
} from "@/data/team";
import type { DashboardSheetData } from "@/lib/sheets-public";

export type GoalRow = {
  id: string;
  name: string;
  role: "Team" | string;
  revenueCurrent: number;
  revenueTarget: number;
  dealsCurrent: number;
  dealsTarget: number;
  exclusiveCreators: number;
  nonExclusiveCreators: number;
  paidCurrentMonth: number;
  pendingOwed: number;
};

export function createGoalRows(
  sourceTeam: Teammate[] = team,
  totals?: DashboardSheetData["totals"],
): GoalRow[] {
  const revenueTarget = sourceTeam.reduce((sum, member) => sum + member.revenueGoal, 0);
  const dealsTarget = sourceTeam.reduce((sum, member) => sum + member.dealsGoal, 0);
  const exclusiveCreators = sourceTeam.reduce((sum, member) => sum + member.exclusiveCreators, 0);
  const nonExclusiveCreators = sourceTeam.reduce(
    (sum, member) => sum + member.nonExclusiveCreators,
    0,
  );
  const paidCurrentMonth =
    totals?.paidThisMonth ?? sourceTeam.reduce((sum, member) => sum + member.monthCommission, 0);
  const pendingOwed =
    totals?.pendingOwed ?? sourceTeam.reduce((sum, member) => sum + member.pendingOwed, 0);

  return [
    {
      id: "team",
      name: "Team Billion",
      role: "Team",
      revenueCurrent:
        totals?.totalPaid ?? sourceTeam.reduce((sum, member) => sum + member.commission, 0),
      revenueTarget,
      dealsCurrent:
        totals?.dealsClosed ?? sourceTeam.reduce((sum, member) => sum + member.dealsClosed, 0),
      dealsTarget,
      exclusiveCreators,
      nonExclusiveCreators,
      paidCurrentMonth,
      pendingOwed,
    },
    ...sourceTeam.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      revenueCurrent: member.commission,
      revenueTarget: member.revenueGoal,
      dealsCurrent: member.dealsClosed,
      dealsTarget: member.dealsGoal,
      exclusiveCreators: member.exclusiveCreators,
      nonExclusiveCreators: member.nonExclusiveCreators,
      paidCurrentMonth: member.monthCommission,
      pendingOwed: member.pendingOwed,
    })),
  ];
}

export const defaultGoalRows: GoalRow[] = createGoalRows(team, {
  totalPaid: totalCommission,
  totalPaidCommission: 0,
  paidThisMonth: totalMonthCommission,
  pendingOwed: totalPendingOwed,
  dealsClosed: totalDealsClosed,
  totalPricing: 0,
  averageDealSize: 0,
  averageProfitMargin: 0,
  paidGoal: totalRevenueGoal,
  dealsGoal: totalDealsGoal,
});
