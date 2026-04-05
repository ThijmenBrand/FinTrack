"use client";

import { useState, useCallback, useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2,
  AlertCircle,
  Tag,
  ChevronDown,
  X,
  Zap,
} from "lucide-react";
import { matchesRule, extractPattern } from "@/lib/csv-utils";
import { cn } from "@/lib/utils";
import type { PreviewTransaction } from "@/lib/csv-utils";

interface Category {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

interface PendingRule {
  pattern: string;
  categoryId: string;
  matchType: string;
}

interface ImportReviewStepProps {
  transactions: PreviewTransaction[];
  categories: Category[];
  skipped: number;
  onBack: () => void;
  onConfirm: (
    transactions: PreviewTransaction[],
    newRules: PendingRule[]
  ) => void;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(dateStr + "T12:00:00"));
}

// Find similar uncategorized transactions based on pattern matching
function findSimilar(
  pattern: string,
  currentId: string,
  transactions: PreviewTransaction[]
): PreviewTransaction[] {
  return transactions.filter(
    (tx) =>
      tx.tempId !== currentId &&
      !tx.categoryId &&
      matchesRule(tx.description, pattern, "contains")
  );
}

interface BatchApplyBanner {
  triggerTxId: string;
  pattern: string;
  categoryId: string;
  categoryName: string;
  matchCount: number;
  matchIds: string[];
  createRule: boolean;
  ruleMatchType: string;
}

const TransactionRow = memo(function TransactionRow({
  tx,
  categories,
  onCategoryChange,
  isAutoMatched,
}: {
  tx: PreviewTransaction;
  categories: Category[];
  onCategoryChange: (tempId: string, categoryId: string) => void;
  isAutoMatched: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const category = categories.find((c) => c.id === tx.categoryId);

  const categorySelect = tx.categoryId && isAutoMatched ? (
    <Select
      value={tx.categoryId}
      onValueChange={(v) => onCategoryChange(tx.tempId, v)}
    >
      <SelectTrigger className="h-7 text-xs border-dashed">
        <span className="flex items-center gap-1.5 truncate">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: category?.color || "#94a3b8" }}
          />
          <span className="truncate">{category?.name}</span>
          <CheckCircle2 className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0 ml-auto" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {categories.map((cat) => (
          <SelectItem key={cat.id} value={cat.id}>
            <span className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: cat.color || "#94a3b8" }}
              />
              {cat.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : tx.categoryId ? (
    <Select
      value={tx.categoryId}
      onValueChange={(v) => onCategoryChange(tx.tempId, v)}
    >
      <SelectTrigger className="h-7 text-xs">
        <span className="flex items-center gap-1.5 truncate">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: category?.color || "#94a3b8" }}
          />
          <span className="truncate">{category?.name}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {categories.map((cat) => (
          <SelectItem key={cat.id} value={cat.id}>
            <span className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: cat.color || "#94a3b8" }}
              />
              {cat.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : (
    <Select
      value=""
      onValueChange={(v) => onCategoryChange(tx.tempId, v)}
    >
      <SelectTrigger className="h-7 text-xs border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Tag className="h-3 w-3" />
          <span>Select...</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {categories.map((cat) => (
          <SelectItem key={cat.id} value={cat.id}>
            <span className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: cat.color || "#94a3b8" }}
              />
              {cat.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="px-3 py-2 border-b last:border-b-0 hover:bg-muted/30 transition-colors space-y-1.5 sm:space-y-0">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Date */}
        <span className="text-xs text-muted-foreground shrink-0 sm:w-16">
          {formatDate(tx.date)}
        </span>

        {/* Description */}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className={cn(
            "text-sm text-left flex-1 min-w-0 cursor-pointer hover:text-foreground/80 transition-colors",
            !expanded && "truncate"
          )}
          title={expanded ? undefined : tx.description}
        >
          {tx.description}
        </button>

        {/* Amount */}
        <span
          className={`text-sm font-mono font-medium text-right shrink-0 tabular-nums sm:w-24 ${
            tx.amount >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {tx.amount >= 0 ? "+" : ""}
          {formatCurrency(tx.amount)}
        </span>

        {/* Category selector — desktop only, inline */}
        <div className="w-44 shrink-0 hidden sm:block">
          {categorySelect}
        </div>
      </div>

      {/* Category selector — mobile only, full width below */}
      <div className="sm:hidden">
        {categorySelect}
      </div>
    </div>
  );
});

export function ImportReviewStep({
  transactions: initialTransactions,
  categories,
  skipped,
  onBack,
  onConfirm,
}: ImportReviewStepProps) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [pendingRules, setPendingRules] = useState<PendingRule[]>([]);
  const [batchBanner, setBatchBanner] = useState<BatchApplyBanner | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);

  // Track which transactions were auto-matched by rules (had categoryId from the start)
  const [autoMatchedIds] = useState(
    () => new Set(initialTransactions.filter((tx) => tx.categoryId).map((tx) => tx.tempId))
  );

  const categorizedCount = useMemo(
    () => transactions.filter((tx) => tx.categoryId).length,
    [transactions]
  );
  const uncategorizedCount = transactions.length - categorizedCount;

  const uncategorizedTxs = useMemo(
    () => transactions.filter((tx) => !tx.categoryId),
    [transactions]
  );

  const handleCategoryChange = useCallback(
    (tempId: string, categoryId: string) => {
      // Update the single transaction
      setTransactions((prev) =>
        prev.map((tx) => (tx.tempId === tempId ? { ...tx, categoryId } : tx))
      );

      // Check for similar uncategorized transactions
      const tx = transactions.find((t) => t.tempId === tempId);
      if (!tx) return;

      const pattern = extractPattern(tx.description);
      const similar = findSimilar(pattern, tempId, transactions);
      const cat = categories.find((c) => c.id === categoryId);

      if (similar.length > 0) {
        setBatchBanner({
          triggerTxId: tempId,
          pattern,
          categoryId,
          categoryName: cat?.name || "Unknown",
          matchCount: similar.length,
          matchIds: similar.map((s) => s.tempId),
          createRule: true,
          ruleMatchType: "contains",
        });
      } else {
        setBatchBanner(null);
      }
    },
    [transactions, categories]
  );

  const handleBatchApply = useCallback(() => {
    if (!batchBanner) return;

    const { matchIds, categoryId, createRule, pattern, ruleMatchType } = batchBanner;

    // Apply category to all matching transactions
    setTransactions((prev) =>
      prev.map((tx) =>
        matchIds.includes(tx.tempId) ? { ...tx, categoryId } : tx
      )
    );

    // Add rule if requested
    if (createRule && pattern) {
      setPendingRules((prev) => {
        // Don't add duplicate rules
        const exists = prev.some(
          (r) => r.pattern === pattern && r.categoryId === categoryId
        );
        if (exists) return prev;
        return [...prev, { pattern, categoryId, matchType: ruleMatchType }];
      });
    }

    setBatchBanner(null);
  }, [batchBanner]);

  const handleDismissBatch = useCallback(() => {
    setBatchBanner(null);
  }, []);

  const handleRemoveRule = useCallback((index: number) => {
    setPendingRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleConfirm = () => {
    onConfirm(transactions, pendingRules);
  };

  const renderTransactionList = (
    txList: PreviewTransaction[],
    limit: number
  ) => {
    const visible = txList.slice(0, limit);
    const hasMore = txList.length > limit;

    return (
      <>
        <div className="rounded-md border divide-y">
          {/* Header */}
          <div className="flex items-center gap-2 sm:gap-3 px-3 py-1.5 bg-muted/50 text-xs font-medium text-muted-foreground">
            <span className="shrink-0 sm:w-16">Date</span>
            <span className="flex-1">Description</span>
            <span className="text-right shrink-0 sm:w-24">Amount</span>
            <span className="w-44 shrink-0 hidden sm:block">Category</span>
          </div>

          {visible.map((tx) => (
            <div key={tx.tempId}>
              <TransactionRow
                tx={tx}
                categories={categories}
                onCategoryChange={handleCategoryChange}
                isAutoMatched={autoMatchedIds.has(tx.tempId)}
              />
              {/* Batch apply banner - shown directly below the triggering transaction */}
              {batchBanner && batchBanner.triggerTxId === tx.tempId && (
                <div className="px-3 py-2 bg-primary/5 border-b">
                  <div className="flex items-start gap-3">
                    <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm">
                          Apply{" "}
                          <span className="font-semibold">
                            {batchBanner.categoryName}
                          </span>{" "}
                          to{" "}
                          <span className="font-semibold">
                            {batchBanner.matchCount}
                          </span>{" "}
                          similar transaction
                          {batchBanner.matchCount !== 1 ? "s" : ""}?
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button size="sm" className="h-7" onClick={handleBatchApply}>
                            Apply
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleDismissBatch}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Rule creation option */}
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="batch-create-rule"
                          checked={batchBanner.createRule}
                          onCheckedChange={(checked) =>
                            setBatchBanner((prev) =>
                              prev ? { ...prev, createRule: checked === true } : null
                            )
                          }
                          className="mt-0.5"
                        />
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="batch-create-rule"
                            className="text-xs font-medium cursor-pointer"
                          >
                            Create rule for future imports
                          </Label>
                          {batchBanner.createRule && (
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <Input
                                value={batchBanner.pattern}
                                onChange={(e) =>
                                  setBatchBanner((prev) =>
                                    prev
                                      ? { ...prev, pattern: e.target.value }
                                      : null
                                  )
                                }
                                className="h-7 text-xs font-mono sm:max-w-[200px]"
                              />
                              <Select
                                value={batchBanner.ruleMatchType}
                                onValueChange={(v) =>
                                  setBatchBanner((prev) =>
                                    prev ? { ...prev, ruleMatchType: v } : null
                                  )
                                }
                              >
                                <SelectTrigger className="h-7 text-xs sm:w-[130px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="contains">Contains</SelectItem>
                                  <SelectItem value="starts_with">
                                    Starts with
                                  </SelectItem>
                                  <SelectItem value="exact">Exact match</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {hasMore && (
          <div className="flex justify-center pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((c) => c + 50)}
            >
              <ChevronDown className="mr-1.5 h-3 w-3" />
              Show more ({txList.length - limit} remaining)
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4 py-2">
      {/* Summary bar */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap rounded-lg bg-muted/50 px-3 sm:px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
          <span>
            <span className="font-semibold">{categorizedCount}</span> categorized
          </span>
        </div>
        {uncategorizedCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            <span>
              <span className="font-semibold">{uncategorizedCount}</span> need
              attention
            </span>
          </div>
        )}
        {skipped > 0 && (
          <div className="text-xs text-muted-foreground ml-auto">
            {skipped} row{skipped !== 1 ? "s" : ""} skipped (invalid data)
          </div>
        )}
      </div>

      {/* Pending rules indicator */}
      {pendingRules.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5">
          <p className="text-xs font-medium text-primary mb-1.5">
            {pendingRules.length} new rule{pendingRules.length !== 1 ? "s" : ""}{" "}
            will be created on import:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pendingRules.map((rule, i) => {
              const cat = categories.find((c) => c.id === rule.categoryId);
              return (
                <Badge
                  key={i}
                  variant="secondary"
                  className="text-xs gap-1.5 pr-1"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: cat?.color || "#94a3b8" }}
                  />
                  &quot;{rule.pattern}&quot; → {cat?.name}
                  <button
                    onClick={() => handleRemoveRule(i)}
                    className="ml-0.5 hover:bg-muted rounded p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue={uncategorizedCount > 0 ? "attention" : "all"}>
        <TabsList>
          <TabsTrigger value="attention" disabled={uncategorizedCount === 0}>
            Needs Attention ({uncategorizedCount})
          </TabsTrigger>
          <TabsTrigger value="all">
            All ({transactions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attention" className="mt-3">
          {uncategorizedCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 dark:text-emerald-400 mb-2" />
              <p className="text-sm font-medium">All transactions categorized</p>
              <p className="text-xs text-muted-foreground mt-1">
                Switch to the &quot;All&quot; tab to review everything.
              </p>
            </div>
          ) : (
            renderTransactionList(uncategorizedTxs, visibleCount)
          )}
        </TabsContent>

        <TabsContent value="all" className="mt-3">
          {renderTransactionList(transactions, visibleCount)}
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleConfirm}>
          Import {transactions.length} transaction
          {transactions.length !== 1 ? "s" : ""}
          {uncategorizedCount > 0 && (
            <span className="ml-1 opacity-75 hidden sm:inline">
              ({uncategorizedCount} uncategorized)
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
