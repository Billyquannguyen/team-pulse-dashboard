import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { ConfigurableStructuredForm } from "@/components/pitching/ConfigurableStructuredForm";
import {
  validateStructuredForm,
  type StructuredFormField,
  type StructuredFormValue,
  type StructuredFormValues,
} from "@/components/pitching/structured-form";
import {
  PreparedDatasetPreview,
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
import { DashboardSelect } from "@/components/ui/dashboard-select";
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
        content: "Build polished, client-ready creator pitching sheets.",
      },
    ],
  }),
  component: PitchingSheetsPage,
});

type Platform = "TikTok" | "Instagram" | "YouTube";
type WorkflowStage = "form" | "exclusives" | "preview";
type PitchRow = PreparedRow & { profile: CreatorProfile; isRosterExclusive: boolean };

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

const platforms: Platform[] = ["TikTok", "Instagram", "YouTube"];
const initialFormValues: StructuredFormValues = {
  clientName: "",
  campaignName: "",
  platforms: [...platforms],
  minimumFollowing: "",
  maximumFollowing: "",
  gender: "All genders",
  countries: [],
  niches: [],
};

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

function rankedOptions(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((rawValue) => {
    const value = rawValue.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({
      value,
      label: value,
      description: `${count.toLocaleString()} creators`,
    }));
}

function normalizedLookupValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function ProfileField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="space-y-1 text-xs font-semibold text-muted-foreground">
      <span>{label}</span>
      <Input
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-2xl bg-background text-sm text-foreground"
      />
    </label>
  );
}

function WorkflowSteps({ stage }: { stage: WorkflowStage }) {
  const activeIndex = stage === "form" ? 0 : stage === "exclusives" ? 1 : 2;
  return (
    <div className="flex items-center gap-2 text-xs font-semibold">
      {["Filters", "Team exclusives", "Preview"].map((label, index) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full",
              index <= activeIndex
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {index < activeIndex ? <Check className="h-3.5 w-3.5" /> : index + 1}
          </span>
          <span className={index === activeIndex ? "text-foreground" : "text-muted-foreground"}>
            {label}
          </span>
          {index < 2 ? <span className="h-px w-5 bg-border sm:w-10" /> : null}
        </div>
      ))}
    </div>
  );
}

function PitchingSheetsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(creatorProfilesQuery);
  const { data: rosterData } = useQuery(dashboardSheetQuery);
  const profiles = useMemo(() => data?.profiles ?? [], [data?.profiles]);
  const rosterReady = rosterData?.source === "google-sheet";
  const currentRosterCreators = useMemo(
    () => (rosterReady ? (rosterData?.creators ?? []) : []),
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
  const rosterExclusiveProfiles = useMemo(
    () => profiles.filter((profile) => rosterExclusiveProfileIds.has(profile.creatorId)),
    [profiles, rosterExclusiveProfileIds],
  );

  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>("form");
  const [formValues, setFormValues] = useState<StructuredFormValues>(initialFormValues);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [workflowError, setWorkflowError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [baseProfiles, setBaseProfiles] = useState<CreatorProfile[]>([]);
  const [selectedExclusiveIds, setSelectedExclusiveIds] = useState<Set<string>>(new Set());
  const [previewSelectedIds, setPreviewSelectedIds] = useState<Set<string>>(new Set());
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupSubmitted, setLookupSubmitted] = useState(false);
  const [editing, setEditing] = useState<CreatorProfile | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const countryOptions = useMemo(
    () => rankedOptions(profiles.map((profile) => profile.location)),
    [profiles],
  );
  const nicheOptions = useMemo(
    () => rankedOptions(profiles.flatMap((profile) => profile.nicheTags.split(","))),
    [profiles],
  );
  const genderOptions = useMemo(
    () => [
      { value: "All genders", label: "All genders" },
      ...rankedOptions(profiles.map((profile) => profile.gender)),
    ],
    [profiles],
  );

  const formFields = useMemo<StructuredFormField[]>(
    () => [
      {
        key: "clientName",
        label: "Client Name",
        type: "text",
        required: true,
        placeholder: "Client or brand",
      },
      {
        key: "campaignName",
        label: "Campaign Name",
        type: "text",
        placeholder: "Optional campaign name",
      },
      {
        key: "platforms",
        label: "Platforms",
        type: "multi-select",
        required: true,
        options: platforms.map((platform) => ({ value: platform, label: platform })),
      },
      {
        key: "minimumFollowing",
        label: "Minimum Following",
        type: "number",
        min: 0,
        placeholder: "No minimum",
      },
      {
        key: "maximumFollowing",
        label: "Maximum Following",
        type: "number",
        min: 0,
        placeholder: "No maximum",
        validate: (value, values) => {
          if (value === "" || values.minimumFollowing === "") return undefined;
          return Number(value) < Number(values.minimumFollowing)
            ? "Maximum following must be greater than the minimum."
            : undefined;
        },
      },
      {
        key: "gender",
        label: "Gender",
        type: "select",
        options: genderOptions,
      },
      {
        key: "countries",
        label: "Countries",
        type: "multi-select",
        placeholder: "All countries",
        helperText: "Most common countries appear first.",
        options: countryOptions,
      },
      {
        key: "niches",
        label: "Niches",
        type: "multi-select",
        placeholder: "All niches",
        options: nicheOptions,
      },
    ],
    [countryOptions, genderOptions, nicheOptions],
  );

  const selectedPlatforms = formValues.platforms as Platform[];
  const outputColumns = useMemo<PreviewColumn<PitchRow>[]>(() => {
    const result: PreviewColumn<PitchRow>[] = [
      { key: "creatorName", label: "Creator Name", value: (row) => row.profile.creatorName },
      { key: "location", label: "Location", value: (row) => row.profile.location },
      { key: "niche", label: "Niche", value: (row) => row.profile.nicheTags },
      { key: "mainPlatform", label: "Main Platform", value: (row) => row.profile.mainPlatform },
    ];
    if (selectedPlatforms.includes("TikTok")) {
      result.push(
        {
          key: "ttFollowing",
          label: "TT Following",
          value: (row) => row.profile.ttFollowing,
          align: "right",
        },
        { key: "ttLink", label: "TT Link", value: (row) => row.profile.ttLink },
      );
    }
    if (selectedPlatforms.includes("Instagram")) {
      result.push(
        {
          key: "instaFollowing",
          label: "Insta Following",
          value: (row) => row.profile.instaFollowing,
          align: "right",
        },
        { key: "instaLink", label: "Insta Link", value: (row) => row.profile.instaLink },
      );
    }
    if (selectedPlatforms.includes("YouTube")) {
      result.push(
        {
          key: "ytFollowing",
          label: "YT Following",
          value: (row) => row.profile.ytFollowing,
          align: "right",
        },
        { key: "ytLink", label: "YT Link", value: (row) => row.profile.ytLink },
      );
    }
    result.push(
      { key: "analytics", label: "Analytics", value: (row) => row.profile.analytics },
      { key: "gender", label: "Gender", value: (row) => row.profile.gender },
      {
        key: "interested",
        label: "Interested?",
        value: () => "☐",
        sortable: false,
        align: "center",
      },
      { key: "rate", label: "Rate", value: () => "", sortable: false, align: "center" },
      {
        key: "deliverables",
        label: "Deliverables",
        value: () => "",
        sortable: false,
        align: "center",
      },
      {
        key: "comments",
        label: "Comments",
        value: () => "",
        sortable: false,
        align: "center",
      },
    );
    return result;
  }, [selectedPlatforms]);

  const preparedRows = useMemo<PitchRow[]>(() => {
    const selectedExclusives = rosterExclusiveProfiles.filter((profile) =>
      selectedExclusiveIds.has(profile.creatorId),
    );
    return [...selectedExclusives, ...baseProfiles].map((profile) => ({
      id: profile.creatorId,
      profile,
      isRosterExclusive: rosterExclusiveProfileIds.has(profile.creatorId),
    }));
  }, [baseProfiles, rosterExclusiveProfileIds, rosterExclusiveProfiles, selectedExclusiveIds]);

  const lookupResults = useMemo(() => {
    if (!lookupSubmitted || !lookupQuery.trim()) return [];
    const needle = normalizedLookupValue(lookupQuery);
    return profiles
      .filter((profile) => {
        const values = [profile.creatorName, profile.ttLink, profile.instaLink, profile.ytLink].map(
          normalizedLookupValue,
        );
        return values.some((value) => value === needle || value.includes(needle));
      })
      .slice(0, 8);
  }, [lookupQuery, lookupSubmitted, profiles]);

  const updateFormValue = (key: string, value: StructuredFormValue) => {
    setFormValues((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const prepareBaseProfiles = () => {
    const errors = validateStructuredForm(formFields, formValues);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!rosterReady) {
      setWorkflowError(
        "The current Creators roster is unavailable, so exclusives cannot be reviewed safely.",
      );
      return;
    }

    setPreparing(true);
    setWorkflowError("");
    window.setTimeout(() => {
      const selectedCountries = formValues.countries as string[];
      const selectedNiches = formValues.niches as string[];
      const gender = String(formValues.gender);
      const minimum = formValues.minimumFollowing === "" ? 0 : Number(formValues.minimumFollowing);
      const maximum =
        formValues.maximumFollowing === ""
          ? Number.POSITIVE_INFINITY
          : Number(formValues.maximumFollowing);

      const matches = profiles.filter((profile) => {
        if (!profile.active || rosterExclusiveProfileIds.has(profile.creatorId)) return false;
        if (gender !== "All genders" && profile.gender !== gender) return false;
        if (selectedCountries.length > 0 && !selectedCountries.includes(profile.location))
          return false;
        if (selectedNiches.length > 0) {
          const profileNiches = profile.nicheTags.split(",").map((value) => value.trim());
          if (!selectedNiches.some((niche) => profileNiches.includes(niche))) return false;
        }
        return selectedPlatforms.some(
          (platform) =>
            platformAvailable(profile, platform) &&
            followerValue(profile, platform) >= minimum &&
            followerValue(profile, platform) <= maximum,
        );
      });

      setBaseProfiles(matches);
      setPreparing(false);
      setWorkflowStage("exclusives");
    }, 350);
  };

  const openPreview = () => {
    setPreviewSelectedIds(new Set());
    setWorkflowStage("preview");
  };

  const smartSort = (left: PitchRow, right: PitchRow) => {
    if (left.isRosterExclusive !== right.isRosterExclusive) return left.isRosterExclusive ? -1 : 1;
    const leftFollowing = Math.max(
      ...selectedPlatforms.map((platform) => followerValue(left.profile, platform)),
    );
    const rightFollowing = Math.max(
      ...selectedPlatforms.map((platform) => followerValue(right.profile, platform)),
    );
    return (
      rightFollowing - leftFollowing ||
      left.profile.creatorName.localeCompare(right.profile.creatorName)
    );
  };

  const downloadRows = async (rows: PitchRow[], columns: PreviewColumn<PitchRow>[]) => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Team Billion";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("Creator Shortlist", {
      properties: { tabColor: { argb: "FFFF6B5F" } },
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const widthFor = (label: string) => {
      if (label.includes("Link") || label === "Analytics") return 38;
      if (label === "Creator Name" || label === "Deliverables") return 24;
      if (label === "Niche" || label === "Comments") return 30;
      if (label.includes("Following")) return 15;
      return 17;
    };

    worksheet.columns = columns.map((column, index) => ({
      header: column.label,
      key: `column${index}`,
      width: widthFor(column.label),
    }));
    rows.forEach((row) => worksheet.addRow(columns.map((column) => column.value(row))));
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: columns.length },
    };
    worksheet.sheetProperties.pageSetUpPr = { fitToPage: true };

    const header = worksheet.getRow(1);
    header.height = 34;
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF6B5F" } };
      cell.font = { name: "Aptos", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: "FFE14E43" } } };
    });

    const interestedIndex = columns.findIndex((column) => column.key === "interested") + 1;
    const editableKeys = new Set(["interested", "rate", "deliverables", "comments"]);
    const hyperlinkKeys = new Set(
      columns
        .filter((column) => column.label.includes("Link") || column.key === "analytics")
        .map((column) => column.key),
    );

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.height = 28;
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const column = columns[columnNumber - 1];
        const rawValue = column?.value(rows[rowNumber - 2]);
        cell.font = { name: "Aptos", size: 10, color: { argb: "FF23232A" } };
        cell.alignment = {
          vertical: "middle",
          horizontal:
            column?.align === "center" ? "center" : column?.align === "right" ? "right" : "left",
          wrapText: column?.key === "niche" || column?.key === "comments",
        };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE8E2DC" } } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: editableKeys.has(column?.key)
              ? "FFFFF7D6"
              : rowNumber % 2 === 0
                ? "FFFFFCF9"
                : "FFFFFFFF",
          },
        };
        if (column?.label.includes("Following")) cell.numFmt = "#,##0";
        if (
          hyperlinkKeys.has(column?.key) &&
          typeof rawValue === "string" &&
          /^https?:\/\//.test(rawValue)
        ) {
          cell.value = { text: rawValue, hyperlink: rawValue };
          cell.font = { name: "Aptos", size: 10, color: { argb: "FF2767C6" }, underline: true };
        }
      });
      if (interestedIndex > 0) {
        const interestedCell = row.getCell(interestedIndex);
        interestedCell.value = "☐";
        interestedCell.font = { name: "Segoe UI Symbol", size: 15, color: { argb: "FF334155" } };
        interestedCell.alignment = { horizontal: "center", vertical: "middle" };
        interestedCell.dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: ['"☐,☑"'],
          showErrorMessage: true,
          errorTitle: "Choose a checkbox value",
          error: "Select either unchecked or checked.",
        };
      }
    });

    worksheet.addConditionalFormatting({
      ref: `${worksheet.getColumn(interestedIndex).letter}2:${worksheet.getColumn(interestedIndex).letter}${Math.max(2, rows.length + 1)}`,
      rules: [
        {
          type: "containsText",
          operator: "containsText",
          text: "☑",
          style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } } },
        },
      ],
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filenameParts = [
      String(formValues.clientName),
      String(formValues.campaignName),
      "Pitching Sheet",
    ]
      .map(safeFilename)
      .filter(Boolean);
    link.href = url;
    link.download = `${filenameParts.join(" - ") || "Creator Pitching Sheet"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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

  return (
    <div className="space-y-6">
      <AppHeader
        title="Pitching Sheets"
        subtitle="Build a polished creator shortlist in three guided steps."
      />

      <section className="relative overflow-hidden rounded-[32px] bg-card ring-1 ring-border">
        <div className="grid min-h-[430px] lg:grid-cols-[0.9fr_1.3fr]">
          <div className="relative z-10 flex flex-col justify-center p-7 md:p-10">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="max-w-lg text-3xl font-bold tracking-tight md:text-4xl">
              Turn your creator database into a client-ready shortlist.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              Choose the campaign criteria, review every Team Billion exclusive, then copy or
              download a polished pitching sheet.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                type="button"
                size="lg"
                className="rounded-2xl"
                disabled={isLoading || profiles.length === 0}
                onClick={() => {
                  setWorkflowStage("form");
                  setWorkflowOpen(true);
                }}
              >
                <FileSpreadsheet className="h-4 w-4" /> Start a Pitching Sheet
              </Button>
              {data?.sheetUrl ? (
                <Button asChild type="button" size="lg" variant="outline" className="rounded-2xl">
                  <a href={data.sheetUrl} target="_blank" rel="noreferrer">
                    Open Master <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="relative min-h-[330px] overflow-hidden bg-[#fff9f4] p-6 lg:min-h-full lg:p-9">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,107,95,0.18),transparent_55%)]" />
            <div className="relative h-full overflow-hidden rounded-3xl border border-[#eadfd7] bg-white shadow-xl">
              <div className="flex items-center gap-2 border-b border-[#eadfd7] bg-[#fff1eb] px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                <span className="text-xs font-bold text-[#5e514b]">Client creator shortlist</span>
              </div>
              <div className="pointer-events-none select-none overflow-hidden blur-[2.5px]">
                <table className="min-w-[760px] text-[11px] text-[#6d625d]">
                  <thead className="bg-primary text-white">
                    <tr>
                      {["Creator", "Location", "Niche", "Platform", "Following", "Interested?"].map(
                        (header) => (
                          <th key={header} className="px-4 py-3 text-left font-semibold">
                            {header}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(profiles.length > 0 ? profiles.slice(0, 9) : Array.from({ length: 9 })).map(
                      (profile, index) => (
                        <tr
                          key={profile ? profile.creatorId : index}
                          className="border-b border-[#eee8e3]"
                        >
                          <td className="px-4 py-3 font-semibold">
                            {profile ? profile.creatorName : "Creator profile"}
                          </td>
                          <td className="px-4 py-3">{profile ? profile.location : "Country"}</td>
                          <td className="px-4 py-3">{profile ? profile.nicheTags : "Niche"}</td>
                          <td className="px-4 py-3">
                            {profile ? profile.mainPlatform : "Platform"}
                          </td>
                          <td className="px-4 py-3">
                            {profile ? profile.ttFollowing.toLocaleString() : "100,000"}
                          </td>
                          <td className="px-4 py-3 text-center">☐</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-white/20">
                <div className="rounded-full bg-white/95 px-4 py-2 text-xs font-bold text-primary shadow-lg">
                  Your sheet preview
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {!rosterReady ? (
        <div
          role="alert"
          className="rounded-3xl bg-destructive/10 px-5 py-4 text-sm text-destructive ring-1 ring-destructive/20"
        >
          Current roster reminders are unavailable because the Creators sheet is not connected.
          Generating a pitching sheet is paused so exclusives cannot be missed silently.
        </div>
      ) : currentRosterExclusiveCount > rosterExclusiveProfiles.length ? (
        <div
          role="status"
          className="rounded-3xl bg-amber-50 px-5 py-4 text-sm text-amber-900 ring-1 ring-amber-200"
        >
          {currentRosterExclusiveCount - rosterExclusiveProfiles.length} current roster exclusive
          {currentRosterExclusiveCount - rosterExclusiveProfiles.length === 1
            ? " needs"
            : "s need"}{" "}
          a matching social link in Creator Profiles.
        </div>
      ) : null}

      <section className="rounded-[32px] bg-card p-6 ring-1 ring-border md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Find a specific creator</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste a TikTok, Instagram or YouTube link, or search by creator name to find their
              profile and talent manager.
            </p>
          </div>
          <Button type="button" variant="outline" className="rounded-2xl" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Creator
          </Button>
        </div>
        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            setLookupSubmitted(true);
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={lookupQuery}
              onChange={(event) => {
                setLookupQuery(event.target.value);
                setLookupSubmitted(false);
              }}
              placeholder="Paste a social link or enter a creator name"
              className="h-11 rounded-2xl pl-9"
            />
          </div>
          <Button type="submit" className="h-11 rounded-2xl" disabled={!lookupQuery.trim()}>
            Find Creator
          </Button>
        </form>

        {lookupSubmitted ? (
          lookupResults.length > 0 ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {lookupResults.map((profile) => (
                <div
                  key={profile.creatorId}
                  className="rounded-2xl bg-muted/50 p-4 ring-1 ring-border"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{profile.creatorName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {profile.location || "Location unavailable"} ·{" "}
                        {profile.nicheTags || "No niche tags"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => openEdit(profile)}
                      aria-label={`Edit ${profile.creatorName}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-4 rounded-xl bg-card px-3 py-2 text-sm">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Talent Manager
                    </span>
                    <div className="mt-0.5 font-semibold">
                      {profile.talentManager || "Not recorded"}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      ["TikTok", profile.ttLink],
                      ["Instagram", profile.instaLink],
                      ["YouTube", profile.ytLink],
                    ].map(([label, url]) =>
                      url ? (
                        <a
                          key={label}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-primary ring-1 ring-border hover:underline"
                        >
                          {label} <ExternalLink className="ml-1 inline h-3 w-3" />
                        </a>
                      ) : null,
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
              No creator profile matched that name or social link.
            </div>
          )
        ) : null}
      </section>

      <Dialog
        open={workflowOpen}
        onOpenChange={(open) => {
          setWorkflowOpen(open);
          if (!open) setWorkflowStage("form");
        }}
      >
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden rounded-3xl border-border bg-card p-0 sm:rounded-3xl">
          {workflowStage !== "preview" ? (
            <div className="border-b border-border px-5 py-5 pr-14 md:px-7">
              <WorkflowSteps stage={workflowStage} />
            </div>
          ) : null}

          {workflowStage === "form" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-7">
              <div className="mb-6">
                <h2 className="text-2xl font-bold">Build your pitching criteria</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose what belongs in this client sheet. Your entries stay here if you go back.
                </p>
              </div>
              <ConfigurableStructuredForm
                fields={formFields}
                values={formValues}
                errors={formErrors}
                onChange={updateFormValue}
                onSubmit={prepareBaseProfiles}
                submitting={preparing}
                submitLabel="Generate Preview"
              />
              {workflowError ? (
                <p
                  role="alert"
                  className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {workflowError}
                </p>
              ) : null}
            </div>
          ) : null}

          {workflowStage === "exclusives" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border px-5 py-5 md:px-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold">Please consider our exclusive creators</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Every current Team Billion exclusive is shown here, regardless of your
                      filters. Select the ones you want to add.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
                    {selectedExclusiveIds.size} of {rosterExclusiveProfiles.length} selected
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-background p-5 md:p-7">
                {rosterExclusiveProfiles.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {rosterExclusiveProfiles.map((profile) => {
                      const selected = selectedExclusiveIds.has(profile.creatorId);
                      return (
                        <button
                          key={profile.creatorId}
                          type="button"
                          onClick={() =>
                            setSelectedExclusiveIds((current) => {
                              const next = new Set(current);
                              if (next.has(profile.creatorId)) next.delete(profile.creatorId);
                              else next.add(profile.creatorId);
                              return next;
                            })
                          }
                          aria-pressed={selected}
                          className={cn(
                            "flex items-start gap-3 rounded-2xl p-4 text-left ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "bg-primary/10 ring-primary"
                              : "bg-card ring-border hover:bg-muted/50",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background",
                            )}
                          >
                            {selected ? <Check className="h-3.5 w-3.5" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">
                              {profile.creatorName}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {profile.location || "No location"} ·{" "}
                              {profile.nicheTags || "No niche"}
                            </span>
                            <span className="mt-2 block text-xs font-semibold text-primary">
                              {profile.mainPlatform} ·{" "}
                              {Math.max(
                                profile.ttFollowing,
                                profile.instaFollowing,
                                profile.ytFollowing,
                              ).toLocaleString()}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-3xl bg-card px-6 py-14 text-center ring-1 ring-border">
                    <Users className="mx-auto h-7 w-7 text-muted-foreground" />
                    <div className="mt-3 font-semibold">No roster exclusives could be matched</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add matching social links to Creator Profiles before generating the sheet.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 md:px-7">
                <p className="text-sm text-muted-foreground">
                  {baseProfiles.length.toLocaleString()} filtered database records will also be
                  prepared.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => setWorkflowStage("form")}
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  {rosterExclusiveProfiles.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() =>
                        setSelectedExclusiveIds(
                          new Set(rosterExclusiveProfiles.map((profile) => profile.creatorId)),
                        )
                      }
                    >
                      <CheckSquare className="h-4 w-4" /> Select All Exclusives
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    className="rounded-2xl"
                    disabled={preparedRows.length === 0}
                    onClick={openPreview}
                  >
                    Continue to Preview
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {workflowStage === "preview" ? (
            <PreparedDatasetPreview
              columns={outputColumns}
              rows={preparedRows}
              selectedIds={previewSelectedIds}
              onSelectedIdsChange={setPreviewSelectedIds}
              smartSort={smartSort}
              smartSortLabel="Pin Team Exclusives"
              onCopy={copyRows}
              onDownload={downloadRows}
              onBack={() => setWorkflowStage("exclusives")}
              onDone={() => setWorkflowOpen(false)}
              title="Pitching sheet preview"
            />
          ) : null}
        </DialogContent>
      </Dialog>

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
            {draft.type === "Exclusive" ? (
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
            ) : null}
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
          {saveError ? (
            <p
              role="alert"
              className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {saveError}
            </p>
          ) : null}
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
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? "Saving..." : editing ? "Save Changes" : "Add Creator"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
