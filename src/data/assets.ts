import { MessageCircle, Hash, FileSpreadsheet, BookOpen, FolderOpen, GraduationCap, type LucideIcon } from "lucide-react";

export type AssetLink = {
  id: string;
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
  accent: string;
};

// TODO(integration): Replace placeholder URLs with real team links.
export const assetLinks: AssetLink[] = [
  { id: "slack", title: "Slack", description: "Team channels & DMs", url: "https://slack.com/app_redirect?team=teambillion", icon: Hash, accent: "from-purple-500/20 to-fuchsia-500/20" },
  { id: "discord", title: "Discord", description: "Voice rooms & community", url: "https://discord.com/channels/teambillion", icon: MessageCircle, accent: "from-indigo-500/20 to-blue-500/20" },
  { id: "sheet", title: "Team Google Sheet", description: "Live deal tracker", url: "https://docs.google.com/spreadsheets/d/PLACEHOLDER_SHEET_ID", icon: FileSpreadsheet, accent: "from-emerald-500/20 to-green-500/20" },
  { id: "notion", title: "Notion Handbook", description: "Playbooks, scripts & SOPs", url: "https://notion.so/teambillion-handbook", icon: BookOpen, accent: "from-slate-500/20 to-zinc-500/20" },
  { id: "drive", title: "Google Drive", description: "Decks, contracts & assets", url: "https://drive.google.com/drive/folders/PLACEHOLDER", icon: FolderOpen, accent: "from-amber-500/20 to-orange-500/20" },
  { id: "training", title: "Training Resources", description: "Onboarding & courses", url: "https://teambillion.example.com/training", icon: GraduationCap, accent: "from-rose-500/20 to-pink-500/20" },
];
