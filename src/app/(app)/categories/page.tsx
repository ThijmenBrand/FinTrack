"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Trash2,
  Tags,
  Zap,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { CategorizePopover } from "@/components/categorize-popover";
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog";
import { CategoryIcon, resolveIcon } from "@/components/category-icon";
import { EmojiPicker } from "@/components/emoji-picker";
import { useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory, useCategoryRules, useCreateCategoryRule, useUpdateCategoryRule, useDeleteCategoryRule, useReapplyCategoryRules } from "@/hooks/use-categories";
import { useTransactions } from "@/hooks/use-transactions";
import type { CategoryWithDetails, RuleWithCategory, Transaction } from "@/types/api";

const MATCH_TYPE_LABELS: Record<string, string> = {
  contains: "Contains",
  starts_with: "Starts with",
  exact: "Exact match",
};

export default function CategoriesPage() {
  // React Query hooks
  const { data: categories = [], isLoading: loading } = useCategories();
  const { data: rules = [] } = useCategoryRules();

  const [uncategorizedPage, setUncategorizedPage] = useState(1);
  const UNCATEGORIZED_LIMIT = 20;
  const { data: uncategorizedData, isLoading: uncategorizedLoading } = useTransactions({ uncategorized: true, limit: UNCATEGORIZED_LIMIT, page: uncategorizedPage, sortBy: "date", sortOrder: "desc" });
  const uncategorizedTxns = uncategorizedData?.data ?? [];
  const uncategorizedTotal = uncategorizedData?.pagination.total ?? 0;

  // Mutations
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const createRule = useCreateCategoryRule();
  const updateRule = useUpdateCategoryRule();
  const deleteRule = useDeleteCategoryRule();
  const reapplyRules = useReapplyCategoryRules();

  // UI state
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryWithDetails | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteRuleConfirm, setDeleteRuleConfirm] = useState<string | null>(
    null
  );
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [editRulePattern, setEditRulePattern] = useState("");
  const [editRuleMatchType, setEditRuleMatchType] = useState("contains");
  const [editRuleCategoryId, setEditRuleCategoryId] = useState("");
  const [reapplyResult, setReapplyResult] = useState<{
    transactionsCategorized: number;
    totalTransactions: number;
    uncategorized: number;
  } | null>(null);
  const [uncategorizedExpanded, setUncategorizedExpanded] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  // Category form
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState("#3b82f6");
  const [catIcon, setCatIcon] = useState<string | null>(null);

  // Rule form
  const [rulePattern, setRulePattern] = useState("");
  const [ruleCategoryId, setRuleCategoryId] = useState("");
  const [ruleMatchType, setRuleMatchType] = useState("contains");
  const [ruleApplyExisting, setRuleApplyExisting] = useState(true);
  const [ruleResult, setRuleResult] = useState<string | null>(null);

  const resetCategoryForm = () => {
    setCatName("");
    setCatColor("#3b82f6");
    setCatIcon(null);
    setEditingCategory(null);
  };

  const resetRuleForm = () => {
    setRulePattern("");
    setRuleCategoryId("");
    setRuleMatchType("contains");
    setRuleApplyExisting(true);
    setRuleResult(null);
  };

  const handleCategorySubmit = async () => {
    const payload = {
      ...(editingCategory ? { id: editingCategory.id } : {}),
      name: catName,
      color: catColor,
      icon: catIcon,
    };

    await (editingCategory ? updateCategory : createCategory).mutateAsync(payload as any);

    setCategoryDialogOpen(false);
    resetCategoryForm();
  };

  const handleDeleteCategory = async (id: string) => {
    await deleteCategory.mutateAsync(id);
    setDeleteConfirm(null);
  };

  const handleRuleSubmit = async () => {
    const data = await createRule.mutateAsync({
      pattern: rulePattern,
      categoryId: ruleCategoryId,
      matchType: ruleMatchType,
      applyToExisting: ruleApplyExisting,
    });

    if (data.applied && data.applied > 0) {
      setRuleResult(
        `Rule created and applied to ${data.applied} existing transaction${data.applied !== 1 ? "s" : ""}`
      );
    } else {
      setRuleResult("Rule created. It will apply to future CSV imports.");
    }
  };

  const handleDeleteRule = async (id: string) => {
    await deleteRule.mutateAsync(id);
    setDeleteRuleConfirm(null);
  };

  const openEditCategory = (cat: CategoryWithDetails) => {
    setEditingCategory(cat);
    setCatName(cat.name);
    setCatColor(cat.color || "#3b82f6");
    setCatIcon(resolveIcon(cat.icon) || cat.icon);
    setCategoryDialogOpen(true);
  };

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  const startEditRule = (rule: RuleWithCategory) => {
    setEditingRule(rule.id);
    setEditRulePattern(rule.pattern);
    setEditRuleMatchType(rule.matchType);
    setEditRuleCategoryId(rule.categoryId);
  };

  const cancelEditRule = () => {
    setEditingRule(null);
    setEditRulePattern("");
    setEditRuleMatchType("contains");
    setEditRuleCategoryId("");
  };

  const saveEditRule = async (ruleId: string) => {
    await updateRule.mutateAsync({
      id: ruleId,
      pattern: editRulePattern,
      matchType: editRuleMatchType,
      categoryId: editRuleCategoryId,
      applyToExisting: true,
    });
    setEditingRule(null);
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
      const key = rule.categoryId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(rule);
      return acc;
    },
    {} as Record<string, RuleWithCategory[]>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
          <p className="text-muted-foreground">
            Manage spending categories and auto-categorization rules.
          </p>
        </div>
        <div className="flex gap-2">
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
            <span className="hidden sm:inline">{reapplyRules.isPending ? "Recalculating..." : "Recalculate All"}</span>
          </Button>
          <Dialog
            open={ruleDialogOpen}
            onOpenChange={(open) => {
              setRuleDialogOpen(open);
              if (!open) resetRuleForm();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">
                <Zap className="sm:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Add Rule</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Categorization Rule</DialogTitle>
                <DialogDescription>
                  Automatically categorize transactions matching a pattern.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Pattern to match</Label>
                  <Input
                    placeholder='e.g. "Albert Heijn", "PayPal", "ASML"'
                    value={rulePattern}
                    onChange={(e) => setRulePattern(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Match type</Label>
                  <Select value={ruleMatchType} onValueChange={setRuleMatchType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">
                        Description contains pattern
                      </SelectItem>
                      <SelectItem value="starts_with">
                        Description starts with pattern
                      </SelectItem>
                      <SelectItem value="exact">Exact match</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Assign to category</Label>
                  <Select
                    value={ruleCategoryId}
                    onValueChange={setRuleCategoryId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{
                                backgroundColor: cat.color || "#94a3b8",
                              }}
                            />
                            {cat.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {ruleResult && (
                  <div className="rounded-md bg-muted p-3 text-sm">
                    {ruleResult}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRuleDialogOpen(false);
                    resetRuleForm();
                  }}
                >
                  {ruleResult ? "Close" : "Cancel"}
                </Button>
                {!ruleResult && (
                  <Button
                    onClick={handleRuleSubmit}
                    disabled={!rulePattern || !ruleCategoryId}
                  >
                    Create Rule
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={categoryDialogOpen}
            onOpenChange={(open) => {
              setCategoryDialogOpen(open);
              if (!open) resetCategoryForm();
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="sm:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Add Category</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingCategory ? "Edit Category" : "Add New Category"}
                </DialogTitle>
                <DialogDescription>
                  {editingCategory
                    ? "Update this spending category."
                    : "Create a new spending category."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Category Name</Label>
                  <Input
                    placeholder="e.g. Groceries, Transport, Coffee"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Icon</Label>
                  <div className="flex items-center gap-3 mb-2">
                    <CategoryIcon icon={catIcon} color={catColor} size="lg" />
                    <span className="text-sm text-muted-foreground">
                      {catIcon ? "Click an emoji below to change" : "Pick an emoji"}
                    </span>
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-md border p-3">
                    <EmojiPicker value={catIcon} onSelect={setCatIcon} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Color</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={catColor}
                      onChange={(e) => setCatColor(e.target.value)}
                      className="h-9 w-14 cursor-pointer rounded border"
                    />
                    <Input
                      value={catColor}
                      onChange={(e) => setCatColor(e.target.value)}
                      placeholder="#3b82f6"
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCategoryDialogOpen(false);
                    resetCategoryForm();
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleCategorySubmit} disabled={!catName}>
                  {editingCategory ? "Save Changes" : "Create Category"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Reapply result banner */}
      {reapplyResult && (
        <div className="flex items-start sm:items-center justify-between rounded-lg border bg-muted/50 px-4 py-3 gap-2">
          <div className="flex items-start sm:items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4 text-blue-500 dark:text-blue-400" />
            <span>
              Recalculated: <strong>{reapplyResult.transactionsCategorized}</strong> of{" "}
              <strong>{reapplyResult.totalTransactions}</strong> transactions categorized.
              {reapplyResult.uncategorized > 0 && (
                <span className="text-muted-foreground">
                  {" "}{reapplyResult.uncategorized} remaining without a matching rule.
                </span>
              )}
              {reapplyResult.uncategorized === 0 && (
                <span className="text-green-600 dark:text-green-400"> All transactions matched.</span>
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

      {/* Uncategorized Transactions */}
      {uncategorizedTotal > 0 && (
        <div className="space-y-3">
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => {
              setUncategorizedExpanded(!uncategorizedExpanded);
            }}
          >
            {uncategorizedExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <h2 className="text-lg font-semibold">
              Uncategorized Transactions ({uncategorizedTotal})
            </h2>
          </div>

          {uncategorizedExpanded && (
            <Card>
              <CardContent className="p-0">
                {uncategorizedLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="divide-y">
                      {uncategorizedTxns.map((tx) => (
                        <div
                          key={tx.id}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => setSelectedTransaction(tx)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {tx.description}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {tx.date}
                              {tx.accountName && ` · ${tx.accountName}`}
                            </p>
                          </div>
                          <span
                            className={`text-sm font-mono tabular-nums shrink-0 ${
                              tx.amount >= 0
                                ? "text-green-600 dark:text-green-400"
                                : "text-foreground"
                            }`}
                          >
                            {tx.amount >= 0 ? "+" : ""}
                            {tx.amount.toFixed(2)}
                          </span>
                          <div onClick={(e) => e.stopPropagation()}>
                            <CategorizePopover
                              transactionId={tx.id}
                              transactionDescription={tx.description}
                              currentCategoryId={null}
                              currentCategoryName={null}
                              currentCategoryColor={null}
                              categories={categories.map((c) => ({
                                id: c.id,
                                name: c.name,
                                color: c.color,
                                icon: c.icon,
                              }))}
                              onCategorized={() => {}}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Pagination */}
                    {uncategorizedTotal > UNCATEGORIZED_LIMIT && (
                      <div className="flex items-center justify-between border-t px-4 py-2.5">
                        <p className="text-xs text-muted-foreground">
                          Showing {(uncategorizedPage - 1) * UNCATEGORIZED_LIMIT + 1}–
                          {Math.min(uncategorizedPage * UNCATEGORIZED_LIMIT, uncategorizedTotal)} of{" "}
                          {uncategorizedTotal}
                        </p>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={uncategorizedPage === 1}
                            onClick={() => setUncategorizedPage(uncategorizedPage - 1)}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              uncategorizedPage * UNCATEGORIZED_LIMIT >= uncategorizedTotal
                            }
                            onClick={() => setUncategorizedPage(uncategorizedPage + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Categories with Grouped Rules */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Categories ({categories.length})
        </h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-xl border bg-card animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) => {
              const catRules = rulesByCategory[cat.id] || [];
              const isExpanded = expandedCategories.has(cat.id);
              const hasRules = catRules.length > 0;

              return (
                <Card key={cat.id} className="overflow-hidden">
                  {/* Category header row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => hasRules && toggleCategory(cat.id)}
                  >
                    {/* Icon + expand icon */}
                    <div className="flex items-center gap-2">
                      <CategoryIcon icon={cat.icon} color={cat.color} size="sm" />
                      {hasRules ? (
                        isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )
                      ) : (
                        <div className="w-4 shrink-0" />
                      )}
                    </div>

                    {/* Category info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{cat.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {cat.transactionCount} transaction
                        {cat.transactionCount !== 1 ? "s" : ""}
                        {hasRules &&
                          ` · ${catRules.length} rule${catRules.length !== 1 ? "s" : ""}`}
                      </p>
                    </div>

                    {/* Actions */}
                    <div
                      className="flex gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEditCategory(cat)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      {deleteConfirm === cat.id ? (
                        <div className="flex gap-1">
                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleDeleteCategory(cat.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeleteConfirm(null)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setDeleteConfirm(cat.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Expanded rules list */}
                  {isExpanded && hasRules && (
                    <div className="border-t bg-muted/30">
                      <div className="px-4 py-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                          Auto-categorization rules
                        </p>
                        <div className="space-y-1">
                          {catRules.map((rule) => (
                            <div
                              key={rule.id}
                              className="flex flex-col sm:flex-row sm:items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group/rule"
                            >
                              {editingRule === rule.id ? (
                                /* Edit mode */
                                <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
                                  <Input
                                    value={editRulePattern}
                                    onChange={(e) =>
                                      setEditRulePattern(e.target.value)
                                    }
                                    className="h-7 text-sm font-mono w-full sm:max-w-[240px]"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter")
                                        saveEditRule(rule.id);
                                      if (e.key === "Escape") cancelEditRule();
                                    }}
                                  />
                                  <div className="flex items-center gap-2">
                                    <Select
                                      value={editRuleMatchType}
                                      onValueChange={setEditRuleMatchType}
                                    >
                                      <SelectTrigger className="h-7 text-xs w-full sm:w-[130px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="contains">
                                          Contains
                                        </SelectItem>
                                        <SelectItem value="starts_with">
                                          Starts with
                                        </SelectItem>
                                        <SelectItem value="exact">
                                          Exact match
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Select
                                      value={editRuleCategoryId}
                                      onValueChange={setEditRuleCategoryId}
                                    >
                                      <SelectTrigger className="h-7 text-xs w-full sm:w-[160px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {categories.map((c) => (
                                          <SelectItem key={c.id} value={c.id}>
                                            <span className="flex items-center gap-1.5">
                                              <span
                                                className="h-2 w-2 rounded-full"
                                                style={{
                                                  backgroundColor:
                                                    c.color || "#94a3b8",
                                                }}
                                              />
                                              {c.name}
                                            </span>
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <div className="flex gap-1 shrink-0">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => saveEditRule(rule.id)}
                                      >
                                        <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={cancelEditRule}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                /* Display mode */
                                <>
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <Zap className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="font-mono text-sm truncate">
                                      &quot;{rule.pattern}&quot;
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1.5 py-0 shrink-0"
                                    >
                                      {MATCH_TYPE_LABELS[rule.matchType] ||
                                        rule.matchType}
                                    </Badge>
                                    {/* Show target category if it differs (rule was moved) */}
                                    {rule.categoryId !== cat.id && (
                                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        <span
                                          className="h-1.5 w-1.5 rounded-full"
                                          style={{
                                            backgroundColor:
                                              rule.categoryColor || "#94a3b8",
                                          }}
                                        />
                                        {rule.categoryName}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex gap-0.5 md:opacity-0 md:group-hover/rule:opacity-100 transition-opacity shrink-0 self-end sm:self-auto">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      onClick={() => startEditRule(rule)}
                                    >
                                      <Pencil className="h-3 w-3 text-muted-foreground" />
                                    </Button>
                                    {deleteRuleConfirm === rule.id ? (
                                      <div className="flex gap-0.5">
                                        <Button
                                          variant="destructive"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() =>
                                            handleDeleteRule(rule.id)
                                          }
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() =>
                                            setDeleteRuleConfirm(null)
                                          }
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() =>
                                          setDeleteRuleConfirm(rule.id)
                                        }
                                      >
                                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                                      </Button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Transaction Detail Dialog */}
      <TransactionDetailDialog
        transaction={selectedTransaction}
        onOpenChange={(open) => {
          if (!open) setSelectedTransaction(null);
        }}
        onCategorized={() => {}}
      />
    </div>
  );
}
