import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Copy,
  Download,
  Pin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type PreviewColumn<Row> = {
  key: string;
  label: string;
  value: (row: Row) => string | number;
  sortable?: boolean;
  align?: "left" | "center" | "right";
};

export type PreparedRow = { id: string };

export type PreparedDatasetPreviewProps<Row extends PreparedRow> = {
  columns: PreviewColumn<Row>[];
  rows: Row[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  smartSort?: (left: Row, right: Row) => number;
  smartSortLabel?: string;
  onCopy: (rows: Row[], columns: PreviewColumn<Row>[]) => Promise<void>;
  onDownload: (rows: Row[], columns: PreviewColumn<Row>[]) => void | Promise<void>;
  onBack?: () => void;
  onDone?: () => void;
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
};

type ModalProps<Row extends PreparedRow> = PreparedDatasetPreviewProps<Row> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function compareValues(left: string | number, right: string | number) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function PreparedDatasetPreview<Row extends PreparedRow>({
  columns,
  rows,
  selectedIds,
  onSelectedIdsChange,
  smartSort,
  smartSortLabel = "Smart Sorting",
  onCopy,
  onDownload,
  onBack,
  onDone,
  title = "Prepared dataset preview",
  description,
  emptyTitle = "Nothing to preview",
  emptyDescription = "Return to the form and adjust the inputs.",
}: PreparedDatasetPreviewProps<Row>) {
  const [smartSorting, setSmartSorting] = useState(Boolean(smartSort));
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [downloading, setDownloading] = useState(false);
  const lastClickedId = useRef<string | null>(null);

  const displayedRows = useMemo(() => {
    const next = [...rows];
    if (smartSorting && smartSort) next.sort(smartSort);
    if (sort) {
      const column = columns.find((candidate) => candidate.key === sort.key);
      if (column) {
        next.sort((left, right) => {
          const result = compareValues(column.value(left), column.value(right));
          return sort.direction === "asc" ? result : -result;
        });
      }
    }
    return next;
  }, [columns, rows, smartSort, smartSorting, sort]);

  const selectedRows = useMemo(
    () => displayedRows.filter((row) => selectedIds.has(row.id)),
    [displayedRows, selectedIds],
  );
  const deselectedRows = useMemo(
    () => displayedRows.filter((row) => !selectedIds.has(row.id)),
    [displayedRows, selectedIds],
  );
  const allSelected = displayedRows.length > 0 && selectedRows.length === displayedRows.length;
  const someSelected = selectedRows.length > 0 && !allSelected;
  const rowGroups = useMemo(
    () => [
      {
        key: "all",
        label: "All rows",
        rows: displayedRows,
        copyFeedback: "All rows copied with header",
        downloadFeedback: "All rows downloaded with header",
      },
      {
        key: "selected",
        label: "Selected rows",
        rows: selectedRows,
        copyFeedback: "Selected rows copied with header",
        downloadFeedback: "Selected rows downloaded with header",
      },
      {
        key: "deselected",
        label: "Deselected rows",
        rows: deselectedRows,
        copyFeedback: "Deselected rows copied with header",
        downloadFeedback: "Deselected rows downloaded with header",
      },
    ],
    [deselectedRows, displayedRows, selectedRows],
  );

  const selectRange = (row: Row, event: React.MouseEvent) => {
    const lastIndex = lastClickedId.current
      ? displayedRows.findIndex((candidate) => candidate.id === lastClickedId.current)
      : -1;
    const currentIndex = displayedRows.findIndex((candidate) => candidate.id === row.id);

    if (event.shiftKey && lastIndex >= 0 && currentIndex >= 0) {
      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      const additive = event.metaKey || event.ctrlKey;
      const next = additive ? new Set(selectedIds) : new Set<string>();
      displayedRows.slice(start, end + 1).forEach((candidate) => next.add(candidate.id));
      onSelectedIdsChange(next);
    } else {
      const next = new Set(selectedIds);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      onSelectedIdsChange(next);
    }

    lastClickedId.current = row.id;
  };

  const cycleSort = (column: PreviewColumn<Row>) => {
    if (column.sortable === false) return;
    setSort((current) => {
      if (!current || current.key !== column.key) return { key: column.key, direction: "asc" };
      if (current.direction === "asc") return { key: column.key, direction: "desc" };
      return null;
    });
  };

  const performCopy = async (copyRows: Row[], label: string) => {
    try {
      await onCopy(copyRows, columns);
      setFeedback(label);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Copy failed");
    }
    window.setTimeout(() => setFeedback(""), 2500);
  };

  const performDownload = async (downloadRows: Row[], label: string) => {
    setDownloading(true);
    try {
      await onDownload(downloadRows, columns);
      setFeedback(label);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Download failed");
    } finally {
      setDownloading(false);
      window.setTimeout(() => setFeedback(""), 2500);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="border-b border-border px-5 py-4 md:px-6 md:py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {description ??
                `${displayedRows.length.toLocaleString()} prepared records · ${selectedRows.length.toLocaleString()} selected`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {smartSort ? (
              <Button
                type="button"
                variant={smartSorting ? "default" : "outline"}
                onClick={() => setSmartSorting((value) => !value)}
                className={cn(
                  "rounded-2xl",
                  smartSorting && "shadow-md shadow-primary/20 ring-2 ring-primary/20",
                )}
                aria-pressed={smartSorting}
              >
                <Pin className="h-4 w-4" />
                {smartSortLabel} {smartSorting ? "On" : "Off"}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  className="rounded-2xl"
                  disabled={displayedRows.length === 0 || downloading}
                >
                  <Download className="h-4 w-4" />
                  {downloading ? "Preparing..." : "Download rows"}
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-2xl p-2">
                <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                  Download as Excel
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {rowGroups.map((group) => (
                  <DropdownMenuItem
                    key={group.key}
                    disabled={group.rows.length === 0}
                    onSelect={() => void performDownload(group.rows, group.downloadFeedback)}
                    className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2"
                  >
                    <span>{group.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {group.rows.length.toLocaleString()}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl"
                  disabled={displayedRows.length === 0}
                >
                  <Copy className="h-4 w-4" />
                  Copy rows
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-2xl p-2">
                <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                  Copy with header row
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {rowGroups.map((group) => (
                  <DropdownMenuItem
                    key={group.key}
                    disabled={group.rows.length === 0}
                    onSelect={() => void performCopy(group.rows, group.copyFeedback)}
                    className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2"
                  >
                    <span>{group.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {group.rows.length.toLocaleString()}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div aria-live="polite" className="mt-2 min-h-5 text-xs font-semibold text-primary">
          {feedback}
        </div>
      </div>

      {columns.length === 0 || displayedRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <div className="text-base font-semibold">{emptyTitle}</div>
            <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-background">
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 w-12 border-b border-r border-border bg-muted px-3 py-3 text-center">
                  <input
                    ref={(element) => {
                      if (element) element.indeterminate = someSelected;
                    }}
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      onSelectedIdsChange(
                        allSelected ? new Set() : new Set(displayedRows.map((row) => row.id)),
                      )
                    }
                    aria-label={
                      allSelected ? "Clear all displayed records" : "Select all displayed records"
                    }
                    className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </th>
                {columns.map((column) => {
                  const activeSort = sort?.key === column.key;
                  const SortIcon = !activeSort
                    ? ArrowUpDown
                    : sort.direction === "asc"
                      ? ArrowUp
                      : ArrowDown;
                  return (
                    <th
                      key={column.key}
                      className={cn(
                        "sticky top-0 z-20 min-w-40 border-b border-r border-border bg-muted px-3 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                        column.align === "center"
                          ? "text-center"
                          : column.align === "right"
                            ? "text-right"
                            : "text-left",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => cycleSort(column)}
                        disabled={column.sortable === false}
                        className="inline-flex w-full items-center justify-between gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                        aria-label={`Sort by ${column.label}`}
                      >
                        {column.label}
                        {column.sortable !== false ? <SortIcon className="h-3.5 w-3.5" /> : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row) => {
                const selected = selectedIds.has(row.id);
                return (
                  <tr
                    key={row.id}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a,button,input")) return;
                      selectRange(row, event);
                    }}
                    className={cn(
                      "cursor-pointer",
                      selected ? "bg-primary/10" : "bg-card hover:bg-muted/50",
                    )}
                  >
                    <td
                      className={cn(
                        "sticky left-0 z-10 border-b border-r border-border px-3 py-2.5 text-center",
                        selected ? "bg-primary/10" : "bg-card",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onClick={(event) => selectRange(row, event)}
                        onChange={() => undefined}
                        aria-label={`Select record ${row.id}`}
                        className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </td>
                    {columns.map((column) => {
                      const value = column.value(row);
                      const cellText = String(value ?? "");
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            "max-w-sm whitespace-pre-wrap border-b border-r border-border px-3 py-2.5 align-middle",
                            column.align === "center"
                              ? "text-center"
                              : column.align === "right"
                                ? "text-right tabular-nums"
                                : "text-left",
                          )}
                        >
                          {isValidUrl(cellText) ? (
                            <a
                              href={cellText}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline underline-offset-2"
                            >
                              {cellText}
                            </a>
                          ) : (
                            cellText
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 md:px-6">
        <p className="text-xs text-muted-foreground">
          Shift-click selects a range. Cmd/Ctrl+Shift-click adds a range.
        </p>
        <div className="flex gap-2">
          {onBack ? (
            <Button type="button" variant="outline" className="rounded-2xl" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          ) : null}
          {onDone ? (
            <Button type="button" className="rounded-2xl" onClick={onDone}>
              Done
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PreparedDatasetPreviewModal<Row extends PreparedRow>({
  open,
  onOpenChange,
  ...previewProps
}: ModalProps<Row>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden rounded-3xl border-border bg-card p-0 sm:rounded-3xl">
        <PreparedDatasetPreview
          {...previewProps}
          onDone={previewProps.onDone ?? (() => onOpenChange(false))}
        />
      </DialogContent>
    </Dialog>
  );
}
