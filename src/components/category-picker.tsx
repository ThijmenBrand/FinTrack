"use client";

import { ChevronDown, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreateCategory } from "@/hooks/use-categories";
import { useI18n } from "@/lib/i18n/client";
import { SearchCreatePicker } from "@/components/search-create-picker";

interface PickerCategory {
  id: string;
  name: string;
  color: string | null;
}

const DEFAULT_COLOR = "#94a3b8";

function Swatch({ color }: { color: string | null }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color || DEFAULT_COLOR }}
    />
  );
}

/** Searchable category picker with create-on-the-fly. */
export function CategoryPicker({
  categories,
  value,
  onChange,
  className,
  placeholder,
  trailing,
  accountId,
}: {
  categories: PickerCategory[];
  value: string | null;
  onChange: (categoryId: string) => void;
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

  const selected = categories.find((c) => c.id === value);

  return (
    <SearchCreatePicker
      items={categories}
      value={value}
      onSelect={onChange}
      creating={createCategory.isPending}
      onCreate={async (name) => {
        try {
          // ponytail: default grey + no icon; recolor in settings if it matters.
          const created = await createCategory.mutateAsync({
            name,
            color: DEFAULT_COLOR,
            icon: null,
          });
          return (created as { id: string }).id;
        } catch (err) {
          console.error("Failed to create category:", err);
          return null;
        }
      }}
      labels={{
        search: "categoryPicker.search",
        empty: "categoryPicker.empty",
        create: "categoryPicker.create",
      }}
      renderLeading={(cat) => <Swatch color={cat.color} />}
      trigger={
        <button
          type="button"
          aria-haspopup="listbox"
          aria-label={selected ? selected.name : placeholder ?? t("categorySelect.placeholder")}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            className,
          )}
        >
          {selected && !placeholder ? (
            <span className="flex items-center gap-1.5 truncate">
              <Swatch color={selected.color} />
              <span className="truncate">{selected.name}</span>
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
