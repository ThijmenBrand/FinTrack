"use client";

import { useMemo, useState } from "react";
import { Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useRecurring,
  useCreateRecurring,
  useUpdateRecurring,
  useDeleteRecurring,
} from "@/hooks/use-recurring";
import { useI18n } from "@/lib/i18n/client";
import type {
  Account,
  CategoryWithDetails,
  FixedCost,
  IncomeLine,
  RecurringTx,
} from "@/types/api";
import { RecurringItem } from "@/app/(app)/recurring/_components/recurring-item";
import {
  RecurringFormDialog,
  type RecurringPrefill,
} from "@/app/(app)/recurring/_components/recurring-form-dialog";
import { BudgetRow } from "./allocation-row";
import type { SplitShare } from "@/lib/budget-split";
import { fixedCostStatus, incomePlanSeed, incomeStatus } from "./budget-row";
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

/** One category's income line, with the plans that promise it. */
export interface IncomeGroup {
  categoryId: string;
  /** Absent when every plan in the category is paused — nothing is expected. */
  line?: IncomeLine;
  /** The period's figures, already resolved to the scope on screen. */
  expected: number;
  received: number;
  items: RecurringTx[];
}

/**
 * The recurring plans behind the budget list, grouped by the category they
 * land in: income on one side, fixed costs on the other.
 *
 * A hook rather than a section component because a fixed cost is a budgeted
 * expense like any other — the page sorts those groups in among the
 * allocations rather than stacking them below in a section of their own.
 * Income rows are built the same way and queue above them in the same list:
 * the API's line joined to the plans that promise it.
 */
export function useRecurringPlans({
  planAccountIds,
  fixedCosts,
  incomeLines,
  yearScope,
  accounts,
  categories,
  linkedRecurringIds,
}: {
  /** Accounts this plan owns; null when no plan scopes the page (= all). */
  planAccountIds: string[] | null;
  fixedCosts: FixedCost[] | undefined;
  /** The API's income side: one line per income category. */
  incomeLines: IncomeLine[] | undefined;
  /** Year scope reads a line's yearly figures instead of the month's. */
  yearScope: boolean;
  accounts: Account[];
  categories: CategoryWithDetails[];
  /**
   * Plans already absorbed by a sub-line row (see `linkedRecurringIds` in
   * `./budget-row`). Dropped before grouping so a linked plan never gets a
   * standalone row of its own — the category's other plans are unaffected.
   */
  linkedRecurringIds: Set<string>;
}) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTx | null>(null);
  // Seeds a NEW plan for an income category that has none to edit yet.
  const [prefill, setPrefill] = useState<RecurringPrefill | null>(null);

  const { data: allItems = [] } = useRecurring();
  const createRecurring = useCreateRecurring();
  const updateRecurring = useUpdateRecurring();
  const deleteRecurring = useDeleteRecurring();

  // Mirror the server's scope: a plan only counts plans on the accounts it
  // owns, so a Joint budget shows joint salary and joint bills and nothing else.
  const { incomeGroups, expenseGroups, showAccount } = useMemo(() => {
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
    const incomePlans = new Map<string, RecurringTx[]>();
    for (const item of scoped) {
      // Absorbed by its sub-line row already — showing it again here would be
      // the same bill counted as two rows.
      if (linkedRecurringIds.has(item.id)) continue;
      const key = item.categoryId ?? UNCATEGORIZED;
      if (item.type === "income") {
        const plans = incomePlans.get(key) ?? [];
        plans.push(item);
        incomePlans.set(key, plans);
        continue;
      }
      if (item.type !== "expense") continue;
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

    // The same shape for income. A yearly plan's line carries the year's own
    // expected/received so a year-scoped row measures a year rather than
    // repeating one month twelve times; a monthly plan has no year half, and
    // never renders in year scope anyway, so the month's figures stand.
    const lines = incomeLines ?? [];
    const scopeOf = (line: IncomeLine) => (yearScope && line.year) || line;
    const lineIds = new Set(lines.map((l) => l.categoryId));
    const incomeRows: IncomeGroup[] = [
      ...lines.map((line) => ({
        categoryId: line.categoryId,
        line,
        expected: scopeOf(line).expected,
        received: scopeOf(line).received,
        items: [...(incomePlans.get(line.categoryId) ?? [])].sort(byActive),
      })),
      // A category whose income plans are all paused gets no line — it expects
      // nothing this period — but keeps its row so those plans stay reachable,
      // exactly as a fully-paused fixed-cost category does.
      ...[...incomePlans.entries()]
        .filter(([categoryId]) => !lineIds.has(categoryId))
        .map(([categoryId, items]) => ({
          categoryId,
          expected: 0,
          received: 0,
          items: [...items].sort(byActive),
        })),
      // Biggest earner first, paused categories last on an expected of zero.
    ].sort((a, b) => b.expected - a.expected);

    return {
      incomeGroups: incomeRows,
      expenseGroups: ordered,
      showAccount: new Set(scoped.map((i) => i.accountId)).size > 1,
    };
  }, [allItems, planAccountIds, fixedCosts, incomeLines, yearScope, linkedRecurringIds]);

  const handleSubmit = async (payload: Record<string, unknown>) => {
    await (editing
      ? updateRecurring.mutateAsync({ id: editing.id, ...payload })
      : createRecurring.mutateAsync(payload));
    setDialogOpen(false);
    setEditing(null);
    setPrefill(null);
  };

  /**
   * The pencil on an income row. What a category expects is the sum of the
   * recurring income behind it — there is no separate number to edit — so
   * editing the category means editing that plan, or writing the first one.
   * With several plans there is no single one to mean, so it adds another,
   * seeded with what the category takes in today.
   */
  const editIncome = (group: IncomeGroup) => {
    if (group.items.length === 1) {
      setPrefill(null);
      setEditing(group.items[0]);
      setDialogOpen(true);
      return;
    }
    setEditing(null);
    setPrefill(
      incomePlanSeed(group, planAccountIds?.[0] ?? accounts[0]?.id ?? ""),
    );
    setDialogOpen(true);
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
    incomeGroups,
    expenseGroups,
    rowProps,
    editIncome,
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
          if (!next) {
            setEditing(null);
            setPrefill(null);
          }
        }}
        editing={editing}
        prefill={prefill}
        // Only a seeded create knows which side it is: the plain "add" button
        // opens on expense, as it always has.
        defaultType={prefill ? "income" : undefined}
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
 * There is nothing to delete (the category has no budget line yet), but the
 * pencil opens one seeded with this category, so a category can grow a cap and
 * sub-lines without being retyped somewhere else.
 */
export function FixedCostRow({
  group,
  rowProps,
  split,
  onHistory,
  onEdit,
}: {
  group: FixedCostGroup;
  rowProps: PlanRowProps;
  /** Who carries this bill on a shared budget; see BudgetRow. */
  split?: SplitShare[];
  onHistory: (target: HistoryTarget) => void;
  /** Opens the allocation dialog on this category. Absent = read-only period. */
  onEdit?: (group: FixedCostGroup) => void;
}) {
  const { t, plural, formatCurrency } = useI18n();
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
        split={split}
        unit={t("budgets.perMonthShort")}
        subNote={plural(
          group.items.length,
          "budgets.stat.recurringPayments.one",
          "budgets.stat.recurringPayments.other",
        )}
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
        // Uncategorized plans have no category to budget or look history up by.
        readOnly={!onEdit || group.categoryId === UNCATEGORIZED}
        onEdit={() => onEdit?.(group)}
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

/**
 * An income category as a budget line: what its recurring plans promise this
 * period against what actually landed, with those plans as its sub-lines.
 *
 * Deliberately the same row as a fixed cost — income is planned and then
 * reconciled exactly the way a bill is, so it should read the same way. Only
 * the direction of "good" flips: beating the plan is a windfall rather than an
 * overspend, which `incomeStatus` handles by topping out at emerald and never
 * reaching red. The pencil edits the same thing a spending row's does — what
 * this category is planned to be — which on the income side is the recurring
 * plan behind it (see `editIncome`).
 */
export function IncomeRow({
  group,
  rowProps,
  yearScope,
  onHistory,
  onEdit,
}: {
  group: IncomeGroup;
  rowProps: PlanRowProps;
  /** The figures are a whole year's when set — the row's unit says so. */
  yearScope?: boolean;
  onHistory: (target: HistoryTarget) => void;
  /** Opens the plan behind this category. Absent = read-only budget. */
  onEdit?: (group: IncomeGroup) => void;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const first = group.items[0];
  const { expected, received, percentage, outstanding, status } =
    incomeStatus(group);
  const settled = Math.abs(outstanding) < 0.01;
  const color = group.line?.categoryColor || first?.categoryColor || "#94a3b8";
  // The API labels its no-category bucket in its own tongue; the list speaks
  // the user's, so that one row is named here rather than passed through.
  const name =
    group.categoryId === UNCATEGORIZED
      ? t("common.uncategorized")
      : group.line?.categoryName || first?.categoryName || t("common.uncategorized");

  return (
    <>
      <BudgetRow
        name={name}
        color={color}
        tone={status}
        percentage={percentage}
        spent={received}
        limit={expected}
        flow="income"
        unit={t(yearScope ? "budgets.perYearShort" : "budgets.perMonthShort")}
        subNote={plural(
          group.items.length,
          "budgets.stat.recurringPayments.one",
          "budgets.stat.recurringPayments.other",
        )}
        delta={
          // A category whose plans are all paused expects nothing this period —
          // "received" would claim a payday that was never planned.
          expected === 0 && received === 0
            ? ""
            : outstanding <= -0.01
              ? t("budgets.extraAmount", {
                  amount: formatCurrency(-outstanding),
                })
              : settled
                ? t("budgets.received")
                : t("budgets.expectedAmount", {
                    amount: formatCurrency(outstanding),
                  })
        }
        facts={
          <>
            {group.line && group.line.avgMonthly > 0 && (
              <span>
                {t("budgets.row.avgReceivedPerMonth", {
                  amount: formatCurrency(group.line.avgMonthly),
                  months: group.line.avgMonths,
                })}
              </span>
            )}
            <span>
              {t("budgets.row.pctReceived", { pct: Math.round(percentage) })}
            </span>
          </>
        }
        // Uncategorized income has no category to plan against.
        readOnly={!onEdit || group.categoryId === UNCATEGORIZED}
        onEdit={() => onEdit?.(group)}
        // Uncategorized plans have no category to look history up by.
        onHistory={
          group.categoryId === UNCATEGORIZED
            ? undefined
            : () =>
                onHistory({
                  categoryId: group.categoryId,
                  categoryName: name,
                  categoryColor: color,
                  // The history plots months, so it wants the monthly figure —
                  // `expected` above may be a whole year's worth in year scope.
                  amount: group.line?.expected ?? 0,
                  kind: "income",
                })
        }
      />
      <PlanRows items={group.items} rowProps={rowProps} />
    </>
  );
}
