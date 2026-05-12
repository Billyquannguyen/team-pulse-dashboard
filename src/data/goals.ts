export type WeeklyGoal = {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: "$" | "#";
};

export const defaultWeeklyGoals: WeeklyGoal[] = [
  { id: "rev", label: "Team Commission Revenue", target: 60000, current: 36450, unit: "$" },
  { id: "outreach", label: "Outreach Sent", target: 1000, current: 981, unit: "#" },
  { id: "calls", label: "Calls Booked", target: 80, current: 67, unit: "#" },
  { id: "contracts", label: "Contracts Signed", target: 35, current: 28, unit: "#" },
];
