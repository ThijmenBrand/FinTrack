"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryPicker } from "@/components/category-picker";
import { useI18n } from "@/lib/i18n/client";
import type { CategoryWithDetails } from "@/types/api";
import { ROW_SHELL, ROW_TWIST } from "../budget-row";
import { PlanRows, type PlanRowProps } from "../recurring-sections";
import { SubLineTree } from "../sub-line-list";
import { cents, type TreeActions } from "../sub-line-list/constants";
import { toLineNodes } from "../sub-line-list/draft";
import type { RecurringTx } from "@/types/api";
import { AddPlanRow } from "./add-plan-row";
import { AmountField, DerivedAmount, EditorRow } from "./editor-row";
import type { EditorRow as Row } from "./draft";

interface Units {
  /** Stored (monthly) → what the fields show. A yearly plan multiplies by 12. */
  toDisplay: (stored: number) => number;
  toStored: (shown: number) => number;
  /** "/mo" or "/yr", so a figure is never ambiguous about its period. */
  unit: string;
}

/**
 * One budget category, open for editing: its cap, its breakdown, and the
 * recurring payments it covers.
 *
 * The cap is a field unless something else already decides it — a breakdown
 * adds up from below, and the endpoint re-derives it on every write, so a
 * typeable field there would be a number the server was going to overrule.
 */
export function AllocationEditor({
  row,
  units,
  actions,
  plans,
  planRowProps,
  onAddPlan,
  onAmount,
  onColor,
  onRemove,
  onRestore,
  onHistory,
}: {
  row: Row;
  units: Units;
  /** Writes into the draft — ops for a saved row, the local tree for a new one. */
  actions: TreeActions;
  /** This category's recurring payments, if it has any not already a sub-line. */
  plans: RecurringTx[];
  planRowProps: PlanRowProps;
  /** Absent on the budget view: reading a month creates no plan. */
  onAddPlan?: () => void;
  onAmount: (stored: number) => void;
  /** Recolours the category itself; absent when it isn't the caller's. */
  onColor?: (hex: string) => Promise<unknown>;
  onRemove: () => void;
  onRestore: () => void;
  onHistory?: () => void;
}) {
  const { t, formatCurrency } = useI18n();
  // A new row has a local tree; a saved one has the server's, with this
  // session's ops already laid over it.
  const lines = row.isNew ? toLineNodes(row.lines ?? []) : row.subLines;
  const derived = lines.length > 0;
  const shown = cents(units.toDisplay(row.amount));

  return (
    <EditorRow
      name={row.categoryName}
      color={row.categoryColor}
      onColor={onColor}
      unit={units.unit}
      reference={
        row.isNew
          ? t("budgets.editor.newLine")
          : row.avgMonthly > 0
            ? // In the same period as the field beside it. The average is
              // measured monthly either way, but quoting "/mo" next to a "/yr"
              // box is how a yearly budget gets set to a twelfth of itself.
              t("budgets.editor.avgSpend", {
                amount: formatCurrency(units.toDisplay(row.avgMonthly)),
                unit: units.unit,
                months: row.avgMonths,
              })
            : t("budgets.editor.noHistory")
      }
      // A row that has never been saved has no spend behind it to plot.
      onHistory={row.isNew ? undefined : onHistory}
      removed={row.removed}
      onRemove={onRemove}
      onRestore={onRestore}
      control={
        derived ? (
          <DerivedAmount
            amount={formatCurrency(shown)}
            hint={t("budgets.subLines.derivedTotal")}
          />
        ) : (
          <AmountField
            value={shown}
            onCommit={(next) => onAmount(units.toStored(next))}
            label={t("budgets.editor.amountFor", { name: row.categoryName ?? "" })}
          />
        )
      }
    >
      <SubLineTree
        lines={lines}
        cap={row.amount}
        toDisplay={units.toDisplay}
        toStored={units.toStored}
        actions={actions}
        color={row.categoryColor}
      />
      <PlanRows items={plans} rowProps={planRowProps} />
      {/* Not under a row on its way out: it has no bills left to gain. */}
      {onAddPlan && !row.removed && <AddPlanRow onAdd={onAddPlan} />}
    </EditorRow>
  );
}

/**
 * A category whose whole cost is recurring payments: income, or a fixed cost
 * with no cap of its own.
 *
 * There is no number to type here — the figure is the sum of the plans under
 * it, and typing over it would be a second answer to a question the plans have
 * already answered. So the row states the total, marks it as derived, and puts
 * every plan one click from its own form. That is the link out.
 */
export function LockedRow({
  name,
  color,
  amount,
  unit,
  plans,
  planRowProps,
  onAddPlan,
  onColor,
  onHistory,
}: {
  name: string;
  color: string | null;
  /** Recolours the category itself; absent when it isn't the caller's. */
  onColor?: (hex: string) => Promise<unknown>;
  /** Display units. */
  amount: number;
  unit: string;
  plans: RecurringTx[];
  planRowProps: PlanRowProps;
  /** Absent on the budget view: reading a month creates no plan. */
  onAddPlan?: () => void;
  onHistory?: () => void;
}) {
  const { t, plural, formatCurrency } = useI18n();

  return (
    <EditorRow
      name={name}
      color={color}
      onColor={onColor}
      unit={unit}
      reference={
        onHistory
          ? plural(
              plans.length,
              "budgets.editor.fromPlans.one",
              "budgets.editor.fromPlans.other",
            )
          : undefined
      }
      onHistory={onHistory}
      control={
        <DerivedAmount
          icon
          amount={formatCurrency(amount)}
          hint={t("budgets.editor.fromPlansHint")}
        />
      }
    >
      <PlanRows items={plans} rowProps={planRowProps} />
      {onAddPlan && <AddPlanRow onAdd={onAddPlan} />}
    </EditorRow>
  );
}

/**
 * The last row of the list: give a category a budget.
 *
 * Inline, at the foot of the list it adds to, rather than a dialog. Adding a
 * category is the thing this screen exists for and it happens several times in
 * a row — a modal that opens, takes two fields and closes is four interactions
 * per line where this is two.
 */
export function AddCategoryRow({
  categories,
  accountId,
  unit,
  onAdd,
}: {
  /** Everything not budgeted in this plan yet. */
  categories: CategoryWithDetails[];
  /** Where a category created on the spot lands; see the allocation dialog. */
  accountId?: string;
  unit: string;
  /** Display units — the caller converts. */
  onAdd: (category: CategoryWithDetails, amount: number) => void;
}) {
  const { t } = useI18n();
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");

  const category = categories.find((c) => c.id === categoryId);
  // Blank counts as zero, and zero is allowed: a category whose cost is its
  // breakdown gets its cap from the sub-lines added under it once the row
  // exists, so demanding a figure here would be asking for a number the
  // roll-up is about to overwrite.
  const parsed = amount.trim() === "" ? 0 : parseFloat(amount);
  const valid = !!category && isFinite(parsed) && parsed >= 0;

  const submit = () => {
    if (!valid || !category) return;
    onAdd(category, cents(parsed));
    setCategoryId("");
    setAmount("");
  };

  return (
    <li className={`${ROW_SHELL} items-center`}>
      <span className={ROW_TWIST} aria-hidden="true">
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <CategoryPicker
          categories={categories}
          value={categoryId || null}
          onChange={setCategoryId}
          accountId={accountId}
        />
      </span>
      <span className="ml-3 flex items-center gap-1.5">
        <span className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            &euro;
          </span>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
            aria-label={t("budgets.editor.newAmount")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="h-9 w-28 pl-6 text-right tabular-nums sm:w-32"
          />
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">{unit}</span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="ml-1 h-8 w-8 shrink-0"
        onClick={submit}
        disabled={!valid}
        aria-label={t("budgets.addManually")}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </li>
  );
}

/** A heading inside the list, naming what the rows under it are. */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-4 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </li>
  );
}
