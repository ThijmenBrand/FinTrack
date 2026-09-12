"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

/**
 * "Add a recurring payment to this category", at the foot of the plans it
 * already has. The category is the row it sits under, so the form opens with
 * it filled in and locked.
 */
export function AddPlanRow({ onAdd }: { onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <li className="flex items-center py-1.5 pl-16 pr-4">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-7 px-2 text-xs text-muted-foreground"
        onClick={onAdd}
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("budgets.editor.addPlan")}
      </Button>
    </li>
  );
}
