"use client";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Spelled-out name when `label` is an abbreviation ("1M" → "Last month"). */
  srLabel?: string;
}

/**
 * One-of-a-few picker. Native radios rather than Radix Tabs: it looks the same
 * but a tablist announces panels that don't exist here, and radios bring
 * grouping, arrow-key navigation, and form semantics for free.
 */
export function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  className,
}: {
  /** Unique per rendered group — radios with the same name share a selection. */
  name: string;
  /** Accessible name for the group; never rendered visibly. */
  legend: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-1">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-label={option.srLabel}
              className="peer sr-only"
            />
            <span
              className={cn(
                "inline-flex h-7 items-center whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background",
                value === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
