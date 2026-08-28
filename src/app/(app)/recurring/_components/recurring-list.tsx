"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { RecurringTx } from "@/types/api";
import { RecurringItem } from "./recurring-item";

export type SortKey = "next" | "amount" | "name";
export type StatusKey = "all" | "active" | "paused";
export type SectionKey = "income" | "expense" | "transfer";

/**
 * Which section a plan belongs in. A plan in a transfer category is neither:
 * it moves money between your own accounts, so the outgoing leg and the
 * matching incoming one would otherwise be counted as a real expense and a
 * real income — one move, booked twice, on both totals.
 */
export function sectionOf(item: RecurringTx): SectionKey {
  return item.categoryKind === "transfer" ? "transfer" : (item.type as "income" | "expense");
}

/**
 * Both types live in one card rather than two side-by-side ones: with a handful
 * of items each, two cards were mostly empty and never the same height, and a
 * collapsed one showed nothing but its own title.
 */
export function RecurringList({
  items,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: {
  items: RecurringTx[];
  onAdd: (type: "income" | "expense") => void;
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusKey>("all");
  const [sort, setSort] = useState<SortKey>("next");

  const q = search.trim().toLowerCase();
  const visible = visibleRows(items, q, status, sort);

  const sections = (["income", "expense", "transfer"] as const)
    .map((type) => {
      const rows = visible.filter((i) => sectionOf(i) === type);
      const monthly = rows
        .filter((i) => i.isActive)
        .reduce((s, i) => s + toMonthly(i.amount, i.frequency), 0);
      return { type, rows, monthly };
    })
    // Income and expenses always keep their (empty) section — they're what the
    // page is for. Transfers only appear once there is one to show.
    .filter((s) => s.type !== "transfer" || s.rows.length > 0);
  const hasTransfers = sections.some((s) => s.type === "transfer");

  const activeCount = visible.filter((i) => i.isActive).length;
  const pausedCount = visible.length - activeCount;
  const showAccount = new Set(items.map((i) => i.accountId)).size > 1;
  const filtered = q !== "" || status !== "all";

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{t("recurring.listTitle")}</CardTitle>
        <CardDescription>
          {t("recurring.listActive", { count: activeCount })}
          {pausedCount > 0 ? ` · ${t("recurring.listPaused", { count: pausedCount })}` : ""}
          {` · ${t("recurring.listTotalsNote")}`}
          {hasTransfers ? ` · ${t("recurring.transfersNote")}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-0 sm:px-6">
        <div className="flex flex-col gap-2 px-4 sm:flex-row sm:items-center sm:px-0">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("recurring.searchPlaceholder")}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusKey)}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("recurring.status.all")}</SelectItem>
              <SelectItem value="active">{t("recurring.status.active")}</SelectItem>
              <SelectItem value="paused">{t("recurring.status.paused")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="next">{t("recurring.sort.next")}</SelectItem>
              <SelectItem value="amount">{t("recurring.sort.amount")}</SelectItem>
              <SelectItem value="name">{t("recurring.sort.name")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ul className="divide-y overflow-hidden border-y sm:rounded-md sm:border-x">
          {sections.map(({ type, rows, monthly }) => (
            <SectionGroup
              key={type}
              type={type}
              monthly={monthly}
              count={rows.length}
              filtered={filtered}
              onAdd={type === "transfer" ? undefined : () => onAdd(type)}
            >
              {rows.map((item) => (
                <RecurringItem
                  key={item.id}
                  item={item}
                  showAccount={showAccount}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggle={onToggle}
                />
              ))}
            </SectionGroup>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Search + status filter, then the chosen order with paused plans sunk to the
 *  bottom — they don't count toward a section's total, so they shouldn't
 *  interrupt the ones that do. `q` is already lowercased and trimmed. */
export function visibleRows(
  items: RecurringTx[],
  q: string,
  status: StatusKey,
  sort: SortKey
) {
  return items
    .filter((i) => {
      if (status !== "all" && i.isActive !== (status === "active")) return false;
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

function SectionGroup({
  type,
  monthly,
  count,
  filtered,
  onAdd,
  children,
}: {
  type: SectionKey;
  monthly: number;
  count: number;
  filtered: boolean;
  /** Absent on the transfer section: a transfer is written as a plain income
   *  or expense plan and only becomes one by its category, so there is no
   *  "add a transfer" that means anything here. */
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  const { t, formatCurrency } = useI18n();
  const isIncome = type === "income";
  const isTransfer = type === "transfer";
  const Icon = isTransfer ? ArrowLeftRight : isIncome ? TrendingUp : TrendingDown;
  const addLabel = isIncome ? t("recurring.addIncome") : t("recurring.addExpense");

  return (
    <>
      <li className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon
            className={`h-3.5 w-3.5 ${isTransfer ? "text-muted-foreground" : isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          />
          {isTransfer
            ? t("categories.kind.transfer")
            : isIncome
              ? t("common.income")
              : t("common.expenses")}
          {count > 0 && <span className="tabular-nums font-normal">({count})</span>}
        </span>
        <span className="flex items-center gap-2">
          {/* No total on transfers: the two legs of one move point opposite
              ways, so any sum of them is a number that means nothing. Each
              row still carries its own amount. */}
          {count > 0 && !isTransfer && (
            <span className="text-xs tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{formatCurrency(monthly)}</span>{" "}
              {t("recurring.perMonthShort")}
            </span>
          )}
          {/* Adding lands in the section you were reading, with its type already
              picked — the page-level button always meant "expense". */}
          {onAdd && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onAdd}
              aria-label={addLabel}
              title={addLabel}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      </li>
      {count === 0 ? (
        <li className="px-4 py-5 text-center text-sm text-muted-foreground">
          {filtered
            ? t("recurring.noMatches")
            : isIncome
              ? t("recurring.noIncomeYet")
              : t("recurring.noExpensesYet")}
        </li>
      ) : (
        children
      )}
    </>
  );
}
