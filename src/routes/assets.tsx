import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, LinkIcon, Pencil, Plus, Trash2, X } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { AssetCard } from "@/components/assets/AssetCard";
import type { AssetLink } from "@/data/assets";
import { loginToDashboard } from "@/lib/auth";
import {
  addTeamAssetLink,
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

type SimpleCardForm = {
  title: string;
  url: string;
};

type ManageDraft = {
  rowNumber: number;
  title: string;
  url: string;
};

function emptyCardForm(): SimpleCardForm {
  return {
    title: "",
    url: "",
  };
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[\p{L}\p{N}]/gu, (letter) => letter.toUpperCase());
}

function draftFromAsset(asset: AssetLink): ManageDraft | null {
  if (!asset.sourceRowNumber) return null;

  return {
    rowNumber: asset.sourceRowNumber,
    title: asset.title,
    url: asset.url,
  };
}

function AssetsPage() {
  const auth = rootRoute.useLoaderData();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useQuery(teamAssetsQuery);
  const assets = data?.assets ?? [];
  const [adminUnlocked, setAdminUnlocked] = useState(auth.isAdmin);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [cardForm, setCardForm] = useState<SimpleCardForm>(() => emptyCardForm());
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [removingRow, setRemovingRow] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<ManageDraft[]>([]);
  const isAdminReady = auth.isAdmin || adminUnlocked;
  const sourceLabel =
    data?.source === "google-sheet"
      ? "Live Team Assets Sheet"
      : data?.source === "error"
        ? "Google Sheets setup needed"
        : data?.source === "fallback"
          ? "Local fallback links"
          : "Loading Team Assets";
  const setupMessage =
    data?.source === "error"
      ? "Team Assets needs TEAM_ASSETS_SPREADSHEET_ID in Vercel and the Sheet shared with the service account as Editor before cards can be saved."
      : "";

  const editableDrafts = useMemo(
    () => assets.map(draftFromAsset).filter((draft): draft is ManageDraft => draft !== null),
    [assets],
  );

  const refreshAssets = async () => {
    await queryClient.invalidateQueries({ queryKey: teamAssetsQuery.queryKey });
  };

  const requireAdminThen = (action: "add" | "manage") => {
    setFormError("");
    setPasswordError("");

    if (isAdminReady) {
      if (action === "add") {
        setAddOpen(true);
      } else {
        setDrafts(editableDrafts);
        setManageOpen(true);
      }
      return;
    }

    setUnlockOpen(true);
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    setIsUnlocking(true);

    try {
      const result = await loginToDashboard({ data: { password } });

      if (!result.ok) {
        setPasswordError(result.message);
        return;
      }

      if (result.role !== "admin") {
        setPasswordError("That password opens team view only. Enter the admin password to edit.");
        return;
      }

      setPassword("");
      setAdminUnlocked(true);
      setUnlockOpen(false);
      setAddOpen(true);
      await router.invalidate();
    } catch {
      setPasswordError("Admin unlock failed. Try again in a moment.");
    } finally {
      setIsUnlocking(false);
    }
  };

  const closeAdd = () => {
    if (isSaving) return;
    setAddOpen(false);
    setCardForm(emptyCardForm());
    setFormError("");
  };

  const closeManage = () => {
    if (savingRow || removingRow) return;
    setManageOpen(false);
    setFormError("");
  };

  const saveNewCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setIsSaving(true);

    try {
      await addTeamAssetLink({
        data: {
          title: cardForm.title,
          url: cardForm.url,
        },
      });
      setCardForm(emptyCardForm());
      setAddOpen(false);
      await refreshAssets();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save this card.");
    } finally {
      setIsSaving(false);
    }
  };

  const openManageFromAdd = () => {
    setAddOpen(false);
    setDrafts(editableDrafts);
    setManageOpen(true);
  };

  const updateDraft = (rowNumber: number, field: keyof SimpleCardForm, value: string) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.rowNumber === rowNumber ? { ...draft, [field]: value } : draft,
      ),
    );
  };

  const saveDraft = async (draft: ManageDraft) => {
    setFormError("");
    setSavingRow(draft.rowNumber);

    try {
      await updateTeamAssetLink({
        data: {
          rowNumber: draft.rowNumber,
          title: draft.title,
          url: draft.url,
        },
      });
      await refreshAssets();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not update this card.");
    } finally {
      setSavingRow(null);
    }
  };

  const removeDraft = async (draft: ManageDraft) => {
    const confirmed = window.confirm(`Delete ${titleCase(draft.title)} from Team Assets?`);
    if (!confirmed) return;

    setFormError("");
    setRemovingRow(draft.rowNumber);

    try {
      await removeTeamAssetLink({ data: { rowNumber: draft.rowNumber } });
      setDrafts((current) => current.filter((item) => item.rowNumber !== draft.rowNumber));
      await refreshAssets();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not delete this card.");
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
            <button
              type="button"
              onClick={() => requireAdminThen("add")}
              className="tb-action inline-flex items-center gap-1.5 rounded-2xl bg-fun-lime px-4 py-2 text-sm font-semibold text-emerald-950 hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Asset Card
            </button>
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
              {formError || data?.warning || data?.error || setupMessage}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((asset) => (
          <AssetCard key={asset.id} asset={asset} />
        ))}
      </div>

      {assets.length === 0 && data?.source === "error" && (
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-sm font-semibold text-destructive">
          Team Assets could not be loaded from Google Sheets yet. Click Add Asset Card to unlock
          admin editing and see the setup error when saving.
        </div>
      )}

      {unlockOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
            <div className="shrink-0 border-b border-border p-5 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-base font-semibold">Admin unlock</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Enter the admin password to add or manage asset cards.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUnlockOpen(false)}
                  className="tb-action rounded-full p-2 hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <form onSubmit={submitPassword} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
                <input
                  autoFocus
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordError("");
                  }}
                  placeholder="Admin password"
                  disabled={isUnlocking}
                  className="tb-search h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                {passwordError && (
                  <p className="mt-2 text-sm font-semibold text-destructive">{passwordError}</p>
                )}
              </div>

              <div className="grid shrink-0 gap-2 border-t border-border bg-card p-5 sm:grid-cols-2 md:p-6">
                <button
                  type="button"
                  onClick={() => setUnlockOpen(false)}
                  className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-muted px-4 text-sm font-semibold hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUnlocking || password.length === 0}
                  className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUnlocking ? "Checking..." : "Unlock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {addOpen && (
        <AssetModal title="Add Asset Card" onClose={closeAdd}>
          <form onSubmit={saveNewCard} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 md:p-6">
              <TextField
                label="Card name"
                value={cardForm.title}
                onChange={(value) => setCardForm((current) => ({ ...current, title: value }))}
                required
              />
              <TextField
                label="Card link"
                value={cardForm.url}
                onChange={(value) => setCardForm((current) => ({ ...current, url: value }))}
                required
              />
              {setupMessage && (
                <div className="rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-3 text-xs font-semibold">
                  {setupMessage}
                </div>
              )}
              {formError && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                  {formError}
                </div>
              )}
            </div>

            <div className="grid shrink-0 gap-2 border-t border-border bg-card p-5 sm:grid-cols-2 md:p-6">
              <button
                type="submit"
                disabled={isSaving}
                className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save new card"}
              </button>
              <button
                type="button"
                onClick={openManageFromAdd}
                className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-muted px-4 text-sm font-semibold hover:bg-accent"
              >
                Modify/Delete cards
              </button>
            </div>
          </form>
        </AssetModal>
      )}

      {manageOpen && (
        <AssetModal title="Modify/Delete cards" onClose={closeManage} wide>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5 md:p-6">
              {drafts.length > 0 ? (
                drafts.map((draft) => (
                  <div
                    key={draft.rowNumber}
                    className="grid gap-3 rounded-2xl border border-border bg-background p-4 md:grid-cols-[1fr_1fr_auto_auto]"
                  >
                    <TextField
                      label="Card name"
                      value={draft.title}
                      onChange={(value) => updateDraft(draft.rowNumber, "title", value)}
                    />
                    <TextField
                      label="Card link"
                      value={draft.url}
                      onChange={(value) => updateDraft(draft.rowNumber, "url", value)}
                    />
                    <button
                      type="button"
                      disabled={savingRow === draft.rowNumber}
                      onClick={() => saveDraft(draft)}
                      className="tb-action inline-flex h-11 items-center justify-center gap-1.5 self-end rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {savingRow === draft.rowNumber ? "Saving" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={removingRow === draft.rowNumber}
                      onClick={() => removeDraft(draft)}
                      className="tb-action inline-flex h-11 items-center justify-center gap-1.5 self-end rounded-2xl bg-destructive/10 px-4 text-sm font-semibold text-destructive hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {removingRow === draft.rowNumber ? "Deleting" : "Delete"}
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl bg-muted/45 p-6 text-center text-sm font-semibold text-muted-foreground">
                  No editable cards loaded yet.
                </div>
              )}
              {formError && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                  {formError}
                </div>
              )}
            </div>

            <div className="flex shrink-0 justify-end border-t border-border bg-card p-5 md:p-6">
              <button
                type="button"
                onClick={closeManage}
                className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </AssetModal>
      )}
    </div>
  );
}

function AssetModal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border ${
          wide ? "max-w-5xl" : "max-w-2xl"
        }`}
      >
        <div className="shrink-0 border-b border-border p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="text-base font-semibold">{title}</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Changes save to the Team Assets Google Sheet.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="tb-action rounded-full p-2 hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <input
        type="text"
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="tb-search mt-1 h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}
