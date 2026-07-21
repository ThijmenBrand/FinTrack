"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Category } from "@/types/api";

/** Sentinel value for the edit dialog's explicit "No category" option. */
export const NO_CATEGORY = "__none__";

export function isPotTargetValid(
  hasTarget: boolean,
  targetAmount: string,
  targetDate: string
): boolean {
  return (
    !hasTarget ||
    (Number(targetAmount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(targetDate))
  );
}

interface PotFormProps {
  /** Prefix for input ids so create/edit dialogs don't collide (e.g. "pot" / "edit-pot"). */
  idPrefix: string;
  categories: Category[];
  name: string;
  onNameChange: (v: string) => void;
  categoryId: string;
  onCategoryChange: (v: string) => void;
  hasTarget: boolean;
  onHasTargetChange: (v: boolean) => void;
  targetAmount: string;
  onTargetAmountChange: (v: string) => void;
  targetDate: string;
  onTargetDateChange: (v: string) => void;
  /** Optional extra option rendered atop the category list (e.g. edit's "No category"). */
  noCategoryOption?: ReactNode;
  /** Helper text under the "Plan for a spike" checkbox. */
  spikeHint: ReactNode;
  /** Submit handler for Enter in the name field when there's no target grid to tab into. */
  onEnterSubmit?: () => void;
}

/** Shared body for the create/edit pot dialogs (name, category, spike target). */
export function PotForm({
  idPrefix,
  categories,
  name,
  onNameChange,
  categoryId,
  onCategoryChange,
  hasTarget,
  onHasTargetChange,
  targetAmount,
  onTargetAmountChange,
  targetDate,
  onTargetDateChange,
  noCategoryOption,
  spikeHint,
  onEnterSubmit,
}: PotFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          placeholder="e.g. Weekend trip Amsterdam"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !hasTarget) onEnterSubmit?.();
          }}
        />
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={categoryId} onValueChange={onCategoryChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select category (optional)" />
          </SelectTrigger>
          <SelectContent>
            {noCategoryOption}
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
          id={`${idPrefix}-has-target`}
          checked={hasTarget}
          onCheckedChange={(c) => onHasTargetChange(c === true)}
          className="mt-0.5"
        />
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-has-target`} className="cursor-pointer">
            Plan for a spike
          </Label>
          <p className="text-xs text-muted-foreground">{spikeHint}</p>
        </div>
      </div>

      {hasTarget && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-target-amount`}>Target amount (€)</Label>
            <Input
              id={`${idPrefix}-target-amount`}
              type="number"
              min="0"
              step="0.01"
              placeholder="450"
              value={targetAmount}
              onChange={(e) => onTargetAmountChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-target-date`}>Target date</Label>
            <Input
              id={`${idPrefix}-target-date`}
              type="date"
              value={targetDate}
              onChange={(e) => onTargetDateChange(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
