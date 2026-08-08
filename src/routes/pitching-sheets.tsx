import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import * as XLSX from "xlsx";
import { AppHeader } from "@/components/layout/AppHeader";
import {
  PreparedDatasetPreviewModal,
  type PreparedRow,
  type PreviewColumn,
} from "@/components/pitching/PreparedDatasetPreviewModal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DashboardSelect, DashboardSelectField } from "@/components/ui/dashboard-select";
import {
  createCreatorProfile,
  creatorProfilesQuery,
  updateCreatorProfile,
  type CreatorProfile,
  type CreatorProfileType,
} from "@/lib/creator-profiles";
import { matchCurrentRosterExclusiveProfileIds } from "@/lib/creator-roster-matching";
import { dashboardSheetQuery } from "@/lib/sheets-public";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pitching-sheets")({
  head: () => ({
    meta: [
      { title: "Pitching Sheets — Team Billion" },
      {
        name: "description",
        content: "Filter the private creator roster and prepare client-ready pitching sheets.",
      },
    ],
  }),
  component: PitchingSheetsPage,
});

type Platform = "TikTok" | "Instagram" | "YouTube";
type ProfileDraft = {
  creatorName: string;
  location: string;
  nicheTags: string;
  nicheDetail: string;
  mainPlatform: string;
  ttFollowing: number;
  ttLink: string;
  instaFollowing: number;
  instaLink: string;
  ytFollowing: number;
  ytLink: string;
  analytics: string;
  type: CreatorProfileType;
  exclusiveTier: string;
  talentManager: string;
  gender: string;
  active: boolean;
  reviewStatus: "Ready" | "Needs Review";
  dataIssues: string;
  updatedBy: string;
};

type PitchRow = PreparedRow & { profile: CreatorProfile; isRosterExclusive: boolean };

const platforms: Platform[] = ["TikTok", "Instagram", "YouTube"];

const emptyDraft: ProfileDraft = {
  creatorName: "",
  location: "",
  nicheTags: "",
  nicheDetail: "",
  mainPlatform: "TikTok",
  ttFollowing: 0,
  ttLink: "",
  instaFollowing: 0,
  instaLink: "",
  ytFollowing: 0,
  ytLink: "",
  analytics: "",
  type: "Partnered",
  exclusiveTier: "",
  talentManager: "",
  gender: "",
  active: true,
  reviewStatus: "Ready",
  dataIssues: "",
  updatedBy: "Team member",
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function followerValue(profile: CreatorProfile, platform: Platform) {
  if (platform === "TikTok") return profile.ttFollowing;
  if (platform === "Instagram") return profile.instaFollowing;
  return profile.ytFollowing;
}

function platformAvailable(profile: CreatorProfile, platform: Platform) {
  if (platform === "TikTok") return Boolean(profile.ttLink || profile.ttFollowing);
  if (platform === "Instagram") return Boolean(profile.instaLink || profile.instaFollowing);
  return Boolean(profile.ytLink || profile.ytFollowing);
}

function quoteClipboardCell(value: string | number) {
  const text = String(value ?? "");
  return /[\t\n\r"]/g.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function copyRows(rows: PitchRow[], columns: PreviewColumn<PitchRow>[]) {
  const matrix = [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => column.value(row))),
  ];
  const plainText = matrix.map((row) => row.map(quoteClipboardCell).join("\t")).join("\n");
  const html = `<table>${matrix
    .map(
      (row, rowIndex) =>
        `<tr>${row
          .map((value) => {
            const tag = rowIndex === 0 ? "th" : "td";
            const escaped = String(value ?? "")
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\n/g, "<br>");
            return `<${tag}>${escaped}</${tag}>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</table>`;

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(plainText);
  }
}

function safeFilename(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
}

function ProfileField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-xs font-semibold text-muted-foreground">
      <span>{label}</span>
      <Input
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-2xl bg-background text-sm text-foreground"
      />
    </label>
  );
}

function CreatorResultsTable({
  profiles,
  selectedIds,
  rosterExclusive,
  onToggle,
  onEdit,
}: {
  profiles: CreatorProfile[];
  selectedIds: Set<string>;
  rosterExclusive: boolean;
  onToggle: (creatorId: string) => void;
  onEdit: (profile: CreatorProfile) => void;
}) {
  return (
    <div className="max-h-[460px] overflow-auto border-t border-border">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left">Select</th>
            <th className="px-4 py-3 text-left">Creator</th>
            <th className="px-4 py-3 text-left">Manager</th>
            <th className="px-4 py-3 text-left">Location</th>
            <th className="px-4 py-3 text-left">Niches</th>
            <th className="px-4 py-3 text-right">Main following</th>
            <th className="px-4 py-3 text-right">Edit</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <tr key={profile.creatorId} className="border-t border-border/70 hover:bg-muted/40">
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(profile.creatorId)}
                  onChange={() => onToggle(profile.creatorId)}
                  aria-label={`Select ${profile.creatorName}`}
                  className="h-4 w-4 accent-primary"
                />
              </td>
              <td className="px-4 py-3 font-semibold">
                <div className="flex flex-wrap items-center gap-2">
                  {profile.creatorName}
                  {rosterExclusive ? (
                    <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      Our roster exclusive
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{profile.talentManager || "—"}</td>
              <td className="px-4 py-3">{profile.location || "—"}</td>
              <td className="max-w-xs px-4 py-3 text-muted-foreground">{profile.nicheTags}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {followerValue(
                  profile,
                  platforms.includes(profile.mainPlatform as Platform)
                    ? (profile.mainPlatform as Platform)
                    : "TikTok",
                ).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onEdit(profile)}
                  aria-label={`Edit ${profile.creatorName}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PitchingSheetsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(creatorProfilesQuery);
  const { data: rosterData } = useQuery(dashboardSheetQuery);
  const profiles = useMemo(() => data?.profiles ?? [], [data?.profiles]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set());
  const [mainPlatform, setMainPlatform] = useState("All main platforms");
  const [gender, setGender] = useState("All genders");
  const [manager, setManager] = useState("All managers");
  const [location, setLocation] = useState("All locations");
  const [niche, setNiche] = useState("All niches");
  const [minimumFollowing, setMinimumFollowing] = useState("");
  const [maximumFollowing, setMaximumFollowing] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewRows, setPreviewRows] = useState<PitchRow[]>([]);
  const [previewSelectedIds, setPreviewSelectedIds] = useState<Set<string>>(new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exclusiveReminderOpen, setExclusiveReminderOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [editing, setEditing] = useState<CreatorProfile | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const rosterReady = rosterData?.source === "google-sheet";
  const currentRosterCreators = useMemo(
    () => (rosterReady ? rosterData.creators : []),
    [rosterData?.creators, rosterReady],
  );
  const currentRosterExclusiveCount = useMemo(
    () => currentRosterCreators.filter((creator) => creator.relationship === "Exclusive").length,
    [currentRosterCreators],
  );
  const rosterExclusiveProfileIds = useMemo(
    () => matchCurrentRosterExclusiveProfileIds(profiles, currentRosterCreators),
    [currentRosterCreators, profiles],
  );

  const options = useMemo(() => {
    const niches = profiles.flatMap((profile) => profile.nicheTags.split(","));
    return {
      managers: ["All managers", ...unique(profiles.map((profile) => profile.talentManager))],
      locations: ["All locations", ...unique(profiles.map((profile) => profile.location))],
      genders: ["All genders", ...unique(profiles.map((profile) => profile.gender))],
      niches: ["All niches", ...unique(niches)],
      mainPlatforms: [
        "All main platforms",
        ...unique(profiles.map((profile) => profile.mainPlatform)),
      ],
    };
  }, [profiles]);

  const filtered = useMemo(() => {
    const minimum = minimumFollowing === "" ? 0 : Number(minimumFollowing);
    const maximum = maximumFollowing === "" ? Number.POSITIVE_INFINITY : Number(maximumFollowing);
    const chosenPlatforms = [...selectedPlatforms];

    const matches = profiles.filter((profile) => {
      if (!profile.active) return false;
      if (manager !== "All managers" && profile.talentManager !== manager) return false;
      if (location !== "All locations" && profile.location !== location) return false;
      if (gender !== "All genders" && profile.gender !== gender) return false;
      if (mainPlatform !== "All main platforms" && profile.mainPlatform !== mainPlatform)
        return false;
      if (
        niche !== "All niches" &&
        !profile.nicheTags
          .split(",")
          .map((value) => value.trim())
          .includes(niche)
      )
        return false;
      if (chosenPlatforms.length > 0) {
        const platformMatch = chosenPlatforms.some(
          (platform) =>
            platformAvailable(profile, platform) &&
            followerValue(profile, platform) >= minimum &&
            followerValue(profile, platform) <= maximum,
        );
        if (!platformMatch) return false;
      } else {
        const largestFollowing = Math.max(
          profile.ttFollowing,
          profile.instaFollowing,
          profile.ytFollowing,
        );
        if (largestFollowing < minimum || largestFollowing > maximum) return false;
      }
      if (deferredSearch) {
        const haystack = [
          profile.creatorName,
          profile.talentManager,
          profile.location,
          profile.nicheTags,
          profile.nicheDetail,
          profile.mainPlatform,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(deferredSearch)) return false;
      }
      return true;
    });

    return matches.sort((left, right) => {
      const platformsToScore = chosenPlatforms.length ? chosenPlatforms : platforms;
      const leftScore = Math.max(
        ...platformsToScore.map((platform) => followerValue(left, platform)),
      );
      const rightScore = Math.max(
        ...platformsToScore.map((platform) => followerValue(right, platform)),
      );
      return rightScore - leftScore || left.creatorName.localeCompare(right.creatorName);
    });
  }, [
    deferredSearch,
    gender,
    location,
    mainPlatform,
    manager,
    maximumFollowing,
    minimumFollowing,
    niche,
    profiles,
    selectedPlatforms,
  ]);

  const rosterExclusiveMatches = useMemo(
    () => filtered.filter((profile) => rosterExclusiveProfileIds.has(profile.creatorId)),
    [filtered, rosterExclusiveProfileIds],
  );
  const otherMatches = useMemo(
    () => filtered.filter((profile) => !rosterExclusiveProfileIds.has(profile.creatorId)),
    [filtered, rosterExclusiveProfileIds],
  );
  const selectedVisibleCount = useMemo(
    () => filtered.filter((profile) => selectedIds.has(profile.creatorId)).length,
    [filtered, selectedIds],
  );
  const unselectedRosterExclusives = useMemo(
    () => rosterExclusiveMatches.filter((profile) => !selectedIds.has(profile.creatorId)),
    [rosterExclusiveMatches, selectedIds],
  );

  const outputPlatforms = useMemo(
    () => (selectedPlatforms.size ? [...selectedPlatforms] : platforms),
    [selectedPlatforms],
  );
  const outputColumns = useMemo<PreviewColumn<PitchRow>[]>(() => {
    const result: PreviewColumn<PitchRow>[] = [
      { key: "creatorName", label: "Creator Name", value: (row) => row.profile.creatorName },
      { key: "location", label: "Location", value: (row) => row.profile.location },
      { key: "niche", label: "Niche", value: (row) => row.profile.nicheTags },
      { key: "mainPlatform", label: "Main Platform", value: (row) => row.profile.mainPlatform },
    ];
    if (outputPlatforms.includes("TikTok")) {
      result.push(
        { key: "ttFollowing", label: "TT Following", value: (row) => row.profile.ttFollowing },
        { key: "ttLink", label: "TT Link", value: (row) => row.profile.ttLink },
      );
    }
    if (outputPlatforms.includes("Instagram")) {
      result.push(
        {
          key: "instaFollowing",
          label: "Insta Following",
          value: (row) => row.profile.instaFollowing,
        },
        { key: "instaLink", label: "Insta Link", value: (row) => row.profile.instaLink },
      );
    }
    if (outputPlatforms.includes("YouTube")) {
      result.push(
        { key: "ytFollowing", label: "YT Following", value: (row) => row.profile.ytFollowing },
        { key: "ytLink", label: "YT Link", value: (row) => row.profile.ytLink },
      );
    }
    result.push(
      { key: "analytics", label: "Analytics", value: (row) => row.profile.analytics },
      { key: "gender", label: "Gender", value: (row) => row.profile.gender },
      { key: "interested", label: "Interested?", value: () => "", sortable: false },
      { key: "rate", label: "Rate", value: () => "", sortable: false },
      { key: "deliverables", label: "Deliverables", value: () => "", sortable: false },
      { key: "comments", label: "Comments", value: () => "", sortable: false },
    );
    return result;
  }, [outputPlatforms]);

  const smartSort = (left: PitchRow, right: PitchRow) => {
    if (left.isRosterExclusive !== right.isRosterExclusive) return left.isRosterExclusive ? -1 : 1;
    const scorePlatforms = outputPlatforms.length ? outputPlatforms : platforms;
    const leftScore = Math.max(
      ...scorePlatforms.map((platform) => followerValue(left.profile, platform)),
    );
    const rightScore = Math.max(
      ...scorePlatforms.map((platform) => followerValue(right.profile, platform)),
    );
    return (
      rightScore - leftScore || left.profile.creatorName.localeCompare(right.profile.creatorName)
    );
  };

  const clearFilters = () => {
    setSearch("");
    setSelectedPlatforms(new Set());
    setMainPlatform("All main platforms");
    setGender("All genders");
    setManager("All managers");
    setLocation("All locations");
    setNiche("All niches");
    setMinimumFollowing("");
    setMaximumFollowing("");
    setSelectedIds(new Set());
  };

  const togglePlatform = (platform: Platform) => {
    setSelectedPlatforms((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const toggleCreatorSelection = (creatorId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(creatorId)) next.delete(creatorId);
      else next.add(creatorId);
      return next;
    });
  };

  const openPreparedPreview = () => {
    const chosenProfiles = [...rosterExclusiveMatches, ...otherMatches].filter((profile) =>
      selectedIds.has(profile.creatorId),
    );
    const rows = chosenProfiles.map((profile) => ({
      id: profile.creatorId,
      profile,
      isRosterExclusive: rosterExclusiveProfileIds.has(profile.creatorId),
    }));
    setPreviewRows(rows);
    setPreviewSelectedIds(new Set(rows.map((row) => row.id)));
    setExclusiveReminderOpen(false);
    setPreviewOpen(true);
  };

  const requestPreview = () => {
    if (!rosterReady) return;
    if (unselectedRosterExclusives.length > 0) {
      setExclusiveReminderOpen(true);
      return;
    }
    openPreparedPreview();
  };

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setSaveError("");
    setEditorOpen(true);
  };

  const openEdit = (profile: CreatorProfile) => {
    setEditing(profile);
    setDraft({
      creatorName: profile.creatorName,
      location: profile.location,
      nicheTags: profile.nicheTags,
      nicheDetail: profile.nicheDetail,
      mainPlatform: profile.mainPlatform,
      ttFollowing: profile.ttFollowing,
      ttLink: profile.ttLink,
      instaFollowing: profile.instaFollowing,
      instaLink: profile.instaLink,
      ytFollowing: profile.ytFollowing,
      ytLink: profile.ytLink,
      analytics: profile.analytics,
      type: profile.type,
      exclusiveTier: profile.exclusiveTier,
      talentManager: profile.talentManager,
      gender: profile.gender,
      active: profile.active,
      reviewStatus: profile.reviewStatus,
      dataIssues: profile.dataIssues,
      updatedBy: "Team member",
    });
    setSaveError("");
    setEditorOpen(true);
  };

  const saveProfile = async () => {
    setSaving(true);
    setSaveError("");
    try {
      if (editing) {
        await updateCreatorProfile({
          data: {
            ...draft,
            creatorId: editing.creatorId,
            rowNumber: editing.rowNumber,
            createdAt: editing.createdAt,
            sourceTabs: editing.sourceTabs,
          },
        });
      } else {
        await createCreatorProfile({ data: draft });
      }
      await queryClient.invalidateQueries({ queryKey: creatorProfilesQuery.queryKey });
      setEditorOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Creator profile could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const downloadRows = (rows: PitchRow[], columns: PreviewColumn<PitchRow>[]) => {
    const matrix = [
      columns.map((column) => column.label),
      ...rows.map((row) => columns.map((column) => column.value(row))),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    worksheet["!autofilter"] = {
      ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}${matrix.length}`,
    };
    worksheet["!cols"] = columns.map((column) => ({
      wch: column.label.includes("Link") || column.label === "Analytics" ? 34 : 18,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Creator Shortlist");
    const parts = [clientName, campaignName, "Pitching Sheet"].map(safeFilename).filter(Boolean);
    XLSX.writeFile(workbook, `${parts.join(" - ") || "Creator Pitching Sheet"}.xlsx`);
  };

  const exclusiveCount = rosterExclusiveProfileIds.size;
  const reviewCount = profiles.filter((profile) => profile.reviewStatus === "Needs Review").length;

  return (
    <div className="space-y-6">
      <AppHeader
        title="Pitching Sheets"
        subtitle="Filter the private creator roster and prepare a client-ready spreadsheet."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Creator profiles", profiles.length],
          ["Current roster exclusives matched", exclusiveCount],
          ["Needs identity review", reviewCount],
        ].map(([label, value]) => (
          <div key={label} className="rounded-3xl bg-card p-5 ring-1 ring-border">
            <div className="text-xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-bold">{Number(value).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {!rosterReady ? (
        <div
          role="alert"
          className="rounded-3xl bg-destructive/10 px-5 py-4 text-sm text-destructive ring-1 ring-destructive/20"
        >
          Current roster reminders are unavailable because the Creators sheet is not connected.
          Preview is paused so roster exclusives cannot be missed silently.
        </div>
      ) : currentRosterExclusiveCount > exclusiveCount ? (
        <div
          role="status"
          className="rounded-3xl bg-amber-50 px-5 py-4 text-sm text-amber-900 ring-1 ring-amber-200"
        >
          {currentRosterExclusiveCount - exclusiveCount} current roster exclusive
          {currentRosterExclusiveCount - exclusiveCount === 1 ? " has" : "s have"} no matching
          social account in Creator Profiles and need review.
        </div>
      ) : null}

      <section className="rounded-3xl bg-card p-5 ring-1 ring-border md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">Private creator master</h2>
              <p className="text-xs text-muted-foreground">
                {isLoading
                  ? "Loading profiles..."
                  : data?.source === "error"
                    ? data.error
                    : "One current profile per creator"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.sheetUrl && (
              <Button asChild variant="outline" className="rounded-2xl">
                <a href={data.sheetUrl} target="_blank" rel="noreferrer">
                  Open Master Sheet <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
            <Button type="button" onClick={openCreate} className="rounded-2xl">
              <Plus className="h-4 w-4" /> Add Creator
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-border md:p-6">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Build the shortlist</h2>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <label className="block text-xs font-semibold text-muted-foreground">
              Search creator or talent manager
              <span className="relative mt-1 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Creator, manager, niche, location..."
                  className="h-11 rounded-2xl bg-background pl-9 text-sm text-foreground"
                />
              </span>
            </label>

            <fieldset>
              <legend className="text-xs font-semibold text-muted-foreground">
                Platforms to pitch
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {platforms.map((platform) => {
                  const selected = selectedPlatforms.has(platform);
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => togglePlatform(platform)}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-2xl px-4 py-2 text-sm font-semibold ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "bg-primary text-primary-foreground ring-primary"
                          : "bg-background text-muted-foreground ring-border hover:text-foreground",
                      )}
                    >
                      {platform}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <ProfileField
                label="Minimum following"
                type="number"
                value={minimumFollowing}
                onChange={setMinimumFollowing}
                placeholder="No minimum"
              />
              <ProfileField
                label="Maximum following"
                type="number"
                value={maximumFollowing}
                onChange={setMaximumFollowing}
                placeholder="No maximum"
              />
            </div>
          </div>

          <div className="grid content-start gap-3 sm:grid-cols-2">
            <DashboardSelectField
              label="Main Platform"
              value={mainPlatform}
              options={options.mainPlatforms}
              onChange={setMainPlatform}
            />
            <DashboardSelectField
              label="Gender"
              value={gender}
              options={options.genders}
              onChange={setGender}
            />
            <DashboardSelectField
              label="Talent Manager"
              value={manager}
              options={options.managers}
              onChange={setManager}
            />
            <DashboardSelectField
              label="Location"
              value={location}
              options={options.locations}
              onChange={setLocation}
            />
            <DashboardSelectField
              label="Niche"
              value={niche}
              options={options.niches}
              onChange={setNiche}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm font-semibold text-primary">
            Current roster exclusives are always shown separately and selected manually.
          </p>
          <Button type="button" variant="ghost" onClick={clearFilters} className="rounded-2xl">
            <RotateCcw className="h-4 w-4" /> Clear filters
          </Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl bg-card ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 md:p-6">
          <div>
            <h2 className="font-semibold">Matching creators</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {filtered.length.toLocaleString()} matches · {selectedVisibleCount.toLocaleString()}{" "}
              manually selected
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl"
              disabled={filtered.length === 0}
              onClick={() => setSelectedIds(new Set(filtered.map((profile) => profile.creatorId)))}
            >
              <CheckSquare className="h-4 w-4" /> Select all matches
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl"
              disabled={selectedVisibleCount === 0}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
            <Button
              type="button"
              className="rounded-2xl"
              disabled={selectedVisibleCount === 0 || !rosterReady}
              onClick={requestPreview}
            >
              Preview {selectedVisibleCount} selected
            </Button>
          </div>
        </div>

        {rosterExclusiveMatches.length > 0 ? (
          <div className="border-t border-border bg-primary/[0.04]">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6">
              <div>
                <h3 className="font-semibold text-primary">Our exclusive roster matches</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {
                    rosterExclusiveMatches.filter((profile) => selectedIds.has(profile.creatorId))
                      .length
                  }{" "}
                  of {rosterExclusiveMatches.length} selected. These are never added automatically.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={() =>
                  setSelectedIds(
                    (current) =>
                      new Set([
                        ...current,
                        ...rosterExclusiveMatches.map((profile) => profile.creatorId),
                      ]),
                  )
                }
              >
                <CheckSquare className="h-4 w-4" /> Select roster matches
              </Button>
            </div>
            <CreatorResultsTable
              profiles={rosterExclusiveMatches}
              selectedIds={selectedIds}
              rosterExclusive
              onToggle={toggleCreatorSelection}
              onEdit={openEdit}
            />
          </div>
        ) : null}

        {otherMatches.length > 0 ? (
          <div className="border-t border-border">
            <div className="px-5 py-4 md:px-6">
              <h3 className="font-semibold">Other matching creators</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Select any additional creators you want to pitch.
              </p>
            </div>
            <CreatorResultsTable
              profiles={otherMatches}
              selectedIds={selectedIds}
              rosterExclusive={false}
              onToggle={toggleCreatorSelection}
              onEdit={openEdit}
            />
          </div>
        ) : null}

        {!isLoading && filtered.length === 0 ? (
          <div className="border-t border-border px-6 py-12 text-center text-muted-foreground">
            No active creators match these filters.
          </div>
        ) : null}
      </section>

      <Dialog open={exclusiveReminderOpen} onOpenChange={setExclusiveReminderOpen}>
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Review your roster exclusives</DialogTitle>
            <DialogDescription>
              {unselectedRosterExclusives.length} matching roster exclusive
              {unselectedRosterExclusives.length === 1 ? " is" : "s are"} still unselected. They
              will not be added automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 overflow-auto rounded-2xl bg-muted p-3 text-sm">
            {unselectedRosterExclusives.map((profile) => (
              <div key={profile.creatorId} className="py-1 font-medium">
                {profile.creatorName}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl"
              onClick={() => setExclusiveReminderOpen(false)}
            >
              Go back and review
            </Button>
            <Button type="button" className="rounded-2xl" onClick={openPreparedPreview}>
              Continue without them
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PreparedDatasetPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        columns={outputColumns}
        rows={previewRows}
        selectedIds={previewSelectedIds}
        onSelectedIdsChange={setPreviewSelectedIds}
        smartSort={smartSort}
        onCopy={copyRows}
        onDownload={downloadRows}
      />

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.creatorName}` : "Add creator"}</DialogTitle>
            <DialogDescription>
              Changes save directly to the private Creator Profiles worksheet.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2 lg:grid-cols-3">
            <ProfileField
              label="Creator Name"
              value={draft.creatorName}
              onChange={(value) => setDraft({ ...draft, creatorName: value })}
            />
            <ProfileField
              label="Location"
              value={draft.location}
              onChange={(value) => setDraft({ ...draft, location: value })}
            />
            <ProfileField
              label="Niche Tags"
              value={draft.nicheTags}
              onChange={(value) => setDraft({ ...draft, nicheTags: value })}
              placeholder="Beauty, Lifestyle"
            />
            <ProfileField
              label="Niche Detail"
              value={draft.nicheDetail}
              onChange={(value) => setDraft({ ...draft, nicheDetail: value })}
            />
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">
              <span>Main Platform</span>
              <DashboardSelect
                value={draft.mainPlatform}
                options={["TikTok", "Instagram", "YouTube", "Twitch", "Other"]}
                onChange={(value) => setDraft({ ...draft, mainPlatform: value })}
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">
              <span>Type</span>
              <DashboardSelect
                value={draft.type}
                options={["Exclusive", "Partnered"]}
                onChange={(value) => setDraft({ ...draft, type: value as CreatorProfileType })}
              />
            </label>
            {draft.type === "Exclusive" && (
              <label className="space-y-1 text-xs font-semibold text-muted-foreground">
                <span>Exclusive Tier</span>
                <DashboardSelect
                  value={draft.exclusiveTier || "None"}
                  options={["None", "Gold", "Silver"]}
                  onChange={(value) =>
                    setDraft({ ...draft, exclusiveTier: value === "None" ? "" : value })
                  }
                />
              </label>
            )}
            <ProfileField
              label="Talent Manager"
              value={draft.talentManager}
              onChange={(value) => setDraft({ ...draft, talentManager: value })}
            />
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">
              <span>Gender</span>
              <DashboardSelect
                value={draft.gender || "Unspecified"}
                options={["Unspecified", "Female", "Male", "Both", "Non-binary", "Other"]}
                onChange={(value) => setDraft({ ...draft, gender: value })}
              />
            </label>
            <ProfileField
              label="TikTok Following"
              type="number"
              value={draft.ttFollowing || ""}
              onChange={(value) => setDraft({ ...draft, ttFollowing: Number(value) || 0 })}
            />
            <ProfileField
              label="TikTok Link"
              value={draft.ttLink}
              onChange={(value) => setDraft({ ...draft, ttLink: value })}
            />
            <ProfileField
              label="Instagram Following"
              type="number"
              value={draft.instaFollowing || ""}
              onChange={(value) => setDraft({ ...draft, instaFollowing: Number(value) || 0 })}
            />
            <ProfileField
              label="Instagram Link"
              value={draft.instaLink}
              onChange={(value) => setDraft({ ...draft, instaLink: value })}
            />
            <ProfileField
              label="YouTube Following"
              type="number"
              value={draft.ytFollowing || ""}
              onChange={(value) => setDraft({ ...draft, ytFollowing: Number(value) || 0 })}
            />
            <ProfileField
              label="YouTube Link"
              value={draft.ytLink}
              onChange={(value) => setDraft({ ...draft, ytLink: value })}
            />
            <ProfileField
              label="Analytics Link"
              value={draft.analytics}
              onChange={(value) => setDraft({ ...draft, analytics: value })}
            />
            <ProfileField
              label="Updated By"
              value={draft.updatedBy}
              onChange={(value) => setDraft({ ...draft, updatedBy: value })}
            />
            <label className="flex items-center gap-2 self-end rounded-2xl bg-muted px-4 py-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              Active for pitching
            </label>
          </div>

          {saveError && (
            <p
              role="alert"
              className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {saveError}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl"
              onClick={() => setEditorOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-2xl"
              disabled={saving || !draft.creatorName.trim()}
              onClick={() => void saveProfile()}
            >
              {saving ? "Saving..." : editing ? "Save Changes" : "Add Creator"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
