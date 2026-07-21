"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Account, Category } from "@/types/api";

export const TYPE_OPTIONS = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "internal_transfer", label: "Transfer" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "reserved", label: "Reserved" },
];

const PERIOD_OPTIONS = [
  { value: "this-month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "last-3-months", label: "Last 3 Months" },
  { value: "last-6-months", label: "Last 6 Months" },
  { value: "this-year", label: "This Year" },
  { value: "last-year", label: "Last Year" },
];

const FILTER_KEYS = ["account", "category", "type", "period"] as const;

// Only category and type support exclusion (GitHub-style `-key:value` tokens).
const EXCLUDE_KEYS = ["category", "type"] as const;
type ExcludeKey = (typeof EXCLUDE_KEYS)[number];

interface FilterToken {
  key: string;
  value: string;
  prefix: string; // "" for free-text search, else "account:", "-type:", etc.
  text: string; // displayed value / search text
  exclude?: boolean;
}

export function computeDateRange(period: string): { from: string; to: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");

  switch (period) {
    case "this-month":
      return { from: `${yyyy}-${mm}-01`, to: "" };
    case "last-month": {
      const prev = new Date(yyyy, now.getMonth() - 1, 1);
      const lastDay = new Date(yyyy, now.getMonth(), 0);
      return {
        from: `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`,
        to: `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`,
      };
    }
    case "last-3-months": {
      const d = new Date(yyyy, now.getMonth() - 2, 1);
      return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: "" };
    }
    case "last-6-months": {
      const d = new Date(yyyy, now.getMonth() - 5, 1);
      return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: "" };
    }
    case "this-year":
      return { from: `${yyyy}-01-01`, to: "" };
    case "last-year":
      return { from: `${yyyy - 1}-01-01`, to: `${yyyy - 1}-12-31` };
    default:
      return { from: "", to: "" };
  }
}

interface TransactionSearchBarProps {
  search: string;
  accountFilter: string;
  categoryFilter: string;
  typeFilter: string;
  periodFilter: string;
  dateFromOverride: string;
  dateToOverride: string;
  excludeCategories: string[];
  excludeTypes: string[];
  accounts: Account[];
  categories: Category[];
  distinctTypes: string[];
  onApply: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  onApplyExclude: (key: ExcludeKey, value: string) => void;
  onRemoveExclude: (key: ExcludeKey, value: string) => void;
  onClearAll: () => void;
}

export function TransactionSearchBar({
  search,
  accountFilter,
  categoryFilter,
  typeFilter,
  periodFilter,
  dateFromOverride,
  dateToOverride,
  excludeCategories,
  excludeTypes,
  accounts,
  categories,
  distinctTypes,
  onApply,
  onRemove,
  onApplyExclude,
  onRemoveExclude,
  onClearAll,
}: TransactionSearchBarProps) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const activeTokens = useMemo(() => {
    const tokens: FilterToken[] = [];
    if (accountFilter !== "all") {
      const acc = accounts.find((a) => a.id === accountFilter);
      tokens.push({ key: "account", value: accountFilter, prefix: "account:", text: acc?.name || accountFilter });
    }
    if (categoryFilter !== "all") {
      const cat = categories.find((c) => c.id === categoryFilter);
      tokens.push({ key: "category", value: categoryFilter, prefix: "category:", text: cat?.name || categoryFilter });
    }
    if (typeFilter !== "all") {
      const t = TYPE_OPTIONS.find((o) => o.value === typeFilter);
      tokens.push({ key: "type", value: typeFilter, prefix: "type:", text: t?.label || typeFilter });
    }
    for (const id of excludeCategories) {
      const cat = categories.find((c) => c.id === id);
      tokens.push({ key: "category", value: id, prefix: "-category:", text: cat?.name || id, exclude: true });
    }
    for (const t of excludeTypes) {
      const opt = TYPE_OPTIONS.find((o) => o.value === t);
      tokens.push({ key: "type", value: t, prefix: "-type:", text: opt?.label || t, exclude: true });
    }
    if (dateFromOverride || dateToOverride) {
      const parts = [dateFromOverride && formatDate(dateFromOverride), dateToOverride && formatDate(dateToOverride)].filter(Boolean);
      tokens.push({ key: "period", value: "custom", prefix: "period:", text: parts.join(" — ") });
    } else if (periodFilter !== "all") {
      const p = PERIOD_OPTIONS.find((o) => o.value === periodFilter);
      tokens.push({ key: "period", value: periodFilter, prefix: "period:", text: p?.label || periodFilter });
    }
    if (search) {
      tokens.push({ key: "search", value: search, prefix: "", text: search });
    }
    return tokens;
  }, [accountFilter, categoryFilter, typeFilter, periodFilter, dateFromOverride, dateToOverride, excludeCategories, excludeTypes, search, accounts, categories]);

  const suggestions = useMemo(() => {
    const raw = inputValue.trim();
    const exclude = raw.startsWith("-");
    const body = (exclude ? raw.slice(1) : raw).toLowerCase();
    const keys: readonly string[] = exclude ? EXCLUDE_KEYS : FILTER_KEYS;
    const prefix = exclude ? "-" : "";
    const verb = exclude ? "Exclude" : "Filter";

    if (!body) {
      return keys.map((k) => ({
        type: "key" as const,
        key: k,
        exclude,
        label: `${prefix}${k}:`,
        description: `${verb} by ${k === "period" ? "time period" : k}`,
      }));
    }

    const colonIdx = body.indexOf(":");
    if (colonIdx !== -1) {
      const key = body.slice(0, colonIdx);
      const query = body.slice(colonIdx + 1);
      if (keys.includes(key)) {
        let options: { value: string; label: string }[] = [];
        if (key === "account") {
          options = accounts.map((a) => ({ value: a.id, label: a.name }));
        } else if (key === "category") {
          options = categories.map((c) => ({ value: c.id, label: c.name }));
        } else if (key === "type") {
          options = TYPE_OPTIONS.filter((o) => distinctTypes.includes(o.value));
        } else if (key === "period") {
          options = PERIOD_OPTIONS;
        }
        return options
          .filter((o) => !query || o.label.toLowerCase().includes(query))
          .map((o) => ({
            type: "value" as const,
            key,
            value: o.value,
            exclude,
            label: `${prefix}${key}:${o.label}`,
            description: "",
          }));
      }
    }

    const keyMatches = keys
      .filter((k) => k.startsWith(body))
      .map((k) => ({
        type: "key" as const,
        key: k,
        exclude,
        label: `${prefix}${k}:`,
        description: `${verb} by ${k}`,
      }));

    // Free-text search only applies to inclusive input.
    return exclude
      ? keyMatches
      : [
          ...keyMatches,
          { type: "search" as const, key: "search", exclude, label: body, description: "Search descriptions", value: body },
        ];
  }, [inputValue, accounts, categories, distinctTypes]);

  const handleSuggestionSelect = (suggestion: (typeof suggestions)[number]) => {
    if (suggestion.type === "key") {
      setInputValue(`${suggestion.exclude ? "-" : ""}${suggestion.key}:`);
      inputRef.current?.focus();
      return;
    }
    if (suggestion.type === "value" && "value" in suggestion) {
      if (suggestion.exclude) onApplyExclude(suggestion.key as ExcludeKey, suggestion.value!);
      else onApply(suggestion.key, suggestion.value!);
    } else if (suggestion.type === "search") {
      onApply("search", inputValue.trim());
    }
    setInputValue("");
    setShowSuggestions(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && inputValue === "" && activeTokens.length > 0) {
      const lastToken = activeTokens[activeTokens.length - 1];
      if (lastToken.exclude) onRemoveExclude(lastToken.key as ExcludeKey, lastToken.value);
      else onRemove(lastToken.key);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && suggestions.length > 0) {
        handleSuggestionSelect(suggestions[selectedSuggestion]);
      } else if (inputValue.trim()) {
        onApply("search", inputValue.trim());
        setInputValue("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedSuggestion((s) => Math.min(s + 1, suggestions.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedSuggestion((s) => Math.max(s - 1, 0));
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative">
      <div
        className="flex items-center gap-1.5 flex-wrap rounded-md border bg-background px-3 py-1.5 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 min-h-[40px] cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        {activeTokens.map((token) => (
          <Badge
            key={`${token.prefix}${token.value}`}
            variant="secondary"
            className="gap-1 pl-2 pr-1 py-0.5 text-xs font-mono shrink-0"
          >
            <span className={token.exclude ? "text-destructive" : "text-muted-foreground"}>{token.prefix}</span>
            <span>{token.text}</span>
            <button
              className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                if (token.exclude) onRemoveExclude(token.key as ExcludeKey, token.value);
                else onRemove(token.key);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={activeTokens.length === 0 ? "Filter transactions... (e.g. account:ING type:expense)" : "Add filter..."}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
            setSelectedSuggestion(0);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleInputKeyDown}
        />
        {activeTokens.length > 0 && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onClearAll();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden"
        >
          <div className="max-h-64 overflow-y-auto p-1">
            {suggestions.map((s, i) => (
              <button
                key={`${s.key}-${s.label}`}
                className={`w-full flex items-center justify-between rounded-sm px-3 py-2 text-sm transition-colors ${
                  i === selectedSuggestion ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                }`}
                onMouseEnter={() => setSelectedSuggestion(i)}
                onClick={() => handleSuggestionSelect(s)}
              >
                <span className="font-mono">
                  {s.type === "search" ? (
                    <span className="flex items-center gap-2">
                      <Search className="h-3 w-3 text-muted-foreground" />
                      {s.label}
                    </span>
                  ) : (
                    s.label
                  )}
                </span>
                {s.description && (
                  <span className="text-xs text-muted-foreground">{s.description}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
