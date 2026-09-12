"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreateCategory } from "@/hooks/use-categories";
import { useI18n } from "@/lib/i18n/client";
import { SearchCreatePicker } from "@/components/search-create-picker";
import type { SubCategoryOption } from "@/types/api";

interface PickerCategory {
  id: string;
  name: string;
  color: string | null;
}

const DEFAULT_COLOR = "#94a3b8";

/**
 * Categories and sub-categories share one flat list, so the ids are prefixed
 * to say which table a row came from.
 */
const CATEGORY = "c:";
const SUB = "s:";

interface Row {
  id: string;
  name: string;
  depth?: number;
  group?: { id: string; name: string };
  color: string | null;
  /** A sub-category: same colour as its category, a smaller dot. */
  sub: boolean;
}

function Swatch({ color, sub }: { color: string | null; sub?: boolean }) {
  return (
    <span
      className={cn("shrink-0 rounded-full", sub ? "h-1.5 w-1.5 opacity-60" : "h-2 w-2")}
      style={{ backgroundColor: color || DEFAULT_COLOR }}
    />
  );
}

/** Searchable category picker with create-on-the-fly. */
export function CategoryPicker({
  categories,
  subCategories,
  value,
  subLineId,
  onChange,
  className,
  placeholder,
  trailing,
  accountId,
}: {
  categories: PickerCategory[];
  /**
   * Budget sub-lines the rows may be narrowed to, flat and pre-ordered (see
   * useSubCategories). Omit and the picker offers categories alone.
   */
  subCategories?: SubCategoryOption[];
  value: string | null;
  subLineId?: string | null;
  /** A sub-category also sets the category it belongs to; the two never disagree. */
  onChange: (categoryId: string, subLineId: string | null) => void;
  className?: string;
  /** Shown instead of the selected category — set for a "set category" style trigger. */
  placeholder?: string;
  /** Extra trigger content, e.g. the auto-match badge. */
  trailing?: React.ReactNode;
  /** Account these rows belong to — created categories land in its owner's space. */
  accountId?: string;
}) {
  const { t } = useI18n();
  const createCategory = useCreateCategory(accountId);

  // One flat list, each category followed by its own sub-lines in plan order.
  // The picker indents them; nothing here is a tree.
  const rows = useMemo<Row[]>(() => {
    const byCategory = new Map<string, SubCategoryOption[]>();
    for (const sub of subCategories ?? []) {
      const list = byCategory.get(sub.categoryId);
      if (list) list.push(sub);
      else byCategory.set(sub.categoryId, [sub]);
    }
    return categories.flatMap((cat) => [
      { id: CATEGORY + cat.id, name: cat.name, color: cat.color, sub: false },
      ...(byCategory.get(cat.id) ?? []).map((line) => ({
        id: SUB + line.id,
        name: line.name,
        depth: line.depth,
        group: { id: CATEGORY + cat.id, name: cat.name },
        color: cat.color,
        sub: true,
      })),
    ]);
  }, [categories, subCategories]);

  const selected = categories.find((c) => c.id === value);
  // Only when it really is a line of the selected category: a sub-line left
  // behind by a recategorization, or deleted from the budget since, resolves to
  // nothing and the row falls back to its category alone.
  const selectedSub = subLineId
    ? (subCategories ?? []).find((s) => s.id === subLineId && s.categoryId === value)
    : undefined;

  const label = selected
    ? selectedSub
      ? `${selected.name} › ${selectedSub.name}`
      : selected.name
    : placeholder ?? t("categorySelect.placeholder");

  return (
    <SearchCreatePicker
      items={rows}
      value={selectedSub ? SUB + selectedSub.id : value ? CATEGORY + value : null}
      onSelect={(id) => {
        if (id.startsWith(SUB)) {
          const line = (subCategories ?? []).find((s) => s.id === id.slice(SUB.length));
          if (line) onChange(line.categoryId, line.id);
          return;
        }
        const categoryId = id.slice(CATEGORY.length);
        // Picking the category itself clears any sub-line under it — the
        // narrower answer can't survive a change to the broader one, and it
        // is how you go back to the category alone. The exception is a picker
        // that was given no sub-categories to show: re-picking the same
        // category there must not silently drop one this control could never
        // have offered.
        // `?.length`, not just the prop: the detail dialog defaults it to `[]`
        // while the query loads, and leaves it empty for an account outside a
        // plan — both are pickers that could never have offered the line.
        const keep = !subCategories?.length && categoryId === value;
        onChange(categoryId, keep ? subLineId ?? null : null);
      }}
      creating={createCategory.isPending}
      onCreate={(name) => {
        // The id is ours, so the picker can close on the new category right
        // away; the hook drops the row from the list again if the POST fails,
        // which leaves anything holding this id back on "no category".
        const id = crypto.randomUUID();
        // ponytail: default grey + no icon; recolor in settings if it matters.
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
      renderLeading={(row) => <Swatch color={row.color} sub={row.sub} />}
      trigger={
        <button
          type="button"
          aria-haspopup="listbox"
          aria-label={label}
          title={selectedSub ? label : undefined}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            className,
          )}
        >
          {selected && !placeholder ? (
            <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <Swatch color={selected.color} />
              {/* The sub-category is the answer the user picked, so it keeps
                  its width (shrink-0) and the category above it is the one
                  that gives way — a cell too narrow for both ellipsises the
                  broader half, never the specific one. */}
              <span className={cn("truncate", selectedSub && "text-muted-foreground")}>
                {selected.name}
              </span>
              {selectedSub && (
                <>
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
                  <span className="shrink-0 truncate">{selectedSub.name}</span>
                </>
              )}
              {trailing}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 truncate text-muted-foreground">
              <Tag className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {placeholder ?? t("categorySelect.placeholder")}
              </span>
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      }
    />
  );
}
