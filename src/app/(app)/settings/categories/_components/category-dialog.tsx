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
import { useI18n } from "@/lib/i18n/client";

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
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t("categories.saveError"));
    }
  };

  return (
    <>
      <DialogHeader>
          <DialogTitle>
            {category ? t("categories.editTitle") : t("categories.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {category ? t("categories.editDescription") : t("categories.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>{t("categories.nameLabel")}</Label>
            <Input
              placeholder={t("categories.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("categories.iconLabel")}</Label>
            <div className="flex items-center gap-3 mb-2">
              <CategoryIcon icon={icon} color={color} size="lg" />
              <span className="text-sm text-muted-foreground">
                {icon ? t("categories.iconChange") : t("categories.iconPick")}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border p-3">
              <EmojiPicker value={icon} onSelect={setIcon} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>{t("categories.colorLabel")}</Label>
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
          {t("common.cancel")}
        </Button>
        <Button onClick={handleSubmit} disabled={!name || isPending}>
          {category ? t("categories.saveChanges") : t("categories.createCategory")}
        </Button>
      </DialogFooter>
    </>
  );
}
