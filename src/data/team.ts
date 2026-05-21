export type Teammate = {
  id: string;
  name: string;
  initials: string;
  role: string;
  // S6: total paid to this member from the start.
  commission: number;
  // S4: paid this month for last month's work.
  monthCommission: number;
  // S2: amount still owed to this member.
  pendingOwed: number;
  dealsClosed: number;
  revenue: number;
  revenueGoal: number;
  dealsGoal: number;
  exclusiveCreators: number;
  nonExclusiveCreators: number;
};

export const team: Teammate[] = [
  {
    id: "1",
    name: "KTrang",
    initials: "KT",
    role: "Closer",
    commission: 84200,
    monthCommission: 31200,
    pendingOwed: 12450,
    dealsClosed: 23,
    revenue: 421000,
    revenueGoal: 500000,
    dealsGoal: 28,
    exclusiveCreators: 8,
    nonExclusiveCreators: 19,
  },
  {
    id: "2",
    name: "HYen",
    initials: "HY",
    role: "Closer",
    commission: 69750,
    monthCommission: 24500,
    pendingOwed: 10480,
    dealsClosed: 18,
    revenue: 348750,
    revenueGoal: 430000,
    dealsGoal: 24,
    exclusiveCreators: 6,
    nonExclusiveCreators: 16,
  },
  {
    id: "3",
    name: "BNgan",
    initials: "BN",
    role: "Closer",
    commission: 61980,
    monthCommission: 22100,
    pendingOwed: 8950,
    dealsClosed: 19,
    revenue: 309900,
    revenueGoal: 390000,
    dealsGoal: 23,
    exclusiveCreators: 5,
    nonExclusiveCreators: 18,
  },
  {
    id: "4",
    name: "LNgoc",
    initials: "LN",
    role: "Closer",
    commission: 44250,
    monthCommission: 16800,
    pendingOwed: 7200,
    dealsClosed: 12,
    revenue: 221250,
    revenueGoal: 280000,
    dealsGoal: 16,
    exclusiveCreators: 4,
    nonExclusiveCreators: 22,
  },
];

export const totalCommission = team.reduce((s, t) => s + t.commission, 0);
export const totalMonthCommission = team.reduce((s, t) => s + t.monthCommission, 0);
export const totalPendingOwed = team.reduce((s, t) => s + t.pendingOwed, 0);
export const totalDealsClosed = team.reduce((s, t) => s + t.dealsClosed, 0);
export const totalRevenue = team.reduce((s, t) => s + t.revenue, 0);
export const totalRevenueGoal = team.reduce((s, t) => s + t.revenueGoal, 0);
export const totalDealsGoal = team.reduce((s, t) => s + t.dealsGoal, 0);
export const averageDealSize = Math.round(totalRevenue / Math.max(1, totalDealsClosed));
