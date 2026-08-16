import { createFileRoute } from "@tanstack/react-router";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckCircle2,
  ChevronDown,
  Eraser,
  Image,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  Mail,
  Maximize2,
  Minimize2,
  Plus,
  Redo2,
  Rows3,
  Send,
  Trash2,
  Underline,
  Undo2,
  XCircle,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import { AppHeader } from "@/components/layout/AppHeader";
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
import { advanceBulkSenderQueue, submitBulkSenderJob, type BulkSenderJob } from "@/lib/bulk-sender";
import { cn } from "@/lib/utils";
import { BulkFollowUpPanel } from "@/components/bulk-sender/BulkFollowUpPanel";

export const Route = createFileRoute("/bulk-sender")({
  head: () => ({
    meta: [
      { title: "Bulk Sender - Team Billion" },
      {
        name: "description",
        content: "Create personalized Gmail drafts from a flexible spreadsheet-style workspace.",
      },
    ],
  }),
  component: BulkSenderPage,
});

type Column = {
  id: string;
  label: string;
  key: string;
  type: "text" | "email";
};

type RowStatus = "ready" | "created" | "skipped" | "failed";

type SenderRow = {
  id: string;
  values: Record<string, string>;
  status?: RowStatus;
  statusMessage?: string;
};

type SavedWorkspace = {
  columns?: Column[];
  rows?: SenderRow[];
  subject?: string;
  bodyHtml?: string;
  activeJobId?: string;
};

const STORAGE_KEY = "team-billion-bulk-sender-workspace-v1";
const MAX_DRAFTS_PER_RUN = 100;
const MIN_VISIBLE_ROWS = 8;

const DEFAULT_COLUMNS: Column[] = [
  { id: "recipient-name", label: "Recipient Name", key: "recipient_name", type: "text" },
  { id: "email", label: "Email", key: "email", type: "email" },
  { id: "niche", label: "Niche", key: "niche", type: "text" },
];

const DEFAULT_SUBJECT = "A creator partnership for {{niche}}";
const DEFAULT_BODY =
  "Hi {{recipient_name}},<div><br></div><div>I’m reaching out from Team Billion about a potential creator partnership in {{niche}}.</div><div><br></div><div>Would you be open to hearing more?</div>";

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function makeEmptyRow(): SenderRow {
  return { id: newId("row"), values: {} };
}

function starterRows() {
  return Array.from({ length: MIN_VISIBLE_ROWS }, makeEmptyRow);
}

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

function uniqueKey(label: string, columns: Column[], currentId?: string) {
  const base = slugify(label);
  const used = new Set(
    columns.filter((column) => column.id !== currentId).map((column) => column.key),
  );
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function isRowEmpty(row: SenderRow) {
  return Object.values(row.values).every((value) => !value?.trim());
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fillTemplate(template: string, row: SenderRow, columns: Column[], htmlValues = false) {
  return columns.reduce((result, column) => {
    const value = row.values[column.id] ?? "";
    const replacement = htmlValues ? escapeHtml(value) : value;
    return result.replace(
      new RegExp(`{{\\s*${column.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*}}`, "gi"),
      replacement,
    );
  }, template);
}

function htmlToText(html: string) {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ");
  const container = document.createElement("div");
  container.innerHTML = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li)>/gi, "\n");
  return (container.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function parsePastedGrid(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .map((line) => line.split("\t"));
}

function ToolbarButton({
  label,
  active,
  onMouseDown,
  children,
}: {
  label: string;
  active?: boolean;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={onMouseDown}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function BulkSenderPage() {
  const [activeTool, setActiveTool] = useState<"bulk-drafts" | "bulk-follow-up">("bulk-drafts");

  return (
    <div className="space-y-6">
      <AppHeader
        title="Bulk Sender"
        subtitle="Create personalized drafts or prepare safe follow-ups for unanswered outreach."
      />
      <div
        className="mx-auto grid w-full max-w-lg grid-cols-2 rounded-[22px] border bg-card p-1.5 shadow-sm ring-1 ring-border/60"
        role="tablist"
        aria-label="Bulk Sender tools"
      >
        <button
          type="button"
          id="bulk-drafts-tab"
          role="tab"
          aria-controls="bulk-sender-panel"
          aria-selected={activeTool === "bulk-drafts"}
          onClick={() => setActiveTool("bulk-drafts")}
          className={cn(
            "rounded-[17px] px-5 py-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            activeTool === "bulk-drafts"
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Bulk Outreach
        </button>
        <button
          type="button"
          id="bulk-follow-up-tab"
          role="tab"
          aria-controls="bulk-sender-panel"
          aria-selected={activeTool === "bulk-follow-up"}
          onClick={() => setActiveTool("bulk-follow-up")}
          className={cn(
            "rounded-[17px] px-5 py-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            activeTool === "bulk-follow-up"
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Bulk Follow-up
        </button>
      </div>
      <div
        id="bulk-sender-panel"
        role="tabpanel"
        aria-labelledby={activeTool === "bulk-drafts" ? "bulk-drafts-tab" : "bulk-follow-up-tab"}
      >
        {activeTool === "bulk-drafts" ? <BulkDraftCreator /> : <BulkFollowUpPanel />}
      </div>
    </div>
  );
}

function BulkDraftCreator() {
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [rows, setRows] = useState<SenderRow[]>(starterRows);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);
  const [expandedGrid, setExpandedGrid] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewRowId, setPreviewRowId] = useState("");
  const [job, setJob] = useState<BulkSenderJob | null>(null);
  const [jobError, setJobError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastEditorTarget, setLastEditorTarget] = useState<"subject" | "body">("body");
  const bodyEditorRef = useRef<HTMLDivElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const processingJobRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);

  const emailColumn = columns.find((column) => column.type === "email");
  const nonEmptyRows = useMemo(() => rows.filter((row) => !isRowEmpty(row)), [rows]);

  const rowValidation = useMemo(() => {
    const seenEmails = new Set<string>();
    return nonEmptyRows.map((row) => {
      const email = emailColumn ? (row.values[emailColumn.id] ?? "").trim().toLowerCase() : "";
      let issue = "";
      if (!emailColumn) issue = "Choose an email column";
      else if (!email) issue = "Missing email";
      else if (!isEmail(email)) issue = "Invalid email";
      else if (seenEmails.has(email)) issue = "Duplicate email";
      else seenEmails.add(email);
      return { row, email, issue };
    });
  }, [emailColumn, nonEmptyRows]);

  const readyRows = rowValidation.filter(
    ({ row, issue }) => !issue && row.status !== "created" && row.status !== "skipped",
  );
  const nextBatch = readyRows.slice(0, MAX_DRAFTS_PER_RUN);
  const waitingCount = Math.max(0, readyRows.length - nextBatch.length);
  const invalidCount = rowValidation.filter(({ issue }) => Boolean(issue)).length;
  const createdCount = rows.filter((row) => row.status === "created").length;
  const previewRow =
    rows.find((row) => row.id === previewRowId && !isRowEmpty(row)) ?? nonEmptyRows[0] ?? null;

  useEffect(() => {
    stoppedRef.current = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as SavedWorkspace;
        if (saved.columns?.length) setColumns(saved.columns);
        if (saved.rows?.length) setRows(saved.rows);
        if (typeof saved.subject === "string") setSubject(saved.subject);
        if (typeof saved.bodyHtml === "string") setBodyHtml(saved.bodyHtml);
        if (saved.activeJobId) void driveQueue(saved.activeJobId);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoaded(true);
    }
    return () => {
      stoppedRef.current = true;
    };
    // The saved job should only be resumed once when the page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const activeJobId =
      job && !["completed", "partial", "failed"].includes(job.status) ? job.id : undefined;
    const workspace: SavedWorkspace = { columns, rows, subject, bodyHtml, activeJobId };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [bodyHtml, columns, job, loaded, rows, subject]);

  useEffect(() => {
    const editor = bodyEditorRef.current;
    if (editor && document.activeElement !== editor && editor.innerHTML !== bodyHtml) {
      editor.innerHTML = bodyHtml;
    }
  }, [bodyHtml]);

  const applyJobResults = (completedJob: BulkSenderJob) => {
    const results = new Map(completedJob.results.map((result) => [result.rowId, result]));
    setRows((current) =>
      current.map((row) => {
        const result = results.get(row.id);
        if (!result) return row;
        return {
          ...row,
          status: result.status === "created" ? "created" : result.status,
          statusMessage: result.message,
        };
      }),
    );
  };

  async function driveQueue(jobId: string) {
    if (processingJobRef.current === jobId) return;
    processingJobRef.current = jobId;
    setIsSubmitting(true);
    try {
      while (!stoppedRef.current) {
        const response = await advanceBulkSenderQueue({ data: { jobId } });
        setJob(response.job);
        if (["completed", "partial", "failed"].includes(response.job.status)) {
          applyJobResults(response.job);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
    } catch (error) {
      setJobError(error instanceof Error ? error.message : "The draft queue could not continue.");
    } finally {
      processingJobRef.current = null;
      setIsSubmitting(false);
    }
  }

  const submitBatch = async () => {
    setJobError("");
    setIsSubmitting(true);
    try {
      const drafts = nextBatch.map(({ row, email }) => {
        const htmlBody = fillTemplate(bodyHtml, row, columns, true);
        return {
          rowId: row.id,
          to: email,
          subject: fillTemplate(subject, row, columns),
          htmlBody,
          textBody: htmlToText(htmlBody),
        };
      });
      const response = await submitBulkSenderJob({
        data: { drafts },
      });
      setJob(response.job);
      setIsSubmitting(false);
      await driveQueue(response.job.id);
    } catch (error) {
      setJobError(error instanceof Error ? error.message : "The draft batch could not be queued.");
      setIsSubmitting(false);
    }
  };

  const updateCell = (rowId: string, columnId: string, value: string) => {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              values: { ...row.values, [columnId]: value },
              status: row.status === "failed" ? "ready" : row.status,
              statusMessage: row.status === "failed" ? "" : row.statusMessage,
            }
          : row,
      ),
    );
  };

  const pasteGrid = (
    event: ClipboardEvent<HTMLInputElement>,
    startRowIndex: number,
    startColumnIndex: number,
  ) => {
    const pasted = parsePastedGrid(event.clipboardData.getData("text/plain"));
    if (pasted.length === 1 && pasted[0]?.length === 1) return;
    event.preventDefault();

    const requiredColumnCount = startColumnIndex + Math.max(...pasted.map((line) => line.length));
    const nextColumns = [...columns];
    while (nextColumns.length < requiredColumnCount) {
      const number = nextColumns.length + 1;
      const label = `Field ${number}`;
      nextColumns.push({
        id: newId("column"),
        label,
        key: uniqueKey(label, nextColumns),
        type: "text",
      });
    }

    const nextRows = rows.map((row) => ({ ...row, values: { ...row.values } }));
    while (nextRows.length < startRowIndex + pasted.length) nextRows.push(makeEmptyRow());
    pasted.forEach((line, rowOffset) => {
      line.forEach((value, columnOffset) => {
        const column = nextColumns[startColumnIndex + columnOffset];
        if (column) nextRows[startRowIndex + rowOffset].values[column.id] = value;
      });
    });
    setColumns(nextColumns);
    setRows(nextRows);
  };

  const addColumn = () => {
    setColumns((current) => {
      const label = `Field ${current.length + 1}`;
      return [
        ...current,
        { id: newId("column"), label, key: uniqueKey(label, current), type: "text" },
      ];
    });
  };

  const renameColumn = (id: string, label: string) => {
    setColumns((current) =>
      current.map((column) =>
        column.id === id ? { ...column, label, key: uniqueKey(label, current, id) } : column,
      ),
    );
  };

  const setEmailColumn = (id: string) => {
    setColumns((current) =>
      current.map((column) => ({ ...column, type: column.id === id ? "email" : "text" })),
    );
  };

  const deleteColumn = (id: string) => {
    setColumns((current) => current.filter((column) => column.id !== id));
    setRows((current) =>
      current.map((row) => {
        const values = { ...row.values };
        delete values[id];
        return { ...row, values };
      }),
    );
  };

  const executeEditorCommand = (command: string, value?: string) => {
    bodyEditorRef.current?.focus();
    document.execCommand(command, false, value);
    setBodyHtml(bodyEditorRef.current?.innerHTML ?? "");
  };

  const toolbarAction =
    (command: string, value?: string) => (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      executeEditorCommand(command, value);
    };

  const insertLink = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const url = window.prompt("Paste the link URL");
    if (!url) return;
    executeEditorCommand("createLink", url);
  };

  const insertImage = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const url = window.prompt("Paste a public HTTPS image URL");
    if (!url) return;
    if (!/^https:\/\//i.test(url)) {
      setJobError("Email images must use a public HTTPS URL.");
      return;
    }
    executeEditorCommand("insertImage", url);
  };

  const insertField = (column: Column) => {
    const token = `{{${column.key}}}`;
    if (lastEditorTarget === "subject" && subjectRef.current) {
      const input = subjectRef.current;
      const start = input.selectionStart ?? subject.length;
      const end = input.selectionEnd ?? start;
      setSubject(`${subject.slice(0, start)}${token}${subject.slice(end)}`);
      window.setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    executeEditorCommand("insertText", token);
  };

  const handleBodyInput = (event: FormEvent<HTMLDivElement>) => {
    setBodyHtml(event.currentTarget.innerHTML);
  };

  const resetCompletedRows = () => {
    setRows((current) =>
      current.map((row) => ({ ...row, status: undefined, statusMessage: undefined })),
    );
    setJob(null);
    setJobError("");
  };

  const canCreate = Boolean(
    emailColumn && nextBatch.length > 0 && subject.trim() && htmlToText(bodyHtml),
  );
  const progress = job?.total ? (job.processed / job.total) * 100 : 0;
  const terminalJob = job && ["completed", "partial", "failed"].includes(job.status);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Rows3 className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Recipients</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste cells directly from Google Sheets. New columns are added automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold">
              {nonEmptyRows.length} rows
            </span>
            <span className="rounded-full bg-success/15 px-3 py-1.5 text-xs font-semibold text-foreground">
              {readyRows.length} ready
            </span>
            {invalidCount > 0 && (
              <span className="rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">
                {invalidCount} need attention
              </span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={addColumn}>
              <Plus className="h-4 w-4" /> Add column
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={expandedGrid ? "Use compact grid" : "Expand grid"}
              onClick={() => setExpandedGrid((current) => !current)}
            >
              {expandedGrid ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div
          className={cn(
            "mt-4 overflow-auto rounded-2xl border bg-background",
            expandedGrid ? "h-[70vh]" : "h-[420px]",
          )}
        >
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
              <tr>
                <th className="sticky left-0 z-30 w-14 border-b border-r bg-muted px-3 py-3 text-center text-xs text-muted-foreground">
                  #
                </th>
                {columns.map((column) => (
                  <th key={column.id} className="min-w-56 border-b border-r p-2 text-left">
                    <div className="flex items-center gap-1.5">
                      <input
                        aria-label={`Rename ${column.label} column`}
                        value={column.label}
                        onChange={(event) => renameColumn(column.id, event.target.value)}
                        className="min-w-0 flex-1 bg-transparent px-2 py-1 font-semibold outline-none focus:rounded-lg focus:ring-2 focus:ring-ring"
                      />
                      <button
                        type="button"
                        title={
                          column.type === "email"
                            ? "Recipient email column"
                            : "Use as recipient email"
                        }
                        aria-label={
                          column.type === "email"
                            ? "Recipient email column"
                            : `Use ${column.label} as recipient email`
                        }
                        onClick={() => setEmailColumn(column.id)}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg",
                          column.type === "email"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Delete column"
                        aria-label={`Delete ${column.label} column`}
                        onClick={() => deleteColumn(column.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="px-2 pt-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                      {`{{${column.key}}}`}
                    </div>
                  </th>
                ))}
                <th className="w-12 border-b bg-muted" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const validation = rowValidation.find((item) => item.row.id === row.id);
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "group",
                      row.status === "created" && "bg-success/5",
                      row.status === "failed" && "bg-destructive/5",
                    )}
                  >
                    <td className="sticky left-0 z-10 border-b border-r bg-background px-3 py-2 text-center text-xs text-muted-foreground group-hover:bg-muted">
                      <div className="flex items-center justify-center gap-1">
                        {row.status === "created" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : row.status === "failed" ? (
                          <XCircle className="h-3.5 w-3.5 text-destructive" />
                        ) : null}
                        {rowIndex + 1}
                      </div>
                    </td>
                    {columns.map((column, columnIndex) => (
                      <td key={column.id} className="border-b border-r p-0">
                        <input
                          value={row.values[column.id] ?? ""}
                          onChange={(event) => updateCell(row.id, column.id, event.target.value)}
                          onPaste={(event) => pasteGrid(event, rowIndex, columnIndex)}
                          title={validation?.issue || row.statusMessage}
                          className={cn(
                            "h-11 w-full min-w-56 bg-transparent px-3 outline-none focus:bg-card focus:ring-2 focus:ring-inset focus:ring-ring",
                            column.type === "email" &&
                              validation?.issue &&
                              !isRowEmpty(row) &&
                              "text-destructive",
                          )}
                        />
                      </td>
                    ))}
                    <td className="border-b px-2">
                      <button
                        type="button"
                        aria-label={`Delete row ${rowIndex + 1}`}
                        onClick={() =>
                          setRows((current) => current.filter((item) => item.id !== row.id))
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((current) => [...current, ...Array.from({ length: 5 }, makeEmptyRow)])
            }
          >
            <Plus className="h-4 w-4" /> Add 5 rows
          </Button>
          {!emailColumn && (
            <p className="text-sm font-medium text-destructive">
              Choose one column as the recipient email using the mail icon.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Email template</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Fields are matched to each row. The connected Gmail signature is added automatically.
            </p>
          </div>
          {nonEmptyRows.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              Preview row
              <select
                value={previewRow?.id ?? ""}
                onChange={(event) => setPreviewRowId(event.target.value)}
                className="h-9 max-w-52 rounded-xl border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                {nonEmptyRows.map((row, index) => (
                  <option key={row.id} value={row.id}>
                    Row {rows.indexOf(row) + 1}:{" "}
                    {emailColumn
                      ? row.values[emailColumn.id] || "No email"
                      : `Recipient ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="bulk-subject"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground"
            >
              Subject
            </label>
            <input
              ref={subjectRef}
              id="bulk-subject"
              value={subject}
              onFocus={() => setLastEditorTarget("subject")}
              onChange={(event) => setSubject(event.target.value)}
              className="h-12 w-full rounded-2xl border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="Email subject"
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Message
            </div>
            <div className="overflow-hidden rounded-2xl border bg-background focus-within:ring-2 focus-within:ring-ring">
              <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/60 p-2">
                <ToolbarButton label="Undo" onMouseDown={toolbarAction("undo")}>
                  <Undo2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Redo" onMouseDown={toolbarAction("redo")}>
                  <Redo2 className="h-4 w-4" />
                </ToolbarButton>
                <span className="mx-1 h-5 w-px bg-border" />
                <ToolbarButton label="Bold" onMouseDown={toolbarAction("bold")}>
                  <Bold className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Italic" onMouseDown={toolbarAction("italic")}>
                  <Italic className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Underline" onMouseDown={toolbarAction("underline")}>
                  <Underline className="h-4 w-4" />
                </ToolbarButton>
                <span className="mx-1 h-5 w-px bg-border" />
                <ToolbarButton
                  label="Bulleted list"
                  onMouseDown={toolbarAction("insertUnorderedList")}
                >
                  <List className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  label="Numbered list"
                  onMouseDown={toolbarAction("insertOrderedList")}
                >
                  <ListOrdered className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Align left" onMouseDown={toolbarAction("justifyLeft")}>
                  <AlignLeft className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Align center" onMouseDown={toolbarAction("justifyCenter")}>
                  <AlignCenter className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Align right" onMouseDown={toolbarAction("justifyRight")}>
                  <AlignRight className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Decrease indent" onMouseDown={toolbarAction("outdent")}>
                  <IndentDecrease className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Increase indent" onMouseDown={toolbarAction("indent")}>
                  <IndentIncrease className="h-4 w-4" />
                </ToolbarButton>
                <span className="mx-1 h-5 w-px bg-border" />
                <label
                  className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-xs font-black text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  title="Text color"
                  aria-label="Text color"
                >
                  A
                  <span className="absolute bottom-1 h-0.5 w-4 bg-primary" />
                  <input
                    type="color"
                    aria-label="Choose text color"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={(event) => executeEditorCommand("foreColor", event.target.value)}
                  />
                </label>
                <ToolbarButton label="Insert link" onMouseDown={insertLink}>
                  <LinkIcon className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Insert image" onMouseDown={insertImage}>
                  <Image className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton label="Clear formatting" onMouseDown={toolbarAction("removeFormat")}>
                  <Eraser className="h-4 w-4" />
                </ToolbarButton>
              </div>
              <div
                ref={bodyEditorRef}
                role="textbox"
                aria-label="Email body"
                aria-multiline="true"
                contentEditable
                suppressContentEditableWarning
                onFocus={() => setLastEditorTarget("body")}
                onInput={handleBodyInput}
                className="min-h-64 px-5 py-4 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_img]:max-w-full"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Insert a field
            </div>
            <div className="flex flex-wrap gap-2">
              {columns.map((column) => (
                <button
                  key={column.id}
                  type="button"
                  onClick={() => insertField(column)}
                  className="rounded-xl bg-primary/10 px-3 py-2 font-mono text-xs font-semibold text-primary transition hover:bg-primary/15"
                >
                  {`{{${column.key}}}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {previewRow && (
          <div className="mt-6 rounded-2xl border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Draft preview
              </div>
              <span className="text-xs text-muted-foreground">
                Signature appears after this message in Gmail
              </span>
            </div>
            <div className="mt-3 border-b pb-3 text-sm font-semibold">
              {fillTemplate(subject, previewRow, columns) || "No subject"}
            </div>
            <div
              className="mt-4 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_img]:max-w-full"
              dangerouslySetInnerHTML={{
                __html: fillTemplate(bodyHtml, previewRow, columns, true),
              }}
            />
          </div>
        )}
      </section>

      {(job || jobError) && (
        <section className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border md:p-5">
          <div className="flex items-start gap-3">
            {isSubmitting ? (
              <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-primary" />
            ) : terminalJob && job.status === "completed" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {jobError || job?.message || "Preparing your draft batch…"}
              </div>
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

      <div className="sticky bottom-4 z-30 rounded-3xl bg-foreground p-3 text-background shadow-xl ring-1 ring-border/30 md:p-4 lg:mr-40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-semibold">
              {nextBatch.length > 0
                ? `${nextBatch.length} draft${nextBatch.length === 1 ? "" : "s"} ready for the next batch`
                : createdCount > 0
                  ? `${createdCount} draft${createdCount === 1 ? "" : "s"} created from this workspace`
                  : "Add valid recipient rows to begin"}
            </div>
            <div className="mt-0.5 text-xs text-background/65">
              {waitingCount > 0
                ? `${waitingCount} additional rows will remain ready for the following batch.`
                : "Every draft opens in the connected Gmail account for review before sending."}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {createdCount > 0 && !isSubmitting && (
              <Button type="button" variant="secondary" onClick={resetCompletedRows}>
                Reuse all rows
              </Button>
            )}
            <Button
              type="button"
              disabled={!canCreate || isSubmitting}
              onClick={() => setConfirmOpen(true)}
              className="min-w-52 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating drafts…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Create {nextBatch.length || 0} email drafts
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Check the batch before creating drafts</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Make sure to check that the rows align and read through the drafts before sending.
              </span>
              <span className="block rounded-2xl bg-warning/20 p-3 font-medium text-foreground">
                Any bulk errors will result in restrictions on tool usage.
              </span>
              <span className="block">
                This will create {nextBatch.length} draft{nextBatch.length === 1 ? "" : "s"} in the
                connected Gmail account. Nothing will be sent automatically.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submitBatch()}>Create</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
