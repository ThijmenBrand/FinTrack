"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pencil,
  Zap,
  X,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import {
  useUpdateCategoryRule,
  useDeleteCategoryRule,
  useDeleteCategory,
} from "@/hooks/use-categories";
import type { CategoryWithDetails, RuleWithCategory } from "@/types/api";
import { MATCH_TYPES, MATCH_TYPE_LABELS } from "./match-types";

interface CategoryRowProps {
  category: CategoryWithDetails;
  rules: RuleWithCategory[];
  /** All categories, for the rule's category re-assignment select. */
  categories: CategoryWithDetails[];
  onEdit: (category: CategoryWithDetails) => void;
  /** Drag handle rendered at the start of the header row. */
  dragHandle?: React.ReactNode;
}

export function CategoryRow({ category, rules, categories, onEdit, dragHandle }: CategoryRowProps) {
  const updateRule = useUpdateCategoryRule();
  const deleteRule = useDeleteCategoryRule();
  const deleteCategory = useDeleteCategory();

  const [expanded, setExpanded] = useState(false);
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState("");
  const [editMatchType, setEditMatchType] = useState("contains");
  const [editCategoryId, setEditCategoryId] = useState("");

  const hasRules = rules.length > 0;

  const startEditRule = (rule: RuleWithCategory) => {
    setEditingRule(rule.id);
    setEditPattern(rule.pattern);
    setEditMatchType(rule.matchType);
    setEditCategoryId(rule.categoryId);
  };

  const cancelEditRule = () => {
    setEditingRule(null);
    setEditPattern("");
    setEditMatchType("contains");
    setEditCategoryId("");
  };

  const saveEditRule = async (ruleId: string) => {
    await updateRule.mutateAsync({
      id: ruleId,
      pattern: editPattern,
      matchType: editMatchType,
      categoryId: editCategoryId,
      applyToExisting: true,
    });
    setEditingRule(null);
  };

  return (
    <Card className="overflow-hidden">
      {/* Category header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => hasRules && setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {dragHandle}
          <CategoryIcon icon={category.icon} color={category.color} size="sm" />
          {hasRules ? (
            expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )
          ) : (
            <div className="w-4 shrink-0" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">{category.name}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {category.transactionCount} transaction
            {category.transactionCount !== 1 ? "s" : ""}
            {hasRules && ` · ${rules.length} rule${rules.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(category)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <ConfirmDeleteButton
            onConfirm={async () => {
              await deleteCategory.mutateAsync(category.id);
            }}
            pending={deleteCategory.isPending}
            label="Delete category"
          />
        </div>
      </div>

      {/* Expanded rules list */}
      {expanded && hasRules && (
        <div className="border-t bg-muted/30">
          <div className="px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Auto-categorization rules
            </p>
            <div className="space-y-1">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group/rule"
                >
                  {editingRule === rule.id ? (
                    /* Edit mode */
                    <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
                      <Input
                        value={editPattern}
                        onChange={(e) => setEditPattern(e.target.value)}
                        className="h-7 text-sm font-mono w-full sm:max-w-[240px]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditRule(rule.id);
                          if (e.key === "Escape") cancelEditRule();
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <Select value={editMatchType} onValueChange={setEditMatchType}>
                          <SelectTrigger className="h-7 text-xs w-full sm:w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MATCH_TYPES.map((m) => (
                              <SelectItem key={m.value} value={m.value}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                          <SelectTrigger className="h-7 text-xs w-full sm:w-[160px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: c.color || "#94a3b8" }}
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
                          {MATCH_TYPE_LABELS[rule.matchType] || rule.matchType}
                        </Badge>
                        {/* Show target category if it differs (rule was moved) */}
                        {rule.categoryId !== category.id && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: rule.categoryColor || "#94a3b8" }}
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
                        <ConfirmDeleteButton
                          onConfirm={async () => {
                            await deleteRule.mutateAsync(rule.id);
                          }}
                          pending={deleteRule.isPending}
                          label="Delete rule"
                        />
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
}
