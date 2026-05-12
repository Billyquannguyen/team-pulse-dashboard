// TODO(integration): Replace this mock array with live Google Sheets data.
// Suggested approach: create a TanStack server function in
// `src/lib/sheets.functions.ts` that calls the Lovable connector gateway:
//   GET https://connector-gateway.lovable.dev/google_sheets/v4/spreadsheets/{SHEET_ID}/values/Deals!A2:K
// Then map each row into the `Deal` shape below. Keep the same column order
// in the spreadsheet so this file becomes a near drop-in replacement.

export type DealStatus = "Won" | "Pending" | "Invoiced" | "Paid";
export type Platform = "Instagram" | "TikTok" | "YouTube" | "Twitch" | "X";

export type Deal = {
  id: string;
  date: string;
  closer: string;
  brand: string;
  creator: string;
  platform: Platform;
  dealType: string;
  grossValue: number;
  commissionPct: number;
  commission: number;
  status: DealStatus;
  notes?: string;
};

const closers = ["Alex Rivera", "Jordan Park", "Sam Chen", "Maya Okafor", "Devon Brooks", "Riley Suzuki"];
const brands = ["Gymshark", "HelloFresh", "Manscaped", "Athletic Greens", "BetterHelp", "Squarespace", "Notion", "Liquid IV", "Ridge Wallet", "Audible", "MasterClass", "Magic Spoon"];
const creators = ["@finn.jacobs", "@maraplays", "@chefkofi", "@itsleo", "@jaime.builds", "@nyahfit", "@sundayhabits", "@deanruns", "@cocoatlas", "@kira.codes", "@stuartshoots", "@thezenmove"];
const platforms: Platform[] = ["Instagram", "TikTok", "YouTube", "Twitch", "X"];
const dealTypes = ["UGC Bundle", "Integrated Video", "Story Series", "Dedicated Post", "Livestream", "Long-form Sponsor"];
const statuses: DealStatus[] = ["Won", "Pending", "Invoiced", "Paid"];

function pick<T>(arr: T[], i: number): T { return arr[i % arr.length]; }

export const deals: Deal[] = Array.from({ length: 32 }, (_, i) => {
  const gross = 1500 + ((i * 731) % 18000);
  const pct = [10, 12, 15, 18, 20][i % 5];
  const d = new Date();
  d.setDate(d.getDate() - (i % 21));
  return {
    id: `D-${1000 + i}`,
    date: d.toISOString().slice(0, 10),
    closer: pick(closers, i),
    brand: pick(brands, i),
    creator: pick(creators, i + 3),
    platform: pick(platforms, i + 1),
    dealType: pick(dealTypes, i + 2),
    grossValue: gross,
    commissionPct: pct,
    commission: Math.round((gross * pct) / 100),
    status: pick(statuses, i + 4),
    notes: i % 4 === 0 ? "Renewal opportunity Q3" : undefined,
  };
});

export const recentDeals = [...deals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
