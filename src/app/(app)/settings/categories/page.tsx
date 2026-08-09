"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { useCategories, useCategoryRules, useReapplyCategoryRules, useReorderCategories } from "@/hooks/use-categories";
import type { CategoryWithDetails, RuleWithCategory } from "@/types/api";
import { CategoryDialog } from "./_components/category-dialog";
import { RuleDialog } from "./_components/rule-dialog";
import { UncategorizedTransactions } from "./_components/uncategorized-transactions";
import { CategoryRow } from "./_components/category-row";
import { useI18n } from "@/lib/i18n/client";

function SortableCategoryRow({
  category,
  rules,
  categories,
  onEdit,
}: {
  category: CategoryWithDetails;
  rules: RuleWithCategory[];
  categories: CategoryWithDetails[];
  onEdit: (category: CategoryWithDetails) => void;
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
  const { t } = useI18n();
  const { data: categories = [], isLoading: loading } = useCategories();
  const { data: rules = [] } = useCategoryRules();
  const reapplyRules = useReapplyCategoryRules();
  const reorderCategories = useReorderCategories();
  const qc = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistic: writing the cache reorders every dropdown too, not just this page.
    const reordered = arrayMove(categories, oldIndex, newIndex);
    qc.setQueryData(["categories"], reordered);
    try {
      await reorderCategories.mutateAsync(reordered.map((c) => c.id));
    } catch (err) {
      console.error("Failed to reorder categories:", err);
      qc.invalidateQueries({ queryKey: ["categories"] });
    }
  };

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryWithDetails | null>(null);
  const [reapplyResult, setReapplyResult] = useState<{
    transactionsCategorized: number;
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("categories.title")}</h1>
          <p className="text-muted-foreground">{t("categories.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReapplyRules} disabled={reapplyRules.isPending}>
            {reapplyRules.isPending ? (
              <Loader2 className="sm:mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="sm:mr-2 h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {reapplyRules.isPending ? t("categories.recalculating") : t("categories.recalculate")}
            </span>
          </Button>
          <RuleDialog categories={categories} />
          <Button onClick={openCreateCategory}>
            <Plus className="sm:mr-2 h-4 w-4" />
            <span className="hidden sm:inline">{t("categories.add")}</span>
          </Button>
        </div>
      </div>

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

      <UncategorizedTransactions categories={categories} />

      {/* Categories with Grouped Rules */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          {t("categories.heading", { count: categories.length })}
        </h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl border bg-card animate-pulse" />
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={categories.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {categories.map((cat) => (
                  <SortableCategoryRow
                    key={cat.id}
                    category={cat}
                    rules={rulesByCategory[cat.id] || []}
                    categories={categories}
                    onEdit={openEditCategory}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
