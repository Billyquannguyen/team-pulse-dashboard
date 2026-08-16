import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { stopAdminMemberPreview } from "@/lib/auth";

const rootRoute = getRouteApi("__root__");

export function AdminPreviewBanner() {
  const auth = rootRoute.useLoaderData();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isExiting, setIsExiting] = useState(false);

  if (!auth.isPreviewing || !auth.previewMember) return null;

  const exitPreview = async () => {
    setIsExiting(true);
    try {
      await stopAdminMemberPreview();
      queryClient.clear();
      await router.invalidate();
    } finally {
      setIsExiting(false);
    }
  };

  return (
    <div
      className="mb-5 flex flex-col gap-3 rounded-3xl border border-primary/20 bg-primary/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-card text-primary ring-1 ring-primary/20">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-primary">
            Admin preview
          </div>
          <div className="truncate text-sm font-black">
            Viewing {auth.previewMember.displayName}'s dashboard
          </div>
          <div className="text-xs text-muted-foreground">
            Preview stays active across every page and is read-only.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={exitPreview}
        disabled={isExiting}
        className="tb-action inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-sm font-bold text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {isExiting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowLeft className="h-4 w-4" />
        )}
        Exit preview
      </button>
    </div>
  );
}
