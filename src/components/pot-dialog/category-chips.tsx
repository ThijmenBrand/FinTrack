"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/category-picker";
import { useMediaQuery } from "@/hooks/use-browser";
import { useI18n } from "@/lib/i18n/client";

export interface CategoryInfo {
  id: string;
  name: string;
  color: string | null;
  icon?: string | null;
}

interface CategoryChipsProps {
  /** The line's categories. */
  value: string[];
  /** Every category the user has. */
  categories: CategoryInfo[];
  /** Categories other lines already collect — not offered here. */
  taken: Set<string>;
  onAdd: (categoryId: string) => void;
  onRemove: (categoryId: string) => void;
  /** Names the line in the remove buttons' labels. */
  lineName: string;
}

/**
 * The categories a budget line collects, as removable chips, and the picker
 * that adds one. On a phone the picker opens in place rather than as a popover:
 * this already sits in a bottom sheet, with the keyboard coming up under it.
 */
export function CategoryChips({ value, categories, taken, onAdd, onRemove, lineName }: CategoryChipsProps) {
  const { t } = useI18n();
  const phone = useMediaQuery("(max-width: 639px)");
  const [picking, setPicking] = useState(false);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const available = categories.filter((c) => !taken.has(c.id) && !value.includes(c.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((id) => {
          const cat = byId.get(id);
          const name = cat?.name ?? t("pots.budget.deletedCategory");
          return (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-2 pr-1 text-xs"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40"
                style={cat?.color ? { backgroundColor: cat.color } : undefined}
              />
              <span className="truncate">{name}</span>
              <button
                type="button"
                onClick={() => onRemove(id)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("pots.budget.removeCategory", { category: name, line: lineName || "…" })}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {phone ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full border-dashed px-2.5 text-xs"
            onClick={() => setPicking((p) => !p)}
            aria-expanded={picking}
          >
            <Plus className="h-3 w-3" />
            {t("pots.budget.addCategory")}
          </Button>
        ) : (
          <CategoryPicker
            categories={available}
            budgetCategoryIds={null}
            value={null}
            placeholder={t("pots.budget.addCategory")}
            onChange={(id) => onAdd(id)}
            className="h-7 w-auto rounded-full border-dashed px-2.5 text-xs [&>svg:last-child]:hidden"
          />
        )}
      </div>
      {phone && picking && (
        <div className="rounded-lg border p-2">
          <CategoryPicker
            inline
            categories={available}
            budgetCategoryIds={null}
            value={null}
            onChange={(id) => {
              onAdd(id);
              setPicking(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
