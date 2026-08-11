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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

interface AllocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAlloc: Allocation | null;
  availableCategories: CategoryWithDetails[];
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
        <Button data-tour="budget-add" variant="ghost" size="sm">
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
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("budgets.alloc.categoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {availableCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: cat.color || "#94a3b8" }}
                        />
                        {cat.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!amount || parseFloat(amount) <= 0 || (!editingAlloc && !categoryId)}
          >
            {editingAlloc ? t("common.save") : t("budgets.alloc.allocate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
