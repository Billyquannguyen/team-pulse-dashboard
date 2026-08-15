import { type FormEvent, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { KeyRound, LockKeyhole, MailCheck, Sparkles, UserPlus } from "lucide-react";
import { BalloonsPopBackground } from "@/components/ui/balloons-pop-background";
import {
  requestDashboardPasswordReset,
  signInToDashboard,
  signUpToDashboard,
  updateDashboardPassword,
  type AuthState,
} from "@/lib/auth";

type AuthMode = "sign-in" | "sign-up" | "reset-password" | "update-password";

export function TeamLoginScreen({
  auth,
  initialMode = "sign-in",
  initialMessage = "",
  initialError = "",
}: {
  auth: AuthState;
  initialMode?: AuthMode;
  initialMessage?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(auth.user?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState(initialMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      if (mode === "reset-password") {
        const result = await requestDashboardPasswordReset({ data: { email } });
        if (!result.ok) setError(result.message);
        else setMessage(result.message);
        return;
      }

      if (mode === "update-password") {
        const result = await updateDashboardPassword({ data: { password } });
        if (!result.ok) setError(result.message);
        else {
          setMessage(result.message);
          setPassword("");
          window.history.replaceState({}, "", "/");
          await router.invalidate();
        }
        return;
      }

      if (mode === "sign-up") {
        const result = await signUpToDashboard({ data: { email, password, displayName } });
        if (!result.ok) setError(result.message);
        else {
          setMessage(result.message);
          setPassword("");
          if (result.signedIn) await router.invalidate();
        }
        return;
      }

      const result = await signInToDashboard({ data: { email, password } });
      if (!result.ok) setError(result.message);
      else {
        setPassword("");
        await router.invalidate();
      }
    } catch {
      setError("Authentication is temporarily unavailable. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword("");
    setError("");
    setMessage("");
  };

  const title =
    mode === "sign-up"
      ? "Create your account"
      : mode === "reset-password"
        ? "Reset your password"
        : mode === "update-password"
          ? "Choose a new password"
          : "Sign in";

  const submitLabel =
    mode === "sign-up"
      ? "Create account"
      : mode === "reset-password"
        ? "Send reset link"
        : mode === "update-password"
          ? "Save new password"
          : "Sign in";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-4 py-10 text-foreground">
      <BalloonsPopBackground />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white via-white/80 to-transparent" />
      <div className="relative z-10 w-full max-w-md">
        <div className="tb-hover-lift rounded-[2rem] border-2 border-foreground bg-white/90 p-6 shadow-[10px_10px_0_rgba(24,24,27,0.9)] backdrop-blur-md sm:p-8">
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

          <div className="mt-8">
            <h2 className="text-xl font-black">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "sign-up"
                ? "Verify your email, then wait for admin approval."
                : mode === "reset-password"
                  ? "We will send a secure recovery link if the account exists."
                  : mode === "update-password"
                    ? "Use at least eight characters."
                    : "Use your approved member account."}
            </p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "sign-up" && (
              <div>
                <label htmlFor="display-name" className="text-sm font-bold">
                  Your name
                </label>
                <input
                  id="display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  required
                  className="tb-search mt-2 h-12 w-full rounded-2xl border-2 border-foreground bg-white px-4 text-base font-semibold outline-none transition focus:shadow-[4px_4px_0_rgba(24,24,27,0.9)] focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}

            {mode !== "update-password" && (
              <div>
                <label htmlFor="member-email" className="text-sm font-bold">
                  Email
                </label>
                <input
                  id="member-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  className="tb-search mt-2 h-12 w-full rounded-2xl border-2 border-foreground bg-white px-4 text-base font-semibold outline-none transition focus:shadow-[4px_4px_0_rgba(24,24,27,0.9)] focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}

            {mode !== "reset-password" && (
              <div>
                <label htmlFor="member-password" className="text-sm font-bold">
                  {mode === "update-password" ? "New password" : "Password"}
                </label>
                <input
                  id="member-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  minLength={mode === "sign-in" ? undefined : 8}
                  required
                  className="tb-search mt-2 h-12 w-full rounded-2xl border-2 border-foreground bg-white px-4 text-base font-semibold outline-none transition focus:shadow-[4px_4px_0_rgba(24,24,27,0.9)] focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}

            {(error || auth.setupIssue) && (
              <div
                role="alert"
                className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
              >
                {error || auth.setupIssue}
              </div>
            )}
            {message && (
              <div
                role="status"
                className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm font-semibold text-foreground"
              >
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={!auth.setupReady || isSubmitting}
              className="tb-action inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground shadow-[5px_5px_0_rgba(24,24,27,0.9)] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50"
            >
              {mode === "sign-up" ? (
                <UserPlus className="h-4 w-4" />
              ) : mode === "reset-password" ? (
                <MailCheck className="h-4 w-4" />
              ) : mode === "update-password" ? (
                <KeyRound className="h-4 w-4" />
              ) : (
                <LockKeyhole className="h-4 w-4" />
              )}
              {isSubmitting ? "Please wait..." : submitLabel}
            </button>
          </form>

          {mode !== "update-password" && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm font-bold">
              {mode !== "sign-in" && (
                <button
                  type="button"
                  onClick={() => changeMode("sign-in")}
                  className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Sign in
                </button>
              )}
              {mode !== "sign-up" && (
                <button
                  type="button"
                  onClick={() => changeMode("sign-up")}
                  className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Create account
                </button>
              )}
              {mode !== "reset-password" && (
                <button
                  type="button"
                  onClick={() => changeMode("reset-password")}
                  className="text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Forgot password?
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
