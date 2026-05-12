export type Teammate = {
  id: string;
  name: string;
  initials: string;
  role: string;
  weekCommission: number;
  monthCommission: number;
  dealsClosed: number;
  weeklyGoal: number;
};

export const team: Teammate[] = [
  { id: "1", name: "Alex Rivera", initials: "AR", role: "Senior Closer", weekCommission: 8420, monthCommission: 31200, dealsClosed: 7, weeklyGoal: 10000 },
  { id: "2", name: "Jordan Park", initials: "JP", role: "Closer", weekCommission: 6750, monthCommission: 24500, dealsClosed: 5, weeklyGoal: 8000 },
  { id: "3", name: "Sam Chen", initials: "SC", role: "Closer", weekCommission: 5980, monthCommission: 22100, dealsClosed: 6, weeklyGoal: 8000 },
  { id: "4", name: "Maya Okafor", initials: "MO", role: "Setter", weekCommission: 4250, monthCommission: 16800, dealsClosed: 4, weeklyGoal: 6000 },
  { id: "5", name: "Devon Brooks", initials: "DB", role: "Setter", weekCommission: 3680, monthCommission: 14200, dealsClosed: 3, weeklyGoal: 6000 },
  { id: "6", name: "Riley Suzuki", initials: "RS", role: "Closer", weekCommission: 3120, monthCommission: 12500, dealsClosed: 3, weeklyGoal: 7000 },
  { id: "7", name: "Casey Martin", initials: "CM", role: "Setter", weekCommission: 2400, monthCommission: 9800, dealsClosed: 2, weeklyGoal: 5000 },
  { id: "8", name: "Taylor Nguyen", initials: "TN", role: "Setter", weekCommission: 1850, monthCommission: 7400, dealsClosed: 2, weeklyGoal: 5000 },
];

export const totalWeekCommission = team.reduce((s, t) => s + t.weekCommission, 0);
export const totalMonthCommission = team.reduce((s, t) => s + t.monthCommission, 0);
export const totalDealsThisWeek = team.reduce((s, t) => s + t.dealsClosed, 0);
