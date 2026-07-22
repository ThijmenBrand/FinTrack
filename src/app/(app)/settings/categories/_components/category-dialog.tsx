"use client";

import { useState } from "react";
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
} from "@/components/ui/dialog";
import { CategoryIcon } from "@/components/category-icon";
import { EmojiPicker } from "@/components/emoji-picker";
import { useCreateCategory, useUpdateCategory } from "@/hooks/use-categories";
import type { CategoryWithDetails } from "@/types/api";

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Category being edited, or null to create a new one. */
  category: CategoryWithDetails | null;
}

export function CategoryDialog({ open, onOpenChange, category }: CategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed remount reinitializes the form to the current category/create. */}
        <CategoryForm
          key={category?.id ?? "new"}
          category={category}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  category,
  onDone,
}: {
  category: CategoryWithDetails | null;
  onDone: () => void;
}) {
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color || "#3b82f6");
  const [icon, setIcon] = useState<string | null>(category?.icon ?? null);
  const [error, setError] = useState<string | null>(null);

  const isPending = createCategory.isPending || updateCategory.isPending;

  const handleSubmit = async () => {
    if (isPending) return;
    setError(null);
    const payload: Record<string, unknown> = {
      ...(category ? { id: category.id } : {}),
      name,
      color,
      icon,
    };
    try {
      await (category ? updateCategory : createCategory).mutateAsync(payload as never);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category");
    }
  };

  return (
    <>
      <DialogHeader>
          <DialogTitle>{category ? "Edit Category" : "Add New Category"}</DialogTitle>
          <DialogDescription>
            {category ? "Update this spending category." : "Create a new spending category."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Category Name</Label>
            <Input
              placeholder="e.g. Groceries, Transport, Coffee"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Icon</Label>
            <div className="flex items-center gap-3 mb-2">
              <CategoryIcon icon={icon} color={color} size="lg" />
              <span className="text-sm text-muted-foreground">
                {icon ? "Click an emoji below to change" : "Pick an emoji"}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border p-3">
              <EmojiPicker value={icon} onSelect={setIcon} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Color</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#3b82f6"
                className="flex-1"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!name || isPending}>
          {category ? "Save Changes" : "Create Category"}
        </Button>
      </DialogFooter>
    </>
  );
}
