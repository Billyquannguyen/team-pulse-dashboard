import { useId } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type DashboardSelectOption = string | { value: string; label: string };

function optionValue(option: DashboardSelectOption) {
  return typeof option === "string" ? option : option.value;
}

function optionLabel(option: DashboardSelectOption) {
  return typeof option === "string" ? option : option.label;
}

export function DashboardSelect({
  value,
  options,
  onChange,
  placeholder = "Select",
  triggerClassName,
  contentClassName,
  triggerId,
  ariaLabelledBy,
}: {
  value: string;
  options: DashboardSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  triggerClassName?: string;
  contentClassName?: string;
  triggerId?: string;
  ariaLabelledBy?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={triggerId}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          "tb-search mt-1 h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm font-semibold text-foreground shadow-none outline-none transition focus:ring-2 focus:ring-primary/30",
          triggerClassName,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        className={cn(
          "z-[80] rounded-2xl border-border bg-card font-sans text-sm font-semibold text-foreground shadow-xl",
          contentClassName,
        )}
      >
        {options.map((option) => (
          <SelectItem
            key={optionValue(option)}
            value={optionValue(option)}
            className="rounded-xl px-3 py-2 text-sm font-semibold"
          >
            {optionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DashboardSelectField({
  label,
  value,
  options,
  onChange,
  className,
  triggerClassName,
  placeholder,
}: {
  label: string;
  value: string;
  options: DashboardSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  triggerClassName?: string;
  placeholder?: string;
}) {
  const labelId = useId();
  const triggerId = useId();

  return (
    <div className={cn("min-w-[150px] flex-1 sm:flex-none", className)}>
      <span id={labelId} className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <DashboardSelect
        value={value}
        options={options}
        onChange={onChange}
        placeholder={placeholder}
        triggerClassName={triggerClassName}
        triggerId={triggerId}
        ariaLabelledBy={labelId}
      />
    </div>
  );
}
