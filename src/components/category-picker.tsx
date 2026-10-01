"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, Repeat, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreateCategory } from "@/hooks/use-categories";
import { useI18n } from "@/lib/i18n/client";
import { SearchCreatePicker } from "@/components/search-create-picker";
import type { BudgetData, SubCategoryOption } from "@/types/api";

interface PickerCategory {
  id: string;
  name: string;
  color: string | null;
}

const DEFAULT_COLOR = "#94a3b8";

/**
 * Categories and sub-categories share one flat list, so the ids are prefixed
 * to say which table a row came from: a category, a budget sub-line, or a
 * recurring plan filed under a category.
 */
const CATEGORY = "c:";
const SUB = "s:";
const PLAN = "r:";

interface Row {
  id: string;
  name: string;
  depth?: number;
  group?: { id: string; name: string };
  color: string | null;
  /** A sub-category: same colour as its category, a smaller dot. */
  sub: boolean;
  /** A recurring plan as sub-category — marked with the repeat icon instead of a dot. */
  plan?: boolean;
  /** Band heading — set only when the list is split by the budget plan. */
  section?: string;
}

/**
 * The categories a budget plan covers: its spending lines and its income lines
 * both — the budget page lists the two, so the picker's top band does too.
 * Null for a plan with no lines yet: a heading over an empty band is worse
 * than no heading. Exported for its test.
 */
export function planCategoryIds(
  budget: Pick<BudgetData, "allocations" | "fixedCosts" | "incomeLines"> | null | undefined,
): Set<string> | null {
  if (!budget) return null;
  const planned = [
    ...budget.allocations.map((a) => a.categoryId),
    ...budget.fixedCosts.map((f) => f.categoryId),
    ...budget.incomeLines.map((l) => l.categoryId),
  ];
  return planned.length === 0 ? null : new Set(planned);
}

/**
 * Split the categories into the ones the budget plan covers and the rest.
 * A separator needs two sides: with the plan covering everything, or nothing,
 * both headings would label a band that is already the whole list, so the
 * list stays flat. Exported for its test.
 */
export function bandByPlan<T extends { id: string }>(
  categories: T[],
  planIds: Set<string> | null | undefined,
): { inPlan: T[]; rest: T[]; banded: boolean } {
  const flat = { inPlan: [] as T[], rest: categories, banded: false };
  if (!planIds) return flat;
  const inPlan = categories.filter((c) => planIds.has(c.id));
  const rest = categories.filter((c) => !planIds.has(c.id));
  return inPlan.length && rest.length ? { inPlan, rest, banded: true } : flat;
}

/**
 * The sub-category a row shows, from what it is filed under: its sub-line,
 * else the plan it is linked to — as the line that stands for that plan, if
 * one does. Only ever an option of `categoryId` itself: a line or plan left
 * behind by a recategorization resolves to nothing, and the row reads as its
 * category alone. Mirrors `subLineName` in GET /api/transactions.
 */
export function selectedSubCategory(
  options: SubCategoryOption[] | undefined,
  categoryId: string | null,
  subLineId: string | null | undefined,
  recurringTransactionId: string | null | undefined,
): SubCategoryOption | undefined {
  if (!options || !categoryId) return undefined;
  const own = options.filter((o) => o.categoryId === categoryId);
  if (subLineId) {
    const line = own.find((o) => o.kind === "line" && o.id === subLineId);
    if (line) return line;
  }
  if (!recurringTransactionId) return undefined;
  return (
    own.find((o) => o.kind === "line" && o.recurringTransactionId === recurringTransactionId) ??
    own.find((o) => o.kind === "plan" && o.id === recurringTransactionId)
  );
}

function Swatch({ color, sub, plan }: { color: string | null; sub?: boolean; plan?: boolean }) {
  if (plan) {
    return (
      <Repeat
        className="h-3 w-3 shrink-0 opacity-70"
        style={{ color: color || DEFAULT_COLOR }}
        aria-hidden
      />
    );
  }
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
  budgetCategoryIds,
  value,
  subLineId,
  recurringTransactionId,
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
  /**
   * The categories the account's budget plan covers. Given, the list is banded:
   * the plan's lines first, then everything else under a heading. Nothing is
   * hidden — a plan says what you meant to spend on, not what you can.
   */
  budgetCategoryIds?: Set<string> | null;
  value: string | null;
  subLineId?: string | null;
  /**
   * The plan the row is linked to. Shown as the sub-category when that plan
   * (or a line standing for it) is one of `value`'s — see selectedSubCategory.
   */
  recurringTransactionId?: string | null;
  /**
   * A sub-category also sets the category it belongs to; the two never
   * disagree. `planId` is the recurring plan the pick stands for — the plan
   * itself, or the one a sub-line stands for — and null for anything else.
   */
  onChange: (categoryId: string, subLineId: string | null, planId: string | null) => void;
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
    const rowsFor = (cat: PickerCategory, section?: string): Row[] => [
      { id: CATEGORY + cat.id, name: cat.name, color: cat.color, sub: false, section },
      ...(byCategory.get(cat.id) ?? []).map((line) => ({
        id: (line.kind === "plan" ? PLAN : SUB) + line.id,
        name: line.name,
        depth: line.depth,
        group: { id: CATEGORY + cat.id, name: cat.name },
        color: cat.color,
        sub: true,
        plan: line.kind === "plan",
        section,
      })),
    ];
    const { inPlan, rest, banded } = bandByPlan(categories, budgetCategoryIds);
    if (!banded) return rest.flatMap((cat) => rowsFor(cat));
    return [
      ...inPlan.flatMap((cat) => rowsFor(cat, t("categoryPicker.inBudget"))),
      ...rest.flatMap((cat) => rowsFor(cat, t("categoryPicker.outsideBudget"))),
    ];
  }, [categories, subCategories, budgetCategoryIds, t]);

  const selected = categories.find((c) => c.id === value);
  const selectedSub = selectedSubCategory(subCategories, value, subLineId, recurringTransactionId);

  const label = selected
    ? selectedSub
      ? `${selected.name} › ${selectedSub.name}`
      : selected.name
    : placeholder ?? t("categorySelect.placeholder");

  return (
    <SearchCreatePicker
      items={rows}
      value={
        selectedSub
          ? (selectedSub.kind === "plan" ? PLAN : SUB) + selectedSub.id
          : value
            ? CATEGORY + value
            : null
      }
      onSelect={(id) => {
        if (id.startsWith(SUB)) {
          const line = (subCategories ?? []).find(
            (s) => s.kind === "line" && s.id === id.slice(SUB.length),
          );
          if (line) onChange(line.categoryId, line.id, line.recurringTransactionId);
          return;
        }
        if (id.startsWith(PLAN)) {
          const plan = (subCategories ?? []).find(
            (s) => s.kind === "plan" && s.id === id.slice(PLAN.length),
          );
          if (plan) onChange(plan.categoryId, null, plan.id);
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
        onChange(categoryId, keep ? subLineId ?? null : null, null);
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
      renderLeading={(row) => <Swatch color={row.color} sub={row.sub} plan={row.plan} />}
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
