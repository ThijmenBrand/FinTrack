"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  useDeleteBudgetPlan,
  useUpdateBudgetPlan,
} from "@/hooks/use-budget-plans";
import { BUDGETABLE_ACCOUNT_TYPES } from "@/lib/account-scope";
import type { Account, BudgetPlanData, BudgetPlanPeriod } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import {
  AccountPicker,
  PeriodChoice,
  SplitEditor,
  useSplitKey,
} from "./plan-fields";

interface BudgetPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: BudgetPlanData;
  plans: BudgetPlanData[];
  accounts: Account[];
  /** Called after a save/delete so the page can move to a sensible plan. */
  onSaved?: (planId: string | null) => void;
}

/**
 * Edit an existing budget plan: name, how it runs, member accounts (exclusive
 * — picking an account moves it out of its current plan), the shared split
 * key, the main flag, and delete. New budgets go through BudgetWizard instead.
 *
 * The sections read top-down in the order the decisions depend on each other:
 * the accounts decide whether there is anything to split, so the split key
 * follows them.
 */
export function BudgetPlanDialog({
  open,
  onOpenChange,
  plan,
  plans,
  accounts,
  onSaved,
}: BudgetPlanDialogProps) {
  const { t } = useI18n();
  const updatePlan = useUpdateBudgetPlan();
  const deletePlan = useDeleteBudgetPlan();

  const [name, setName] = useState(plan.name);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    plan.accounts.map((a) => a.id),
  );
  const [makeMain, setMakeMain] = useState(false);
  const [period, setPeriod] = useState<BudgetPlanPeriod>(plan.period);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchingToYearly = period === "yearly" && plan.period !== "yearly";
  const switchingToMonthly = period === "monthly" && plan.period === "yearly";
  const busy = updatePlan.isPending || deletePlan.isPending;

  const budgetableAccounts = accounts.filter((a) =>
    (BUDGETABLE_ACCOUNT_TYPES as readonly string[]).includes(a.type),
  );
  const planNameById = new Map(plans.map((p) => [p.id, p.name]));
  const split = useSplitKey(accounts, selectedIds, plan);

  const toggleAccount = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((v) => v !== id),
    );
  };

  const handleSave = async () => {
    setError(null);
    try {
      await updatePlan.mutateAsync({
        id: plan.id,
        name: name.trim(),
        accountIds: selectedIds,
        ...(makeMain && !plan.isMain ? { isMain: true } : {}),
        ...(period !== plan.period ? { period } : {}),
        ...split.payload,
      });
      onSaved?.(plan.id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    }
  };

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setError(null);
    try {
      await deletePlan.mutateAsync(plan.id);
      onSaved?.(null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.somethingWentWrong"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {t("budgets.plan.editTitle", { name: plan.name })}
          </DialogTitle>
          <DialogDescription>
            {t("budgets.plan.editDescription")}
          </DialogDescription>
        </DialogHeader>

        {/* A hairline between sections rather than one flat stack: five
            decisions at the same visual level read as a form dump. */}
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="plan-name">{t("common.name")}</Label>
            <Input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("budgets.plan.namePlaceholder")}
              maxLength={60}
              autoFocus
            />
          </div>

          <section className="space-y-2 border-t pt-5">
            <PeriodChoice name="plan-period" value={period} onChange={setPeriod} />
            {(switchingToYearly || switchingToMonthly) && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                {t(
                  switchingToYearly
                    ? "budgets.plan.period.switchToYearly"
                    : "budgets.plan.period.switchToMonthly",
                )}
              </p>
            )}
          </section>

          <section className="border-t pt-5">
            <AccountPicker
              accounts={budgetableAccounts}
              planNameById={planNameById}
              currentPlanId={plan.id}
              selectedIds={selectedIds}
              onToggle={toggleAccount}
            />
          </section>

          {split.isShared && (
            <section className="border-t pt-5">
              <SplitEditor split={split} />
            </section>
          )}

          {/* The current main plan can't demote itself — promote another one
              instead — so it shows the switch on and locked rather than
              hiding the row and leaving you wondering where it went. */}
          <section className="flex items-center justify-between gap-4 border-t pt-5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("budgets.plan.mainTitle")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {plan.isMain
                  ? t("budgets.plan.isMainHint")
                  : t("budgets.plan.mainHint")}
              </p>
            </div>
            <Switch
              checked={plan.isMain || makeMain}
              onCheckedChange={setMakeMain}
              disabled={plan.isMain}
              aria-label={t("budgets.plan.mainTitle")}
            />
          </section>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Pinned: the actions stay reachable however long the account list
            runs, which is what pushed Save off screen before. */}
        <DialogFooter className="sticky bottom-0 z-10 gap-2 border-t bg-background pt-3 sm:justify-between">
          <Button
            type="button"
            variant={confirmingDelete ? "destructive" : "ghost"}
            onClick={handleDelete}
            disabled={busy}
            className={confirmingDelete ? "" : "text-red-600 dark:text-red-400"}
          >
            {deletePlan.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {confirmingDelete
              ? t("budgets.plan.confirmDelete")
              : t("common.delete")}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={
              busy ||
              name.trim().length === 0 ||
              (split.isShared && !split.valid)
            }
          >
            {updatePlan.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("budgets.plan.saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
