export type AssetIconName =
  | "book"
  | "calendar"
  | "database"
  | "discord"
  | "document"
  | "drive"
  | "folder"
  | "link"
  | "notion"
  | "slack"
  | "spreadsheet";

export type AssetColorName =
  | "amber"
  | "blue"
  | "green"
  | "pink"
  | "purple"
  | "rose"
  | "slate"
  | "yellow";

export type AssetLink = {
  id: string;
  title: string;
  description: string;
  url: string;
  icon: AssetIconName;
  color: AssetColorName;
  accent: string;
  category: string;
  enabled: boolean;
  sortOrder: number;
  sourceRowNumber?: number;
};

export const fallbackAssetLinks: AssetLink[] = [
  {
    id: "slack",
    title: "Slack",
    description: "Team channels & DMs",
    url: "https://app.slack.com/client",
    icon: "slack",
    color: "purple",
    accent: "from-purple-500/20 to-fuchsia-500/20",
    category: "Communication",
    enabled: true,
    sortOrder: 10,
  },
  {
    id: "discord",
    title: "Discord",
    description: "Voice rooms & community",
    url: "https://discord.com/app",
    icon: "discord",
    color: "blue",
    accent: "from-indigo-500/20 to-blue-500/20",
    category: "Communication",
    enabled: true,
    sortOrder: 20,
  },
  {
    id: "notion",
    title: "Notion Handbook",
    description: "Playbooks, scripts & SOPs",
    url: "https://www.notion.so/Influencer-Marketing-Beginner-Guide-2af83ff9296d8032b11fec9617d99db0?source=copy_link",
    icon: "notion",
    color: "slate",
    accent: "from-slate-500/20 to-zinc-500/20",
    category: "Knowledge",
    enabled: true,
    sortOrder: 30,
  },
  {
    id: "drive",
    title: "Team Assets",
    description: "Decks, contracts & assets",
    url: "https://drive.google.com/drive/folders/1ZdVFtAYk2qjK-3sO_DR1wuWstLzqWtlb?usp=sharing",
    icon: "drive",
    color: "amber",
    accent: "from-amber-500/20 to-orange-500/20",
    category: "Assets",
    enabled: true,
    sortOrder: 40,
  },
  {
    id: "database",
    title: "Company Database",
    description: "Creators, brands & company records",
    url: "https://www.stride-os.com/dashboard",
    icon: "database",
    color: "rose",
    accent: "from-rose-500/20 to-pink-500/20",
    category: "Database",
    enabled: true,
    sortOrder: 50,
  },
];
