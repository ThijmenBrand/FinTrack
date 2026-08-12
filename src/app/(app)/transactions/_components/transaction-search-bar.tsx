"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { parseSearchTerm } from "@/lib/search-query";
import type { Account, Category, Pot } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { I18n, MessageKey } from "@/lib/i18n/translate";

export const TYPE_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "income", labelKey: "tx.type.income" },
  { value: "expense", labelKey: "tx.type.expense" },
  { value: "internal_transfer", labelKey: "tx.type.internalTransfer" },
  { value: "reimbursement", labelKey: "tx.type.reimbursement" },
];

export const PERIOD_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "this-month", labelKey: "tx.period.thisMonth" },
  { value: "last-month", labelKey: "tx.period.lastMonth" },
  { value: "last-3-months", labelKey: "tx.period.last3Months" },
  { value: "last-6-months", labelKey: "tx.period.last6Months" },
  { value: "this-year", labelKey: "tx.period.thisYear" },
  { value: "last-year", labelKey: "tx.period.lastYear" },
];

// The `key:value` tokens are query syntax, not prose — they stay in English so
// a filter URL means the same thing whatever language the UI is in. Only the
// human-readable description beside each suggestion is translated.
const FILTER_KEYS = ["account", "category", "type", "period", "pot"] as const;

const FILTER_KEY_LABELS: Record<string, MessageKey> = {
  account: "tx.search.key.account",
  category: "tx.search.key.category",
  type: "tx.search.key.type",
  period: "tx.search.key.period",
  pot: "tx.search.key.pot",
};

function describeSearch(t: I18n["t"], raw: string): string {
  const parsed = parseSearchTerm(raw);
  if (parsed.date) return t("tx.search.textOrDate");
  if (parsed.amount)
    return parsed.text ? t("tx.search.textOrAmount") : t("tx.search.aroundAmount");
  return t("tx.search.descriptions");
}

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
  categoryFilters: string[];
  typeFilters: string[];
  potFilter: string;
  periodFilter: string;
  dateFromOverride: string;
  dateToOverride: string;
  excludeCategories: string[];
  excludeTypes: string[];
  accounts: Account[];
  categories: Category[];
  pots: Pot[];
  distinctTypes: string[];
  onApply: (key: string, value: string) => void;
  onRemove: (key: string, value?: string) => void;
  onApplyExclude: (key: ExcludeKey, value: string) => void;
  onRemoveExclude: (key: ExcludeKey, value: string) => void;
  onClearAll: () => void;
}

export function TransactionSearchBar({
  search,
  accountFilter,
  categoryFilters,
  typeFilters,
  potFilter,
  periodFilter,
  dateFromOverride,
  dateToOverride,
  excludeCategories,
  excludeTypes,
  accounts,
  categories,
  pots,
  distinctTypes,
  onApply,
  onRemove,
  onApplyExclude,
  onRemoveExclude,
  onClearAll,
}: TransactionSearchBarProps) {
  const { t, formatDate } = useI18n();
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const activeTokens = useMemo(() => {
    const tokens: FilterToken[] = [];
    if (accountFilter !== "all") {
      // The dashboard links here with its whole account scope, so the filter
      // can be a comma-separated list.
      const ids = accountFilter.split(",");
      const names = ids.map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean);
      tokens.push({
        key: "account",
        value: accountFilter,
        prefix: "account:",
        text:
          names.length === ids.length
            ? names.join(", ")
            : t("tx.search.accountCount", { count: ids.length }),
      });
    }
    for (const id of categoryFilters) {
      const cat = categories.find((c) => c.id === id);
      tokens.push({ key: "category", value: id, prefix: "category:", text: cat?.name || id });
    }
    for (const type of typeFilters) {
      const opt = TYPE_OPTIONS.find((o) => o.value === type);
      tokens.push({ key: "type", value: type, prefix: "type:", text: opt ? t(opt.labelKey) : type });
    }
    if (potFilter !== "all") {
      const pot = pots.find((p) => p.id === potFilter);
      tokens.push({ key: "pot", value: potFilter, prefix: "pot:", text: pot?.name || potFilter });
    }
    for (const id of excludeCategories) {
      const cat = categories.find((c) => c.id === id);
      tokens.push({ key: "category", value: id, prefix: "-category:", text: cat?.name || id, exclude: true });
    }
    for (const type of excludeTypes) {
      const opt = TYPE_OPTIONS.find((o) => o.value === type);
      tokens.push({
        key: "type",
        value: type,
        prefix: "-type:",
        text: opt ? t(opt.labelKey) : type,
        exclude: true,
      });
    }
    if (dateFromOverride || dateToOverride) {
      const parts = [dateFromOverride && formatDate(dateFromOverride), dateToOverride && formatDate(dateToOverride)].filter(Boolean);
      tokens.push({ key: "period", value: "custom", prefix: "period:", text: parts.join(" — ") });
    } else if (periodFilter !== "all") {
      const p = PERIOD_OPTIONS.find((o) => o.value === periodFilter);
      tokens.push({
        key: "period",
        value: periodFilter,
        prefix: "period:",
        text: p ? t(p.labelKey) : periodFilter,
      });
    }
    if (search) {
      tokens.push({ key: "search", value: search, prefix: "", text: search });
    }
    return tokens;
  }, [accountFilter, categoryFilters, typeFilters, potFilter, periodFilter, dateFromOverride, dateToOverride, excludeCategories, excludeTypes, search, accounts, categories, pots, t, formatDate]);

  const suggestions = useMemo(() => {
    const raw = inputValue.trim();
    const exclude = raw.startsWith("-");
    const body = (exclude ? raw.slice(1) : raw).toLowerCase();
    const keys: readonly string[] = exclude ? EXCLUDE_KEYS : FILTER_KEYS;
    const prefix = exclude ? "-" : "";
    const describeKey = (k: string) =>
      t(exclude ? "tx.search.excludeBy" : "tx.search.filterBy", {
        what: FILTER_KEY_LABELS[k] ? t(FILTER_KEY_LABELS[k]) : k,
      });

    if (!body) {
      return keys.map((k) => ({
        type: "key" as const,
        key: k,
        exclude,
        label: `${prefix}${k}:`,
        description: describeKey(k),
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
          options = TYPE_OPTIONS.filter((o) => distinctTypes.includes(o.value)).map((o) => ({
            value: o.value,
            label: t(o.labelKey),
          }));
        } else if (key === "period") {
          options = PERIOD_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
        } else if (key === "pot") {
          options = pots.map((p) => ({ value: p.id, label: p.name }));
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
        description: describeKey(k),
      }));

    // Free-text search only applies to inclusive input.
    return exclude
      ? keyMatches
      : [
          ...keyMatches,
          {
            type: "search" as const,
            key: "search",
            exclude,
            label: raw,
            description: describeSearch(t, raw),
            value: raw,
          },
        ];
  }, [inputValue, accounts, categories, pots, distinctTypes, t]);

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
      else onRemove(lastToken.key, lastToken.value);
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
                else onRemove(token.key, token.value);
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
          placeholder={
            activeTokens.length === 0
              ? t("tx.search.placeholder")
              : t("tx.search.addFilter")
          }
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
