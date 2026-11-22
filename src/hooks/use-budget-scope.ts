"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { useBudgetPlans } from "@/hooks/use-budget-plans";
import type { BudgetPlanData } from "@/types/api";

/** The cross-budget scope. Not a plan id, so it can't collide with one. */
export const ALL_BUDGETS = "all" as const;

export type BudgetScopeValue = typeof ALL_BUDGETS | string;

export interface BudgetScope {
  /** Every plan the user can read, in the order the API returned them. */
  plans: BudgetPlanData[];
  /** ALL_BUDGETS, a plan id, or null while plans/preferences load. */
  value: BudgetScopeValue | null;
  /** The scoped plan; null on ALL_BUDGETS or before plans load. */
  plan: BudgetPlanData | null;
  /**
   * The plan a one-budget view falls back to under ALL_BUDGETS — the main
   * plan. Views that can only show one budget use this and name it, so the
   * sidebar and the page never disagree about which budget is on screen.
   */
  fallbackPlan: BudgetPlanData | null;
  setValue: (next: BudgetScopeValue) => void;
  /** True until both preferences and plans have arrived. */
  isLoading: boolean;
  /**
   * True from the click until the new scope is actually on screen: the
   * preferences write plus the server re-render it triggers. Controls show it
   * rather than looking finished while the page underneath is still the old
   * budget.
   */
  isSwitching: boolean;
  /** The selector hides below this: one budget is not a choice. */
  hasChoice: boolean;
  /**
   * Whether views that hide rows outside the scope — the transaction list —
   * should narrow. False with one budget: the selector is hidden there, so
   * narrowing would drop unbudgeted accounts out of the list with nothing on
   * screen to say why or to undo it.
   */
  narrows: boolean;
}

/**
 * The app-wide budget scope behind the sidebar selector. One selection, held
 * in user preferences (so it survives a reload and follows the user between
 * devices) and read by the dashboard, budgets, insights and transactions.
 *
 * `?budget=` deep links still override it per page — see the dashboard's
 * resolveDashboardPlan.
 */
export function useBudgetScope(): BudgetScope {
  const router = useRouter();
  const { data: prefs } = usePreferences();
  const { data: plansData } = useBudgetPlans();
  const updatePrefs = useUpdatePreferences();

  // router.refresh() re-renders the server components this scope feeds. Inside
  // a transition, isRefreshing stays true until that render has landed, which
  // is the part of a switch the mutation's own pending flag cannot see.
  const [isRefreshing, startRefresh] = useTransition();

  const plans = useMemo(() => plansData?.plans ?? [], [plansData]);
  const isLoading = !prefs || !plansData;

  const fallbackPlan = useMemo(
    () => plans.find((p) => p.isMain) ?? plans[0] ?? null,
    [plans],
  );

  // A stored plan id that no longer resolves (deleted, or unshared) falls back
  // to the main plan instead of leaving the app scoped to nothing.
  const value: BudgetScopeValue | null = useMemo(() => {
    if (isLoading) return null;
    if (prefs.budgetScopeAll) return ALL_BUDGETS;
    const stored = prefs.mainBudgetPlanId;
    if (stored && plans.some((p) => p.id === stored)) return stored;
    return fallbackPlan?.id ?? ALL_BUDGETS;
  }, [isLoading, prefs, plans, fallbackPlan]);

  const plan =
    value === null || value === ALL_BUDGETS
      ? null
      : plans.find((p) => p.id === value) ?? null;

  // Read through a ref so setValue keeps a stable identity: callers put it in
  // effect dependency arrays.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const setValue = useCallback(
    (next: BudgetScopeValue) => {
      // Picking what is already picked would otherwise cost a write and a full
      // server re-render for no change on screen.
      if (next === valueRef.current) return;
      // On ALL_BUDGETS the plan id stays put: it's what one-budget views fall
      // back to, and switching back lands on the same budget you left.
      updatePrefs.mutate(
        next === ALL_BUDGETS
          ? { budgetScopeAll: true }
          : { budgetScopeAll: false, mainBudgetPlanId: next },
        // The dashboard resolves its scope on the server, so invalidating the
        // client caches isn't enough to re-render it.
        { onSuccess: () => startRefresh(() => router.refresh()) },
      );
    },
    [updatePrefs, router, startRefresh],
  );

  const hasChoice = plans.length > 1;

  return {
    plans,
    value,
    plan,
    fallbackPlan,
    setValue,
    isLoading,
    isSwitching: updatePrefs.isPending || isRefreshing,
    hasChoice,
    narrows: hasChoice && value !== null && value !== ALL_BUDGETS,
  };
}
