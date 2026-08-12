"use client";

import { useMemo, useState } from "react";
import { Lock, Plus, TrendingUp } from "lucide-react";
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
import { CategoryProgressRow } from "./category-progress-row";
import { SectionHeader } from "./section-header";

/** Server-side bucket key for a recurring row with no category. */
const UNCATEGORIZED = "uncategorized";

/**
 * The income and fixed-cost sections of the budget list.
 *
 * These rows *are* the budget's income line and its fixed-cost line — the API
 * derives both from `recurring_transactions` — so they are list items in the
 * plan itself, not a card beside it and not folded away behind a disclosure.
 * A bill you cannot avoid is the first thing a budget has to account for; it
 * gets the same row, the same columns and the same visibility as a category
 * you choose to spend on.
 *
 * Returns bare `<li>`s: the caller owns the `<ul>` so every section of the
 * plan divides and aligns as one list.
 */
export function RecurringSections({
  fixedCosts,
  planAccountIds,
  accounts,
  categories,
}: {
  fixedCosts: FixedCost[];
  /** Accounts this plan owns; null when no plan scopes the page (= all). */
  planAccountIds: string[] | null;
  accounts: Account[];
  categories: CategoryWithDetails[];
}) {
  const { t, formatCurrency } = useI18n();
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

    const progress = new Map(fixedCosts.map((fc) => [fc.categoryId, fc]));
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
    const ordered = [...groups.entries()]
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
  const fixedSpent = fixedCosts.reduce((sum, fc) => sum + fc.spent, 0);
  const fixedLimit = fixedCosts.reduce((sum, fc) => sum + fc.monthlyAmount, 0);

  const openEdit = (item: RecurringTx) => {
    setEditing(item);
    setDialogOpen(true);
  };

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
  const rowProps = {
    showAccount,
    onEdit: openEdit,
    onDelete: (id: string) => deleteRecurring.mutate(id),
    onToggle: (item: RecurringTx) =>
      updateRecurring.mutate({ id: item.id, isActive: !item.isActive }),
  };

  return (
    <>
      {income.length > 0 && (
        <>
          <SectionHeader
            icon={TrendingUp}
            iconClassName="text-emerald-600 dark:text-emerald-400"
            label={t("common.income")}
            note={`${formatCurrency(monthlyIncome)}${t("recurring.perMonthShort")}`}
          />
          {/* No indent: income rows sit under their section heading, not under
              a category row the way fixed costs do. */}
          {income.map((item) => (
            <RecurringItem key={item.id} item={item} {...rowProps} />
          ))}
        </>
      )}

      <SectionHeader
        icon={Lock}
        label={t("budgets.fixedCostsTitle")}
        note={
          fixedLimit > 0
            ? t("budgets.allocationsSpent", {
                spent: formatCurrency(fixedSpent),
                limit: formatCurrency(fixedLimit),
              })
            : undefined
        }
        action={
          // One dialog for both sections — the form picks income or expense.
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
              <Button variant="ghost" size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("recurring.add")}
              </Button>
            }
          />
        }
      />
      {expenseGroups.length === 0 ? (
        <li className="px-4 py-6 text-center text-sm text-muted-foreground">
          {t("budgets.noFixedCostsYet")}
        </li>
      ) : (
        expenseGroups.map(({ categoryId, fc, items }) => (
          <CategoryGroup
            key={categoryId}
            fc={fc}
            items={items}
            rowProps={rowProps}
          />
        ))
      )}
    </>
  );
}

/** One category's planned-vs-paid line, with the plans that produce it beneath. */
function CategoryGroup({
  fc,
  items,
  rowProps,
}: {
  fc?: FixedCost;
  items: RecurringTx[];
  rowProps: {
    showAccount: boolean;
    onEdit: (item: RecurringTx) => void;
    onDelete: (id: string) => void;
    onToggle: (item: RecurringTx) => void;
  };
}) {
  const { t, formatCurrency } = useI18n();
  const first = items[0];
  const monthlyAmount = fc?.monthlyAmount ?? 0;
  const spent = fc?.spent ?? 0;
  const pct = monthlyAmount > 0 ? Math.min(100, (spent / monthlyAmount) * 100) : 0;
  const outstanding = monthlyAmount - spent;
  const over = outstanding <= -0.01;
  const settled = Math.abs(outstanding) < 0.01;

  return (
    <>
      <CategoryProgressRow
        color={fc?.categoryColor || first.categoryColor || "#94a3b8"}
        name={
          fc?.categoryName || first.categoryName || t("common.uncategorized")
        }
        progressPct={pct}
        barClassName={over ? "bg-red-500" : "bg-slate-400"}
        amount={
          <>
            <span className="font-medium">{formatCurrency(spent)}</span>
            <span className="text-muted-foreground">
              {" / "}
              {formatCurrency(monthlyAmount)}
            </span>
          </>
        }
        delta={
          // A category whose plans are all paused owes nothing this month —
          // "paid" would be a lie, so it gets no note at all.
          monthlyAmount === 0 && spent === 0 ? null : (
            <span
              className={over ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}
            >
              {over
                ? t("budgets.overAmount", { amount: formatCurrency(-outstanding) })
                : settled
                  ? t("budgets.paid")
                  : t("budgets.dueAmount", { amount: formatCurrency(outstanding) })}
            </span>
          )
        }
      />
      {items.map((item) => (
        <RecurringItem key={item.id} item={item} className="sm:pl-9" {...rowProps} />
      ))}
    </>
  );
}
