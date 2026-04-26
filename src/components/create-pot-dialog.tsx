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
import { useCreatePot } from "@/hooks/use-pots";
import type { Category } from "@/types/api";

interface CreatePotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  onCreated: () => void;
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

  const targetValid =
    !hasTarget ||
    (Number(targetAmount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(targetDate));

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
      onCreated();
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

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pot-name">Name</Label>
            <Input
              id="pot-name"
              placeholder="e.g. Weekend trip Amsterdam"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !hasTarget) handleCreate();
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
              id="pot-has-target"
              checked={hasTarget}
              onCheckedChange={(c) => setHasTarget(c === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="pot-has-target" className="cursor-pointer">
                Plan for a spike
              </Label>
              <p className="text-xs text-muted-foreground">
                Set a target amount and date so the pot shows up in your forecast and dashboard.
              </p>
            </div>
          </div>

          {hasTarget && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pot-target-amount">Target amount (€)</Label>
                <Input
                  id="pot-target-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="450"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pot-target-date">Target date</Label>
                <Input
                  id="pot-target-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

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
