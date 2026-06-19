export type Teammate = {
  id: string;
  name: string;
  initials: string;
  role: string;
  worksheetName?: string;
  status?: "active" | "offboarded";
  color?: string;
  sortOrder?: number;
  joinedMonth?: string;
  avatarUrl?: string;
  instagramUrl?: string;
  tiktokUrl?: string;
  youtubeUrl?: string;
  // Parsed from the member summary label/value cells in the deal worksheet.
  commission: number;
  // Parsed from the member summary label/value cells in the deal worksheet.
  monthCommission: number;
  // Parsed from the member summary label/value cells in the deal worksheet.
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
    worksheetName: "KTrang",
    status: "active",
    color: "#A3E635",
    sortOrder: 10,
    joinedMonth: "",
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
    worksheetName: "HYen",
    status: "active",
    color: "#FACC15",
    sortOrder: 20,
    joinedMonth: "",
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
    worksheetName: "BNgan",
    status: "active",
    color: "#F9A8D4",
    sortOrder: 30,
    joinedMonth: "",
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
    worksheetName: "LNgoc",
    status: "active",
    color: "#C4B5FD",
    sortOrder: 40,
    joinedMonth: "",
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
