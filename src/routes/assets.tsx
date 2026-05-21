import { createFileRoute } from "@tanstack/react-router";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ExternalLink, LinkIcon, Pencil, Plus, Trash2, X } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { AssetCard } from "@/components/assets/AssetCard";
import type { AssetColorName, AssetIconName, AssetLink } from "@/data/assets";
import {
  addTeamAssetLink,
  assetColorOptions,
  assetIconOptions,
  removeTeamAssetLink,
  teamAssetsQuery,
  updateTeamAssetLink,
} from "@/lib/team-assets";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/assets")({
  head: () => ({
    meta: [
      { title: "Team Assets — Team Billion" },
      { name: "description", content: "Quick links to team tools." },
    ],
  }),
  component: AssetsPage,
});

type AssetFormState = {
  title: string;
  subtitle: string;
  url: string;
  icon: AssetIconName;
  color: AssetColorName;
  category: string;
  enabled: boolean;
  sortOrder: string;
  rowNumber?: number;
};

function emptyForm(): AssetFormState {
  return {
    title: "",
    subtitle: "",
    url: "",
    icon: "link",
    color: "purple",
    category: "Team",
    enabled: true,
    sortOrder: "100",
  };
}

function formFromAsset(asset: AssetLink): AssetFormState {
  return {
    title: asset.title,
    subtitle: asset.description,
    url: asset.url,
    icon: asset.icon,
    color: asset.color,
    category: asset.category,
    enabled: asset.enabled,
    sortOrder: String(asset.sortOrder),
    rowNumber: asset.sourceRowNumber,
  };
}

function AssetsPage() {
  const auth = rootRoute.useLoaderData();
  const { data } = useQuery(teamAssetsQuery);
  const queryClient = useQueryClient();
  const assets = data?.assets ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [form, setForm] = useState<AssetFormState>(() => emptyForm());
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [removingRow, setRemovingRow] = useState<number | null>(null);
  const sourceLabel =
    data?.source === "google-sheet"
      ? "Live Team Assets Sheet"
      : data?.source === "error"
        ? "Google Sheets connection error"
        : data?.source === "fallback"
          ? "Local fallback links"
          : "Loading Team Assets";
  const canManageAssets = auth.isAdmin && data?.source === "google-sheet";

  const refreshAssets = async () => {
    await queryClient.invalidateQueries({ queryKey: teamAssetsQuery.queryKey });
  };

  const openAdd = () => {
    setFormMode("add");
    setForm(emptyForm());
    setFormError("");
    setFormOpen(true);
  };

  const openEdit = (asset: AssetLink) => {
    if (!asset.sourceRowNumber) {
      setFormError("This link is missing its Google Sheet row number. Refresh and try again.");
      return;
    }
    setFormMode("edit");
    setForm(formFromAsset(asset));
    setFormError("");
    setFormOpen(true);
  };

  const closeForm = () => {
    if (isSaving) return;
    setFormOpen(false);
    setFormError("");
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setIsSaving(true);

    try {
      const payload = {
        title: form.title,
        subtitle: form.subtitle,
        url: form.url,
        icon: form.icon,
        color: form.color,
        category: form.category,
        enabled: form.enabled,
        sortOrder: Number(form.sortOrder) || 0,
      };

      if (formMode === "edit") {
        if (!form.rowNumber) {
          throw new Error("This link is missing its Google Sheet row number.");
        }
        await updateTeamAssetLink({ data: { ...payload, rowNumber: form.rowNumber } });
      } else {
        await addTeamAssetLink({ data: payload });
      }

      setFormOpen(false);
      setForm(emptyForm());
      await refreshAssets();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save this link.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeAsset = async (asset: AssetLink) => {
    if (!asset.sourceRowNumber) {
      setFormError("This link is missing its Google Sheet row number. Refresh and try again.");
      return;
    }

    const confirmed = window.confirm(`Remove ${asset.title} from Team Assets?`);
    if (!confirmed) return;

    setRemovingRow(asset.sourceRowNumber);
    setFormError("");

    try {
      await removeTeamAssetLink({ data: { rowNumber: asset.sourceRowNumber } });
      await refreshAssets();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not remove this link.");
    } finally {
      setRemovingRow(null);
    }
  };

  return (
    <div className="space-y-6">
      <AppHeader title="Team assets 🔗" subtitle="One-tap access to all our tools." />

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="tb-hover-icon flex h-9 w-9 items-center justify-center rounded-xl bg-fun-yellow">
              <LinkIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Team Assets source</div>
              <div className="text-xs text-muted-foreground">
                {sourceLabel} · {assets.length} active links
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageAssets && (
              <button
                type="button"
                onClick={openAdd}
                className="tb-action inline-flex items-center gap-1.5 rounded-2xl bg-fun-lime px-4 py-2 text-sm font-semibold text-emerald-950 hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Add link
              </button>
            )}
            {data?.links.teamAssetsSheetUrl ? (
              <a
                href={data.links.teamAssetsSheetUrl}
                target="_blank"
                rel="noreferrer"
                className="tb-action tb-link-arrow inline-flex items-center gap-1.5 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Open in Sheets <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 rounded-2xl bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground"
              >
                Sheet link unavailable
              </button>
            )}
          </div>
        </div>

        {(data?.warning || data?.error || formError) && (
          <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" />
              Team Assets notice
            </div>
            <p className="break-words text-xs leading-relaxed">
              {formError || data?.warning || data?.error}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((a) => (
          <div key={a.id} className="relative">
            <AssetCard asset={a} />
            {canManageAssets && (
              <div className="absolute bottom-4 right-4 z-20 flex gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(a)}
                  className="tb-action inline-flex h-9 items-center gap-1.5 rounded-full bg-white/90 px-3 text-xs font-bold text-foreground shadow-sm ring-1 ring-border hover:bg-white"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  disabled={removingRow === a.sourceRowNumber}
                  onClick={() => removeAsset(a)}
                  className="tb-action inline-flex h-9 items-center gap-1.5 rounded-full bg-white/90 px-3 text-xs font-bold text-destructive shadow-sm ring-1 ring-border hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {removingRow === a.sourceRowNumber ? "Removing" : "Remove"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {assets.length === 0 && data?.source === "error" && (
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-sm font-semibold text-destructive">
          Team Assets could not be loaded from Google Sheets. Check the diagnostics page for the
          safe server-side status.
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
            <div className="shrink-0 border-b border-border p-5 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-base font-semibold">
                    {formMode === "edit" ? "Edit link" : "Add link"}
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Changes save to the Team Assets Google Sheet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeForm}
                  className="tb-action rounded-full p-2 hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <form onSubmit={submitForm} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 md:p-6">
                <TextField
                  label="Title"
                  value={form.title}
                  onChange={(value) => setForm((current) => ({ ...current, title: value }))}
                  required
                />
                <TextField
                  label="Subtitle / description"
                  value={form.subtitle}
                  onChange={(value) => setForm((current) => ({ ...current, subtitle: value }))}
                />
                <TextField
                  label="URL"
                  value={form.url}
                  onChange={(value) => setForm((current) => ({ ...current, url: value }))}
                  required
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Icon"
                    value={form.icon}
                    options={assetIconOptions}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, icon: value as AssetIconName }))
                    }
                  />
                  <SelectField
                    label="Color"
                    value={form.color}
                    options={assetColorOptions}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, color: value as AssetColorName }))
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Category"
                    value={form.category}
                    onChange={(value) => setForm((current) => ({ ...current, category: value }))}
                  />
                  <TextField
                    label="Sort order"
                    type="number"
                    value={form.sortOrder}
                    onChange={(value) => setForm((current) => ({ ...current, sortOrder: value }))}
                  />
                </div>
                <label className="tb-action flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm font-semibold">
                  Enabled
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, enabled: event.target.checked }))
                    }
                    className="h-5 w-5 accent-primary"
                  />
                </label>
                {formError && (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                    {formError}
                  </div>
                )}
              </div>

              <div className="grid shrink-0 gap-2 border-t border-border bg-card p-5 sm:grid-cols-2 md:p-6">
                <button
                  type="button"
                  onClick={closeForm}
                  className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-muted px-4 text-sm font-semibold hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tb-search mt-1 h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tb-search mt-1 h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/30"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
