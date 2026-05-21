import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import {
  getGoogleSheetsDiagnostics,
  type GoogleSheetsDiagnostics,
} from "@/lib/google-sheets-diagnostics";
import { cn } from "@/lib/utils";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/diagnostics")({
  head: () => ({
    meta: [
      { title: "Diagnostics — Team Billion" },
      { name: "description", content: "Admin-only Google Sheets diagnostics." },
    ],
  }),
  loader: async () => getGoogleSheetsDiagnostics(),
  component: DiagnosticsPage,
});

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold",
        ok ? "bg-fun-lime text-emerald-950" : "bg-destructive/10 text-destructive",
      )}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {ok ? "OK" : "Needs attention"}
    </span>
  );
}

function DiagnosticsContent({ diagnostics }: { diagnostics: GoogleSheetsDiagnostics }) {
  return (
    <div className="space-y-6">
      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Environment variables</h3>
            <p className="text-xs text-muted-foreground">
              Values are hidden. This only checks whether each variable exists.
            </p>
          </div>
          <div className="text-xs font-semibold text-muted-foreground">
            Checked {new Date(diagnostics.checkedAt).toLocaleString()}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {diagnostics.env.map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between gap-3 rounded-2xl bg-muted/45 p-4"
            >
              <span className="text-sm font-semibold">{item.name}</span>
              <StatusPill ok={item.exists} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {diagnostics.spreadsheets.map((sheet) => (
          <div key={sheet.envVar} className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{sheet.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{sheet.envVar}</p>
              </div>
              <StatusPill ok={sheet.configured && sheet.readable} />
            </div>

            <div className="mt-5 grid gap-3 text-sm">
              <div className="flex items-center justify-between rounded-2xl bg-muted/45 p-3">
                <span className="font-medium text-muted-foreground">Configured</span>
                <span className="font-bold">{sheet.configured ? "Yes" : "No"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/45 p-3">
                <span className="font-medium text-muted-foreground">Readable</span>
                <span className="font-bold">{sheet.readable ? "Yes" : "No"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/45 p-3">
                <span className="font-medium text-muted-foreground">Visible tabs</span>
                <span className="font-bold">{sheet.tabCount}</span>
              </div>
            </div>

            {sheet.tabs.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {sheet.tabs.map((tab) => (
                  <span
                    key={tab}
                    className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                  >
                    {tab}
                  </span>
                ))}
              </div>
            )}

            {sheet.error && (
              <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                <div className="mb-1 flex items-center gap-2 font-bold">
                  <AlertTriangle className="h-4 w-4" />
                  Google Sheets API error
                </div>
                <p className="break-words text-xs leading-relaxed">{sheet.error}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosticsPage() {
  const auth = rootRoute.useLoaderData();
  const diagnostics = Route.useLoaderData();

  if (!auth.isAdmin) {
    return (
      <div className="space-y-6">
        <AppHeader
          title="Diagnostics"
          subtitle="Google Sheets connection checks are admin-only."
        />
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-sm font-semibold text-destructive">
          Log in with the admin password to view diagnostics.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AppHeader
        title="Diagnostics"
        subtitle="Safe server-side checks for Google Sheets and Vercel env vars."
      />
      <DiagnosticsContent diagnostics={diagnostics} />
    </div>
  );
}
