export type ActivityDay = {
  day: string;
  outreach: number;
  replies: number;
  calls: number;
  contracts: number;
};

export const weeklyActivity: ActivityDay[] = [
  { day: "Mon", outreach: 142, replies: 38, calls: 9, contracts: 3 },
  { day: "Tue", outreach: 168, replies: 41, calls: 12, contracts: 4 },
  { day: "Wed", outreach: 154, replies: 47, calls: 11, contracts: 5 },
  { day: "Thu", outreach: 189, replies: 52, calls: 14, contracts: 6 },
  { day: "Fri", outreach: 176, replies: 49, calls: 13, contracts: 7 },
  { day: "Sat", outreach: 88, replies: 21, calls: 5, contracts: 2 },
  { day: "Sun", outreach: 64, replies: 14, calls: 3, contracts: 1 },
];

export const activityTotals = weeklyActivity.reduce(
  (acc, d) => ({
    outreach: acc.outreach + d.outreach,
    replies: acc.replies + d.replies,
    calls: acc.calls + d.calls,
    contracts: acc.contracts + d.contracts,
  }),
  { outreach: 0, replies: 0, calls: 0, contracts: 0 }
);
