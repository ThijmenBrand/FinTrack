"use client";

import { useState } from "react";
import type { Allocation, CategoryWithDetails, RecurringTx } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CategoryPicker } from "@/components/category-picker";
import { Loader2, Plus, Repeat } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { useAccounts } from "@/hooks/use-accounts";
import { useBudgetPlans } from "@/hooks/use-budget-plans";
import { useCategories } from "@/hooks/use-categories";
import { useCreateRecurring, useRecurring } from "@/hooks/use-recurring";
import {
  useCreateBudget,
  useUpdateSubLine,
  type BudgetChildInput,
} from "@/hooks/use-budgets";
import { fromMonthly, toMonthly } from "@/lib/recurring";
import {
  RecurringFormDialog,
  type RecurringPrefill,
} from "@/app/(app)/recurring/_components/recurring-form-dialog";
import { SubLineList, SubLineTree } from "./sub-line-list";
import { AdoptList } from "./sub-line-list/adopt-list";
import { cents, type TreeActions } from "./sub-line-list/constants";
import { TONE_TEXT } from "./budget-row";
import {
  addLine,
  adoptDrafts,
  linkedPlanIds,
  removeLine,
  sumLines,
  toChildInput,
  toLineNodes,
  uncoveredMonthly,
  updateLine,
  type DraftLine,
  type LineNode,
  type LinkedPlan,
} from "./sub-line-list/draft";

interface AllocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAlloc: Allocation | null;
  availableCategories: CategoryWithDetails[];
  /** Plan owner's account — a category created here lands in their space. */
  accountId?: string;
  categoryAverages: Record<string, number>;
  unallocated: number;
  /** Yearly plans enter and display the annual figure; storage stays monthly. */
  yearly?: boolean;
  /**
   * The plan the allocation belongs to. Only the paths this dialog posts
   * itself need it — a sub-line tree, a line made recurring, a plan adopted;
   * `onCreate`/`onUpdate` still carry the caller's own plan scoping. Absent
   * resolves the main plan, exactly as `POST /api/budgets` does.
   */
  budgetId?: string;
  /**
   * Seeds an ADD: the category the row that opened this already stands for, and
   * what it costs today. Keyed on by the caller, so switching rows re-seeds.
   */
  prefill?: { categoryId: string; amount: number } | null;
  onCreate: (categoryId: string, amount: number) => Promise<void>;
  onUpdate: (id: string, amount: number) => Promise<void>;
}

/** Twelve months make a year — the only conversion in the whole feature. */
const MONTHS_PER_YEAR = 12;

/** What the recurring form is being opened for. */
interface RecurringTarget {
  /**
   * The line to make recurring, or null for "this whole category is one
   * payment" — which has no line yet, so submitting creates the first one.
   */
  lineId: string | null;
  name: string;
  /** Stored (monthly) units, to seed the form's per-occurrence field from. */
  amount: number;
}

export function AllocationDialog({
  open,
  onOpenChange,
  editingAlloc,
  availableCategories,
  accountId,
  categoryAverages,
  unallocated,
  yearly = false,
  budgetId,
  prefill = null,
  onCreate,
  onUpdate,
}: AllocationDialogProps) {
  const { t, formatCurrency } = useI18n();

  // Allocations are always stored per month; a yearly plan just talks in
  // annual figures. Converting only at the edges keeps ×12 and ÷12 from
  // meeting in the middle and drifting.
  // Rounded to cents on the way out, because both directions can land on a
  // figure the field should never show: a yearly amount is stored as
  // `entered / 12` and multiplying it back is only exact for whole euros
  // (€100.01 a year would reopen as "100.00999999999999"), and an average is
  // whatever the division of past spend produced.
  const toDisplay = (monthly: number) =>
    Math.round((yearly ? monthly * MONTHS_PER_YEAR : monthly) * 100) / 100;
  const toStored = (shown: number) => (yearly ? shown / MONTHS_PER_YEAR : shown);
  const initialAmount = editingAlloc
    ? String(toDisplay(editingAlloc.amount))
    : prefill && prefill.amount > 0
      ? String(toDisplay(prefill.amount))
      : "";

  // Initial fields come from the edit target; the parent remounts this
  // component (via `key`) whenever the target changes, so no sync effect.
  const [categoryId, setCategoryId] = useState(
    editingAlloc?.categoryId ?? prefill?.categoryId ?? "",
  );
  const [amount, setAmount] = useState(initialAmount);
  // The add modal's tree, held here until Allocate writes the lot in one POST.
  // Edit mode has a saved allocation to hang sub-lines off, so it keeps
  // writing each one through its own endpoint as it goes.
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [recurringFor, setRecurringFor] = useState<RecurringTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Covers the whole submit, not just this dialog's own POST: onCreate and
  // onUpdate are the caller's mutations, and those are the paths a plain
  // allocation takes.
  const [saving, setSaving] = useState(false);

  const createBudget = useCreateBudget();
  const createRecurring = useCreateRecurring();
  const updateSubLine = useUpdateSubLine();

  // Reset to the edit target's values (empty for add) when closing, so a
  // reopened "add" dialog starts clean without a sync effect.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCategoryId(editingAlloc?.categoryId ?? prefill?.categoryId ?? "");
      setAmount(initialAmount);
      setDraft([]);
      setSeededFor(null);
      setRecurringFor(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const category = editingAlloc?.categoryId ?? categoryId;
  const categoryName =
    editingAlloc?.categoryName ??
    availableCategories.find((c) => c.id === categoryId)?.name ??
    "";

  // Which plan the allocation lands in, resolved the way the server resolves
  // it. It decides two things: the account a new recurring plan hangs off, and
  // which existing plans are in scope to adopt.
  const { data: plansData } = useBudgetPlans();
  const plan =
    plansData?.plans.find((p) => p.id === budgetId) ??
    plansData?.plans.find((p) => p.isMain) ??
    plansData?.plans[0] ??
    null;
  const planAccountIds = plan ? plan.accounts.map((a) => a.id) : null;

  const { data: allAccounts } = useAccounts();
  const accounts = (allAccounts ?? []).filter(
    (a) => !planAccountIds || planAccountIds.includes(a.id),
  );
  // The picker's list is what may still be allocated, so it never contains the
  // category being edited — the recurring form needs the full list to show the
  // one it is prefilled with.
  const { data: allCategories } = useCategories(accountId);
  const { data: allPlans } = useRecurring();

  const planOf = (id: string): LinkedPlan | undefined => {
    const found = allPlans?.find((p) => p.id === id);
    return found
      ? {
          frequency: found.frequency,
          dayOfWeek: found.dayOfWeek,
          dayOfMonth: found.dayOfMonth,
          monthOfYear: found.monthOfYear,
          startDate: found.startDate,
        }
      : undefined;
  };

  // A parent is its children — at every level, and whether they are saved rows
  // or lines that exist only in this modal. With any, the amount field stops
  // being something to type in and becomes something to read.
  const savedLines = editingAlloc?.subLines ?? [];
  const derived = editingAlloc
    ? savedLines.length > 0
      ? sumLines(savedLines)
      : null
    : draft.length > 0
      ? sumLines(draft)
      : null;
  const shown = derived !== null ? String(cents(toDisplay(derived))) : amount;
  const entered = parseFloat(amount);
  const stored = derived !== null ? derived : entered > 0 ? toStored(entered) : null;

  const draftActions: TreeActions = {
    add: (parentId, name, lineAmount) =>
      setDraft((d) =>
        addLine(d, parentId, {
          key: crypto.randomUUID(),
          name,
          amount: lineAmount,
          children: [],
        }),
      ),
    update: (id, name, lineAmount) =>
      setDraft((d) => updateLine(d, id, { name, amount: lineAmount })),
    remove: (line) => setDraft((d) => removeLine(d, line.id)),
  };

  /** The one-shot writes this dialog fires itself have nowhere else to fail. */
  const attempt = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
      return true;
    } catch {
      setError(t("budgets.subLines.errGeneric"));
      return false;
    }
  };

  /**
   * A new sub-line and the plan it stands for, in one POST. On an allocation
   * that already exists the endpoint attaches the child and re-sums, which is
   * the only way in: nothing links a plan to a sub-line already saved.
   */
  const postChild = (child: BudgetChildInput) =>
    createBudget.mutateAsync({
      categoryId: editingAlloc!.categoryId,
      amount: editingAlloc!.amount,
      budgetId,
      children: [child],
    });

  const handleSubmit = async () => {
    if (stored === null || stored <= 0 || saving) return;
    setSaving(true);
    try {
      if (editingAlloc) {
        await onUpdate(editingAlloc.id, stored);
      } else if (draft.length > 0) {
        const ok = await attempt(() =>
          createBudget.mutateAsync({
            categoryId,
            amount: stored,
            budgetId,
            children: toChildInput(draft),
          }),
        );
        if (!ok) return;
      } else {
        await onCreate(categoryId, stored);
      }
      handleOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRecurringSubmit = async (payload: Record<string, unknown>) => {
    if (!recurringFor) return;
    const spec: NonNullable<BudgetChildInput["recurring"]> = {
      accountId: String(payload.accountId),
      // Sign is the server's business: it stores expenses negative.
      amount: Math.abs(Number(payload.amount)),
      frequency: payload.frequency as NonNullable<
        BudgetChildInput["recurring"]
      >["frequency"],
      dayOfWeek: payload.dayOfWeek as number | null,
      dayOfMonth: payload.dayOfMonth as number | null,
      startDate: String(payload.startDate),
    };
    const monthly = toMonthly(spec.amount, spec.frequency);
    const name = String(payload.description || recurringFor.name);

    if (!editingAlloc) {
      setDraft((d) =>
        recurringFor.lineId === null
          ? addLine(d, null, {
              key: crypto.randomUUID(),
              name,
              amount: monthly,
              children: [],
              recurring: spec,
            })
          : updateLine(d, recurringFor.lineId, { name, amount: monthly, recurring: spec }),
      );
      setRecurringFor(null);
      return;
    }

    const ok = await attempt(async () => {
      if (recurringFor.lineId) {
        // An existing line: create the plan, then link it on — one PUT
        // attaches a recurring id to a saved sub-line, so there is no
        // in-between state where the old line is gone and the new one isn't
        // written yet.
        const created = (await createRecurring.mutateAsync({
          accountId: spec.accountId,
          description: name,
          amount: spec.amount,
          type: "expense",
          categoryId: editingAlloc!.categoryId,
          frequency: spec.frequency,
          dayOfWeek: spec.dayOfWeek,
          dayOfMonth: spec.dayOfMonth,
          startDate: spec.startDate,
        })) as { id: string };
        await updateSubLine.mutateAsync({ id: recurringFor.lineId, recurringId: created.id });
      } else {
        // "Whole category" toggle: no line exists yet, so the tree endpoint
        // creates the sub-line and its plan together.
        await postChild({ name, amount: monthly, recurring: spec });
      }
    });
    if (ok) setRecurringFor(null);
  };

  const handleAdopt = async (adopted: RecurringTx) => {
    const monthly = toMonthly(adopted.amount, adopted.frequency);
    if (!editingAlloc) {
      setDraft((d) =>
        addLine(d, null, {
          key: crypto.randomUUID(),
          name: adopted.description,
          amount: monthly,
          children: [],
          adoptRecurringId: adopted.id,
        }),
      );
      return;
    }
    await attempt(() =>
      postChild({
        name: adopted.description,
        amount: monthly,
        adoptRecurringId: adopted.id,
      }),
    );
  };

  const openRecurringFor = (line: LineNode) =>
    setRecurringFor({ lineId: line.id, name: line.name, amount: line.amount });

  // Past spend to offer as an autofill, in whichever unit is on screen.
  const avgMonthly = editingAlloc
    ? editingAlloc.avgMonthly
    : categoryId
      ? categoryAverages[categoryId] ?? 0
      : 0;
  const avg = toDisplay(avgMonthly);

  // Only expense plans in this category, and only on accounts this plan
  // scopes — the same scope the budgets page reads recurring rows through.
  const adoptable = category
    ? (allPlans ?? []).filter(
        (p) =>
          p.type === "expense" &&
          p.categoryId === category &&
          (!planAccountIds || planAccountIds.includes(p.accountId)),
      )
    : [];
  // Auto-adopt on picking a category. Those payments land here whether the
  // tree mentions them or not, so an unadopted plan is a cap that starts the
  // month over budget — there is no useful "leave it out" answer. Seeded once
  // per category: a line removed stays removed, and changing category re-seeds
  // from the new one rather than leaving the old one's bills behind.
  // Paused plans are skipped; they take nothing this month.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (!editingAlloc && category && allPlans && seededFor !== category) {
    setSeededFor(category);
    setDraft(adoptDrafts(adoptable));
  }

  const adoptedIds = linkedPlanIds(editingAlloc ? savedLines : draft);
  // What those plans commit the category to that no line here stands for yet.
  // Their payments land in this category whether the budget mentions them or
  // not, so a line below that figure reads as over budget before the month
  // starts. Said once, next to the list that fixes it in one click.
  const uncovered = uncoveredMonthly(adoptable, adoptedIds);
  const underCovered = stored !== null && stored < uncovered - 0.005;

  // The form has one prefill channel — the row it is editing — so the seed
  // travels as a plan that does not exist yet. Its id keys the remount, so
  // moving to another line re-derives the fields. `prefill` (not `editing`)
  // keeps the dialog reading as a create: this is always a new plan.
  const recurringPrefill: RecurringPrefill | null = recurringFor && {
    id: recurringFor.lineId ?? "whole-category",
    accountId: planAccountIds?.[0] ?? accounts[0]?.id ?? "",
    description: recurringFor.name,
    amount: fromMonthly(recurringFor.amount, "monthly"),
    categoryId: category || null,
    frequency: "monthly",
    dayOfWeek: null,
    dayOfMonth: null,
    startDate: new Date().toISOString().slice(0, 10),
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {/* The one control in this header that keeps its label at every width:
            a budget you cannot add a category to is not a budget. */}
        <Button
          data-tour="budget-add"
          variant="outline"
          size="sm"
          className="h-9 sm:h-8"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("budgets.addManually")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingAlloc ? t("budgets.alloc.editTitle") : t("budgets.alloc.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {editingAlloc
              ? t("budgets.alloc.editDescription", {
                  name: editingAlloc.categoryName ?? "",
                })
              : t("budgets.alloc.addDescription", {
                  amount: formatCurrency(unallocated),
                })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          {!editingAlloc && (
            <div className="grid gap-2">
              <Label>{t("common.category")}</Label>
              {/* Same picker as the transaction flows: type to filter, and
                  create the category on the spot when it isn't there yet. */}
              <CategoryPicker
                categories={availableCategories}
                value={categoryId || null}
                onChange={setCategoryId}
                accountId={accountId}
              />
              {availableCategories.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("budgets.alloc.noCategories")}
                </p>
              )}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="alloc-amount">
              {t(yearly ? "budgets.alloc.yearlyAmount" : "budgets.alloc.monthlyAmount")}
            </Label>
            {derived !== null ? (
              // Nothing here takes input: the figure is the breakdown's total.
              // A read-only field would still look like one, so the amount is
              // stated as a figure instead, next to what produced it.
              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2.5">
                <span className="text-xs text-muted-foreground">
                  {t("budgets.subLines.derivedTotal")}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {formatCurrency(cents(toDisplay(derived)))}
                </span>
              </div>
            ) : (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  &euro;
                </span>
                <Input
                  id="alloc-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="150.00"
                  value={shown}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-8"
                />
              </div>
            )}
            {/* Nothing to autofill into a field that adds itself up. */}
            {derived === null && avg > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("budgets.alloc.avgHintPrefix")}{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={() => setAmount(String(avg))}
                >
                  {formatCurrency(avg)}
                </button>
                {t(
                  yearly
                    ? "budgets.alloc.avgHintSuffixYearly"
                    : "budgets.alloc.avgHintSuffix",
                )}
              </p>
            )}
            {yearly && parseFloat(shown) > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("budgets.alloc.perMonthEquivalent", {
                  amount: formatCurrency(parseFloat(shown) / MONTHS_PER_YEAR),
                })}
              </p>
            )}
            {/* One payment for the lot — offered only while nothing has been
                broken out, because a split and a single plan are two different
                answers to the same question. */}
            {derived === null && category && stored !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 h-7 w-fit px-2 text-xs text-muted-foreground"
                onClick={() =>
                  setRecurringFor({ lineId: null, name: categoryName, amount: stored })
                }
              >
                <Repeat className="mr-1 h-3 w-3" />
                {t("budgets.alloc.wholeRecurring")}
              </Button>
            )}
          </div>
          <div className="grid gap-2 border-t pt-4">
            <p className="text-sm font-medium leading-none">
              {t("budgets.subLines.heading")}
            </p>
            {/* One surface under the rows: without it the lines read as more
                of the form above them rather than as the budget's parts. */}
            <div className="rounded-lg bg-muted/40 p-2">
              {editingAlloc ? (
                <SubLineList
                  variant="dialog"
                  alloc={editingAlloc}
                  cap={derived ?? editingAlloc.amount}
                  toDisplay={toDisplay}
                  toStored={toStored}
                  onMakeRecurring={openRecurringFor}
                />
              ) : (
                <SubLineTree
                  variant="dialog"
                  lines={toLineNodes(draft, planOf)}
                  cap={derived ?? 0}
                  toDisplay={toDisplay}
                  toStored={toStored}
                  actions={draftActions}
                  onMakeRecurring={openRecurringFor}
                />
              )}
            </div>
            {underCovered && (
              <p className={`text-xs ${TONE_TEXT.warning}`}>
                {t("budgets.alloc.uncoveredRecurring", {
                  amount: formatCurrency(cents(toDisplay(uncovered))),
                })}
              </p>
            )}
            <AdoptList
              plans={adoptable}
              adoptedIds={adoptedIds}
              toDisplay={toDisplay}
              onAdopt={handleAdopt}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              stored === null ||
              stored <= 0 ||
              (!editingAlloc && !categoryId) ||
              saving ||
              // An adopt or a make-recurring is still writing the tree this
              // would save the total of.
              createBudget.isPending
            }
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingAlloc ? t("common.save") : t("budgets.alloc.allocate")}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Stacked over this modal rather than replacing it: the budget being
          built is still the context for the payment being described. */}
      {recurringPrefill && (
        <RecurringFormDialog
          open
          onOpenChange={(next) => {
            if (!next) setRecurringFor(null);
          }}
          editing={null}
          prefill={recurringPrefill}
          accounts={accounts}
          categories={allCategories ?? availableCategories}
          onSubmit={handleRecurringSubmit}
          trigger={<span className="hidden" />}
        />
      )}
    </Dialog>
  );
}
