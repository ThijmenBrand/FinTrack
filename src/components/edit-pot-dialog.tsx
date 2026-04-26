"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useUpdatePot } from "@/hooks/use-pots";
import type { Category, Pot } from "@/types/api";

const NO_CATEGORY = "__none__";

interface EditPotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  pot: Pot | null;
  onSaved?: () => void;
}

export function EditPotDialog({
  open,
  onOpenChange,
  categories,
  pot,
  onSaved,
}: EditPotDialogProps) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);
  const [hasTarget, setHasTarget] = useState(false);
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const updatePot = useUpdatePot();

  useEffect(() => {
    if (pot) {
      setName(pot.name);
      setCategoryId(pot.categoryId ?? NO_CATEGORY);
      const had = pot.targetAmount != null && pot.targetDate != null;
      setHasTarget(had);
      setTargetAmount(pot.targetAmount != null ? String(pot.targetAmount) : "");
      setTargetDate(pot.targetDate ?? "");
    }
  }, [pot]);

  const targetValid =
    !hasTarget ||
    (Number(targetAmount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(targetDate));

  const handleSave = async () => {
    if (!pot || !name.trim() || !targetValid) return;
    try {
      await updatePot.mutateAsync({
        id: pot.id,
        name: name.trim(),
        categoryId: categoryId === NO_CATEGORY ? null : categoryId,
        targetAmount: hasTarget ? Number(targetAmount) : null,
        targetDate: hasTarget ? targetDate : null,
      });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to update pot:", err);
    }
  };

  const isDirty =
    !!pot &&
    (name.trim() !== pot.name ||
      (categoryId === NO_CATEGORY ? null : categoryId) !==
        (pot.categoryId ?? null) ||
      hasTarget !== (pot.targetAmount != null && pot.targetDate != null) ||
      (hasTarget &&
        (Number(targetAmount) !== (pot.targetAmount ?? 0) ||
          targetDate !== (pot.targetDate ?? ""))));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Pot</DialogTitle>
          <DialogDescription>
            Rename, recategorise, or set a target so this pot becomes a planned spike.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-pot-name">Name</Label>
            <Input
              id="edit-pot-name"
              placeholder="e.g. Weekend trip Amsterdam"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !hasTarget) handleSave();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>
                  <span className="text-muted-foreground">No category</span>
                </SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      {cat.color && (
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                      )}
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start gap-3 pt-1">
            <Checkbox
              id="edit-pot-has-target"
              checked={hasTarget}
              onCheckedChange={(c) => setHasTarget(c === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="edit-pot-has-target" className="cursor-pointer">
                Plan for a spike
              </Label>
              <p className="text-xs text-muted-foreground">
                Clearing this resets the funded amount.
              </p>
            </div>
          </div>

          {hasTarget && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-pot-target-amount">Target amount (€)</Label>
                <Input
                  id="edit-pot-target-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="450"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-pot-target-date">Target date</Label>
                <Input
                  id="edit-pot-target-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>
            </div>
          )}

          {pot && pot.targetAmount != null && hasTarget && (
            <p className="text-xs text-muted-foreground">
              Funded so far: €{(pot.fundedAmount ?? 0).toFixed(2)} / €
              {pot.targetAmount.toFixed(2)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !isDirty || !targetValid || updatePot.isPending}
          >
            {updatePot.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
