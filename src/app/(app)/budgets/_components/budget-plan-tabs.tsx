"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Pencil, Plus, Star } from "lucide-react";
import type { BudgetPlanData } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

interface BudgetPlanTabsProps {
  plans: BudgetPlanData[];
  activeId?: string;
  onSelect: (planId: string) => void;
  /** Omitted in simple mode — switching stays, plan management doesn't. */
  onEdit?: (plan: BudgetPlanData) => void;
  onCreate?: () => void;
}

/**
 * Plan switcher for the Budgets page. The main plan carries a star so it's
 * always clear which budget the dashboard mirrors.
 */
export function BudgetPlanTabs({
  plans,
  activeId,
  onSelect,
  onEdit,
  onCreate,
}: BudgetPlanTabsProps) {
  const { t } = useI18n();
  const active = plans.find((p) => p.id === activeId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {plans.length > 0 && (
        <Tabs value={activeId} onValueChange={onSelect}>
          <TabsList>
            {plans.map((p) => (
              <TabsTrigger key={p.id} value={p.id} className="gap-1.5">
                {p.isMain && (
                  <Star
                    className="h-3 w-3 fill-current text-amber-500"
                    aria-label={t("dashboard.budgetCard.mainBudgetStar")}
                  />
                )}
                {p.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {active && onEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onEdit(active)}
          aria-label={t("budgets.tabs.editPlan", { name: active.name })}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {onCreate && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onCreate}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("budgets.tabs.newBudget")}
        </Button>
      )}
    </div>
  );
}
