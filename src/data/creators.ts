// TODO(integration): Replace this mock array with live creator data from the
// team sheet or company database once the real source is connected.

export type CreatorStatus = "Active" | "Prospect" | "Paused" | "Needs follow-up";
export type CreatorRelationship = "Exclusive" | "Non-exclusive";
export type CreatorPlatform = "Instagram" | "TikTok" | "YouTube" | "Twitch" | "X";

export type Creator = {
  id: string;
  handle: string;
  owner: string;
  platform: CreatorPlatform;
  niche: string;
  base?: string;
  email?: string;
  tiktokLink?: string;
  instagramLink?: string;
  youtubeLink?: string;
  estimatedRate?: string;
  songPromoRate?: string;
  followers: number;
  relationship: CreatorRelationship;
  status: CreatorStatus;
  activeDeals: number;
  revenue: number;
  notes?: string;
};

const owners = ["KTrang", "HYen", "BNgan", "LNgoc"];
const handles = [
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
  "@mika.moves",
  "@anaeats",
  "@julesvlog",
  "@kai.camera",
  "@livwell",
  "@maxmakes",
  "@nora.travels",
  "@benbakes",
  "@ellafit",
  "@zoeplays",
  "@noahcodes",
  "@miahome",
];
const platforms: CreatorPlatform[] = ["Instagram", "TikTok", "YouTube", "Twitch", "X"];
const niches = ["Fitness", "Gaming", "Food", "Lifestyle", "Tech", "Wellness", "Travel", "Home"];
const statuses: CreatorStatus[] = ["Active", "Prospect", "Needs follow-up", "Paused"];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

export const creators: Creator[] = handles.map((handle, i) => ({
  id: `C-${2000 + i}`,
  handle,
  owner: pick(owners, i),
  platform: pick(platforms, i + 2),
  niche: pick(niches, i + 1),
  followers: 25000 + ((i * 37211) % 850000),
  relationship: i % 4 === 0 ? "Exclusive" : "Non-exclusive",
  status: pick(statuses, i + 3),
  activeDeals: i % 5,
  revenue: 4500 + ((i * 4100) % 62000),
  notes: i % 6 === 0 ? "Strong renewal candidate" : undefined,
}));
