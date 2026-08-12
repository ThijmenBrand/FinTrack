"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, Pencil, Plus, Star } from "lucide-react";
import type { BudgetPlanData } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

/**
 * The page title *is* the plan switcher: one budget is on screen at a time, so
 * a tab strip spent horizontal room on plans nobody was looking at.
 */
export function BudgetSwitcher({
  plans,
  active,
  onSelect,
  onEdit,
  onCreate,
}: {
  plans: BudgetPlanData[];
  active: BudgetPlanData | null;
  onSelect: (planId: string) => void;
  onEdit: (plan: BudgetPlanData) => void;
  onCreate: () => void;
}) {
  const { t, plural } = useI18n();

  const subtitle = (plan: BudgetPlanData) =>
    [
      t(
        plan.period === "yearly"
          ? "budgets.plan.period.yearly"
          : "budgets.plan.period.monthly",
      ),
      plan.isMain ? t("budgets.switcher.mainShort") : null,
      plural(
        plan.accounts.length,
        "budgets.switcher.accounts.one",
        "budgets.switcher.accounts.other",
      ),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <h1 className="text-2xl font-bold tracking-tight">
            {active ? active.name : t("budgets.fallbackTitle")}
          </h1>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">{t("budgets.switcher.label")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {plans.map((plan) => (
            <DropdownMenuItem
              key={plan.id}
              onSelect={() => onSelect(plan.id)}
              className="gap-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{plan.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {subtitle(plan)}
                </span>
              </span>
              {plan.id === active?.id && (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onCreate} className="gap-2 text-primary">
            <Plus className="h-4 w-4" />
            {t("budgets.tabs.newBudget")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {active?.isMain && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          <Star className="h-3 w-3 fill-current" />
          {t("budgets.switcher.main")}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {active && (
          <Button variant="ghost" size="sm" onClick={() => onEdit(active)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            {t("common.edit")}
          </Button>
        )}
        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("budgets.tabs.newBudget")}
        </Button>
      </div>
    </div>
  );
}
