"use client";

import { useState, type ReactNode } from "react";
import { Package, Plus, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchCreatePicker, type ExtraCreate } from "@/components/search-create-picker";
import { useCreateCategory } from "@/hooks/use-categories";
import { useMediaQuery } from "@/hooks/use-browser";
import { useI18n } from "@/lib/i18n/client";
import type { PotCategory } from "@/types/api";

export interface CategoryInfo {
  id: string;
  name: string;
  color: string | null;
  icon?: string | null;
}

const DEFAULT_COLOR = "#94a3b8";
/** Both kinds share one picker list, so ids say which table a row is from. */
const CATEGORY = "c:";
const POT = "p:";

/** The pot this line belongs to, when it already exists. */
export interface ChipsPot {
  name: string;
  /** Its own categories (Transport › Flight). */
  categories: PotCategory[];
  /**
   * Categories a new pot category can hang under from this line — a
   * sub-line's parent's. Empty: the picker can't create one here.
   */
  createParents: CategoryInfo[];
  onCreate: (name: string, parentCategoryId: string) => Promise<string | null>;
}

interface CategoryChipsProps {
  /** The line's categories. */
  value: string[];
  /** The line's pot categories. */
  potValue?: string[];
  /** Every category the user has. */
  categories: CategoryInfo[];
  /** Categories other lines already collect — not offered here. Both kinds. */
  taken: Set<string>;
  onAdd: (categoryId: string) => void;
  onRemove: (categoryId: string) => void;
  onAddPot?: (potCategoryId: string) => void;
  onRemovePot?: (potCategoryId: string) => void;
  pot?: ChipsPot;
  /** Names the line in the remove buttons' labels, and the suggested pot category. */
  lineName: string;
}

interface Item {
  id: string;
  name: string;
  group?: { id: string; name: string };
  section?: string;
  color: string | null;
  pot: boolean;
}

/**
 * The categories a budget line collects, as removable chips, and the picker
 * that adds one. The pot's own categories are chips too, marked with the
 * pot's icon; the picker lists them first and can create one under the
 * parent line's category — named after the line before anything is typed,
 * since that is usually the one wanted.
 *
 * On a phone the picker opens in place rather than as a popover: this already
 * sits in a bottom sheet, with the keyboard coming up under it.
 */
export function CategoryChips({
  value,
  potValue = [],
  categories,
  taken,
  onAdd,
  onRemove,
  onAddPot,
  onRemovePot,
  pot,
  lineName,
}: CategoryChipsProps) {
  const { t } = useI18n();
  const phone = useMediaQuery("(max-width: 639px)");
  const [picking, setPicking] = useState(false);
  const createCategory = useCreateCategory();
  const byId = new Map(categories.map((c) => [c.id, c]));
  const potById = new Map((pot?.categories ?? []).map((c) => [c.id, c]));

  const free = (id: string) => !taken.has(id) && !value.includes(id) && !potValue.includes(id);
  const potItems: Item[] = (pot?.categories ?? []).filter((c) => free(c.id)).map((c) => {
    const parent = byId.get(c.parentCategoryId);
    return {
      id: POT + c.id,
      name: c.name,
      // An id no row has, so the parent's name always shows beside it.
      group: { id: `parent:${c.parentCategoryId}`, name: parent?.name ?? "" },
      color: parent?.color ?? null,
      pot: true,
    };
  });
  const banded = potItems.length > 0;
  const items: Item[] = [
    ...potItems.map((i) => ({ ...i, section: t("pots.budget.potBand", { pot: pot!.name }) })),
    ...categories
      .filter((c) => free(c.id))
      .map((c) => ({
        id: CATEGORY + c.id,
        name: c.name,
        color: c.color,
        pot: false,
        section: banded ? t("pots.budget.allCategories") : undefined,
      })),
  ];

  // One row per parent the new category could hang under, named after what
  // was typed — or, before anything is, after the line itself.
  const potCreates = (typed: string): ExtraCreate[] => {
    if (!pot || !onAddPot) return [];
    const name = (typed || lineName).trim();
    if (!name) return [];
    const lower = name.toLowerCase();
    return pot.createParents
      .filter(
        (p) =>
          !pot.categories.some((c) => c.parentCategoryId === p.id && c.name.toLowerCase() === lower),
      )
      .map((parent) => ({
        key: parent.id,
        // Two lines, so the part that matters — what it hangs under — never
        // truncates behind the pot's name.
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <Package className="h-3.5 w-3.5 shrink-0" style={{ color: parent.color || DEFAULT_COLOR }} aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{t("pots.budget.createPotCategory", { name, parent: parent.name })}</span>
              <span className="truncate text-xs text-muted-foreground">{t("pots.budget.potBand", { pot: pot.name })}</span>
            </span>
          </span>
        ),
        onCreate: async () => {
          const id = await pot.onCreate(name, parent.id);
          if (!id) return false;
          onAddPot(id);
          setPicking(false);
          return true;
        },
      }));
  };

  const select = (id: string) => {
    if (id.startsWith(POT)) onAddPot?.(id.slice(POT.length));
    else onAdd(id.slice(CATEGORY.length));
    setPicking(false);
  };

  const picker = (inline: boolean) => (
    <SearchCreatePicker
      inline={inline}
      items={items}
      value={null}
      onSelect={select}
      extraCreates={potCreates}
      creating={createCategory.isPending}
      onCreate={(name) => {
        // Same optimistic create as the shared CategoryPicker: the id is ours,
        // so the chip can appear before the POST lands.
        const id = crypto.randomUUID();
        createCategory.mutate(
          { id, name, color: DEFAULT_COLOR, icon: null },
          { onError: (err) => console.error("Failed to create category:", err) },
        );
        return CATEGORY + id;
      }}
      labels={{
        search: "categoryPicker.search",
        empty: "categoryPicker.empty",
        create: "categoryPicker.create",
      }}
      renderLeading={(item) =>
        item.pot ? (
          <Package className="h-3 w-3 shrink-0" style={{ color: item.color || DEFAULT_COLOR }} aria-hidden />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color || DEFAULT_COLOR }} />
        )
      }
      trigger={
        <button
          type="button"
          aria-haspopup="listbox"
          className="flex h-7 items-center gap-1.5 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Tag className="h-3 w-3 shrink-0" />
          {t("pots.budget.addCategory")}
        </button>
      }
    />
  );

  const chip = (key: string, label: ReactNode, title: string, onRemoveChip: () => void, removeName: string) => (
    <span
      key={key}
      title={title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-2 pr-1 text-xs"
    >
      {label}
      <button
        type="button"
        onClick={onRemoveChip}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("pots.budget.removeCategory", { category: removeName, line: lineName || "…" })}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((id) => {
          const cat = byId.get(id);
          const name = cat?.name ?? t("pots.budget.deletedCategory");
          return chip(
            id,
            <>
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40"
                style={cat?.color ? { backgroundColor: cat.color } : undefined}
              />
              <span className="truncate">{name}</span>
            </>,
            name,
            () => onRemove(id),
            name,
          );
        })}
        {potValue.map((id) => {
          const cat = potById.get(id);
          const parent = cat ? byId.get(cat.parentCategoryId) : undefined;
          const name = cat?.name ?? t("pots.budget.deletedCategory");
          return chip(
            id,
            <>
              <Package
                className="h-3 w-3 shrink-0 text-muted-foreground"
                style={parent?.color ? { color: parent.color } : undefined}
                aria-hidden
              />
              <span className="truncate">{name}</span>
            </>,
            parent && pot
              ? t("pots.budget.potCategoryTitle", { parent: parent.name, name, pot: pot.name })
              : name,
            () => onRemovePot?.(id),
            name,
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
          picker(false)
        )}
      </div>
      {phone && picking && <div className="rounded-lg border p-2">{picker(true)}</div>}
    </div>
  );
}
