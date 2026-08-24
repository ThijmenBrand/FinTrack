"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChevronLeft, Loader2, Plus, Search, Users } from "lucide-react";
import { useCreateBudgetPlan, useUpdateBudgetPlan } from "@/hooks/use-budget-plans";
import { useCreateCategory } from "@/hooks/use-categories";
import { useCreateBudget } from "@/hooks/use-budgets";
import { BUDGETABLE_ACCOUNT_TYPES } from "@/lib/account-scope";
import { isBudgetable } from "@/lib/default-categories";
import { MONTHS_PER_YEAR } from "@/lib/financial-year";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import type {
  Account,
  BudgetPlanData,
  BudgetPlanPeriod,
  CategoryWithDetails,
} from "@/types/api";
import {
  AccountPicker,
  PeriodChoice,
  SplitEditor,
  useSplitKey,
} from "./plan-fields";

interface BudgetWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: BudgetPlanData[];
  accounts: Account[];
  categories: CategoryWithDetails[];
  /**
   * Typical monthly spend per category, for the limit suggestions in step 2.
   *
   * ponytail: these are the averages of the budget currently on screen, not of
   * the accounts being picked here — the plan doesn't exist yet, so there is
   * nothing to scope a fresh query to. They are a starting figure the user
   * edits, never a stored number. Swap for an accountIds-scoped average
   * endpoint if the suggestions ever have to be exact.
   */
  categoryAverages: Record<string, number>;
  /** Called with the new plan's id so the page can switch to it. */
  onCreated?: (planId: string) => void;
}

/** New categories made here: grey, no icon — recolor in settings if it matters. */
const DEFAULT_COLOR = "#94a3b8";

type WizardCategory = Pick<CategoryWithDetails, "id" | "name" | "color" | "kind">;

const STEPS = [
  { label: "budgets.wizard.step1", description: "budgets.wizard.step1Description" },
  { label: "budgets.wizard.step2", description: "budgets.wizard.step2Description" },
  { label: "budgets.wizard.step3", description: "budgets.wizard.step3Description" },
] as const;
const LAST_STEP = STEPS.length - 1;

/**
 * Creating a budget, one decision at a time: which accounts it watches and
 * what it is called, then what it plans for, then who carries it.
 *
 * A wizard rather than the edit form because none of it exists yet — the
 * accounts decide whether there is anything to split, and the categories are
 * only worth showing once there is a budget to hang them on. Editing an
 * existing plan stays a single form (BudgetPlanDialog), where every field
 * already has an answer.
 */
export function BudgetWizard({
  open,
  onOpenChange,
  plans,
  accounts,
  categories,
  categoryAverages,
  onCreated,
}: BudgetWizardProps) {
  const { t, plural, formatCurrency } = useI18n();
  const createPlan = useCreateBudgetPlan();
  const updatePlan = useUpdateBudgetPlan();
  const createBudget = useCreateBudget();
  const createCategory = useCreateCategory();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [period, setPeriod] = useState<BudgetPlanPeriod>("monthly");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Picked categories: present = budgeted, value = the amount being typed. */
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  /** Categories made in step 2 — kept until the refetched prop carries them. */
  const [added, setAdded] = useState<WizardCategory[]>([]);
  const [makeMain, setMakeMain] = useState(false);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // What already landed on the server, so a retry after a half-finished run
  // resumes instead of creating a second plan or doubling its limits.
  const createdId = useRef<string | null>(null);
  const savedCategories = useRef(new Set<string>());

  const split = useSplitKey(accounts, selectedIds, null);
  const budgetableAccounts = accounts.filter((a) =>
    (BUDGETABLE_ACCOUNT_TYPES as readonly string[]).includes(a.type),
  );
  const planNameById = new Map(plans.map((p) => [p.id, p.name]));

  // Limits are stored per month; a yearly plan just talks in annual figures.
  const yearly = period === "yearly";
  const toDisplay = (monthly: number) =>
    Math.round((yearly ? monthly * MONTHS_PER_YEAR : monthly) * 100) / 100;
  const toStored = (shown: number) => (yearly ? shown / MONTHS_PER_YEAR : shown);

  const budgetableCategories: WizardCategory[] = [
    ...categories,
    ...added.filter((a) => !categories.some((c) => c.id === a.id)),
  ].filter((c) => isBudgetable(c.kind));
  const needle = query.trim().toLowerCase();
  const visibleCategories = needle
    ? budgetableCategories.filter((c) => c.name.toLowerCase().includes(needle))
    : budgetableCategories;
  // Offer to make what was searched for, unless it already exists.
  const creatable =
    needle.length > 0 && !budgetableCategories.some((c) => c.name.toLowerCase() === needle);

  const entries = Object.entries(limits).filter(
    ([, v]) => parseFloat(v) > 0,
  );
  const plannedTotal = entries.reduce((sum, [, v]) => sum + parseFloat(v), 0);
  // A ticked category with a blank or zero amount would be silently dropped —
  // say so on the button instead.
  const limitsComplete = Object.values(limits).every((v) => parseFloat(v) > 0);

  // Switching the period after limits are typed would silently reinterpret
  // them — €400 a month is not €400 a year — so the figures move with it.
  const changePeriod = (next: BudgetPlanPeriod) => {
    if (next === period) return;
    setLimits((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, v]) => {
          const n = parseFloat(v);
          if (!(n > 0)) return [id, v];
          const moved =
            next === "yearly" ? n * MONTHS_PER_YEAR : n / MONTHS_PER_YEAR;
          return [id, String(Math.round(moved * 100) / 100)];
        }),
      ),
    );
    setPeriod(next);
  };

  const toggleAccount = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((v) => v !== id),
    );
  };

  const toggleCategory = (id: string, checked: boolean) => {
    setLimits((prev) => {
      if (!checked) {
        const { [id]: _dropped, ...rest } = prev;
        return rest;
      }
      // A limit is a round decision, not a measurement — the average it comes
      // from is shown unrounded next to it.
      const avg = Math.round(toDisplay(categoryAverages[id] ?? 0));
      return { ...prev, [id]: avg > 0 ? String(avg) : "" };
    });
  };

  const addCategory = async () => {
    setError(null);
    try {
      const cat = (await createCategory.mutateAsync({
        name: query.trim(),
        color: DEFAULT_COLOR,
        icon: null,
      })) as WizardCategory;
      setAdded((prev) => [...prev, cat]);
      // Ticked with no amount on purpose: there is no history to suggest one.
      setLimits((prev) => ({ ...prev, [cat.id]: "" }));
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    }
  };

  const reset = () => {
    setStep(0);
    setName("");
    setPeriod("monthly");
    setSelectedIds([]);
    setLimits({});
    setQuery("");
    setAdded([]);
    setMakeMain(false);
    setCreating(false);
    setDone(0);
    setError(null);
    createdId.current = null;
    savedCategories.current = new Set();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && creating) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    setDone(savedCategories.current.size);
    try {
      if (!createdId.current) {
        const created = await createPlan.mutateAsync({
          name: name.trim(),
          accountIds: selectedIds,
          period,
          ...split.payload,
        });
        createdId.current = created.id;
      }
      const planId = createdId.current;
      // Sequential on purpose: a dozen writes fired at once at libsql buys
      // nothing and makes a partial failure harder to resume from.
      for (const [categoryId, amount] of entries) {
        if (savedCategories.current.has(categoryId)) continue;
        await createBudget.mutateAsync({
          categoryId,
          amount: toStored(parseFloat(amount)),
          budgetId: planId,
        });
        savedCategories.current.add(categoryId);
        setDone(savedCategories.current.size);
      }
      // The very first budget is main already; this only ever promotes.
      if (makeMain && plans.length > 0) {
        await updatePlan.mutateAsync({ id: planId, isMain: true });
      }
      onCreated?.(planId);
      reset();
      onOpenChange(false);
    } catch (e) {
      setCreating(false);
      setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    }
  };

  const canContinue =
    step === 0
      ? name.trim().length > 0 && selectedIds.length > 0
      : step === 1
        ? limitsComplete
        : !split.isShared || split.valid;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>{t("budgets.wizard.title")}</DialogTitle>
          <DialogDescription>{t(STEPS[step].description)}</DialogDescription>
        </DialogHeader>

        {/* The sequence is the information here, so it gets a rail — a filled
            track per step, not numbered badges. */}
        <ol className="flex gap-2">
          {STEPS.map(({ label }, i) => (
            <li
              key={label}
              aria-current={i === step ? "step" : undefined}
              className="flex flex-1 flex-col gap-1.5"
            >
              <span
                className={cn(
                  "h-0.5 rounded-full transition-colors duration-200",
                  i <= step ? "bg-primary" : "bg-muted",
                )}
              />
              <span
                className={cn(
                  "truncate text-xs",
                  i === step
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {t(label)}
              </span>
            </li>
          ))}
        </ol>

        <div className="space-y-5">
          {step === 0 && (
            <>
              <AccountPicker
                accounts={budgetableAccounts}
                planNameById={planNameById}
                selectedIds={selectedIds}
                onToggle={toggleAccount}
              />

              <section className="space-y-2 border-t pt-5">
                <Label htmlFor="wizard-name">{t("common.name")}</Label>
                <Input
                  id="wizard-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("budgets.plan.namePlaceholder")}
                  maxLength={60}
                />
              </section>

              <section className="border-t pt-5">
                <PeriodChoice
                  name="wizard-period"
                  value={period}
                  onChange={changePeriod}
                />
              </section>
            </>
          )}

          {step === 1 && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && creatable) {
                      e.preventDefault();
                      void addCategory();
                    }
                  }}
                  placeholder={t("budgets.wizard.searchCategories")}
                  className="pl-9"
                  aria-label={t("budgets.wizard.searchCategories")}
                />
              </div>

              <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {visibleCategories.map((cat) => {
                  const checked = cat.id in limits;
                  const avg = toDisplay(categoryAverages[cat.id] ?? 0);
                  return (
                    <li
                      key={cat.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 transition-colors duration-150",
                        checked ? "bg-primary/5" : "hover:bg-muted/40",
                      )}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleCategory(cat.id, v === true)}
                        />
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: cat.color || DEFAULT_COLOR }}
                        />
                        <span className="truncate text-sm">{cat.name}</span>
                      </label>

                      {checked ? (
                        <div className="relative shrink-0">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                            &euro;
                          </span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={limits[cat.id]}
                            onChange={(e) =>
                              setLimits((prev) => ({
                                ...prev,
                                [cat.id]: e.target.value,
                              }))
                            }
                            aria-label={cat.name}
                            className="h-8 w-28 pl-6 text-right tabular-nums"
                          />
                        </div>
                      ) : (
                        avg > 0 && (
                          // The reason to tick this row, stated in the row.
                          <button
                            type="button"
                            onClick={() => toggleCategory(cat.id, true)}
                            className="shrink-0 rounded px-1 text-xs tabular-nums text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            {t("budgets.wizard.typically", {
                              amount: formatCurrency(avg),
                            })}
                          </button>
                        )
                      )}
                    </li>
                  );
                })}

                {/* Nothing to pick is a reason to make one, not a dead end. */}
                {creatable && (
                  <li>
                    <button
                      type="button"
                      onClick={addCategory}
                      disabled={createCategory.isPending}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted/40 disabled:opacity-60"
                    >
                      {createCategory.isPending ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">
                        {t("categoryPicker.create", { name: query.trim() })}
                      </span>
                    </button>
                  </li>
                )}

                {visibleCategories.length === 0 && !creatable && (
                  <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t(
                      budgetableCategories.length === 0
                        ? "budgets.wizard.noCategories"
                        : "budgets.wizard.noMatch",
                      { query: query.trim() },
                    )}
                  </li>
                )}
              </ul>

              {/* A ticked row with a blank amount would be dropped on
                  save; saying so beats a Next button that just sits
                  there dead. */}
              {limitsComplete ? (
                <p className="text-xs text-muted-foreground">
                  {entries.length === 0
                    ? t("budgets.wizard.categoriesOptional")
                    : t(
                        yearly
                          ? "budgets.wizard.plannedYearly"
                          : "budgets.wizard.plannedMonthly",
                        { amount: formatCurrency(plannedTotal) },
                      )}
                </p>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t("budgets.wizard.limitsIncomplete")}
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <>
              {split.isShared ? (
                <SplitEditor split={split} />
              ) : (
                <div className="rounded-lg border border-dashed p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    {t("budgets.wizard.notSharedTitle")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("budgets.wizard.notSharedBody")}
                  </p>
                  <Link
                    href="/accounts"
                    className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                  >
                    {t("budgets.wizard.toAccounts")}
                  </Link>
                </div>
              )}

              {plans.length > 0 && (
                <section className="flex items-center justify-between gap-4 border-t pt-5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t("budgets.plan.mainTitle")}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("budgets.plan.mainHint")}
                    </p>
                  </div>
                  <Switch
                    checked={makeMain}
                    onCheckedChange={setMakeMain}
                    aria-label={t("budgets.plan.mainTitle")}
                  />
                </section>
              )}

              {/* What is about to be created, in one line per decision — the
                  last chance to notice a wrong account before it moves. */}
              <section className="space-y-2 border-t pt-5">
                <Label>{t("budgets.wizard.summary")}</Label>
                <dl className="divide-y rounded-lg border text-sm">
                  {[
                    { term: t("common.name"), value: name.trim() },
                    {
                      term: t("budgets.plan.periodLabel"),
                      value: t(`budgets.plan.period.${period}`),
                    },
                    {
                      term: t("budgets.plan.accountsLabel"),
                      value: accounts
                        .filter((a) => selectedIds.includes(a.id))
                        .map((a) => a.name)
                        .join(", "),
                    },
                    {
                      term: t("budgets.wizard.step2"),
                      value:
                        entries.length === 0
                          ? t("common.none")
                          : `${plural(
                              entries.length,
                              "budgets.wizard.categoryCount.one",
                              "budgets.wizard.categoryCount.other",
                            )} · ${formatCurrency(plannedTotal)}`,
                    },
                  ].map((row) => (
                    <div
                      key={row.term}
                      className="flex items-baseline justify-between gap-4 px-3 py-2"
                    >
                      <dt className="shrink-0 text-xs text-muted-foreground">
                        {row.term}
                      </dt>
                      <dd className="min-w-0 truncate text-right font-medium">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 z-10 gap-2 border-t bg-background pt-3 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (step === 0 ? handleOpenChange(false) : setStep(step - 1))}
            disabled={creating}
          >
            {step > 0 && <ChevronLeft className="mr-1 h-4 w-4" />}
            {step === 0 ? t("common.cancel") : t("common.back")}
          </Button>
          <Button
            type="button"
            onClick={() => (step === LAST_STEP ? handleCreate() : setStep(step + 1))}
            disabled={!canContinue || creating}
          >
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {step < LAST_STEP
              ? t("common.next")
              : creating && entries.length > 0
                ? t("budgets.wizard.creatingProgress", {
                    done,
                    total: entries.length,
                  })
                : t("budgets.plan.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
