"use client";

import { useState, useCallback, useMemo } from "react";
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
import { CheckCircle2, AlertCircle, Tag, ChevronDown, X, Zap } from "lucide-react";
import { matchesRule, extractPattern } from "@/lib/csv-utils";
import {
  ImportTransactionRow,
  type ImportCategory as Category,
  type ImportPot,
} from "@/components/import-transaction-row";
import { ReimbursementPicker } from "@/components/reimbursement-picker";
import type { PreviewTransaction } from "@/lib/csv-utils";

interface PendingRule {
  pattern: string;
  categoryId: string;
  matchType: string;
}

interface ImportReviewStepProps {
  transactions: PreviewTransaction[];
  categories: Category[];
  pots: ImportPot[];
  accountId: string;
  skipped: number;
  duplicates: number;
  error?: string | null;
  onBack: () => void;
  onConfirm: (
    transactions: PreviewTransaction[],
    newRules: PendingRule[]
  ) => void;
}

// Find similar uncategorized transactions based on pattern matching
function findSimilar(
  pattern: string,
  currentId: string,
  transactions: PreviewTransaction[]
): PreviewTransaction[] {
  return transactions.filter((tx) => {
    if (tx.tempId === currentId || tx.categoryId) return false;
    const target = tx.name ? `${tx.name} — ${tx.description}` : tx.description;
    return matchesRule(target, pattern, "contains");
  });
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

export function ImportReviewStep({
  transactions: initialTransactions,
  categories,
  pots,
  accountId,
  skipped,
  duplicates,
  error,
  onBack,
  onConfirm,
}: ImportReviewStepProps) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [pendingRules, setPendingRules] = useState<PendingRule[]>([]);
  const [batchBanner, setBatchBanner] = useState<BatchApplyBanner | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Track which transactions were auto-matched by rules (had categoryId from the start)
  const [autoMatchedIds] = useState(
    () => new Set(initialTransactions.filter((tx) => tx.categoryId).map((tx) => tx.tempId))
  );

  const categorizedCount = useMemo(
    () => transactions.filter((tx) => tx.categoryId).length,
    [transactions]
  );
  const uncategorizedCount = transactions.length - categorizedCount;

  // Keep the just-categorized trigger row in the attention list while its
  // batch-apply banner is active, so the banner stays visible in that tab.
  const uncategorizedTxs = useMemo(
    () =>
      transactions.filter(
        (tx) => !tx.categoryId || tx.tempId === batchBanner?.triggerTxId
      ),
    [transactions, batchBanner?.triggerTxId]
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

      const pattern = extractPattern(tx.name || tx.description);
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

  const handleNotesChange = useCallback((tempId: string, notes: string | null) => {
    setTransactions((prev) =>
      prev.map((tx) => (tx.tempId === tempId ? { ...tx, notes } : tx))
    );
  }, []);

  const handlePotChange = useCallback((tempId: string, groupId: string | null) => {
    setTransactions((prev) =>
      prev.map((tx) => (tx.tempId === tempId ? { ...tx, groupId } : tx))
    );
  }, []);

  // Row whose reimbursement picker is currently open
  const [reimburseTargetId, setReimburseTargetId] = useState<string | null>(null);
  const reimburseTarget = reimburseTargetId
    ? transactions.find((tx) => tx.tempId === reimburseTargetId) ?? null
    : null;

  const handleToggleReimbursement = useCallback(
    (tempId: string) => {
      const tx = transactions.find((t) => t.tempId === tempId);
      if (!tx) return;
      if (tx.type === "reimbursement") {
        // Unmark: back to plain income
        setTransactions((prev) =>
          prev.map((t) =>
            t.tempId === tempId
              ? { ...t, type: "income", reimbursesExpenseId: null, reimbursesDescription: null }
              : t
          )
        );
      } else {
        setReimburseTargetId(tempId);
      }
    },
    [transactions]
  );

  const handleReimburseSelect = useCallback(
    (expense: { id: string; description: string }) => {
      const tempId = reimburseTargetId;
      if (!tempId) return;
      setTransactions((prev) =>
        prev.map((t) =>
          t.tempId === tempId
            ? {
                ...t,
                type: "reimbursement",
                reimbursesExpenseId: expense.id,
                reimbursesDescription: expense.description,
              }
            : t
        )
      );
      setReimburseTargetId(null);
    },
    [reimburseTargetId]
  );

  const handleToggleSelect = useCallback((tempId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  const handleBulkCategory = (categoryId: string) => {
    setTransactions((prev) =>
      prev.map((tx) => (selectedIds.has(tx.tempId) ? { ...tx, categoryId } : tx))
    );
    setSelectedIds(new Set());
    setBatchBanner(null);
  };

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
    const allSelected =
      txList.length > 0 && txList.every((tx) => selectedIds.has(tx.tempId));

    return (
      <>
        <div className="rounded-md border divide-y">
          {/* Header */}
          <div className="flex items-center gap-2 sm:gap-3 px-3 py-1.5 bg-muted/50 text-xs font-medium text-muted-foreground">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (allSelected) txList.forEach((tx) => next.delete(tx.tempId));
                  else txList.forEach((tx) => next.add(tx.tempId));
                  return next;
                });
              }}
              aria-label="Select all"
              className="shrink-0"
            />
            <span className="shrink-0 sm:w-16">Date</span>
            <span className="flex-1">Description</span>
            <span className="text-right shrink-0 sm:w-24">Amount</span>
            {/* Spacers matching the per-row note / pot / reimbursement buttons */}
            <span className="w-7 shrink-0" />
            {pots.length > 0 && <span className="w-7 shrink-0" />}
            <span className="w-7 shrink-0" />
            <span className="w-44 shrink-0 hidden sm:block">Category</span>
          </div>

          {visible.map((tx) => (
            <div key={tx.tempId}>
              <ImportTransactionRow
                tx={tx}
                categories={categories}
                pots={pots}
                onCategoryChange={handleCategoryChange}
                onNotesChange={handleNotesChange}
                onPotChange={handlePotChange}
                onToggleReimbursement={handleToggleReimbursement}
                isAutoMatched={autoMatchedIds.has(tx.tempId)}
                selected={selectedIds.has(tx.tempId)}
                onToggleSelect={handleToggleSelect}
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
        {(skipped > 0 || duplicates > 0) && (
          <div className="text-xs text-muted-foreground ml-auto">
            {[
              duplicates > 0 &&
                `${duplicates} duplicate${duplicates !== 1 ? "s" : ""} already imported`,
              skipped > 0 &&
                `${skipped} row${skipped !== 1 ? "s" : ""} skipped (invalid data)`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>

      {/* Bulk category bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Select value="" onValueChange={handleBulkCategory}>
            <SelectTrigger className="h-8 w-52 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Tag className="h-3 w-3" />
                <span>Set category...</span>
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
          <Button
            variant="ghost"
            size="sm"
            className="h-8 ml-auto"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="mr-1 h-3 w-3" />
            Clear
          </Button>
        </div>
      )}

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

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="min-w-0 break-words">
            <p className="font-medium">Import failed</p>
            <p className="opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Reimbursement expense picker — selection is stored on the row and linked at commit */}
      {reimburseTarget && (
        <ReimbursementPicker
          open
          onOpenChange={(o) => {
            if (!o) setReimburseTargetId(null);
          }}
          transactionAmount={reimburseTarget.amount}
          transactionDescription={reimburseTarget.name || reimburseTarget.description}
          transactionDate={reimburseTarget.date}
          accountId={accountId}
          onSelect={handleReimburseSelect}
        />
      )}

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
