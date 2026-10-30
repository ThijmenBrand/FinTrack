"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SpendProgress } from "@/components/spend-progress";
import { PotDialog } from "@/components/pot-dialog";
import { TONE } from "@/app/(app)/budgets/_components/budget-row";
import type { DashboardPotBudget } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

export function PotBudgetsList({ pots }: { pots: DashboardPotBudget[] }) {
  const { t, formatCurrency: fc, formatDate } = useI18n();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <ul className="space-y-3 max-md:space-y-0">
        {pots.map((pot) => (
          <li key={pot.id}>
            <button
              type="button"
              onClick={() => setOpenId(pot.id)}
              className="w-full space-y-2 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:border-border/60 max-md:px-0 max-md:py-4"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted"
                  style={pot.categoryColor ? { backgroundColor: pot.categoryColor } : undefined}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{pot.name}</span>
                {pot.targetDate && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("dashboard.potBudgets.since", { date: formatDate(pot.targetDate) })}
                  </span>
                )}
              </div>
              <SpendProgress
                spent={pot.spent}
                total={pot.total}
                status={pot.status}
                categoryColor={pot.categoryColor}
                size="card"
                meta={
                  pot.worstLine && (
                    <p className={`text-xs ${TONE.exceeded.text}`}>
                      {t("dashboard.potBudgets.worstLine", {
                        line: pot.worstLine.parentName
                          ? `${pot.worstLine.parentName} › ${pot.worstLine.name}`
                          : pot.worstLine.name,
                        amount: fc(pot.worstLine.overBy),
                      })}
                    </p>
                  )
                }
              />
            </button>
          </li>
        ))}
      </ul>
      <PotDialog
        potId={openId}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
