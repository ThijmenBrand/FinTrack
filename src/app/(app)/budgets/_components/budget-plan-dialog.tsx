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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import {
  useCreateBudgetPlan,
  useDeleteBudgetPlan,
  useUpdateBudgetPlan,
} from "@/hooks/use-budget-plans";
import { BUDGETABLE_ACCOUNT_TYPES } from "@/lib/account-scope";
import type { Account, BudgetPlanData } from "@/types/api";

interface BudgetPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new budget */
  plan: BudgetPlanData | null;
  plans: BudgetPlanData[];
  accounts: Account[];
  /** Called after a create/delete so the page can move to a sensible tab. */
  onSaved?: (planId: string | null) => void;
}

/**
 * Create/edit a budget plan: name, member accounts (exclusive — picking an
 * account moves it out of its current plan), main flag, delete.
 */
export function BudgetPlanDialog({
  open,
  onOpenChange,
  plan,
  plans,
  accounts,
  onSaved,
}: BudgetPlanDialogProps) {
  const createPlan = useCreateBudgetPlan();
  const updatePlan = useUpdateBudgetPlan();
  const deletePlan = useDeleteBudgetPlan();

  const [name, setName] = useState(plan?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    plan?.accounts.map((a) => a.id) ?? [],
  );
  const [makeMain, setMakeMain] = useState(plan?.isMain ?? false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFirstPlan = plans.length === 0;
  const busy = createPlan.isPending || updatePlan.isPending || deletePlan.isPending;

  const budgetableAccounts = accounts.filter((a) =>
    (BUDGETABLE_ACCOUNT_TYPES as readonly string[]).includes(a.type),
  );
  const planNameById = new Map(plans.map((p) => [p.id, p.name]));

  const toggleAccount = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((v) => v !== id)));
  };

  const handleSave = async () => {
    setError(null);
    try {
      if (plan) {
        await updatePlan.mutateAsync({
          id: plan.id,
          name: name.trim(),
          accountIds: selectedIds,
          ...(makeMain && !plan.isMain ? { isMain: true } : {}),
        });
        onSaved?.(plan.id);
      } else {
        const result = await createPlan.mutateAsync({
          name: name.trim(),
          accountIds: selectedIds,
        });
        if (makeMain && !isFirstPlan) {
          await updatePlan.mutateAsync({ id: result.id, isMain: true });
        }
        onSaved?.(result.id);
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const handleDelete = async () => {
    if (!plan) return;
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
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : "New budget"}</DialogTitle>
          <DialogDescription>
            A budget tracks the spending of its accounts with its own category
            limits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plan-name">Name</Label>
            <Input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Joint household"
              maxLength={60}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Accounts</Label>
            {budgetableAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No checking or joint accounts yet — add one under Settings →
                Accounts first.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {budgetableAccounts.map((acc) => {
                  const otherPlanName =
                    acc.budgetId && acc.budgetId !== plan?.id
                      ? planNameById.get(acc.budgetId)
                      : null;
                  return (
                    <li key={acc.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                        <Checkbox
                          checked={selectedIds.includes(acc.id)}
                          onCheckedChange={(checked) =>
                            toggleAccount(acc.id, checked === true)
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{acc.name}</span>
                        {otherPlanName && selectedIds.includes(acc.id) && (
                          <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                            moves from {otherPlanName}
                          </span>
                        )}
                        {otherPlanName && !selectedIds.includes(acc.id) && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            in {otherPlanName}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              An account belongs to one budget — picking it here moves it out of
              its current one.
            </p>
          </div>

          {/* The first plan becomes main automatically; the current main can't
              demote itself (promote another plan instead). */}
          {!isFirstPlan && !plan?.isMain && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={makeMain}
                onCheckedChange={(checked) => setMakeMain(checked === true)}
              />
              Main budget — shown on the dashboard
            </label>
          )}
          {plan?.isMain && (
            <p className="text-xs text-muted-foreground">
              This is your main budget (shown on the dashboard). To change that,
              make another budget main.
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {plan ? (
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
              {confirmingDelete ? "Delete budget and its limits?" : "Delete"}
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={busy || name.trim().length === 0}
          >
            {(createPlan.isPending || updatePlan.isPending) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {plan ? "Save changes" : "Create budget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
