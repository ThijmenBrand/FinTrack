"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Plus, X, RefreshCw, Loader2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBulkDeleteCategories, useCategories, useCategoryRules, useReapplyCategoryRules, useReorderCategories } from "@/hooks/use-categories";
import type { CategoryKind, CategoryWithDetails, RuleWithCategory } from "@/types/api";
import { CATEGORY_KIND_OPTIONS } from "./_components/category-row";
import { CategoryDialog } from "./_components/category-dialog";
import { RuleDialog } from "./_components/rule-dialog";
import { SplitRulesSection } from "./_components/split-rules-section";
import { UncategorizedTransactions } from "./_components/uncategorized-transactions";
import { CategoryRow } from "./_components/category-row";
import { SettingsHeader } from "@/components/settings/settings-ui";
import { useI18n } from "@/lib/i18n/client";

function SortableCategoryRow({
  category,
  rules,
  categories,
  onEdit,
  selected,
  onToggleSelect,
}: {
  category: CategoryWithDetails;
  rules: RuleWithCategory[];
  categories: CategoryWithDetails[];
  onEdit: (category: CategoryWithDetails) => void;
  selected: boolean;
  onToggleSelect: (selected: boolean) => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={isDragging ? "relative opacity-50" : undefined}
    >
      <CategoryRow
        category={category}
        rules={rules}
        categories={categories}
        onEdit={onEdit}
        selected={selected}
        onToggleSelect={onToggleSelect}
        dragHandle={
          <button
            className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-label={t("categories.reorderLabel", { name: category.name })}
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}

export default function CategoriesPage() {
  const { t, plural } = useI18n();
  const { data: categories = [], isLoading: loading } = useCategories();
  const { data: rules = [] } = useCategoryRules();
  const reapplyRules = useReapplyCategoryRules();
  const reorderCategories = useReorderCategories();
  const qc = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // The list is grouped by kind, but sortOrder is one global sequence shared
  // by all categories (the PATCH endpoint just numbers whatever id list it's
  // given 0..n). So an in-group drag reorders only that kind's slice, then
  // splices it back into the same slots it held in the full list — every
  // other group's order and position is left untouched.
  const handleDragEnd = (kind: CategoryKind) => async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const groupItems = categories.filter((c) => c.kind === kind);
    const oldIndex = groupItems.findIndex((c) => c.id === active.id);
    const newIndex = groupItems.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedGroup = arrayMove(groupItems, oldIndex, newIndex);
    let cursor = 0;
    // Optimistic: writing the cache reorders every dropdown too, not just this page.
    const reordered = categories.map((c) => (c.kind === kind ? reorderedGroup[cursor++] : c));
    qc.setQueryData(["categories"], reordered);
    try {
      await reorderCategories.mutateAsync(reordered.map((c) => c.id));
    } catch (err) {
      console.error("Failed to reorder categories:", err);
      qc.invalidateQueries({ queryKey: ["categories"] });
    }
  };

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const bulkDelete = useBulkDeleteCategories();

  const toggleSelect = (id: string, selected: boolean) =>
    setSelectedIds((ids) => (selected ? [...ids, id] : ids.filter((x) => x !== id)));

  // Derived so ids of categories deleted elsewhere drop out of the count.
  const selectedCategories = categories.filter((c) => selectedIds.includes(c.id));

  const handleBulkDelete = async () => {
    try {
      await bulkDelete.mutateAsync(selectedCategories.map((c) => c.id));
    } catch (err) {
      console.error("Failed to delete categories:", err);
    }
    setSelectedIds([]);
  };

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryWithDetails | null>(null);
  const [reapplyResult, setReapplyResult] = useState<{
    transactionsCategorized: number;
    transactionsSplit: number;
    totalTransactions: number;
    uncategorized: number;
  } | null>(null);

  const openCreateCategory = () => {
    setEditingCategory(null);
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (cat: CategoryWithDetails) => {
    setEditingCategory(cat);
    setCategoryDialogOpen(true);
  };

  const handleReapplyRules = async () => {
    setReapplyResult(null);
    try {
      const data = await reapplyRules.mutateAsync();
      setReapplyResult({
        transactionsCategorized: data.transactionsCategorized,
        transactionsSplit: data.transactionsSplit,
        totalTransactions: data.totalTransactions,
        uncategorized: data.uncategorized,
      });
    } catch (err) {
      console.error("Failed to reapply rules:", err);
    }
  };

  // Group rules by category
  const rulesByCategory = rules.reduce(
    (acc, rule) => {
      (acc[rule.categoryId] ??= []).push(rule);
      return acc;
    },
    {} as Record<string, RuleWithCategory[]>
  );

  return (
    <div className="space-y-6">
      <SettingsHeader
        title="categories.title"
        description="categories.subtitle"
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleReapplyRules}
              disabled={reapplyRules.isPending}
            >
              {reapplyRules.isPending ? (
                <Loader2 className="sm:mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="sm:mr-2 h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {reapplyRules.isPending
                  ? t("categories.recalculating")
                  : t("categories.recalculate")}
              </span>
            </Button>
            <RuleDialog categories={categories} />
            <Button data-tour="category-new" onClick={openCreateCategory}>
              <Plus className="sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">{t("categories.add")}</span>
            </Button>
          </>
        }
      />

      <CategoryDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        category={editingCategory}
      />

      {/* Reapply result banner */}
      {reapplyResult && (
        <div className="flex items-start sm:items-center justify-between rounded-lg border bg-muted/50 px-4 py-3 gap-2">
          <div className="flex items-start sm:items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4 text-blue-500 dark:text-blue-400" />
            <span>
              {t("categories.recalcResult", {
                done: reapplyResult.transactionsCategorized,
                total: reapplyResult.totalTransactions,
              })}
              {reapplyResult.transactionsSplit > 0 && (
                <span>
                  {" "}
                  {plural(
                    reapplyResult.transactionsSplit,
                    "categories.recalcSplit.one",
                    "categories.recalcSplit.other",
                  )}
                </span>
              )}
              {reapplyResult.uncategorized > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  {t("categories.recalcRemaining", { count: reapplyResult.uncategorized })}
                </span>
              )}
              {reapplyResult.uncategorized === 0 && (
                <span className="text-green-600 dark:text-green-400">
                  {" "}
                  {t("categories.recalcAllMatched")}
                </span>
              )}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setReapplyResult(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <UncategorizedTransactions />

      <SplitRulesSection categories={categories} />

      {/* Categories with Grouped Rules */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={selectedCategories.length === categories.length && categories.length > 0}
            onCheckedChange={(v) =>
              setSelectedIds(v === true ? categories.map((c) => c.id) : [])
            }
            aria-label={t("categories.bulk.selectAll")}
            disabled={categories.length === 0}
          />
          <h3 className="text-base font-semibold tracking-tight">
            {t("categories.heading", { count: categories.length })}
          </h3>
        </div>

        {selectedCategories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <span className="text-sm font-medium">
              {t("categories.bulk.selected", { count: selectedCategories.length })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedIds([])}>
                <X className="mr-1 h-3.5 w-3.5" />
                {t("common.clear")}
              </Button>
              <ConfirmDeleteButton
                variant="text"
                onConfirm={handleBulkDelete}
                pending={bulkDelete.isPending}
                label={plural(
                  selectedCategories.length,
                  "categories.bulk.deleteCount.one",
                  "categories.bulk.deleteCount.other"
                )}
                confirmLabel={t("common.delete")}
                message={t("categories.bulk.deleteWarning")}
              />
            </div>
          </div>
        )}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {CATEGORY_KIND_OPTIONS.map(({ value: kind, labelKey }) => {
              const groupCategories = categories.filter((c) => c.kind === kind);
              // ponytail: skip empty groups rather than show a heading over nothing.
              if (groupCategories.length === 0) return null;

              return (
                <div key={kind} className="space-y-2">
                  <h4 className="text-sm font-semibold text-muted-foreground tracking-tight">
                    {t(labelKey)}
                  </h4>
                  {/* A DndContext per group confines drag-and-drop to that
                      group — the sortOrder space is global, but a row must
                      only reorder among its own kind, not leap into another. */}
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd(kind)}
                  >
                    <SortableContext
                      items={groupCategories.map((c) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {groupCategories.map((cat) => (
                          <SortableCategoryRow
                            key={cat.id}
                            category={cat}
                            rules={rulesByCategory[cat.id] || []}
                            categories={categories}
                            onEdit={openEditCategory}
                            selected={selectedIds.includes(cat.id)}
                            onToggleSelect={(sel) => toggleSelect(cat.id, sel)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
