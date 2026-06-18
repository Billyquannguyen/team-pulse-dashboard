import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Database,
  FileSpreadsheet,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { DashboardSelectField } from "@/components/ui/dashboard-select";
import { Textarea } from "@/components/ui/textarea";
import {
  addContactDatabaseContact,
  contactDatabaseQuery,
  deduplicateContactDatabase,
  deleteContactDatabaseContact,
  updateContactDatabaseContact,
  upsertContactDatabaseContacts,
  type ContactDatabaseContact,
} from "@/lib/contact-database";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/contact-database")({
  head: () => ({
    meta: [
      { title: "Contact Database - Team Billion" },
      {
        name: "description",
        content: "Stored brand contacts for Team Billion outreach.",
      },
    ],
  }),
  component: ContactDatabasePage,
});

const ALL_BRANDS = "All brands";

type ContactForm = {
  brandName: string;
  contactName: string;
  contactFirstName: string;
  email: string;
  position: string;
  source: string;
  firstFoundAt: string;
  lastContactedAt: string;
  gmailThreadId: string;
  notes: string;
};

function emptyForm(): ContactForm {
  return {
    brandName: "",
    contactName: "",
    contactFirstName: "",
    email: "",
    position: "",
    source: "Manual",
    firstFoundAt: "",
    lastContactedAt: "",
    gmailThreadId: "",
    notes: "",
  };
}

function formFromContact(contact: ContactDatabaseContact): ContactForm {
  return {
    brandName: contact.brandName,
    contactName: contact.contactName,
    contactFirstName: contact.contactFirstName,
    email: contact.email,
    position: contact.position,
    source: contact.source,
    firstFoundAt: contact.firstFoundAt,
    lastContactedAt: contact.lastContactedAt,
    gmailThreadId: contact.gmailThreadId,
    notes: contact.notes,
  };
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      currentValue += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      currentRow.push(currentValue.trim());
      currentValue = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      currentRow.push(currentValue.trim());
      if (currentRow.some(Boolean)) rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  currentRow.push(currentValue.trim());
  if (currentRow.some(Boolean)) rows.push(currentRow);

  const [headers = [], ...bodyRows] = rows;
  return { headers, rows: bodyRows };
}

function columnIndex(headers: string[], aliases: string[]) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const normalizedAliases = aliases.map(normalizeHeader);
  return normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));
}

function cell(headers: string[], row: string[], aliases: string[]) {
  const index = columnIndex(headers, aliases);
  return index >= 0 ? (row[index]?.trim() ?? "") : "";
}

function contactsFromCsv(text: string) {
  const { headers, rows } = parseCsv(text);
  return rows
    .map((row) => ({
      brandName: cell(headers, row, ["brandName", "brand name", "brand", "company"]),
      contactName: cell(headers, row, ["contactName", "contact name", "name", "full name"]),
      contactFirstName: cell(headers, row, [
        "contactFirstName",
        "contact first name",
        "first name",
      ]),
      email: cell(headers, row, ["email", "email address", "work email", "business email"]),
      position: cell(headers, row, ["position", "title", "job title", "role"]),
      source: cell(headers, row, ["source"]) || "CSV Import",
      firstFoundAt: cell(headers, row, ["firstFoundAt", "first found at", "found at"]),
      lastContactedAt: cell(headers, row, ["lastContactedAt", "last contacted at"]),
      gmailThreadId: cell(headers, row, ["gmailThreadId", "gmail thread id", "thread id"]),
      notes: cell(headers, row, ["notes", "note"]),
    }))
    .filter((contact) => contact.brandName || contact.email || contact.contactName);
}

function ContactDatabasePage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery(contactDatabaseQuery);
  const contacts = useMemo(() => data?.contacts ?? [], [data?.contacts]);
  const [q, setQ] = useState("");
  const [brandFilter, setBrandFilter] = useState(ALL_BRANDS);
  const [emailFilter, setEmailFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactDatabaseContact | null>(null);
  const [form, setForm] = useState<ContactForm>(() => emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeduping, setIsDeduping] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const brandOptions = useMemo(
    () => [
      ALL_BRANDS,
      ...Array.from(new Set(contacts.map((contact) => contact.brandName)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    ],
    [contacts],
  );
  const filteredContacts = useMemo(() => {
    const query = q.trim().toLowerCase();
    const emailQuery = emailFilter.trim().toLowerCase();

    return contacts.filter((contact) => {
      const searchable = [
        contact.brandName,
        contact.contactName,
        contact.contactFirstName,
        contact.email,
        contact.position,
        contact.source,
        contact.notes,
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!query || searchable.includes(query)) &&
        (!emailQuery || contact.email.toLowerCase().includes(emailQuery)) &&
        (brandFilter === ALL_BRANDS || contact.brandName === brandFilter)
      );
    });
  }, [brandFilter, contacts, emailFilter, q]);
  const contactedCount = contacts.filter((contact) => contact.lastContactedAt).length;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: contactDatabaseQuery.queryKey });
  };

  const closeModal = () => {
    if (isSaving) return;
    setAddOpen(false);
    setEditingContact(null);
    setForm(emptyForm());
    setError("");
  };

  const openEdit = (contact: ContactDatabaseContact) => {
    setEditingContact(contact);
    setForm(formFromContact(contact));
    setError("");
  };

  const submitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSaving(true);

    try {
      if (editingContact?.rowNumber) {
        await updateContactDatabaseContact({
          data: {
            rowNumber: editingContact.rowNumber,
            id: editingContact.id,
            ...form,
          },
        });
        setMessage("Contact updated.");
      } else {
        await addContactDatabaseContact({ data: form });
        setMessage("Contact added.");
      }

      setAddOpen(false);
      setEditingContact(null);
      setForm(emptyForm());
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save contact.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteContact = async (contact: ContactDatabaseContact) => {
    if (!contact.rowNumber) return;
    const confirmed = window.confirm(`Delete ${contact.email || contact.contactName}?`);
    if (!confirmed) return;

    setError("");
    setMessage("");

    try {
      await deleteContactDatabaseContact({ data: { rowNumber: contact.rowNumber } });
      setMessage("Contact deleted.");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete contact.");
    }
  };

  const importCsvFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setMessage("");
    setIsImporting(true);

    try {
      const text = await file.text();
      const imported = contactsFromCsv(text);
      if (imported.length === 0) {
        setError("No contacts found in that CSV.");
        return;
      }

      const result = await upsertContactDatabaseContacts({ data: { contacts: imported } });
      setMessage(
        `Imported ${imported.length} rows. ${result.created} new, ${result.updated} updated.`,
      );
      await refresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not import CSV.");
    } finally {
      setIsImporting(false);
    }
  };

  const dedupeContacts = async () => {
    setError("");
    setMessage("");
    setIsDeduping(true);

    try {
      const result = await deduplicateContactDatabase();
      setMessage(`Removed ${result.removed} duplicate row${result.removed === 1 ? "" : "s"}.`);
      await refresh();
    } catch (dedupeError) {
      setError(
        dedupeError instanceof Error ? dedupeError.message : "Could not deduplicate contacts.",
      );
    } finally {
      setIsDeduping(false);
    }
  };

  return (
    <div className="space-y-6">
      <AppHeader
        title="Contact Database"
        subtitle="Stored brand contacts used by Brand Finder duplicate checks."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricTile
          label="Total contacts"
          value={contacts.length.toLocaleString()}
          icon={Database}
        />
        <MetricTile
          label="Brands"
          value={brandOptions.slice(1).length.toLocaleString()}
          icon={FileSpreadsheet}
        />
        <MetricTile
          label="Previously contacted"
          value={contactedCount.toLocaleString()}
          icon={Check}
        />
      </section>

      <Panel
        title="Database"
        subtitle={
          data?.source === "google-sheet"
            ? "Live Google Sheet"
            : isLoading
              ? "Loading contacts..."
              : data?.error || "Contact Database not loaded"
        }
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setAddOpen(true);
                setForm(emptyForm());
                setError("");
              }}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Add contact
            </button>
            <label className="tb-action inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground">
              {isImporting ? <LoaderIcon /> : <Upload className="h-4 w-4" />}
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  void importCsvFile(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              disabled={isDeduping}
              onClick={() => void dedupeContacts()}
              className="tb-action inline-flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeduping ? <LoaderIcon /> : <RotateCcw className="h-4 w-4" />}
              Deduplicate
            </button>
          </div>
        }
      >
        {(data?.warning || data?.error || message || error) && (
          <div
            className={cn(
              "mb-4 rounded-2xl border p-4 text-sm",
              error || data?.error
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-fun-lime/50 bg-fun-lime/20 text-foreground",
            )}
          >
            <div className="mb-1 flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" />
              Contact Database notice
            </div>
            <p className="break-words text-xs leading-relaxed">
              {error || message || data?.warning || data?.error}
            </p>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(180px,0.25fr)_minmax(180px,0.25fr)]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search brand, contact, email, notes..."
              className="tb-search h-10 w-full rounded-2xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <DashboardSelectField
            label="Brand"
            value={brandFilter}
            options={brandOptions}
            onChange={setBrandFilter}
          />
          <label className="text-xs font-semibold text-muted-foreground">
            Email
            <input
              value={emailFilter}
              onChange={(event) => setEmailFilter(event.target.value)}
              placeholder="name@brand.com"
              className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                <th className="px-3 py-2.5 text-left font-medium">Contact</th>
                <th className="px-3 py-2.5 text-left font-medium">Email</th>
                <th className="px-3 py-2.5 text-left font-medium">Position</th>
                <th className="px-3 py-2.5 text-left font-medium">Last contacted</th>
                <th className="px-3 py-2.5 text-left font-medium">Source</th>
                <th className="px-3 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.length === 0 && (
                <tr className="border-t border-border/60">
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No contacts found.
                  </td>
                </tr>
              )}
              {filteredContacts.map((contact) => (
                <tr
                  key={`${contact.rowNumber}-${contact.id}`}
                  className="tb-row-hover border-t border-border/60"
                >
                  <td className="min-w-[180px] px-3 py-3 font-semibold">{contact.brandName}</td>
                  <td className="min-w-[180px] px-3 py-3">
                    <div>{contact.contactName || "-"}</div>
                    {contact.contactFirstName && (
                      <div className="text-xs text-muted-foreground">
                        {contact.contactFirstName}
                      </div>
                    )}
                  </td>
                  <td className="min-w-[220px] px-3 py-3 text-muted-foreground">
                    {contact.email || "-"}
                  </td>
                  <td className="min-w-[220px] px-3 py-3 text-muted-foreground">
                    {contact.position || "-"}
                  </td>
                  <td className="min-w-[170px] px-3 py-3 text-muted-foreground">
                    {contact.lastContactedAt || "-"}
                  </td>
                  <td className="min-w-[140px] px-3 py-3 text-muted-foreground">
                    {contact.source || "-"}
                  </td>
                  <td className="min-w-[130px] px-3 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => openEdit(contact)}
                        className="tb-action flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => void deleteContact(contact)}
                        className="tb-action flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {(addOpen || editingContact) && (
        <ContactModal title={editingContact ? "Edit contact" : "Add contact"} onClose={closeModal}>
          <form onSubmit={submitContact} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 md:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Brand name"
                  value={form.brandName}
                  onChange={(value) => setForm((current) => ({ ...current, brandName: value }))}
                  required
                />
                <TextField
                  label="Contact name"
                  value={form.contactName}
                  onChange={(value) => setForm((current) => ({ ...current, contactName: value }))}
                />
                <TextField
                  label="First name"
                  value={form.contactFirstName}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, contactFirstName: value }))
                  }
                />
                <TextField
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(value) => setForm((current) => ({ ...current, email: value }))}
                />
                <TextField
                  label="Position"
                  value={form.position}
                  onChange={(value) => setForm((current) => ({ ...current, position: value }))}
                />
                <TextField
                  label="Source"
                  value={form.source}
                  onChange={(value) => setForm((current) => ({ ...current, source: value }))}
                />
                <TextField
                  label="First found at"
                  value={form.firstFoundAt}
                  onChange={(value) => setForm((current) => ({ ...current, firstFoundAt: value }))}
                />
                <TextField
                  label="Last contacted at"
                  value={form.lastContactedAt}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, lastContactedAt: value }))
                  }
                />
              </div>
              <TextField
                label="Gmail thread ID"
                value={form.gmailThreadId}
                onChange={(value) => setForm((current) => ({ ...current, gmailThreadId: value }))}
              />
              <label className="block text-sm font-semibold">
                Notes
                <Textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  className="mt-1 min-h-28 rounded-2xl bg-background text-sm"
                />
              </label>
              {error && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="grid shrink-0 gap-2 border-t border-border bg-card p-5 sm:grid-cols-2 md:p-6">
              <button
                type="submit"
                disabled={isSaving}
                className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save contact"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="tb-action inline-flex h-11 items-center justify-center rounded-2xl bg-muted px-4 text-sm font-semibold hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </form>
        </ContactModal>
      )}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {subtitle && <p className="mt-1 text-xs font-medium text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Database;
}) {
  return (
    <div className="tb-hover-lift rounded-3xl bg-card p-5 ring-1 ring-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
        </div>
        <div className="tb-hover-icon flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function ContactModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
        <div className="shrink-0 border-b border-border p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <h4 className="text-base font-semibold">{title}</h4>
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

function LoaderIcon() {
  return <RotateCcw className="h-4 w-4 animate-spin" />;
}
