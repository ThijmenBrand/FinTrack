"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tag, Check } from "lucide-react";
import { CategoryPicker } from "@/components/category-picker";
import { useUpdatePot } from "@/hooks/use-pots";
import type { Category } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

interface PotCategoryPopoverProps {
  potId: string;
  potName: string;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
  currentCategoryColor: string | null;
  categories: Category[];
}

export function PotCategoryPopover({
  potId,
  potName,
  currentCategoryId,
  currentCategoryName,
  currentCategoryColor,
  categories,
}: PotCategoryPopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(currentCategoryId);
  const updatePot = useUpdatePot();

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setSelectedCategoryId(currentCategoryId);
    }
    setOpen(next);
  };

  const handleSave = async () => {
    try {
      await updatePot.mutateAsync({
        id: potId,
        categoryId: selectedCategoryId,
      });
      setOpen(false);
    } catch (err) {
      console.error("Failed to update pot category:", err);
    }
  };

  const isDirty = selectedCategoryId !== (currentCategoryId ?? null);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs rounded-md px-2 py-1 hover:bg-accent transition-colors text-left">
          {currentCategoryName ? (
            <>
              {currentCategoryColor && (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: currentCategoryColor }}
                />
              )}
              <span className="text-muted-foreground truncate">{currentCategoryName}</span>
            </>
          ) : (
            <span className="text-muted-foreground flex items-center gap-1">
              <Tag className="h-3 w-3" />
              {t("categorize.trigger")}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm mb-1">{t("potCategory.title")}</h4>
            <p className="text-xs text-muted-foreground break-words">{potName}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t("common.category")}</Label>
            {/* Pots are never shared, so no account: they live in the caller's own space. */}
            <CategoryPicker
              value={selectedCategoryId}
              onChange={setSelectedCategoryId}
              onClear={() => setSelectedCategoryId(null)}
              categories={categories}
              className="h-8 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updatePot.isPending || !isDirty}
            >
              {updatePot.isPending ? t("categorize.saving") : t("common.save")}
              {!updatePot.isPending && <Check className="ml-1 h-3 w-3" />}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
