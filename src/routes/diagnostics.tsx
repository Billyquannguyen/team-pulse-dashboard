import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import {
  getGoogleSheetsDiagnostics,
  type GoogleSheetsDiagnostics,
} from "@/lib/google-sheets-diagnostics";
import {
  createTestSlackNotification,
  forceRefreshSlackNotifications,
  slackNotificationsQuery,
} from "@/lib/slack-notifications";
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

function MetricBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-muted/45 p-4">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-bold">{value}</div>
    </div>
  );
}

function TabMatchCard({
  title,
  diagnostic,
}: {
  title: string;
  diagnostic: NonNullable<GoogleSheetsDiagnostics["dataFlow"]>["tabs"]["deals"];
}) {
  if (!diagnostic) return null;

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="text-xs text-muted-foreground">
            Member tabs are auto-detected from worksheet headers. System tabs are ignored.
          </p>
        </div>
        <StatusPill ok={diagnostic.matchedMembers.length > 0} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <MetricBox label="Available tabs" value={diagnostic.availableTabs.length} />
        <MetricBox label="Detected members" value={diagnostic.matchedMembers.length} />
        <MetricBox label="Ignored tabs" value={diagnostic.skippedTabs.length} />
      </div>

      <div className="mt-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Detected
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {diagnostic.matchedMembers.length > 0 ? (
              diagnostic.matchedMembers.map((item) => (
                <span
                  key={`${item.memberName}-${item.sheetName}`}
                  className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                >
                  {item.memberName} -&gt; {item.sheetName}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No member tabs matched.</span>
            )}
          </div>
        </div>
      </div>

      {diagnostic.skippedTabs.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Skipped tab</th>
                <th className="px-3 py-2 text-left font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {diagnostic.skippedTabs.slice(0, 20).map((item) => (
                <tr key={`${item.sheetName}-${item.reason}`} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{item.sheetName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TeamAssetsDiagnosticsCard({
  diagnostics,
}: {
  diagnostics: GoogleSheetsDiagnostics["teamAssets"];
}) {
  if (!diagnostics) return null;

  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Team Assets data flow</h3>
          <p className="text-xs text-muted-foreground">
            This checks the Google Sheet used by the Team Assets page.
          </p>
        </div>
        <StatusPill ok={diagnostics.source === "google-sheet"} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricBox label="Source" value={diagnostics.source} />
        <MetricBox label="Configured" value={diagnostics.spreadsheet.configured ? "Yes" : "No"} />
        <MetricBox label="Writable" value={diagnostics.spreadsheet.writable ? "Yes" : "No"} />
        <MetricBox label="Tab found" value={diagnostics.tab.found ? "Yes" : "No"} />
        <MetricBox label="Rows" value={diagnostics.counts.rows} />
        <MetricBox label="Active links" value={diagnostics.counts.assets} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Sheet</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>Env var: {diagnostics.spreadsheet.envVar}</div>
            <div>Readable: {diagnostics.spreadsheet.readable ? "Yes" : "No"}</div>
            <div>Writable: {diagnostics.spreadsheet.writable ? "Yes" : "No"}</div>
            <div>Expected tab: {diagnostics.tab.expectedName}</div>
            <div>Matched tab: {diagnostics.tab.sheetName ?? "-"}</div>
          </div>
        </div>
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Caching check</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>Query stale time: {diagnostics.cache.queryStaleTimeMs}ms</div>
            <div>Query refetch interval: {diagnostics.cache.queryRefetchIntervalMs}ms</div>
            <div>Server cache TTL: {diagnostics.cache.serverCacheTtlMs}ms</div>
            <div>Server cache status: {diagnostics.cache.serverCacheStatus}</div>
            <div>Server cache expires: {diagnostics.cache.serverCacheExpiresAt ?? "-"}</div>
            <div>Google fetch cache: {diagnostics.cache.googleFetchCache}</div>
          </div>
        </div>
      </div>

      {diagnostics.tab.availableTabs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {diagnostics.tab.availableTabs.slice(0, 20).map((tab) => (
            <span
              key={tab}
              className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
            >
              {tab}
            </span>
          ))}
        </div>
      )}

      {diagnostics.fallbackReason && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="mb-1 flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" />
            Team Assets error reason
          </div>
          <p className="break-words text-xs leading-relaxed">{diagnostics.fallbackReason}</p>
        </div>
      )}

      {diagnostics.warnings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
          <div className="mb-2 font-bold">Team Assets warnings</div>
          <ul className="space-y-1 text-xs">
            {diagnostics.warnings.slice(0, 20).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActiveBrandsDiagnosticsCard({
  diagnostics,
}: {
  diagnostics: GoogleSheetsDiagnostics["activeBrands"];
}) {
  if (!diagnostics) return null;

  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Active Brands data flow</h3>
          <p className="text-xs text-muted-foreground">
            This checks the Google Sheet used by the Active Brands page.
          </p>
        </div>
        <StatusPill ok={diagnostics.source === "google-sheet"} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricBox label="Source" value={diagnostics.source} />
        <MetricBox
          label="Env configured"
          value={diagnostics.spreadsheet.configured ? "Yes" : "No"}
        />
        <MetricBox label="Tab found" value={diagnostics.tab.found ? "Yes" : "No"} />
        <MetricBox label="Headers" value={diagnostics.counts.headers} />
        <MetricBox label="Rows" value={diagnostics.counts.rows} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Sheet</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>Env var: {diagnostics.spreadsheet.envVar}</div>
            <div>Readable: {diagnostics.spreadsheet.readable ? "Yes" : "No"}</div>
            <div>Expected tab: {diagnostics.tab.expectedName}</div>
            <div>Matched tab: {diagnostics.tab.sheetName ?? "-"}</div>
          </div>
        </div>
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Caching check</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>Query stale time: {diagnostics.cache.queryStaleTimeMs}ms</div>
            <div>Query refetch interval: {diagnostics.cache.queryRefetchIntervalMs}ms</div>
            <div>Server cache TTL: {diagnostics.cache.serverCacheTtlMs}ms</div>
            <div>Server cache status: {diagnostics.cache.serverCacheStatus}</div>
            <div>Server cache expires: {diagnostics.cache.serverCacheExpiresAt ?? "-"}</div>
            <div>Google fetch cache: {diagnostics.cache.googleFetchCache}</div>
          </div>
        </div>
      </div>

      {diagnostics.tab.availableTabs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {diagnostics.tab.availableTabs.slice(0, 20).map((tab) => (
            <span
              key={tab}
              className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
            >
              {tab}
            </span>
          ))}
        </div>
      )}

      {diagnostics.fallbackReason && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="mb-1 flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" />
            Active Brands error reason
          </div>
          <p className="break-words text-xs leading-relaxed">{diagnostics.fallbackReason}</p>
        </div>
      )}

      {diagnostics.warnings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
          <div className="mb-2 font-bold">Active Brands warnings</div>
          <ul className="space-y-1 text-xs">
            {diagnostics.warnings.slice(0, 20).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotionKnowledgeDiagnosticsCard({
  diagnostics,
}: {
  diagnostics: GoogleSheetsDiagnostics["notion"];
}) {
  if (!diagnostics) return null;

  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Billy GPT Notion knowledge</h3>
          <p className="text-xs text-muted-foreground">
            This checks the private Notion handbook index used by Billy GPT.
          </p>
        </div>
        <StatusPill
          ok={diagnostics.setupReady && diagnostics.isSynced && diagnostics.errors.length === 0}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricBox label="Notion token" value={diagnostics.tokenExists ? "Present" : "Missing"} />
        <MetricBox
          label="Root page ID"
          value={diagnostics.rootPageIdExists ? "Present" : "Missing"}
        />
        <MetricBox label="Root access" value={diagnostics.rootPageAccess} />
        <MetricBox label="Synced" value={diagnostics.isSynced ? "Yes" : "No"} />
        <MetricBox label="Indexed" value={diagnostics.indexed ? "Yes" : "No"} />
        <MetricBox label="Pages indexed" value={diagnostics.pagesIndexed} />
        <MetricBox label="Chunks indexed" value={diagnostics.chunksIndexed} />
        <MetricBox label="Last retrieval" value={diagnostics.lastRetrievalResultCount} />
        <MetricBox
          label="Last sync"
          value={
            diagnostics.lastSyncTime ? new Date(diagnostics.lastSyncTime).toLocaleString() : "-"
          }
        />
      </div>

      <div className="mt-4 rounded-2xl bg-muted/45 p-4 text-sm">
        <div className="font-semibold">Sync status</div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div>Checked: {new Date(diagnostics.checkedAt).toLocaleString()}</div>
          <div>Setup ready: {diagnostics.setupReady ? "Yes" : "No"}</div>
          <div>Token env: {diagnostics.tokenEnvName}</div>
          <div>Last duration: {diagnostics.lastDurationMs ?? "-"}ms</div>
          <div>Recursive subpages: enabled up to the configured nested block depth</div>
          <div>Storage: private server-side index. Page contents are not shown in diagnostics.</div>
          <div>
            Web provider: {diagnostics.web.provider}
            {diagnostics.web.braveConfigured ? " with Brave key" : " public fallback"}
          </div>
        </div>
      </div>

      {(diagnostics.setupIssue || diagnostics.rootPageError) && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="mb-1 flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" />
            Notion setup issue
          </div>
          <p className="break-words text-xs leading-relaxed">
            {diagnostics.setupIssue ?? diagnostics.rootPageError}
          </p>
        </div>
      )}

      {diagnostics.errors.length > 0 && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="mb-2 font-bold">Notion errors</div>
          <ul className="space-y-1 text-xs">
            {diagnostics.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {diagnostics.warnings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
          <div className="mb-2 font-bold">Notion warnings</div>
          <ul className="space-y-1 text-xs">
            {diagnostics.warnings.slice(0, 20).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ContractReviewDiagnosticsCard({
  diagnostics,
}: {
  diagnostics: GoogleSheetsDiagnostics["contractReview"];
}) {
  if (!diagnostics) return null;

  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Billy GPT contract review</h3>
          <p className="text-xs text-muted-foreground">
            This checks PDF upload, extraction, and OpenAI contract review readiness.
          </p>
        </div>
        <StatusPill ok={diagnostics.openAiKeyPresent} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricBox
          label="OpenAI key"
          value={diagnostics.openAiKeyPresent ? "Present" : "Missing"}
        />
        <MetricBox label="Model" value={diagnostics.modelUsed} />
        <MetricBox label="Upload status" value={diagnostics.uploadStatus} />
        <MetricBox label="Extraction" value={diagnostics.extractionStatus} />
        <MetricBox label="Extracted chars" value={diagnostics.lastExtractedChars} />
        <MetricBox label="Sent chars" value={diagnostics.lastSentChars} />
        <MetricBox label="Chunks" value={diagnostics.reviewChunkCount} />
      </div>

      <div className="mt-4 rounded-2xl bg-muted/45 p-4 text-sm">
        <div className="font-semibold">Cost-safe handling</div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div>Temporary files: {diagnostics.temporaryFileHandling}</div>
          <div>Max PDF size: {(diagnostics.maxPdfBytes / 1024 / 1024).toFixed(1)}MB</div>
          <div>Max contract characters sent: {diagnostics.maxContractCharsSent}</div>
          <div>Truncated last review: {diagnostics.truncatedForCostSafety ? "Yes" : "No"}</div>
          <div>OpenAI calls last review: {diagnostics.openAiCallCount}</div>
          <div>
            Sources used last review:{" "}
            {diagnostics.sourcesUsed.length > 0 ? diagnostics.sourcesUsed.join(", ") : "-"}
          </div>
          <div>
            Last review:{" "}
            {diagnostics.lastReviewAt ? new Date(diagnostics.lastReviewAt).toLocaleString() : "-"}
          </div>
          <div>Last file: {diagnostics.lastFileName ?? "-"}</div>
        </div>
      </div>

      {diagnostics.lastError && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="mb-1 flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" />
            Last contract review issue
          </div>
          <p className="break-words text-xs leading-relaxed">{diagnostics.lastError}</p>
        </div>
      )}
    </div>
  );
}

function CreateTestSlackNotificationButton() {
  const [message, setMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const queryClient = useQueryClient();

  const handleCreate = async () => {
    setIsCreating(true);
    setMessage("");

    try {
      const result = await createTestSlackNotification();
      setMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: slackNotificationsQuery.queryKey });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create the test notification.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black">Manual test</div>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Creates a fake dashboard notification without calling Slack.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
          Create Test Slack Notification
        </button>
      </div>
      {message && <p className="mt-3 text-xs font-bold text-muted-foreground">{message}</p>}
    </div>
  );
}

function ForceRefreshSlackNotificationsButton() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setMessage(null);

    try {
      const result = await forceRefreshSlackNotifications();
      setMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: slackNotificationsQuery.queryKey });
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh Slack reminders.");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black">Force refresh</div>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Re-runs Slack sync and rewrites stored Redis reminder names from fresh Slack lookups.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="tb-action inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRefreshing && <Loader2 className="h-4 w-4 animate-spin" />}
          Force Refresh Slack Reminders
        </button>
      </div>
      {message && <p className="mt-3 text-xs font-bold text-muted-foreground">{message}</p>}
    </div>
  );
}

function SlackNotificationsDiagnosticsCard({
  diagnostics,
}: {
  diagnostics: GoogleSheetsDiagnostics["slackNotifications"];
}) {
  if (!diagnostics) return null;

  const ok =
    diagnostics.slackConnected && diagnostics.dmFetchSuccess && diagnostics.redisConfigured;

  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Slack DM follow-ups</h3>
          <p className="text-xs text-muted-foreground">
            This checks the hourly Slack DM reminder system shown in the dashboard bell.
          </p>
        </div>
        <StatusPill ok={ok} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricBox label="Slack connected" value={diagnostics.slackConnected ? "Yes" : "No"} />
        <MetricBox label="Owner user set" value={diagnostics.ownerUserConfigured ? "Yes" : "No"} />
        <MetricBox
          label="Owner matches token"
          value={
            diagnostics.ownerUserMatchesToken === null
              ? "-"
              : diagnostics.ownerUserMatchesToken
                ? "Yes"
                : "No"
          }
        />
        <MetricBox label="DM fetch" value={diagnostics.dmFetchSuccess ? "OK" : "Not checked"} />
        <MetricBox label="Redis" value={diagnostics.redisConfigured ? "Configured" : "Missing"} />
        <MetricBox label="Overdue DMs" value={diagnostics.overdueCount} />
        <MetricBox label="Active reminders" value={diagnostics.activeNotificationCount} />
        <MetricBox label="DMs scanned" value={diagnostics.totalDmChannelsScanned} />
        <MetricBox label="Threshold" value={`${diagnostics.thresholdMinutes} min`} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Live token check</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>auth.test: {diagnostics.authTest.ok ? "OK" : "Failed"}</div>
            <div>User ID: {diagnostics.authTest.userId ?? "-"}</div>
            <div>Team ID: {diagnostics.authTest.teamId ?? "-"}</div>
            <div>Error: {diagnostics.authTest.error ?? "-"}</div>
          </div>
        </div>
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Stored user lookup probe</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>Attempted: {diagnostics.userInfoProbe.attempted ? "Yes" : "No"}</div>
            <div>users.info: {diagnostics.userInfoProbe.ok ? "OK" : "Failed / not run"}</div>
            <div>User ID: {diagnostics.userInfoProbe.userId ?? "-"}</div>
            <div>Stored name: {diagnostics.userInfoProbe.storedPersonName ?? "-"}</div>
            <div>Fresh name: {diagnostics.userInfoProbe.freshPersonName ?? "-"}</div>
            <div>Stored source: {diagnostics.userInfoProbe.storedNameSource ?? "-"}</div>
            <div>Fresh source: {diagnostics.userInfoProbe.freshNameSource ?? "-"}</div>
            <div>Error: {diagnostics.userInfoProbe.error ?? "-"}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Schedule and storage</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>Vercel Cron: hourly via /api/slack-followups</div>
            <div>
              Production threshold locked: {diagnostics.productionThresholdLocked ? "Yes" : "No"}
            </div>
            <div>Redis readable: {diagnostics.redisReadable ? "Yes" : "No"}</div>
            <div>Redis writable: {diagnostics.redisWritable ? "Yes" : "No"}</div>
            <div>
              Last sync:{" "}
              {diagnostics.lastSyncAt ? new Date(diagnostics.lastSyncAt).toLocaleString() : "-"}
            </div>
            <div>
              Last check:{" "}
              {diagnostics.lastCheckAt ? new Date(diagnostics.lastCheckAt).toLocaleString() : "-"}
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Slack scopes detected</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {diagnostics.scopesDetected.length > 0 ? (
              diagnostics.scopesDetected.slice(0, 20).map((scope) => (
                <span
                  key={scope}
                  className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                >
                  {scope}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">
                No scopes detected yet. Run the cron check once.
              </span>
            )}
          </div>
        </div>
      </div>

      <CreateTestSlackNotificationButton />
      <ForceRefreshSlackNotificationsButton />

      {(diagnostics.lastError || diagnostics.lastWarning) && (
        <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
          <div className="mb-2 font-bold">Slack reminder note</div>
          {diagnostics.lastError && (
            <p className="break-words text-xs font-semibold text-destructive">
              {diagnostics.lastError}
            </p>
          )}
          {diagnostics.lastWarning && (
            <p className="break-words text-xs font-semibold">{diagnostics.lastWarning}</p>
          )}
        </div>
      )}
    </div>
  );
}

function BillyAssistantHubDiagnosticsCard({
  diagnostics,
}: {
  diagnostics: GoogleSheetsDiagnostics["billyAssistantHub"];
}) {
  if (!diagnostics) return null;

  const ok =
    diagnostics.storageMode !== "unavailable" &&
    diagnostics.redisReadable &&
    diagnostics.redisWritable;

  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Billy GPT assistant hub</h3>
          <p className="text-xs text-muted-foreground">
            This checks the function-based Billy GPT hub, meeting memory, and future GPT links.
          </p>
        </div>
        <StatusPill ok={ok} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricBox label="Storage mode" value={diagnostics.storageMode} />
        <MetricBox label="Redis configured" value={diagnostics.redisConfigured ? "Yes" : "No"} />
        <MetricBox label="Redis readable" value={diagnostics.redisReadable ? "Yes" : "No"} />
        <MetricBox label="Redis writable" value={diagnostics.redisWritable ? "Yes" : "No"} />
        <MetricBox label="Week key" value={diagnostics.currentWeekKey} />
        <MetricBox label="Topics this week" value={diagnostics.currentWeekTopicCount} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">Meeting topic storage</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>Rollover: {diagnostics.currentWeekStartsAtLabel}</div>
            <div>
              Last save:{" "}
              {diagnostics.lastSaveAt ? new Date(diagnostics.lastSaveAt).toLocaleString() : "-"}
            </div>
            <div>
              Last save status:{" "}
              {diagnostics.lastSaveOk === null ? "-" : diagnostics.lastSaveOk ? "OK" : "Failed"}
            </div>
            <div>Last save error: {diagnostics.lastSaveError ?? "-"}</div>
          </div>
        </div>
        <div className="rounded-2xl bg-muted/45 p-4 text-sm">
          <div className="font-semibold">External GPT links</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>
              {diagnostics.externalGptLinks.contractReview.expectedTitle}:{" "}
              {diagnostics.externalGptLinks.contractReview.configured
                ? `Connected from ${diagnostics.externalGptLinks.contractReview.source}`
                : "Missing from Team Assets"}
            </div>
            <div>
              {diagnostics.externalGptLinks.creatorBrandMatching.expectedTitle}:{" "}
              {diagnostics.externalGptLinks.creatorBrandMatching.configured
                ? `Connected from ${diagnostics.externalGptLinks.creatorBrandMatching.source}`
                : "Missing from Team Assets"}
            </div>
            <div>
              {diagnostics.externalGptLinks.generalFaqs.expectedTitle}:{" "}
              {diagnostics.externalGptLinks.generalFaqs.configured
                ? `Connected from ${diagnostics.externalGptLinks.generalFaqs.source}`
                : "Using built-in Billy GPT link"}
            </div>
          </div>
        </div>
      </div>

      {!diagnostics.redisConfigured && (
        <div className="mt-4 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
          <div className="font-bold">Redis setup note</div>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Local preview can use server memory, but production meeting topics need
            UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
          </p>
        </div>
      )}
    </div>
  );
}

function DiagnosticsContent({ diagnostics }: { diagnostics: GoogleSheetsDiagnostics }) {
  return (
    <div className="space-y-6">
      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Dashboard data flow</h3>
            <p className="text-xs text-muted-foreground">
              This runs the same server-side reader used by the live dashboard.
            </p>
          </div>
          <StatusPill ok={diagnostics.dataFlow?.source === "google-sheet"} />
        </div>

        {diagnostics.dataFlow ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <MetricBox label="Source" value={diagnostics.dataFlow.source} />
              <MetricBox
                label="Fallback active"
                value={diagnostics.dataFlow.fallbackActive ? "Yes" : "No"}
              />
              <MetricBox label="Team members" value={diagnostics.dataFlow.counts.teamMembers} />
              <MetricBox label="Deals" value={diagnostics.dataFlow.counts.deals} />
              <MetricBox label="Creators" value={diagnostics.dataFlow.counts.creators} />
              <MetricBox
                label="Outreach rows"
                value={diagnostics.dataFlow.counts.outreachCreators}
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl bg-muted/45 p-4 text-sm">
                <div className="font-semibold">Runtime</div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>NODE_ENV: {diagnostics.dataFlow.runtime.nodeEnv}</div>
                  <div>VERCEL: {diagnostics.dataFlow.runtime.vercel ? "Yes" : "No"}</div>
                  <div>
                    Production runtime:{" "}
                    {diagnostics.dataFlow.runtime.productionRuntime ? "Yes" : "No"}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl bg-muted/45 p-4 text-sm">
                <div className="font-semibold">Caching check</div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>Query stale time: {diagnostics.dataFlow.cache.queryStaleTimeMs}ms</div>
                  <div>
                    Query refetch interval: {diagnostics.dataFlow.cache.queryRefetchIntervalMs}ms
                  </div>
                  <div>Server cache TTL: {diagnostics.dataFlow.cache.serverCacheTtlMs}ms</div>
                  <div>Server cache status: {diagnostics.dataFlow.cache.serverCacheStatus}</div>
                  <div>
                    Server cache expires: {diagnostics.dataFlow.cache.serverCacheExpiresAt ?? "-"}
                  </div>
                  <div>Google fetch cache: {diagnostics.dataFlow.cache.googleFetchCache}</div>
                  <div>
                    Static rendering likely:{" "}
                    {diagnostics.dataFlow.cache.staticRenderingLikely ? "Yes" : "No"}
                  </div>
                </div>
              </div>
            </div>

            {diagnostics.dataFlow.fallbackReason && (
              <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                <div className="mb-1 flex items-center gap-2 font-bold">
                  <AlertTriangle className="h-4 w-4" />
                  Fallback or error reason
                </div>
                <p className="break-words text-xs leading-relaxed">
                  {diagnostics.dataFlow.fallbackReason}
                </p>
              </div>
            )}

            <div className="mt-4 space-y-4">
              <TabMatchCard
                title="Deal tab matching"
                diagnostic={diagnostics.dataFlow.tabs.deals}
              />
              <TabMatchCard
                title="Outreach tab matching"
                diagnostic={diagnostics.dataFlow.tabs.outreach}
              />

              {diagnostics.dataFlow.tabs.signedCreators && (
                <div className="rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">Signed creators tab</h4>
                      <p className="text-xs text-muted-foreground">
                        This is used for the Signed & Partnered page.
                      </p>
                    </div>
                    <StatusPill ok={diagnostics.dataFlow.tabs.signedCreators.found} />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <MetricBox
                      label="Expected"
                      value={diagnostics.dataFlow.tabs.signedCreators.expectedName}
                    />
                    <MetricBox
                      label="Found"
                      value={diagnostics.dataFlow.tabs.signedCreators.found ? "Yes" : "No"}
                    />
                    <MetricBox
                      label="Matched tab"
                      value={diagnostics.dataFlow.tabs.signedCreators.sheetName ?? "-"}
                    />
                  </div>
                  {diagnostics.dataFlow.tabs.signedCreators.warning && (
                    <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs font-semibold text-destructive">
                      {diagnostics.dataFlow.tabs.signedCreators.warning}
                    </div>
                  )}
                </div>
              )}

              {diagnostics.dataFlow.tabs.warnings.length > 0 && (
                <div className="rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-4 text-sm">
                  <div className="mb-2 font-bold">Tab warnings</div>
                  <ul className="space-y-1 text-xs">
                    {diagnostics.dataFlow.tabs.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-2xl bg-muted/45 p-4 text-sm font-semibold text-muted-foreground">
            Data flow diagnostics unavailable.
          </div>
        )}
      </div>

      <TeamAssetsDiagnosticsCard diagnostics={diagnostics.teamAssets} />

      <ActiveBrandsDiagnosticsCard diagnostics={diagnostics.activeBrands} />

      <NotionKnowledgeDiagnosticsCard diagnostics={diagnostics.notion} />

      <ContractReviewDiagnosticsCard diagnostics={diagnostics.contractReview} />

      <SlackNotificationsDiagnosticsCard diagnostics={diagnostics.slackNotifications} />

      <BillyAssistantHubDiagnosticsCard diagnostics={diagnostics.billyAssistantHub} />

      <div className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Google auth</h3>
            <p className="text-xs text-muted-foreground">
              This checks whether the service account can get a Google access token.
            </p>
          </div>
          <StatusPill ok={diagnostics.auth.ok} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MetricBox label="Attempted" value={diagnostics.auth.attempted ? "Yes" : "No"} />
          <MetricBox label="Succeeded" value={diagnostics.auth.ok ? "Yes" : "No"} />
          <MetricBox label="Used cached token" value={diagnostics.auth.cached ? "Yes" : "No"} />
        </div>
        {diagnostics.auth.error && (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="mb-1 flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" />
              Google auth error
            </div>
            <p className="break-words text-xs leading-relaxed">{diagnostics.auth.error}</p>
          </div>
        )}
      </div>

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
          <div
            key={sheet.envVar}
            className="tb-hover-lift rounded-3xl bg-card p-6 ring-1 ring-border"
          >
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
              <div className="flex items-center justify-between rounded-2xl bg-muted/45 p-3">
                <span className="font-medium text-muted-foreground">Rows returned</span>
                <span className="font-bold">{sheet.totalRows}</span>
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

            {sheet.rowCounts.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Tab</th>
                      <th className="px-3 py-2 text-right font-semibold">Headers</th>
                      <th className="px-3 py-2 text-right font-semibold">Rows</th>
                      <th className="px-3 py-2 text-right font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rowCounts.slice(0, 20).map((tab) => (
                      <tr key={tab.sheetName} className="border-t border-border/60">
                        <td className="px-3 py-2 font-medium">{tab.sheetName}</td>
                        <td className="px-3 py-2 text-right">{tab.headerCount}</td>
                        <td className="px-3 py-2 text-right">{tab.rowCount}</td>
                        <td className="px-3 py-2 text-right">
                          {tab.readable ? "OK" : (tab.error ?? "Error")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
        <AppHeader title="Diagnostics" subtitle="Google Sheets connection checks are admin-only." />
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
