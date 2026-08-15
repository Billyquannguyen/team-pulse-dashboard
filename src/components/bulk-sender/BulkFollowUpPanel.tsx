import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bold,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  MailPlus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Underline,
  XCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  deleteFollowUpTemplate,
  fetchFollowUpCandidates,
  fetchFollowUpTemplates,
  fetchGmailFollowUpLabels,
  saveFollowUpTemplate,
  updateAllowedFollowUpLabels,
  type FollowUpCandidate,
  type FollowUpTemplate,
} from "@/lib/bulk-follow-up";
import {
  advanceBulkFollowUpQueue,
  fetchBulkFollowUpAudit,
  getBulkFollowUpJob,
  submitBulkFollowUpJob,
  type BulkFollowUpJob,
} from "@/lib/bulk-follow-up-queue";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;
const MAX_BATCH = 100;
const ACTIVE_JOB_KEY = "team-billion-bulk-follow-up-active-job-v1";

function htmlToText(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li)>/gi, "\n");
  return (container.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function relativeDays(iso: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function exactDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function interactionLabel(level: number) {
  if (level === 1) return "Initial outreach";
  return `Initial outreach and ${level - 1} follow-up${level === 2 ? "" : "s"}`;
}

function pageNumbers(current: number, total: number) {
  const start = Math.max(1, Math.min(current - 2, total - 4));
  const end = Math.min(total, Math.max(5, current + 2));
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="Follow-up results pages"
      className="mx-auto flex w-fit max-w-full items-center gap-5 overflow-x-auto rounded-2xl border border-white/10 bg-foreground px-3 py-2 text-background shadow-sm sm:gap-8 sm:px-4"
    >
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-bold transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </button>
      <div className="flex items-center gap-1" aria-label={`Page ${page} of ${totalPages}`}>
        {pageNumbers(page, totalPages).map((number) => (
          <button
            key={number}
            type="button"
            aria-current={number === page ? "page" : undefined}
            onClick={() => onChange(number)}
            className={cn(
              "flex h-9 min-w-9 items-center justify-center rounded-xl px-2 text-sm font-black transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              number === page && "border border-white/25 bg-white/12",
            )}
          >
            {number}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-bold transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35"
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

function ComposerButton({
  label,
  command,
  value,
  editor,
}: {
  label: string;
  command: string;
  value?: string;
  editor: React.RefObject<HTMLDivElement | null>;
}) {
  const apply = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    editor.current?.focus();
    document.execCommand(command, false, value);
  };
  const Icon =
    command === "bold"
      ? Bold
      : command === "italic"
        ? Italic
        : command === "underline"
          ? Underline
          : command === "insertOrderedList"
            ? ListOrdered
            : List;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={apply}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function BulkFollowUpPanel() {
  const queryClient = useQueryClient();
  const labelsQuery = useQuery({
    queryKey: ["gmail-follow-up-labels"],
    queryFn: () => fetchGmailFollowUpLabels(),
    staleTime: 60_000,
  });
  const templatesQuery = useQuery({
    queryKey: ["bulk-follow-up-templates"],
    queryFn: () => fetchFollowUpTemplates(),
    staleTime: 45_000,
  });
  const auditQuery = useQuery({
    queryKey: ["bulk-follow-up-audit"],
    queryFn: () => fetchBulkFollowUpAudit(),
    enabled: labelsQuery.data?.canManage === true,
    staleTime: 60_000,
  });
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [allowedLabelIds, setAllowedLabelIds] = useState<string[]>([]);
  const [labelSettingsBusy, setLabelSettingsBusy] = useState(false);
  const [labelSettingsMessage, setLabelSettingsMessage] = useState("");
  const [interactionLevel, setInteractionLevel] = useState(1);
  const [minimumDays, setMinimumDays] = useState<3 | 7 | 14 | 30>(3);
  const [candidates, setCandidates] = useState<FollowUpCandidate[]>([]);
  const [hasMoreCandidates, setHasMoreCandidates] = useState(false);
  const [selectedThreads, setSelectedThreads] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [job, setJob] = useState<BulkFollowUpJob | null>(null);
  const [jobError, setJobError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);

  const driveQueue = useCallback(async (jobId: string) => {
    while (true) {
      const result = await advanceBulkFollowUpQueue({ data: { jobId } });
      setJob(result.job);
      if (["completed", "partial", "failed"].includes(result.job.status)) {
        window.localStorage.removeItem(ACTIVE_JOB_KEY);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
  }, []);

  useEffect(() => {
    if (!labelsQuery.data) return;
    setAllowedLabelIds(labelsQuery.data.allowedLabelIds);
  }, [labelsQuery.data]);

  useEffect(() => {
    const jobId = window.localStorage.getItem(ACTIVE_JOB_KEY);
    if (!jobId) return;
    void getBulkFollowUpJob({ data: { jobId } })
      .then(({ job: restored }) => {
        setJob(restored);
        if (!["completed", "partial", "failed"].includes(restored.status)) void driveQueue(jobId);
        else window.localStorage.removeItem(ACTIVE_JOB_KEY);
      })
      .catch(() => window.localStorage.removeItem(ACTIVE_JOB_KEY));
  }, [driveQueue]);

  const oldestBatch = candidates.slice(0, MAX_BATCH);
  const selectedCandidates = oldestBatch.filter((candidate) =>
    selectedThreads.has(candidate.threadId),
  );
  const totalPages = Math.max(1, Math.ceil(oldestBatch.length / PAGE_SIZE));
  const visibleCandidates = oldestBatch.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const progress = job?.total ? (job.processed / job.total) * 100 : 0;

  const selectedLabels = useMemo(() => new Set(selectedLabelIds), [selectedLabelIds]);
  const toggleLabel = (id: string) =>
    setSelectedLabelIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  const toggleThread = (id: string) =>
    setSelectedThreads((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const scan = async () => {
    setScanning(true);
    setScanError("");
    setJob(null);
    try {
      const result = await fetchFollowUpCandidates({
        data: {
          labelIds: selectedLabelIds,
          interactionLevel,
          minimumDaysSinceLastSent: minimumDays,
        },
      });
      setCandidates(result.candidates);
      setHasMoreCandidates(result.hasMore);
      setSelectedThreads(new Set(result.candidates.map((candidate) => candidate.threadId)));
      setPage(1);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Gmail threads could not be filtered.");
    } finally {
      setScanning(false);
    }
  };

  const loadTemplate = (template: FollowUpTemplate | null) => {
    setTemplateId(template?.id ?? "");
    setTemplateName(template?.name ?? "");
    setBodyHtml(template?.htmlBody ?? "");
    if (editorRef.current) editorRef.current.innerHTML = template?.htmlBody ?? "";
    setTemplateMessage("");
  };

  const saveTemplate = async () => {
    setTemplateBusy(true);
    setTemplateMessage("");
    try {
      const result = await saveFollowUpTemplate({
        data: {
          id: templateId || undefined,
          name: templateName,
          htmlBody: bodyHtml,
          textBody: htmlToText(bodyHtml),
        },
      });
      setTemplateId(result.template.id);
      setTemplateMessage("Template saved for the team.");
      await queryClient.invalidateQueries({ queryKey: ["bulk-follow-up-templates"] });
    } catch (error) {
      setTemplateMessage(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setTemplateBusy(false);
    }
  };

  const removeTemplate = async (template: FollowUpTemplate) => {
    if (!window.confirm(`Delete “${template.name}” for everyone?`)) return;
    setTemplateBusy(true);
    try {
      await deleteFollowUpTemplate({ data: { id: template.id } });
      if (template.id === templateId) loadTemplate(null);
      await queryClient.invalidateQueries({ queryKey: ["bulk-follow-up-templates"] });
    } finally {
      setTemplateBusy(false);
    }
  };

  const saveAllowedLabels = async () => {
    setLabelSettingsBusy(true);
    setLabelSettingsMessage("");
    try {
      await updateAllowedFollowUpLabels({ data: { labelIds: allowedLabelIds } });
      setLabelSettingsMessage("Allowed Gmail labels updated for the team.");
      await queryClient.invalidateQueries({ queryKey: ["gmail-follow-up-labels"] });
    } catch (error) {
      setLabelSettingsMessage(
        error instanceof Error ? error.message : "Labels could not be saved.",
      );
    } finally {
      setLabelSettingsBusy(false);
    }
  };

  const createDrafts = async () => {
    setConfirmOpen(false);
    setJobError("");
    try {
      const textBody = htmlToText(bodyHtml);
      const result = await submitBulkFollowUpJob({
        data: {
          candidates: selectedCandidates,
          filter: {
            labelIds: selectedLabelIds,
            interactionLevel,
            minimumDaysSinceLastSent: minimumDays,
          },
          htmlBody: bodyHtml,
          textBody,
        },
      });
      setJob(result.job);
      window.localStorage.setItem(ACTIVE_JOB_KEY, result.job.id);
      await driveQueue(result.job.id);
    } catch (error) {
      setJobError(
        error instanceof Error ? error.message : "The follow-up drafts could not be queued.",
      );
    }
  };

  const insertLink = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const url = window.prompt("Paste the link URL");
    if (!url) return;
    const normalized = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    try {
      const parsed = new URL(normalized);
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) throw new Error();
      editorRef.current?.focus();
      document.execCommand("createLink", false, parsed.toString());
    } catch {
      setTemplateMessage("Use a valid https:// or mailto: link.");
    }
  };

  const pastePlainText = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-black">Find unanswered outreach</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Labels match any selection. Only outbound-first threads with no received message
              qualify.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,0.7fr)_minmax(190px,0.55fr)_auto] lg:items-end">
          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">
              Gmail labels · match any
            </div>
            <div className="max-h-36 overflow-auto rounded-2xl border bg-background p-2">
              {labelsQuery.isLoading ? (
                <div className="p-3 text-sm font-bold text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading labels...
                </div>
              ) : (
                labelsQuery.data?.labels.map((label) => (
                  <label
                    key={label.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={selectedLabels.has(label.id)}
                      onChange={() => toggleLabel(label.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span>{label.name}</span>
                  </label>
                ))
              )}
            </div>
            {labelsQuery.data?.canManage && (
              <div className="mt-3 rounded-2xl border border-dashed p-3">
                <div className="text-xs font-black uppercase tracking-wide text-muted-foreground">
                  Admin allowed labels
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {labelsQuery.data.labels.map((label) => (
                    <label
                      key={`allowed-${label.id}`}
                      className="flex items-center gap-2 text-xs font-bold"
                    >
                      <input
                        type="checkbox"
                        checked={allowedLabelIds.includes(label.id)}
                        onChange={() =>
                          setAllowedLabelIds((current) =>
                            current.includes(label.id)
                              ? current.filter((id) => id !== label.id)
                              : [...current, label.id],
                          )
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      {label.name}
                    </label>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={labelSettingsBusy}
                  onClick={() => void saveAllowedLabels()}
                  className="mt-3"
                >
                  Save allowed labels
                </Button>
                {labelSettingsMessage && (
                  <p className="mt-2 text-xs font-bold">{labelSettingsMessage}</p>
                )}
              </div>
            )}
          </div>
          <label>
            <span className="mb-2 block text-xs font-black uppercase tracking-wide text-muted-foreground">
              Level of interaction
            </span>
            <select
              value={interactionLevel}
              onChange={(event) => setInteractionLevel(Number(event.target.value))}
              className="h-12 w-full rounded-2xl border bg-background px-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {[1, 2, 3, 4, 5].map((level) => (
                <option key={level} value={level}>
                  {interactionLabel(level)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-xs font-black uppercase tracking-wide text-muted-foreground">
              Last sent email
            </span>
            <select
              value={minimumDays}
              onChange={(event) => setMinimumDays(Number(event.target.value) as 3 | 7 | 14 | 30)}
              className="h-12 w-full rounded-2xl border bg-background px-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {[3, 7, 14, 30].map((days) => (
                <option key={days} value={days}>
                  At least {days} days ago
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            disabled={scanning || selectedLabelIds.length === 0}
            onClick={() => void scan()}
            className="h-12 rounded-2xl px-5"
          >
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Filter threads
          </Button>
        </div>
        {(scanError || labelsQuery.error) && (
          <div
            role="alert"
            className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive"
          >
            {scanError ||
              (labelsQuery.error instanceof Error
                ? labelsQuery.error.message
                : "Labels could not be loaded.")}
          </div>
        )}
      </section>

      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-black">Review matching threads</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {candidates.length
                ? `Showing the oldest ${oldestBatch.length} matching threads${hasMoreCandidates ? ". More matches exist." : "."}`
                : "Run the filters to review eligible recipients."}
            </p>
          </div>
          {oldestBatch.length > 0 && (
            <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-black text-primary">
              {selectedCandidates.length} selected
            </span>
          )}
        </div>
        {oldestBatch.length > 0 && (
          <>
            <div className="mt-5 max-h-[610px] overflow-auto rounded-2xl border">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="w-14 px-4 py-3">
                      <input
                        aria-label="Select all visible oldest threads"
                        type="checkbox"
                        checked={
                          selectedCandidates.length === oldestBatch.length && oldestBatch.length > 0
                        }
                        onChange={(event) =>
                          setSelectedThreads(
                            event.target.checked
                              ? new Set(oldestBatch.map((candidate) => candidate.threadId))
                              : new Set(),
                          )
                        }
                        className="h-4 w-4 accent-primary"
                      />
                    </th>
                    <th className="px-4 py-3 font-black">Recipient</th>
                    <th className="px-4 py-3 font-black">Thread</th>
                    <th className="px-4 py-3 font-black">Last sent email</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleCandidates.map((candidate) => (
                    <tr key={candidate.threadId} className="hover:bg-muted/35">
                      <td className="px-4 py-3">
                        <input
                          aria-label={`Select ${candidate.recipientEmail}`}
                          type="checkbox"
                          checked={selectedThreads.has(candidate.threadId)}
                          onChange={() => toggleThread(candidate.threadId)}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-black">
                          {candidate.recipientName || "Unknown name"}
                        </div>
                        <div className="mt-0.5 text-xs font-semibold text-muted-foreground">
                          {candidate.recipientEmail}
                        </div>
                      </td>
                      <td className="max-w-sm px-4 py-3">
                        <div className="truncate font-bold" title={candidate.subject}>
                          {candidate.subject}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {interactionLabel(candidate.interactionLevel)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-black">{relativeDays(candidate.lastSentAt)}</div>
                        <div className="mt-0.5 text-xs font-semibold text-muted-foreground">
                          {exactDate(candidate.lastSentAt)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5">
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          </>
        )}
      </section>

      <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-black">Follow-up template</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Templates are shared with the team. Add any sign-off you want directly in the
              template. No signature or image is added automatically.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => loadTemplate(null)}>
            New template
          </Button>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="max-h-[360px] space-y-2 overflow-auto rounded-2xl border bg-background p-2">
            {templatesQuery.isLoading ? (
              <div className="p-3 text-sm font-bold text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading templates...
              </div>
            ) : templatesQuery.data?.length ? (
              templatesQuery.data.map((template) => (
                <div
                  key={template.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-xl p-2",
                    template.id === templateId ? "bg-primary/10" : "hover:bg-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => loadTemplate(template)}
                    className="min-w-0 flex-1 rounded-lg px-2 py-1 text-left font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block truncate">{template.name}</span>
                  </button>
                  {labelsQuery.data?.canManage && (
                    <button
                      type="button"
                      aria-label={`Delete ${template.name}`}
                      onClick={() => void removeTemplate(template)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive focus:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="p-4 text-sm font-semibold text-muted-foreground">
                No saved templates yet.
              </div>
            )}
          </div>
          <div className="space-y-4">
            <label>
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-muted-foreground">
                Template name
              </span>
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="First follow-up"
                className="h-12 w-full rounded-2xl border bg-background px-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div>
              <div className="mb-1.5 text-xs font-black uppercase tracking-wide text-muted-foreground">
                Message
              </div>
              <div className="overflow-hidden rounded-2xl border bg-background focus-within:ring-2 focus-within:ring-ring">
                <div className="flex items-center gap-1 border-b bg-muted/60 p-2">
                  <ComposerButton label="Bold" command="bold" editor={editorRef} />
                  <ComposerButton label="Italic" command="italic" editor={editorRef} />
                  <ComposerButton label="Underline" command="underline" editor={editorRef} />
                  <ComposerButton
                    label="Bulleted list"
                    command="insertUnorderedList"
                    editor={editorRef}
                  />
                  <ComposerButton
                    label="Numbered list"
                    command="insertOrderedList"
                    editor={editorRef}
                  />
                  <button
                    type="button"
                    aria-label="Insert link"
                    title="Insert link"
                    onMouseDown={insertLink}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <LinkIcon className="h-4 w-4" />
                  </button>
                </div>
                <div
                  ref={editorRef}
                  role="textbox"
                  aria-label="Follow-up message"
                  aria-multiline="true"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(event) => setBodyHtml(event.currentTarget.innerHTML)}
                  onPaste={pastePlainText}
                  className="min-h-48 px-5 py-4 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-muted-foreground">
                No subject or personalization fields are needed because Gmail attaches this as a
                reply.
              </p>
              <Button
                type="button"
                disabled={templateBusy || !templateName.trim() || !htmlToText(bodyHtml)}
                onClick={() => void saveTemplate()}
              >
                <Save className="h-4 w-4" />
                {templateBusy ? "Saving..." : "Save template"}
              </Button>
            </div>
            {templateMessage && (
              <p role="status" className="text-sm font-bold text-muted-foreground">
                {templateMessage}
              </p>
            )}
          </div>
        </div>
      </section>

      {(job || jobError) && (
        <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
          <div className="flex items-start gap-3">
            {job && !["completed", "partial", "failed"].includes(job.status) ? (
              <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-primary" />
            ) : job?.status === "completed" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-bold">{jobError || job?.message}</div>
              {job && (
                <>
                  <Progress value={progress} className="mt-3 h-2" />
                  <div className="mt-2 text-xs text-muted-foreground">
                    {job.processed} of {job.total} processed
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {labelsQuery.data?.canManage && auditQuery.data?.length ? (
        <section className="rounded-3xl bg-card p-5 shadow-sm ring-1 ring-border">
          <h2 className="font-black">Recent Follow-up audit</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The latest completed jobs are retained for 30 days.
          </p>
          <div className="mt-4 max-h-64 overflow-auto rounded-2xl border">
            {auditQuery.data.slice(0, 10).map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm last:border-b-0"
              >
                <span className="font-bold">{new Date(entry.finishedAt).toLocaleString()}</span>
                <span className="text-muted-foreground">
                  {entry.created} created · {entry.skipped} skipped · {entry.failed} failed
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="sticky bottom-4 z-30 rounded-3xl bg-foreground p-4 text-background shadow-xl ring-1 ring-border/30 lg:mr-40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-black">
              {selectedCandidates.length} follow-up draft
              {selectedCandidates.length === 1 ? "" : "s"} selected
            </div>
            <div className="mt-0.5 text-xs text-background/65">
              Nothing is sent automatically. Review every Gmail draft before sending.
            </div>
          </div>
          <Button
            type="button"
            disabled={
              selectedCandidates.length === 0 ||
              !htmlToText(bodyHtml) ||
              Boolean(job && !["completed", "partial", "failed"].includes(job.status))
            }
            onClick={() => setConfirmOpen(true)}
            className="min-w-52 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <MailPlus className="h-4 w-4" />
            Create {selectedCandidates.length} drafts
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Review before creating follow-up drafts</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Check the selected recipients, interaction level, and last-sent dates before
                continuing.
              </span>
              <span className="block rounded-2xl bg-warning/20 p-3 font-medium text-foreground">
                This creates {selectedCandidates.length} replies as Gmail drafts in the original
                threads. Nothing will be sent automatically.
              </span>
              <span className="block">Read through every draft in Gmail before sending it.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction onClick={() => void createDrafts()}>Create drafts</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
