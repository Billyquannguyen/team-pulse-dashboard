import { FormEvent, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { LockKeyhole, Sparkles } from "lucide-react";
import { BalloonsPopBackground } from "@/components/ui/balloons-pop-background";
import { loginToDashboard, type AuthState } from "@/lib/auth";

export function TeamLoginScreen({ auth }: { auth: AuthState }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const result = await loginToDashboard({ data: { password } });
      setPassword("");

      if (!result.ok) {
        setError(result.message);
        return;
      }

      await router.invalidate();
    } catch {
      setError("Login failed. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-4 py-10 text-foreground">
      <BalloonsPopBackground />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white via-white/80 to-transparent" />
      <div className="relative z-10 w-full max-w-md">
        <div className="tb-hover-lift rounded-[2rem] border-2 border-foreground bg-white/88 p-6 shadow-[10px_10px_0_rgba(24,24,27,0.9)] backdrop-blur-md sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-muted-foreground">
                Private HQ
              </p>
              <h1 className="text-3xl font-black tracking-tight">Team Billion</h1>
            </div>
          </div>

          <form onSubmit={submitLogin} className="mt-8 space-y-4">
            <div>
              <label htmlFor="team-password" className="text-sm font-bold">
                Enter team or admin password
              </label>
              <input
                id="team-password"
                autoFocus
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                autoComplete="current-password"
                disabled={!auth.setupReady || isSubmitting}
                className="tb-search mt-2 h-12 w-full rounded-2xl border-2 border-foreground bg-white px-4 text-base font-semibold outline-none transition focus:shadow-[4px_4px_0_rgba(24,24,27,0.9)] focus:ring-2 focus:ring-primary/30"
                placeholder="Password"
              />
            </div>

            {(error || auth.setupIssue) && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
                {error || auth.setupIssue}
              </div>
            )}

            <button
              type="submit"
              disabled={!auth.setupReady || isSubmitting || password.length === 0}
              className="tb-action inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground shadow-[5px_5px_0_rgba(24,24,27,0.9)] transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
            >
              <LockKeyhole className="h-4 w-4" />
              {isSubmitting ? "Checking..." : "Unlock dashboard"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs font-semibold text-muted-foreground">
            Team password gives normal access. Admin password unlocks goal editing.
          </p>
        </div>
      </div>
    </div>
  );
}
