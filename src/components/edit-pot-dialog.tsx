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
  const updatePot = useUpdatePot();

  useEffect(() => {
    if (pot) {
      setName(pot.name);
      setCategoryId(pot.categoryId ?? NO_CATEGORY);
    }
  }, [pot]);

  const handleSave = async () => {
    if (!pot || !name.trim()) return;
    try {
      await updatePot.mutateAsync({
        id: pot.id,
        name: name.trim(),
        categoryId: categoryId === NO_CATEGORY ? null : categoryId,
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
      (categoryId === NO_CATEGORY ? null : categoryId) !== (pot.categoryId ?? null));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Pot</DialogTitle>
          <DialogDescription>
            Rename this pot or change the category it belongs to. Member transactions stay grouped.
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
                if (e.key === "Enter") handleSave();
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !isDirty || updatePot.isPending}
          >
            {updatePot.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
