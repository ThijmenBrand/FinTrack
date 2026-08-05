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
import { formatCurrency } from "@/lib/utils";

interface AllocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAlloc: Allocation | null;
  availableCategories: CategoryWithDetails[];
  categoryAverages: Record<string, number>;
  unallocated: number;
  onCreate: (categoryId: string, amount: number) => Promise<void>;
  onUpdate: (id: string, amount: number) => Promise<void>;
}

export function AllocationDialog({
  open,
  onOpenChange,
  editingAlloc,
  availableCategories,
  categoryAverages,
  unallocated,
  onCreate,
  onUpdate,
}: AllocationDialogProps) {
  // Initial fields come from the edit target; the parent remounts this
  // component (via `key`) whenever the target changes, so no sync effect.
  const [categoryId, setCategoryId] = useState(editingAlloc?.categoryId ?? "");
  const [amount, setAmount] = useState(
    editingAlloc ? String(editingAlloc.amount) : "",
  );

  // Reset to the edit target's values (empty for add) when closing, so a
  // reopened "add" dialog starts clean without a sync effect.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCategoryId(editingAlloc?.categoryId ?? "");
      setAmount(editingAlloc ? String(editingAlloc.amount) : "");
    }
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    await (editingAlloc ? onUpdate(editingAlloc.id, amt) : onCreate(categoryId, amt));
    onOpenChange(false);
  };

  // Average monthly spend to offer as an autofill; same hint for add and edit.
  const avg = editingAlloc
    ? editingAlloc.avgMonthly
    : categoryId
      ? categoryAverages[categoryId] ?? 0
      : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="flex-1 sm:flex-none">
          <Plus className="mr-2 h-4 w-4" />
          Add manually
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingAlloc ? "Edit Allocation" : "Add Budget Allocation"}
          </DialogTitle>
          <DialogDescription>
            {editingAlloc
              ? `Update the monthly budget for ${editingAlloc.categoryName}.`
              : `Allocate from your ${formatCurrency(unallocated)} unallocated budget.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {!editingAlloc && (
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category..." />
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
            <Label>Monthly Amount</Label>
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
                You typically spend{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={() => setAmount(String(avg))}
                >
                  {formatCurrency(avg)}
                </button>
                /mo on average in this category.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!amount || parseFloat(amount) <= 0 || (!editingAlloc && !categoryId)}
          >
            {editingAlloc ? "Save" : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
