"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Coins,
  Loader2,
  Lock,
  Sparkles,
} from "lucide-react";
import {
  useAcceptBudgetSuggestions,
  useBudgets,
  useGenerateBudgets,
  useRejectBudgetSuggestions,
} from "@/hooks/use-budgets";
import { useBudgetPlans } from "@/hooks/use-budget-plans";
import { useAccounts } from "@/hooks/use-accounts";
import { useCategories, useUpdateCategory } from "@/hooks/use-categories";
import { usePreferences } from "@/hooks/use-preferences";
import { isBudgetable } from "@/lib/default-categories";
import { getFinancialMonthRange } from "@/lib/financial-month";
import { currentFinancialSlot, MONTHS_PER_YEAR } from "@/lib/financial-year";
import { addLine, removeLine, updateLine } from "@/lib/budget-cache";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  BudgetHistoryDialog,
  type HistoryTarget,
} from "@/components/budget-history-dialog";
import { BudgetSuggestionsDialog } from "@/components/budget-suggestions-dialog";
import { useI18n } from "@/lib/i18n/client";
import type { CategoryWithDetails } from "@/types/api";
import type { EmptyGenerateReason } from "@/lib/auto-budget";
import { BudgetsSkeleton } from "../_components/budgets-skeleton";
import { SectionHeader } from "../_components/section-header";
import { NoticeLine } from "../_components/notice-line";
import { EmptyGenerateNotice } from "../_components/empty-generate-notice";
import { ImportBudgetDialog } from "../_components/import-budget-dialog";
import { RegenerateConfirmDialog } from "../_components/regenerate-confirm-dialog";
import { SuggestionRow } from "../_components/suggestion-row";
import { linkedRecurringIds } from "../_components/budget-row";
import { UNCATEGORIZED, useRecurringPlans } from "../_components/recurring-sections";
import type { TreeActions } from "../_components/sub-line-list/constants";
import type { DraftLine } from "../_components/sub-line-list/draft";
import {
  AddCategoryRow,
  AllocationEditor,
  GroupLabel,
  LockedRow,
} from "../_components/editor/rows";
import {
  EMPTY_DRAFT,
  changeCount,
  overlay,
  type Draft,
  type NewAllocation,
} from "../_components/editor/draft";
import { saveDraft } from "../_components/editor/save";

export default function BudgetEditPage() {
  return (
    <Suspense>
      <BudgetEditPageInner />
    </Suspense>
  );
}

/**
 * The plan, open for writing.
 *
 * A route of its own rather than a mode on the budget page, because the two
 * answer different questions: "how is this month going" wants spend, bars and
 * a period stepper, and "what should this plan be" wants none of them. There
 * is no period picker here at all — an allocation belongs to the BUDGET, not
 * to a month, so editing one from March and from July is the same edit. What
 * the month contributes is the reference figures, and those are always read
 * from the live one.
 *
 * Every change is drafted. Nothing here writes until Save, which is what makes
 * it safe to rebalance a whole plan: the totals at the top move as you type,
 * so you can see the answer before committing to it.
 */
function BudgetEditPageInner() {
  const i18n = useI18n();
  const { t, plural, formatCurrency } = i18n;
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: prefs } = usePreferences();
  const startDay = prefs?.financialMonthStartDay ?? 1;

  const { data: plansData } = useBudgetPlans();
  const plans = plansData?.plans ?? [];
  const selectedPlanId = searchParams.get("plan");
  const activePlan =
    plans.find((p) => p.id === selectedPlanId) ??
    plans.find((p) => p.isMain) ??
    plans[0] ??
    null;
  const activePlanId = activePlan?.id;
  const isYearly = activePlan?.period === "yearly";
  const backHref = activePlanId
    ? `/budgets?plan=${encodeURIComponent(activePlanId)}`
    : "/budgets";

  // The live financial month. Not a choice: the plan being edited is the same
  // plan in every month, and the figures beside the fields are only useful if
  // they describe the month the user is actually in.
  const liveSlot = useMemo(() => currentFinancialSlot(startDay), [startDay]);
  const { from: dateFrom, to: dateTo } = useMemo(
    () => getFinancialMonthRange(new Date(), startDay),
    [startDay],
  );

  const { data: accountsData, isLoading: accountsLoading } = useAccounts();
  const { data: categoriesData } = useCategories();
  const categories = categoriesData ?? [];
  // An allocation is plan-owned data, so it references the PLAN OWNER's
  // categories: on someone else's shared plan the caller's own ids are
  // rejected by POST /api/budgets. Own plans resolve to the same request as
  // `useCategories()` above, so this costs nothing there.
  const planAccountId =
    activePlan && activePlan.role !== "owner" ? activePlan.accounts[0]?.id : undefined;
  const { data: planCategoriesData } = useCategories(planAccountId);

  // Recolouring a category is a write on the CATEGORY, and the route only
  // lets an owner make it — so the dots are only a control on a plan whose
  // categories are the caller's own.
  const updateCategory = useUpdateCategory();
  const recolor = (categoryId: string) =>
    // "Uncategorized" is a bucket, not a row in the table — there is nothing
    // to recolour.
    (!activePlan || activePlan.role === "owner") && categoryId !== UNCATEGORIZED
      ? // `mutateAsync`, so a refusal reaches the dot and puts it back. The
        // rejection is handled there; nothing escapes into an onBlur.
        (hex: string) => updateCategory.mutateAsync({ id: categoryId, color: hex })
      : undefined;

  const { data = null, isLoading } = useBudgets({
    dateFrom,
    dateTo,
    budgetId: activePlanId,
    noScale: true,
    ...(isYearly
      ? { year: liveSlot.year, monthIndex: liveSlot.monthIndex }
      : {}),
  });

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  /** How many changes are waiting. Read before the early returns: it guards the tab. */
  const dirty = changeCount(draft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<HistoryTarget | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [emptyReason, setEmptyReason] = useState<EmptyGenerateReason | null>(null);
  const generateBudgets = useGenerateBudgets();
  const acceptSuggestions = useAcceptBudgetSuggestions();
  const rejectSuggestions = useRejectBudgetSuggestions();

  const recurring = useRecurringPlans({
    planAccountIds: activePlan ? activePlan.accounts.map((a) => a.id) : null,
    fixedCosts: data?.fixedCosts,
    incomeLines: data?.incomeLines,
    yearScope: false,
    accounts: accountsData ?? [],
    // The PLAN OWNER's categories, for the same reason the picker uses them:
    // a recurring row on a shared account is filed in the owner's space, and
    // the rows on screen name the owner's category ids — looked up in the
    // caller's own list they would resolve to nothing.
    categories: planCategoriesData ?? categories,
    linkedRecurringIds: linkedRecurringIds(data?.allocations ?? []),
    // A recurring payment added here is a change to the plan like any other:
    // drafted, counted in the figures above, written by Save.
    pending: draft.recurring,
    draftCreates: {
      add: (tx) => setDraft((d) => ({ ...d, recurring: [...d.recurring, tx] })),
      update: (tx) =>
        setDraft((d) => ({
          ...d,
          recurring: d.recurring.map((r) => (r.id === tx.id ? tx : r)),
        })),
      remove: (id) =>
        setDraft((d) => ({
          ...d,
          recurring: d.recurring.filter((r) => r.id !== id),
        })),
    },
  });

  // ─── Draft edits ───────────────────────────────────────────────────────────
  // Each one is a patch on the patch: nothing here reads the server's list, so
  // none of them can be invalidated by a refetch landing mid-edit.
  const setAmount = (id: string, amount: number) =>
    setDraft((d) => ({ ...d, amounts: { ...d.amounts, [id]: amount } }));

  const setNewAmount = (key: string, amount: number) =>
    setDraft((d) => ({
      ...d,
      added: d.added.map((row) => (row.key === key ? { ...row, amount } : row)),
    }));

  const remove = (id: string) =>
    setDraft((d) => ({ ...d, removed: [...d.removed, id] }));

  const restore = (id: string) =>
    setDraft((d) => ({ ...d, removed: d.removed.filter((x) => x !== id) }));

  const addCategory = (category: CategoryWithDetails, amount: number) =>
    setDraft((d) => ({
      ...d,
      added: [
        ...d.added,
        {
          key: `new:${crypto.randomUUID()}`,
          categoryId: category.id,
          categoryName: category.name,
          categoryColor: category.color,
          amount,
          lines: [],
        } satisfies NewAllocation,
      ],
    }));

  /** Sub-line edits on a saved allocation: an op appended to the log. */
  const savedActions = (allocationId: string): TreeActions => ({
    add: (parentId, name, amount) =>
      setDraft((d) => ({
        ...d,
        ops: [
          ...d.ops,
          {
            kind: "add",
            allocationId,
            parentId,
            id: `line:${crypto.randomUUID()}`,
            name,
            amount,
          },
        ],
      })),
    update: (id, name, amount) =>
      setDraft((d) => ({
        ...d,
        ops: [...d.ops, { kind: "update", allocationId, id, name, amount }],
      })),
    remove: (line) =>
      setDraft((d) => ({
        ...d,
        ops: [...d.ops, { kind: "remove", allocationId, id: line.id }],
      })),
  });

  /**
   * The same three edits on a row that has never been saved. Those go straight
   * into its local tree instead of the op log: the allocation has no id yet,
   * and `POST /api/budgets` writes the whole tree in one call anyway.
   */
  const newActions = (key: string): TreeActions => {
    const patch = (change: (lines: DraftLine[]) => DraftLine[]) =>
      setDraft((d) => ({
        ...d,
        added: d.added.map((row) =>
          row.key === key ? { ...row, lines: change(row.lines) } : row,
        ),
      }));
    return {
      add: (parentId, name, amount) =>
        patch((lines) =>
          addLine(lines, parentId, {
            id: crypto.randomUUID(),
            name,
            amount,
            children: [],
          }),
        ),
      update: (id, name, amount) => patch((lines) => updateLine(lines, id, { name, amount })),
      remove: (line) => patch((lines) => removeLine(lines, line.id)),
    };
  };

  // The browser's own guard, for a reload or a closed tab. In-app navigation
  // can't see this, so the one link off the page asks separately.
  useEffect(() => {
    if (dirty === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** The one way off this page that could lose work; see the back link below. */
  const leave = () => {
    if (dirty > 0 && !confirm(t("budgets.editor.discardConfirm"))) return;
    router.push(backHref);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    let result;
    try {
      result = await saveDraft(draft, activePlanId);
      setDraft(result.draft);
      // One refetch for the whole run, whatever happened: the list on screen
      // has to describe what the server now holds, including a partial save.
      // Its own failure is swallowed — the writes already landed, and letting
      // a refetch reject here would throw out of an onClick with nothing to
      // catch it, past the save-result handling below.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["budgets"] }),
        // A drafted plan that just landed is a new recurring row, and the
        // fixed-cost and income lines above are derived from those.
        queryClient.invalidateQueries({ queryKey: ["recurring"] }),
        queryClient.invalidateQueries({ queryKey: ["recurring-forecast"] }),
      ]).catch(() => {});
    } finally {
      // In a finally so a refetch that rejects can't leave the bar spinning
      // over a draft that has already been written.
      setSaving(false);
    }
    if (!result.failed) {
      // Nothing left to edit: back to the read-only view of what was just written.
      router.push(backHref);
      return;
    }
    setSaveError(
      result.saved > 0
        ? t("budgets.editor.savedSome", {
            saved: result.saved,
            total: result.total,
          })
        : t("budgets.editor.saveFailed"),
    );
  };

  const runGenerate = async () => {
    setEmptyReason(null);
    const result = await generateBudgets.mutateAsync({ budgetId: activePlanId });
    if (result.suggestions.length > 0) setSuggestionsOpen(true);
    else setEmptyReason(result.emptyReason ?? "no-history");
  };

  if (isLoading || accountsLoading) return <BudgetsSkeleton />;
  if (!data) return null;

  // A viewer on a shared plan may read the budget and change nothing in it.
  if (activePlan && activePlan.role === "viewer") {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <Lock className="h-8 w-8 text-muted-foreground/40" />
        <p className="max-w-sm text-sm text-muted-foreground">
          {t("budgets.editor.viewerOnly", { name: activePlan.ownerName ?? "" })}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href={backHref}>{t("budgets.editor.backToBudget")}</Link>
        </Button>
      </Card>
    );
  }

  // A yearly plan is planned in years. Its rows are stored monthly like every
  // other, so the conversion happens here, at the edge, and nothing below this
  // line has to know which kind of plan it is drawing.
  const units = isYearly
    ? {
        toDisplay: (stored: number) =>
          Math.round(stored * MONTHS_PER_YEAR * 100) / 100,
        toStored: (shown: number) => shown / MONTHS_PER_YEAR,
        unit: t("budgets.perYearShort"),
      }
    : {
        toDisplay: (stored: number) => stored,
        toStored: (shown: number) => shown,
        unit: t("budgets.perMonthShort"),
      };

  const rows = overlay(data.allocations, draft);
  const allocatedCatIds = new Set(rows.filter((r) => !r.removed).map((r) => r.categoryId));
  const available = (planCategoriesData ?? []).filter(
    (c) => !allocatedCatIds.has(c.id) && isBudgetable(c.kind),
  );

  // A fixed-cost category that also has an allocation hands its plans to that
  // row, exactly as the budget view does — one category, one line.
  const plansByCategory = new Map(
    recurring.expenseGroups.map((g) => [g.categoryId, g.items]),
  );
  const lockedExpenses = recurring.expenseGroups.filter(
    (g) => !allocatedCatIds.has(g.categoryId),
  );

  // What the plan comes to, live, as it is typed. This is the point of drafting
  // the whole thing: the consequence of a change is on screen before it is
  // committed, not after a save and a refetch.
  const allocatedMonthly = rows
    .filter((r) => !r.removed)
    .reduce((sum, r) => sum + r.amount, 0);
  const lockedMonthly = lockedExpenses.reduce(
    (sum, g) => sum + (g.fc?.monthlyAmount ?? 0),
    0,
  );
  const incomeMonthly = recurring.incomeGroups.reduce((sum, g) => sum + g.expected, 0);
  const unallocated = incomeMonthly - allocatedMonthly - lockedMonthly;

  const hasSuggestions = data.suggestions.length > 0;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 text-muted-foreground"
          asChild
        >
          <Link
            href={backHref}
            onClick={(e) => {
              // The only way out of this page that could lose work. The browser
              // guard below can't see an in-app navigation.
              if (dirty > 0 && !confirm(t("budgets.editor.discardConfirm"))) {
                e.preventDefault();
              }
            }}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            {activePlan?.name ?? t("budgets.fallbackTitle")}
          </Link>
        </Button>
      </div>

      {/* Save sits with the title rather than in a bar that appears at the
          bottom of the page: it is the one thing this screen is for, and a
          control that only exists once you have already changed something
          cannot be found by anyone wondering whether it will be there. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t("budgets.editor.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(isYearly ? "budgets.editor.introYearly" : "budgets.editor.intro")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty > 0 && (
            <span className="text-sm text-muted-foreground">
              {plural(
                dirty,
                "budgets.editor.pending.one",
                "budgets.editor.pending.other",
              )}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={leave} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || dirty === 0}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>

      {/* The plan's arithmetic, in the unit being typed. It moves as you type,
          which is the whole reason the changes are drafted rather than sent. */}
      <div className="grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-card">
        <Figure
          label={t("budgets.stat.income")}
          value={formatCurrency(units.toDisplay(incomeMonthly))}
        />
        <Figure
          label={t("budgets.stat.allocated")}
          value={formatCurrency(units.toDisplay(allocatedMonthly + lockedMonthly))}
        />
        <Figure
          label={t(
            unallocated < 0 ? "budgets.stat.overAllocated" : "budgets.stat.unallocated",
          )}
          value={formatCurrency(Math.abs(units.toDisplay(unallocated)))}
          tone={unallocated < 0 ? "text-red-700 dark:text-red-400" : undefined}
        />
      </div>

      {saveError && <NoticeLine icon={AlertTriangle}>{saveError}</NoticeLine>}

      {emptyReason && (
        <EmptyGenerateNotice
          reason={emptyReason}
          i18n={i18n}
          onDismiss={() => setEmptyReason(null)}
        />
      )}

      {/* Frozen while the run is in flight. `saveDraft` resolves against the
          draft it was handed and the result replaces what is in state, so an
          amount typed mid-save would be thrown away without a trace. */}
      <Card className="overflow-hidden" inert={saving}>
        <ul className="divide-y">
          <SectionHeader
            icon={Coins}
            label={t("budgets.planHeading", {
              count: rows.filter((r) => !r.removed).length + lockedExpenses.length,
            })}
            action={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 sm:h-8 sm:w-auto sm:px-3"
                  aria-label={
                    hasSuggestions
                      ? t("budgets.regenerate")
                      : t("budgets.generateFromHistory")
                  }
                  onClick={() =>
                    hasSuggestions ? setRegenerateOpen(true) : runGenerate()
                  }
                  disabled={generateBudgets.isPending || !data.automation.enabled}
                  title={
                    data.automation.enabled ? undefined : t("budgets.generateDisabled")
                  }
                >
                  {generateBudgets.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 sm:mr-1.5" />
                  )}
                  <span className="hidden sm:inline">
                    {hasSuggestions
                      ? t("budgets.regenerate")
                      : t("budgets.generateFromHistory")}
                  </span>
                </Button>
                {/* Import only ever creates rows, so it is offered only on a
                    budget with none — running it twice would double them. */}
                {data.allocations.length === 0 && (
                  <ImportBudgetDialog
                    budgetId={activePlanId}
                    accounts={accountsData ?? []}
                    defaultAccountId={
                      activePlan?.accounts[0]?.id ?? accountsData?.[0]?.id
                    }
                    startDate={dateFrom}
                  />
                )}
                {recurring.formDialog}
              </>
            }
          />

          {/* ponytail: suggestions write straight through, unlike everything
              else here — they are the server's rows, not the user's edits, and
              accepting one is a yes/no rather than a change to review. Fold
              them into the draft if the split ever confuses anyone. */}
          {data.suggestions.length > 0 && (
            <GroupLabel>
              {plural(
                data.suggestions.length,
                "budgets.suggestionsReady.one",
                "budgets.suggestionsReady.other",
              )}
            </GroupLabel>
          )}
          {data.suggestions.map((s) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              busy={acceptSuggestions.isPending || rejectSuggestions.isPending}
              onAccept={() =>
                acceptSuggestions.mutate([{ id: s.id, amount: s.suggestedAmount }])
              }
              onReject={() => rejectSuggestions.mutate([s.id])}
            />
          ))}

          {recurring.incomeGroups.length > 0 && (
            <GroupLabel>{t("budgets.stat.income")}</GroupLabel>
          )}
          {recurring.incomeGroups.map((group) => {
            const name =
              group.line?.categoryName ??
              group.items[0]?.categoryName ??
              t("common.uncategorized");
            const color =
              group.line?.categoryColor ?? group.items[0]?.categoryColor ?? null;
            return (
              <LockedRow
                key={group.categoryId}
                name={name}
                color={color}
                amount={units.toDisplay(group.expected)}
                unit={units.unit}
                onColor={recolor(group.categoryId)}
                plans={group.items}
                planRowProps={recurring.rowProps}
                onAddPlan={
                  group.categoryId === UNCATEGORIZED
                    ? undefined
                    : () => recurring.addUnderCategory(group.categoryId, "income")
                }
                onHistory={() =>
                  setHistoryTarget({
                    categoryId: group.categoryId,
                    categoryName: name,
                    categoryColor: color,
                    amount: group.expected,
                    kind: "income",
                  })
                }
              />
            );
          })}

          <GroupLabel>{t("budgets.editor.spending")}</GroupLabel>

          {rows.map((row) => (
            <AllocationEditor
              key={row.id}
              row={row}
              units={units}
              actions={row.isNew ? newActions(row.id) : savedActions(row.id)}
              plans={plansByCategory.get(row.categoryId) ?? []}
              planRowProps={recurring.rowProps}
              onAddPlan={() => recurring.addUnderCategory(row.categoryId, "expense")}
              onAmount={(stored) =>
                row.isNew ? setNewAmount(row.id, stored) : setAmount(row.id, stored)
              }
              onColor={recolor(row.categoryId)}
              onRemove={() => remove(row.id)}
              onRestore={() => restore(row.id)}
              onHistory={() => setHistoryTarget(row)}
            />
          ))}

          {/* Fixed costs with no cap of their own sit at the foot of the
              spending list, where their totals still count toward it. */}
          {lockedExpenses.map((group) => {
            const name =
              group.fc?.categoryName ??
              group.items[0]?.categoryName ??
              t("common.uncategorized");
            const color =
              group.fc?.categoryColor ?? group.items[0]?.categoryColor ?? null;
            return (
              <LockedRow
                key={group.categoryId}
                name={name}
                color={color}
                amount={units.toDisplay(group.fc?.monthlyAmount ?? 0)}
                unit={units.unit}
                onColor={recolor(group.categoryId)}
                plans={group.items}
                planRowProps={recurring.rowProps}
                onAddPlan={
                  group.categoryId === UNCATEGORIZED
                    ? undefined
                    : () => recurring.addUnderCategory(group.categoryId, "expense")
                }
                onHistory={() =>
                  setHistoryTarget({
                    categoryId: group.categoryId,
                    categoryName: name,
                    categoryColor: color,
                    amount: group.fc?.monthlyAmount ?? 0,
                  })
                }
              />
            );
          })}

          <AddCategoryRow
            categories={available}
            accountId={planAccountId}
            unit={units.unit}
            onAdd={(category, amount) => addCategory(category, units.toStored(amount))}
          />
        </ul>
      </Card>

      <BudgetHistoryDialog
        allocation={historyTarget}
        budgetId={activePlanId}
        onOpenChange={(open) => {
          if (!open) setHistoryTarget(null);
        }}
      />

      <BudgetSuggestionsDialog
        open={suggestionsOpen}
        onOpenChange={setSuggestionsOpen}
        suggestions={data.suggestions}
        lookbackMonths={data.automation.lookbackMonths}
      />

      <RegenerateConfirmDialog
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
        suggestionCount={data.suggestions.length}
        lookbackMonths={data.automation.lookbackMonths}
        pending={generateBudgets.isPending}
        onConfirm={() => {
          setRegenerateOpen(false);
          runGenerate();
        }}
      />
    </div>
  );
}

/** One figure of the plan's arithmetic: the label small, the number readable. */
function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3.5 sm:px-5">
      <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 truncate text-lg font-semibold tabular-nums sm:text-xl ${tone ?? ""}`}
      >
        {value}
      </p>
    </div>
  );
}
