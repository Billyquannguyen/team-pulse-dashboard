import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Clock3, LogOut, RefreshCw, ShieldX, Sparkles } from "lucide-react";
import { BalloonsPopBackground } from "@/components/ui/balloons-pop-background";
import { logoutFromDashboard, type AuthState } from "@/lib/auth";

export function MemberAccessScreen({ auth }: { auth: AuthState }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const blocked = auth.accessStatus === "rejected" || auth.accessStatus === "disabled";

  const refresh = async () => {
    setBusy(true);
    await router.invalidate();
    setBusy(false);
  };

  const logout = async () => {
    setBusy(true);
    await logoutFromDashboard();
    await router.invalidate();
    setBusy(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-4 py-10 text-foreground">
      <BalloonsPopBackground />
      <div className="relative z-10 w-full max-w-lg rounded-[2rem] border-2 border-foreground bg-white/92 p-7 text-center shadow-[10px_10px_0_rgba(24,24,27,0.9)] backdrop-blur-md sm:p-9">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          {blocked ? <ShieldX className="h-7 w-7" /> : <Clock3 className="h-7 w-7" />}
        </div>
        <div className="mt-5 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="h-4 w-4" /> Team Billion
        </div>
        <h1 className="mt-3 text-2xl font-black">
          {auth.accessStatus === "disabled"
            ? "Account disabled"
            : auth.accessStatus === "rejected"
              ? "Access request declined"
              : "Waiting for approval"}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {blocked
            ? "Contact the dashboard administrator if you believe this should be changed."
            : "Your email is verified. An administrator must approve your membership before the dashboard opens."}
        </p>
        <div className="mt-5 rounded-2xl bg-muted px-4 py-3 text-sm font-bold">
          {auth.user?.email}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {!blocked && (
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              className="tb-action inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-50"
            >
              <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Check approval
            </button>
          )}
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            className="tb-action inline-flex h-11 items-center justify-center gap-2 rounded-2xl border-2 border-foreground bg-white px-5 text-sm font-black focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}
