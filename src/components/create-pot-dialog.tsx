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
import { Loader2 } from "lucide-react";
import { useCreatePot } from "@/hooks/use-pots";
import { PotForm, isPotTargetValid } from "@/components/pot-form";
import type { Category } from "@/types/api";

interface CreatePotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  onCreated?: () => void;
}

export function CreatePotDialog({
  open,
  onOpenChange,
  categories,
  onCreated,
}: CreatePotDialogProps) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [hasTarget, setHasTarget] = useState(false);
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const createPot = useCreatePot();

  const reset = () => {
    setName("");
    setCategoryId("");
    setHasTarget(false);
    setTargetAmount("");
    setTargetDate("");
  };

  const targetValid = isPotTargetValid(hasTarget, targetAmount, targetDate);

  const handleCreate = async () => {
    if (!name.trim() || !targetValid) return;
    try {
      await createPot.mutateAsync({
        name: name.trim(),
        categoryId: categoryId || null,
        targetAmount: hasTarget ? Number(targetAmount) : null,
        targetDate: hasTarget ? targetDate : null,
      });
      reset();
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to create pot:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Pot</DialogTitle>
          <DialogDescription>
            Group related transactions (e.g. a weekend trip) into a pot. Add a target to plan for an upcoming spike.
          </DialogDescription>
        </DialogHeader>

        <PotForm
          idPrefix="pot"
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
          spikeHint="Set a target amount and date so the pot shows up in your forecast and dashboard."
          onEnterSubmit={handleCreate}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || !targetValid || createPot.isPending}
          >
            {createPot.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Create Pot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
