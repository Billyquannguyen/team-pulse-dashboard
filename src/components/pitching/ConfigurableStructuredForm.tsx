import { useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  StructuredFormField,
  StructuredFormValue,
  StructuredFormValues,
} from "@/components/pitching/structured-form";
import { cn } from "@/lib/utils";

type Props = {
  fields: StructuredFormField[];
  values: StructuredFormValues;
  errors: Record<string, string>;
  onChange: (key: string, value: StructuredFormValue) => void;
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel?: string;
};

function MultiSelectField({
  field,
  value,
  error,
  onChange,
}: {
  field: StructuredFormField;
  value: string[];
  error?: string;
  onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(
    () =>
      (field.options ?? []).filter((option) =>
        `${option.label} ${option.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [field.options, query],
  );

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground">
        {field.label}
        {field.required ? <span className="ml-1 text-destructive">*</span> : null}
      </label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-auto min-h-11 w-full justify-between rounded-2xl bg-background px-3 text-left font-normal",
              error && "border-destructive",
            )}
            aria-invalid={Boolean(error)}
          >
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
              {value.length === 0
                ? (field.placeholder ?? `Select ${field.label.toLowerCase()}`)
                : value.length <= 2
                  ? value
                      .map(
                        (selected) =>
                          field.options?.find((option) => option.value === selected)?.label ??
                          selected,
                      )
                      .join(", ")
                  : `${value.length} selected`}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(360px,calc(100vw-2rem))] rounded-2xl p-2">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${field.label.toLowerCase()}...`}
              className="h-9 rounded-xl pl-9"
            />
          </div>
          <div className="max-h-64 overflow-auto">
            {options.map((option) => {
              const selected = value.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    onChange(
                      selected
                        ? value.filter((candidate) => candidate !== option.value)
                        : [...value, option.value],
                    )
                  }
                  className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-pressed={selected}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background",
                    )}
                  >
                    {selected ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span>
                    <span className="font-medium">{option.label}</span>
                    {option.description ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {options.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No options found.
              </p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      {field.helperText ? (
        <p className="text-xs text-muted-foreground">{field.helperText}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ConfigurableStructuredForm({
  fields,
  values,
  errors,
  onChange,
  onSubmit,
  submitting = false,
  submitLabel = "Generate Preview",
}: Props) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-6"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => {
          const value = values[field.key];
          const error = errors[field.key];
          if (field.type === "multi-select") {
            return (
              <MultiSelectField
                key={field.key}
                field={field}
                value={Array.isArray(value) ? value : []}
                error={error}
                onChange={(next) => onChange(field.key, next)}
              />
            );
          }

          return (
            <label
              key={field.key}
              className="space-y-1.5 text-xs font-semibold text-muted-foreground"
            >
              <span>
                {field.label}
                {field.required ? <span className="ml-1 text-destructive">*</span> : null}
              </span>
              {field.type === "select" ? (
                <select
                  value={String(value ?? "")}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  aria-invalid={Boolean(error)}
                  className={cn(
                    "h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring",
                    error && "border-destructive",
                  )}
                >
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  type={field.type}
                  min={field.min}
                  max={field.max}
                  value={value as string | number}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    onChange(
                      field.key,
                      field.type === "number" && event.target.value !== ""
                        ? Number(event.target.value)
                        : event.target.value,
                    )
                  }
                  aria-invalid={Boolean(error)}
                  className={cn(
                    "h-11 rounded-2xl bg-background text-sm text-foreground",
                    error && "border-destructive",
                  )}
                />
              )}
              {field.helperText ? (
                <span className="block font-normal">{field.helperText}</span>
              ) : null}
              {error ? (
                <span role="alert" className="block font-medium text-destructive">
                  {error}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <div className="flex justify-end border-t border-border pt-5">
        <Button type="submit" disabled={submitting} className="min-w-44 rounded-2xl">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "Preparing records..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
