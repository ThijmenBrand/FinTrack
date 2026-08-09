"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Pencil, Plus, Star } from "lucide-react";
import type { BudgetPlanData } from "@/types/api";

interface BudgetPlanTabsProps {
  plans: BudgetPlanData[];
  activeId?: string;
  onSelect: (planId: string) => void;
  onEdit: (plan: BudgetPlanData) => void;
  onCreate: () => void;
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
                    aria-label="Main budget"
                  />
                )}
                {p.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onEdit(active)}
          aria-label={`Edit ${active.name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={onCreate}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        New budget
      </Button>
    </div>
  );
}
