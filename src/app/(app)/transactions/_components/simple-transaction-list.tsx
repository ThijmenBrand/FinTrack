"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryIcon } from "@/components/category-icon";
import { CategorizePopover } from "@/components/categorize-popover";
import { Search, Upload, FileSpreadsheet } from "lucide-react";
import type { Category, Pagination, Transaction } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { PaginationBar } from "./transactions-table";
import { PERIOD_OPTIONS } from "./transaction-search-bar";

type Option = { value: string; label: string };

/** One dropdown, "all" first — the only filter shape simple mode offers. */
function FilterSelect({
  value,
  allLabel,
  options,
  onChange,
}: {
  value: string;
  allLabel: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Simple mode's transactions view: who, when, which category, how much.
 * Search plus one dropdown each for period, category and type — no query
 * syntax, no sorting, no bulk actions, no pots and no per-row buttons.
 * Tapping a row opens the same detail dialog as the full view, which is where
 * anything more lives.
 */
export function SimpleTransactionList({
  transactions,
  pagination,
  setPagination,
  loading,
  fetching,
  search,
  onSearchChange,
  period,
  onPeriodChange,
  category,
  onCategoryChange,
  categories,
  type,
  onTypeChange,
  typeOptions,
  onOpen,
  onUpload,
}: {
  transactions: Transaction[];
  pagination: Pagination;
  setPagination: Dispatch<SetStateAction<Pagination>>;
  loading: boolean;
  fetching: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  period: string;
  onPeriodChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  categories: Category[];
  type: string;
  onTypeChange: (value: string) => void;
  typeOptions: Option[];
  onOpen: (tx: Transaction) => void;
  onUpload: () => void;
}) {
  const { t, formatCurrency, formatDate } = useI18n();

  // Typing drives the query, so hold the keystrokes locally and only push the
  // settled value up.
  const [draft, setDraft] = useState(search);
  useEffect(() => {
    const id = setTimeout(() => onSearchChange(draft), 300);
    return () => clearTimeout(id);
  }, [draft, onSearchChange]);

  const filtered =
    !!search || period !== "all" || category !== "all" || type !== "all";

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("tx.simple.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <FilterSelect
          value={period}
          allLabel={t("tx.period.allTime")}
          options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={onPeriodChange}
        />
        <FilterSelect
          value={category}
          allLabel={t("tx.table.allCategories")}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          onChange={onCategoryChange}
        />
        <FilterSelect
          value={type}
          allLabel={t("tx.table.allTypes")}
          options={typeOptions}
          onChange={onTypeChange}
        />
      </div>

      {loading && transactions.length === 0 ? (
        <div className="space-y-px">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-16">
          <FileSpreadsheet className="mb-4 h-16 w-16 text-muted-foreground/30" />
          <h3 className="mb-1 text-lg font-medium text-muted-foreground">
            {t("tx.table.emptyTitle")}
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            {filtered ? t("tx.table.emptyFiltered") : t("tx.table.emptyImport")}
          </p>
          {!filtered && (
            <Button onClick={onUpload}>
              <Upload className="mr-2 h-4 w-4" />
              {t("tx.importCsv")}
            </Button>
          )}
        </div>
      ) : (
        <div
          aria-busy={fetching}
          className={
            fetching
              ? "pointer-events-none opacity-50 transition-opacity"
              : "transition-opacity"
          }
        >
          {/* Column headers — desktop only; the phone rows stack instead. */}
          <div className="hidden items-center gap-3 border-b px-4 py-2 text-xs font-medium text-muted-foreground sm:flex">
            <span className="w-9 shrink-0" />
            <span className="flex-1">{t("common.description")}</span>
            <span className="w-28 shrink-0">{t("common.date")}</span>
            <span className="w-40 shrink-0">{t("common.category")}</span>
            <span className="w-28 shrink-0 text-right">{t("common.amount")}</span>
          </div>

          <div className="divide-y">
            {transactions.map((tx) => {
              const categoryPicker = (
                <CategorizePopover
                  transactionId={tx.id}
                  transactionDescription={tx.name || tx.description}
                  currentCategoryId={tx.categoryId}
                  currentCategoryName={tx.categoryName}
                  currentCategoryColor={tx.categoryColor}
                  currentCategoryIcon={tx.categoryIcon}
                  categories={categories}
                />
              );
              return (
                // Not a <button>: the category picker is an interactive control
                // inside the row, which can't nest in one.
                <div
                  key={tx.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(tx)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(tx);
                    }
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none active:bg-muted/50"
                >
                  <CategoryIcon
                    icon={tx.categoryIcon}
                    color={tx.categoryColor}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {tx.name || tx.description}
                    </p>
                    <p className="truncate text-xs text-muted-foreground sm:hidden">
                      {formatDate(tx.date)}
                    </p>
                    <div
                      className="-ml-2 sm:hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {categoryPicker}
                    </div>
                  </div>
                  <span className="hidden w-28 shrink-0 text-sm text-muted-foreground sm:block">
                    {formatDate(tx.date)}
                  </span>
                  <div
                    className="hidden w-40 shrink-0 sm:block"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {categoryPicker}
                  </div>
                  <span
                    className={`w-28 shrink-0 text-right font-mono text-sm font-medium ${
                      tx.amount >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {tx.amount >= 0 ? "+" : ""}
                    {formatCurrency(tx.amount)}
                  </span>
                </div>
              );
            })}
          </div>

          <PaginationBar pagination={pagination} setPagination={setPagination} />
        </div>
      )}
    </div>
  );
}
