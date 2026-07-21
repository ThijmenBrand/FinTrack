"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Check,
} from "lucide-react";

/** Sort direction indicator, shared by the sortable column headers and the dropdown. */
export function SortArrow({
  active,
  order,
}: {
  active: boolean;
  order: "asc" | "desc";
}) {
  if (!active)
    return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />;
  return order === "asc" ? (
    <ArrowUp className="ml-1 h-3 w-3" />
  ) : (
    <ArrowDown className="ml-1 h-3 w-3" />
  );
}

export function HeaderFilterDropdown({
  label,
  options,
  value,
  onChange,
  sortable,
  sortBy,
  currentSortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  options: { value: string; label: string; color?: string | null }[];
  // string = single-select; string[] = multi-select (empty array means "all").
  // In multi mode onChange("all") clears; onChange(optValue) toggles that value.
  value: string | string[];
  onChange: (value: string) => void;
  sortable?: boolean;
  sortBy?: string;
  currentSortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (col: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const multiple = Array.isArray(value);
  const isFiltered = multiple ? value.length > 0 : value !== "all";
  const isSelected = (v: string) => (multiple ? value.includes(v) : value === v);

  const filtered = filterText
    ? options.filter((o) => o.label.toLowerCase().includes(filterText.toLowerCase()))
    : options;

  // Single-select closes on pick; multi-select stays open so you can toggle several.
  const pick = (v: string) => {
    onChange(v);
    if (!multiple || v === "all") { setOpen(false); setFilterText(""); }
  };

  return (
    <div className="flex items-center gap-0.5">
      {sortable && sortBy && onSort && (
        <button
          className="flex items-center hover:text-foreground transition-colors"
          onClick={() => onSort(sortBy)}
        >
          {label}
          <SortArrow active={currentSortBy === sortBy} order={sortOrder ?? "desc"} />
        </button>
      )}
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFilterText(""); }}>
        <PopoverTrigger asChild>
          <button
            className={`flex items-center gap-0.5 hover:text-foreground transition-colors ${
              isFiltered ? "text-foreground font-semibold" : ""
            }`}
          >
            {!sortable && label}
            <ChevronDown className={`h-3 w-3 ${isFiltered ? "text-foreground" : "text-muted-foreground/60"}`} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <div className="p-2 border-b">
            <Input
              placeholder={`Filter ${label.toLowerCase()}...`}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-7 text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            <button
              className={`w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors ${
                !isFiltered ? "font-medium" : ""
              }`}
              onClick={() => pick("all")}
            >
              <span className="w-4 h-4 flex items-center justify-center">
                {!isFiltered && <Check className="h-3 w-3" />}
              </span>
              All {label}s
            </button>
            {filtered.map((opt) => (
              <button
                key={opt.value}
                className={`w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors ${
                  isSelected(opt.value) ? "font-medium" : ""
                }`}
                onClick={() => pick(opt.value)}
              >
                <span className="w-4 h-4 flex items-center justify-center">
                  {isSelected(opt.value) && <Check className="h-3 w-3" />}
                </span>
                {opt.color && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                <span className="truncate">{opt.label}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-3 text-center">No matches</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
