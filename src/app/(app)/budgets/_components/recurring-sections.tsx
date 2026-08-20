"use client";

import { useMemo, useState } from "react";
import { Plus, Repeat, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useRecurring,
  useCreateRecurring,
  useUpdateRecurring,
  useDeleteRecurring,
} from "@/hooks/use-recurring";
import { toMonthly } from "@/lib/recurring";
import { useI18n } from "@/lib/i18n/client";
import type { Account, CategoryWithDetails, FixedCost, RecurringTx } from "@/types/api";
import { RecurringItem } from "@/app/(app)/recurring/_components/recurring-item";
import { RecurringFormDialog } from "@/app/(app)/recurring/_components/recurring-form-dialog";
import { BudgetRow } from "./allocation-row";
import { SectionHeader } from "./section-header";
import { fixedCostStatus } from "./budget-row";
import type { HistoryTarget } from "@/components/budget-history-dialog";

/** Server-side bucket key for a recurring row with no category. */
const UNCATEGORIZED = "uncategorized";

/** What every recurring row needs; identical for income and fixed costs. */
export interface PlanRowProps {
  showAccount: boolean;
  inBudgetList: boolean;
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
}

/** One category's fixed cost, with the plans that produce it. */
export interface FixedCostGroup {
  categoryId: string;
  /** Absent when every plan in the category is paused — nothing is due then. */
  fc?: FixedCost;
  items: RecurringTx[];
}

/**
 * The recurring plans behind the budget list: this plan's income, and the
 * fixed costs grouped by the category they land in.
 *
 * A hook rather than a section component because a fixed cost is a budgeted
 * expense like any other — the page sorts these groups in among the
 * allocations rather than stacking them below in a section of their own.
 */
export function useRecurringPlans({
  planAccountIds,
  fixedCosts,
  accounts,
  categories,
}: {
  /** Accounts this plan owns; null when no plan scopes the page (= all). */
  planAccountIds: string[] | null;
  fixedCosts: FixedCost[] | undefined;
  accounts: Account[];
  categories: CategoryWithDetails[];
}) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTx | null>(null);

  const { data: allItems = [] } = useRecurring();
  const createRecurring = useCreateRecurring();
  const updateRecurring = useUpdateRecurring();
  const deleteRecurring = useDeleteRecurring();

  // Mirror the server's scope: a plan only counts plans on the accounts it
  // owns, so a Joint budget shows joint salary and joint bills and nothing else.
  const { income, expenseGroups, showAccount } = useMemo(() => {
    const scoped =
      planAccountIds === null
        ? allItems
        : allItems.filter((i) => planAccountIds.includes(i.accountId));
    // Paused last within each group — they don't count toward any total, so
    // they shouldn't sit between the plans that do.
    const byActive = (a: RecurringTx, b: RecurringTx) =>
      Number(b.isActive) - Number(a.isActive);

    const progress = new Map((fixedCosts ?? []).map((fc) => [fc.categoryId, fc]));
    const groups = new Map<string, { fc?: FixedCost; items: RecurringTx[] }>();
    for (const item of scoped) {
      if (item.type !== "expense") continue;
      const key = item.categoryId ?? UNCATEGORIZED;
      const group = groups.get(key) ?? { fc: progress.get(key), items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    // Biggest monthly commitment first; a category whose plans are all paused
    // carries no fixed cost and sinks to the bottom rather than vanishing.
    const ordered: FixedCostGroup[] = [...groups.entries()]
      .map(([categoryId, group]) => ({
        categoryId,
        ...group,
        items: [...group.items].sort(byActive),
      }))
      .sort((a, b) => (b.fc?.monthlyAmount ?? 0) - (a.fc?.monthlyAmount ?? 0));

    return {
      income: scoped.filter((i) => i.type === "income").sort(byActive),
      expenseGroups: ordered,
      showAccount: new Set(scoped.map((i) => i.accountId)).size > 1,
    };
  }, [allItems, planAccountIds, fixedCosts]);

  const monthlyIncome = income
    .filter((i) => i.isActive)
    .reduce((sum, i) => sum + toMonthly(i.amount, i.frequency), 0);

  const handleSubmit = async (payload: Record<string, unknown>) => {
    await (editing
      ? updateRecurring.mutateAsync({ id: editing.id, ...payload })
      : createRecurring.mutateAsync(payload));
    setDialogOpen(false);
    setEditing(null);
  };

  // `mutate`, not `mutateAsync` — these fire from a row with nothing awaiting
  // them, so a failed request belongs in the mutation's error state rather
  // than an unhandled rejection.
  const rowProps: PlanRowProps = {
    showAccount,
    inBudgetList: true,
    onEdit: (item) => {
      setEditing(item);
      setDialogOpen(true);
    },
    onDelete: (id) => deleteRecurring.mutate(id),
    onToggle: (item) =>
      updateRecurring.mutate({ id: item.id, isActive: !item.isActive }),
  };

  return {
    income,
    monthlyIncome,
    expenseGroups,
    rowProps,
    /**
     * Add/edit form for both kinds of plan — the form itself picks income or
     * expense. Rendered in the list header: it is also what the pencil on a
     * row opens, so it has to be mounted whichever period is on screen.
     */
    formDialog: (
      <RecurringFormDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditing(null);
        }}
        editing={editing}
        accounts={accounts}
        categories={categories}
        onSubmit={handleSubmit}
        trigger={
          // Icon-only on a phone, like the other controls in that header — and
          // the repeat mark rather than a plus, because it shares the row with
          // "add category" and two plus buttons say nothing about which is which.
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 sm:h-8 sm:w-auto sm:px-3"
            aria-label={t("recurring.add")}
          >
            <Repeat className="h-3.5 w-3.5 sm:hidden" />
            <Plus className="hidden h-3.5 w-3.5 sm:mr-1.5 sm:inline" />
            <span className="hidden sm:inline">{t("recurring.add")}</span>
          </Button>
        }
      />
    ),
  };
}

/**
 * The plan's income: its own section at the foot of the list.
 *
 * Income is the only part of the plan that isn't an expense, so it keeps a
 * heading of its own — everything above it is money going out.
 */
export function IncomeSection({
  income,
  monthlyIncome,
  rowProps,
}: {
  income: RecurringTx[];
  monthlyIncome: number;
  rowProps: PlanRowProps;
}) {
  const { t, formatCurrency } = useI18n();
  if (income.length === 0) return null;

  return (
    <>
      <SectionHeader
        icon={TrendingUp}
        iconClassName="text-emerald-600 dark:text-emerald-400"
        label={t("common.income")}
        note={`${formatCurrency(monthlyIncome)}${t("recurring.perMonthShort")}`}
      />
      {/* No indent: income rows sit under their section heading, not under a
          category row the way fixed costs do. */}
      {income.map((item) => (
        <RecurringItem key={item.id} item={item} {...rowProps} />
      ))}
    </>
  );
}

/** The recurring plans under a category, indented like its sub-lines. */
export function PlanRows({
  items,
  rowProps,
}: {
  items: RecurringTx[];
  rowProps: PlanRowProps;
}) {
  return items.map((item) => (
    <RecurringItem key={item.id} item={item} className="sm:pl-9" {...rowProps} />
  ));
}

/**
 * A fixed-cost category as a budget line: the category's planned-vs-paid row,
 * with the recurring plans that produce it as its sub-lines.
 *
 * The same expandable row as an allocation — a fixed-cost category is spent
 * against like any other, so it owes the same facts and the same history.
 * Editing stays on the plan rows underneath: the category has no budget line
 * of its own to edit or delete.
 */
export function FixedCostRow({
  group,
  rowProps,
  onHistory,
}: {
  group: FixedCostGroup;
  rowProps: PlanRowProps;
  onHistory: (target: HistoryTarget) => void;
}) {
  const { t, formatCurrency } = useI18n();
  const first = group.items[0];
  const { limit, spent, percentage, outstanding, status } = fixedCostStatus(group.fc);
  const settled = Math.abs(outstanding) < 0.01;
  const color = group.fc?.categoryColor || first.categoryColor || "#94a3b8";
  const name =
    group.fc?.categoryName || first.categoryName || t("common.uncategorized");

  return (
    <>
      <BudgetRow
        name={name}
        color={color}
        tone={status}
        percentage={percentage}
        spent={spent}
        limit={limit}
        delta={
          // A category whose plans are all paused owes nothing this month —
          // "paid" would be a lie, so it gets no note at all.
          limit === 0 && spent === 0
            ? ""
            : status === "exceeded"
              ? t("budgets.overAmount", { amount: formatCurrency(-outstanding) })
              : settled
                ? t("budgets.paid")
                : t("budgets.dueAmount", { amount: formatCurrency(outstanding) })
        }
        facts={
          <>
            {group.fc && group.fc.avgMonthly > 0 && (
              <span>
                {t("budgets.row.avgPerMonth", {
                  amount: formatCurrency(group.fc.avgMonthly),
                  months: group.fc.avgMonths,
                })}
              </span>
            )}
            <span>
              {t("budgets.row.pctUsed", { pct: Math.round(percentage) })}
            </span>
          </>
        }
        readOnly
        // Uncategorized plans have no category to look history up by.
        onHistory={
          group.categoryId === UNCATEGORIZED
            ? undefined
            : () =>
                onHistory({
                  categoryId: group.categoryId,
                  categoryName: name,
                  categoryColor: color,
                  amount: limit,
                })
        }
      />
      <PlanRows items={group.items} rowProps={rowProps} />
    </>
  );
}
