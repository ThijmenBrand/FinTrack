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
import { SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useUpdatePot } from "@/hooks/use-pots";
import { PotForm, isPotTargetValid, NO_CATEGORY } from "@/components/pot-form";
import type { Category, Pot } from "@/types/api";

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

  const targetValid = isPotTargetValid(hasTarget, targetAmount, targetDate);

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

        <PotForm
          idPrefix="edit-pot"
          categories={categories}
          name={name}
          onNameChange={setName}
          categoryId={categoryId}
          onCategoryChange={setCategoryId}
          hasTarget={hasTarget}
          onHasTargetChange={setHasTarget}
          targetAmount={targetAmount}
          onTargetAmountChange={setTargetAmount}
          targetDate={targetDate}
          onTargetDateChange={setTargetDate}
          noCategoryOption={
            <SelectItem value={NO_CATEGORY}>
              <span className="text-muted-foreground">No category</span>
            </SelectItem>
          }
          spikeHint="Clearing this resets the funded amount."
          onEnterSubmit={handleSave}
        />

        {pot && pot.targetAmount != null && hasTarget && (
          <p className="text-xs text-muted-foreground">
            Funded so far: €{(pot.fundedAmount ?? 0).toFixed(2)} / €
            {pot.targetAmount.toFixed(2)}
          </p>
        )}

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
