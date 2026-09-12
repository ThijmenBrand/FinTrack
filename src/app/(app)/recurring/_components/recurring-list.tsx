"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeftRight, Plus, Search, TrendingDown, TrendingUp } from "lucide-react";
import { toMonthly } from "@/lib/recurring";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import type { RecurringTx } from "@/types/api";
import { RecurringItem } from "./recurring-item";

export type SortKey = "next" | "amount" | "name";
export type SectionKey = "income" | "expense" | "transfer";
export type FilterKey = "all" | SectionKey;

/**
 * Which section a plan belongs in. A plan in a transfer category is neither:
 * it moves money between your own accounts, so the outgoing leg and the
 * matching incoming one would otherwise be counted as a real expense and a
 * real income — one move, booked twice, on both totals.
 */
export function sectionOf(item: RecurringTx): SectionKey {
  return item.categoryKind === "transfer" ? "transfer" : (item.type as "income" | "expense");
}

const SECTIONS: Record<
  SectionKey,
  { icon: typeof TrendingUp; tone: string; label: MessageKey; empty: MessageKey }
> = {
  income: {
    icon: TrendingUp,
    tone: "text-emerald-600 dark:text-emerald-400",
    label: "common.income",
    empty: "recurring.noIncomeYet",
  },
  expense: {
    icon: TrendingDown,
    tone: "text-red-600 dark:text-red-400",
    label: "common.expenses",
    empty: "recurring.noExpensesYet",
  },
  transfer: {
    icon: ArrowLeftRight,
    tone: "text-muted-foreground",
    label: "recurring.transfers",
    empty: "recurring.noMatches",
  },
};

/**
 * Every plan on one flat list rather than a card per type: with a handful of
 * items each, two cards were mostly empty and never the same height, and the
 * section rule alone carries the split.
 */
export function RecurringList({
  items,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  deletingId,
  togglingId,
}: {
  items: RecurringTx[];
  onAdd: (type: "income" | "expense") => void;
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
  /** The row whose delete / pause is still in flight, if any. */
  deletingId?: string | null;
  togglingId?: string | null;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("next");
  // One plan open at a time: two expanded panels push the rest of the list off
  // the screen and nothing here is worth comparing side by side.
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const rows = visibleRows(items, q, sort);
  const hasTransfers = items.some((i) => sectionOf(i) === "transfer");
  const showAccount = new Set(items.map((i) => i.accountId)).size > 1;

  // "All" means the two sides of the cash flow. Transfers count on neither, so
  // they stay out of it until they are asked for by name.
  const shown: SectionKey[] = filter === "all" ? ["income", "expense"] : [filter];
  const sections = shown
    .map((type) => {
      const sectionRows = rows.filter((i) => sectionOf(i) === type);
      return {
        type,
        rows: sectionRows,
        monthly: sectionRows
          .filter((i) => i.isActive)
          .reduce((s, i) => s + toMonthly(i.amount, i.frequency), 0),
      };
    })
    // A search that misses gets one answer for the page, not an empty section
    // per type. Unsearched, income and expenses keep their invitation.
    .filter((s) => s.rows.length > 0 || !q);

  // Counted after the search, so a query that only matches transfers still
  // offers the way to them instead of reading as "no plans match".
  const hiddenTransfers =
    filter === "all" ? rows.filter((i) => sectionOf(i) === "transfer").length : 0;

  const filterOptions: SegmentedOption<FilterKey>[] = [
    { value: "all", label: t("recurring.status.all") },
    { value: "income", label: t("common.income") },
    { value: "expense", label: t("common.expenses") },
    ...(hasTransfers ? [{ value: "transfer" as const, label: t("recurring.transfers") }] : []),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("recurring.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Segmented
          name="recurring-filter"
          legend={t("recurring.filterLegend")}
          value={filter}
          options={filterOptions}
          onChange={setFilter}
          className="order-last w-full sm:order-none sm:w-auto"
        />
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          {/* The prefix is inside the trigger, so the control reads "Sort: Next
              date" both on screen and to a screen reader. */}
          <SelectTrigger className="w-auto gap-1.5">
            <span className="text-muted-foreground">{t("recurring.sortBy")}</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="next">{t("recurring.sort.next")}</SelectItem>
            <SelectItem value="amount">{t("recurring.sort.amount")}</SelectItem>
            <SelectItem value="name">{t("recurring.sort.name")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sections.map(({ type, rows: sectionRows, monthly }) => {
        const { icon: Icon, tone, label, empty } = SECTIONS[type];
        return (
          <section key={type} className="mt-7">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
              <h2 className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                {t(label)}
              </h2>
              {sectionRows.length > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {sectionRows.length}
                </span>
              )}
              {/* No total on transfers: the two legs of one move point opposite
                  ways, so any sum of them is a number that means nothing. Each
                  row still carries its own amount. */}
              {sectionRows.length > 0 && type !== "transfer" && (
                <span className="ml-auto text-[13px] tabular-nums">
                  {formatCurrency(monthly)}{" "}
                  <span className="text-muted-foreground">{t("recurring.perMonthShort")}</span>
                </span>
              )}
              {/* Adding lands in the section you were reading, with its type
                  already picked — the page-level button always meant "expense".
                  A transfer is written as a plain income or expense plan and
                  only becomes one by its category, so it has no add of its own. */}
              {type !== "transfer" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-6 w-6 ${sectionRows.length > 0 ? "" : "ml-auto"}`}
                  onClick={() => onAdd(type)}
                  aria-label={t(type === "income" ? "recurring.addIncome" : "recurring.addExpense")}
                  title={t(type === "income" ? "recurring.addIncome" : "recurring.addExpense")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="mt-2.5 h-px bg-border" />
            {sectionRows.length === 0 ? (
              <p className="py-5 text-center text-sm text-muted-foreground">{t(empty)}</p>
            ) : (
              <ul className="mt-1">
                {sectionRows.map((item) => (
                  <RecurringItem
                    key={item.id}
                    item={item}
                    kind={type}
                    showAccount={showAccount}
                    expanded={expanded === item.id}
                    onExpand={() => setExpanded((id) => (id === item.id ? null : item.id))}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onToggle={onToggle}
                    deleting={deletingId === item.id}
                    toggling={togglingId === item.id}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {sections.length === 0 && (
        <div className="mt-10 text-center">
          <p className="text-sm text-muted-foreground">{t("recurring.noMatchesFor", { q: search.trim() })}</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setSearch("")}>
            {t("recurring.clearSearch")}
          </Button>
        </div>
      )}

      {hiddenTransfers > 0 && (
        <div className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-1">
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-[13px] text-muted-foreground">
            {plural(
              hiddenTransfers,
              "recurring.transfersHidden.one",
              "recurring.transfersHidden.other"
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setFilter("transfer")}>
            {t("recurring.showTransfers")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Search, then the chosen order with paused plans sunk to the bottom — they
 *  don't count toward a section's total, so they shouldn't interrupt the ones
 *  that do. `q` is already lowercased and trimmed. */
export function visibleRows(items: RecurringTx[], q: string, sort: SortKey) {
  return items
    .filter((i) => {
      if (!q) return true;
      return [i.description, i.categoryName, i.accountName].some((f) =>
        f?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || compare(sort, a, b));
}

/** Plans with no next date sort last — an ended plan isn't "coming up soonest". */
function compare(sort: SortKey, a: RecurringTx, b: RecurringTx) {
  if (sort === "amount")
    return toMonthly(b.amount, b.frequency) - toMonthly(a.amount, a.frequency);
  if (sort === "name") return a.description.localeCompare(b.description);
  return (a.nextOccurrence ?? "9999").localeCompare(b.nextOccurrence ?? "9999");
}
