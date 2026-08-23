"use client";

import { useState } from "react";
import type { Allocation, CategoryWithDetails } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CategoryPicker } from "@/components/category-picker";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { MONEY_EPSILON } from "@/lib/validation";
import { SubLineList } from "./sub-line-list";

interface AllocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAlloc: Allocation | null;
  availableCategories: CategoryWithDetails[];
  /** Plan owner's account — a category created here lands in their space. */
  accountId?: string;
  categoryAverages: Record<string, number>;
  unallocated: number;
  /** Yearly plans enter and display the annual figure; storage stays monthly. */
  yearly?: boolean;
  onCreate: (categoryId: string, amount: number) => Promise<void>;
  onUpdate: (id: string, amount: number) => Promise<void>;
}

/** Twelve months make a year — the only conversion in the whole feature. */
const MONTHS_PER_YEAR = 12;

export function AllocationDialog({
  open,
  onOpenChange,
  editingAlloc,
  availableCategories,
  accountId,
  categoryAverages,
  unallocated,
  yearly = false,
  onCreate,
  onUpdate,
}: AllocationDialogProps) {
  const { t, formatCurrency } = useI18n();

  // Allocations are always stored per month; a yearly plan just talks in
  // annual figures. Converting only at the edges keeps ×12 and ÷12 from
  // meeting in the middle and drifting.
  // Rounded to cents on the way out, because both directions can land on a
  // figure the field should never show: a yearly amount is stored as
  // `entered / 12` and multiplying it back is only exact for whole euros
  // (€100.01 a year would reopen as "100.00999999999999"), and an average is
  // whatever the division of past spend produced.
  const toDisplay = (monthly: number) =>
    Math.round((yearly ? monthly * MONTHS_PER_YEAR : monthly) * 100) / 100;
  const toStored = (shown: number) => (yearly ? shown / MONTHS_PER_YEAR : shown);
  const initialAmount = editingAlloc ? String(toDisplay(editingAlloc.amount)) : "";

  // Initial fields come from the edit target; the parent remounts this
  // component (via `key`) whenever the target changes, so no sync effect.
  const [categoryId, setCategoryId] = useState(editingAlloc?.categoryId ?? "");
  const [amount, setAmount] = useState(initialAmount);

  // Reset to the edit target's values (empty for add) when closing, so a
  // reopened "add" dialog starts clean without a sync effect.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCategoryId(editingAlloc?.categoryId ?? "");
      setAmount(initialAmount);
    }
    onOpenChange(next);
  };

  // An allocation cannot shrink below the split already planned inside it —
  // the server rejects it, so the dialog says so before submit.
  const rootSubsTotal = editingAlloc
    ? editingAlloc.subLines.reduce((sum, l) => sum + l.amount, 0)
    : 0;
  const enteredStored = parseFloat(amount) > 0 ? toStored(parseFloat(amount)) : null;
  const belowSubsTotal =
    !!editingAlloc &&
    enteredStored !== null &&
    enteredStored < rootSubsTotal - MONEY_EPSILON;

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    const stored = toStored(amt);
    await (editingAlloc
      ? onUpdate(editingAlloc.id, stored)
      : onCreate(categoryId, stored));
    onOpenChange(false);
  };

  // Past spend to offer as an autofill, in whichever unit is on screen.
  const avgMonthly = editingAlloc
    ? editingAlloc.avgMonthly
    : categoryId
      ? categoryAverages[categoryId] ?? 0
      : 0;
  const avg = toDisplay(avgMonthly);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {/* The one control in this header that keeps its label at every width:
            a budget you cannot add a category to is not a budget. */}
        <Button
          data-tour="budget-add"
          variant="outline"
          size="sm"
          className="h-9 sm:h-8"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("budgets.addManually")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingAlloc ? t("budgets.alloc.editTitle") : t("budgets.alloc.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {editingAlloc
              ? t("budgets.alloc.editDescription", {
                  name: editingAlloc.categoryName ?? "",
                })
              : t("budgets.alloc.addDescription", {
                  amount: formatCurrency(unallocated),
                })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {!editingAlloc && (
            <div className="grid gap-2">
              <Label>{t("common.category")}</Label>
              {/* Same picker as the transaction flows: type to filter, and
                  create the category on the spot when it isn't there yet. */}
              <CategoryPicker
                categories={availableCategories}
                value={categoryId || null}
                onChange={setCategoryId}
                accountId={accountId}
              />
              {availableCategories.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("budgets.alloc.noCategories")}
                </p>
              )}
            </div>
          )}
          <div className="grid gap-2">
            <Label>
              {t(yearly ? "budgets.alloc.yearlyAmount" : "budgets.alloc.monthlyAmount")}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                &euro;
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="150.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-8"
              />
            </div>
            {avg > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("budgets.alloc.avgHintPrefix")}{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={() => setAmount(String(avg))}
                >
                  {formatCurrency(avg)}
                </button>
                {t(
                  yearly
                    ? "budgets.alloc.avgHintSuffixYearly"
                    : "budgets.alloc.avgHintSuffix",
                )}
              </p>
            )}
            {yearly && parseFloat(amount) > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("budgets.alloc.perMonthEquivalent", {
                  amount: formatCurrency(parseFloat(amount) / MONTHS_PER_YEAR),
                })}
              </p>
            )}
            {belowSubsTotal && (
              <p className="text-xs text-destructive">
                {t("budgets.subLines.belowSubsTotal")}
              </p>
            )}
          </div>
          {editingAlloc && (
            <div className="border-t pt-3">
              {/* The cap is the *saved* amount, not what's in the field: the
                  server validates sub-lines against what it has stored, so
                  offering room that only exists in an unsubmitted input would
                  invite a request it is bound to reject. */}
              <SubLineList
                variant="dialog"
                alloc={editingAlloc}
                cap={editingAlloc.amount}
                toDisplay={toDisplay}
                toStored={toStored}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !amount ||
              parseFloat(amount) <= 0 ||
              (!editingAlloc && !categoryId) ||
              belowSubsTotal
            }
          >
            {editingAlloc ? t("common.save") : t("budgets.alloc.allocate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
