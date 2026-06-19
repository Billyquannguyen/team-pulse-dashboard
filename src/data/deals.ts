export type DealStatus = "Pending" | "Posted" | "Paid" | "Overdue" | "Cancelled";
export type Platform = "Instagram" | "TikTok" | "YouTube" | "Twitch" | "X";

export type Deal = {
  id: string;
  rowNumber: string;
  manager: string;
  brand: string;
  creator: string;
  platform: Platform;
  contractLink?: string;
  liveLink?: string;
  month: string;
  totalPricingGbp: number;
  creatorTotalGbp: number;
  profitMargin: string;
  managerTotalGbp: number;
  vnd: number;
  netTerms: string;
  managerTotalPaid: boolean;
  managerPaidCurrentMonth: boolean;
  status: DealStatus;
  notes?: string;
};

const managers = ["KTrang", "HYen", "BNgan", "LNgoc"];
const brands = [
  "Gymshark",
  "HelloFresh",
  "Manscaped",
  "Athletic Greens",
  "BetterHelp",
  "Squarespace",
  "Notion",
  "Liquid IV",
  "Ridge Wallet",
  "Audible",
  "MasterClass",
  "Magic Spoon",
];
const creators = [
  "@finn.jacobs",
  "@maraplays",
  "@chefkofi",
  "@itsleo",
  "@jaime.builds",
  "@nyahfit",
  "@sundayhabits",
  "@deanruns",
  "@cocoatlas",
  "@kira.codes",
  "@stuartshoots",
  "@thezenmove",
];
const platforms: Platform[] = ["Instagram", "TikTok", "YouTube", "Twitch", "X"];
const statuses: DealStatus[] = ["Pending", "Posted", "Paid", "Overdue"];
const netTerms = ["Net 15", "Net 30", "Net 45", "Paid upfront"];
const fallbackNow = new Date();
const fallbackCurrentMonth = `${String(fallbackNow.getMonth() + 1).padStart(2, "0")}/${fallbackNow.getFullYear()}`;

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

export const deals: Deal[] = Array.from({ length: 32 }, (_, i) => {
  const totalPricingGbp = 1500 + ((i * 731) % 18000);
  const creatorTotalGbp = Math.round(totalPricingGbp * (0.45 + (i % 4) * 0.05));
  const managerTotalGbp = Math.round(totalPricingGbp * (0.16 + (i % 5) * 0.015));
  const profitMargin = `${Math.round((managerTotalGbp / Math.max(1, totalPricingGbp)) * 100)}%`;
  const status = pick(statuses, i + 1);
  const managerTotalPaid = status === "Paid";
  const managerPaidCurrentMonth = i % 3 === 0 && managerTotalPaid;

  return {
    id: `D-${1000 + i}`,
    rowNumber: `${i + 1}`,
    manager: pick(managers, i),
    brand: pick(brands, i),
    creator: pick(creators, i + 3),
    platform: pick(platforms, i + 1),
    contractLink: i % 4 === 0 ? "https://docs.google.com/document/d/PLACEHOLDER" : undefined,
    liveLink: i % 3 === 0 ? "https://example.com/live-campaign" : undefined,
    month: i < 18 ? fallbackCurrentMonth : "05/2026",
    totalPricingGbp,
    creatorTotalGbp,
    profitMargin,
    managerTotalGbp,
    vnd: managerTotalGbp * 32000,
    netTerms: pick(netTerms, i),
    managerTotalPaid,
    managerPaidCurrentMonth,
    status,
    notes: i % 4 === 0 ? "Renewal opportunity" : undefined,
  };
});

export const recentDeals = deals.slice(0, 8);
