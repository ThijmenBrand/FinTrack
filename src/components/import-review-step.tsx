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
import { CheckCircle2, AlertCircle, ChevronDown, X, Zap } from "lucide-react";
import { matchesRule, extractPattern } from "@/lib/csv-utils";
import { SplitPartsEditor } from "@/components/split-transaction-editor/split-parts-editor";
import {
  newSplitRow,
  splitCents,
  type SplitRow,
} from "@/components/split-transaction-editor/split-rows";
import {
  ImportTransactionRow,
  type ImportCategory as Category,
  type ImportPot,
} from "@/components/import-transaction-row";
import { ReimbursementPicker } from "@/components/reimbursement-picker";
import { CategoryPicker } from "@/components/category-picker";
import type { PreviewTransaction } from "@/lib/csv-utils";
import { useI18n } from "@/lib/i18n/client";

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
  pending: number;
  feesApplied: number;
  duplicates: number;
  error?: string | null;
  onBack: () => void;
  onConfirm: (
    transactions: PreviewTransaction[],
    newRules: PendingRule[]
  ) => void;
}

/**
 * Whether a row still needs the user's attention. A row split into parts is
 * handled once every part has a category — the parts are what get categorized,
 * the row itself deliberately stays category-less (it becomes a split parent,
 * which counts in no totals).
 */
function isHandled(tx: PreviewTransaction): boolean {
  if (tx.splits?.length) return tx.splits.every((s) => s.categoryId);
  return !!tx.categoryId;
}

// Find similar uncategorized transactions based on pattern matching
function findSimilar(
  pattern: string,
  currentId: string,
  transactions: PreviewTransaction[]
): PreviewTransaction[] {
  return transactions.filter((tx) => {
    // Split rows are categorized through their parts, never in bulk.
    if (tx.tempId === currentId || tx.categoryId || tx.splits?.length) return false;
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
  pending,
  feesApplied,
  duplicates,
  error,
  onBack,
  onConfirm,
}: ImportReviewStepProps) {
  const { t, plural } = useI18n();
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
    () => transactions.filter(isHandled).length,
    [transactions]
  );
  const uncategorizedCount = transactions.length - categorizedCount;

  // Keep the just-categorized trigger row in the attention list while its
  // batch-apply banner is active, so the banner stays visible in that tab.
  const uncategorizedTxs = useMemo(
    () =>
      transactions.filter(
        (tx) => !isHandled(tx) || tx.tempId === batchBanner?.triggerTxId
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
          categoryName: cat?.name || t("csvReview.unknownCategory"),
          matchCount: similar.length,
          matchIds: similar.map((s) => s.tempId),
          createRule: true,
          ruleMatchType: "contains",
        });
      } else {
        setBatchBanner(null);
      }
    },
    [transactions, categories, t]
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

  // A pot claims the whole row, so it drops any split the row had (the row
  // editor hides the pot picker while a split exists, this covers the rest).
  const handlePotChange = useCallback((tempId: string, groupId: string | null) => {
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.tempId === tempId
          ? { ...tx, groupId, ...(groupId ? { splits: null, splitRuleId: null } : {}) }
          : tx
      )
    );
  }, []);

  // Row whose split editor is open (proposed parts, or a fresh manual split)
  const [splitEditorId, setSplitEditorId] = useState<string | null>(null);

  const handleEditSplit = useCallback((tempId: string) => setSplitEditorId(tempId), []);

  const handleRemoveSplit = useCallback((tempId: string) => {
    setSplitEditorId((id) => (id === tempId ? null : id));
    setTransactions((prev) =>
      prev.map((tx) => (tx.tempId === tempId ? { ...tx, splits: null, splitRuleId: null } : tx))
    );
  }, []);

  /**
   * Store edited parts on the row. splitRuleId is dropped: once the parts have
   * been through the editor they are the user's, so the commit records the
   * children as manually categorized and Recalculate All leaves them alone.
   */
  const handleSaveSplit = useCallback(
    (tempId: string, rows: SplitRow[], sign: number) => {
      setTransactions((prev) =>
        prev.map((tx) =>
          tx.tempId === tempId
            ? {
                ...tx,
                categoryId: null,
                splitRuleId: null,
                splits: rows.map((r) => ({
                  amount: (sign * splitCents(r.amount)) / 100,
                  categoryId: r.categoryId,
                })),
              }
            : tx
        )
      );
      setSplitEditorId(null);
    },
    []
  );

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
              ? {
                  ...t,
                  type: "income",
                  reimbursesExpenseId: null,
                  reimbursesTempId: null,
                  reimbursesDescription: null,
                }
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
    (expense: { id: string; description: string; local?: boolean }) => {
      const tempId = reimburseTargetId;
      if (!tempId) return;
      setTransactions((prev) =>
        prev.map((t) =>
          t.tempId === tempId
            ? {
                ...t,
                type: "reimbursement",
                // A local pick references another import row by tempId; a DB pick
                // references an existing expense id. Only one is ever set.
                reimbursesExpenseId: expense.local ? null : expense.id,
                reimbursesTempId: expense.local ? expense.id : null,
                reimbursesDescription: expense.description,
                // Reimbursements can't be split (nor split rows reimbursed).
                splits: null,
                splitRuleId: null,
              }
            : t
        )
      );
      setReimburseTargetId(null);
    },
    [reimburseTargetId]
  );

  // Other to-be-imported expense rows offered as reimbursement targets.
  const localExpenses = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            t.type === "expense" &&
            t.amount < 0 &&
            t.tempId !== reimburseTargetId
        )
        .map((t) => {
          const cat = categories.find((c) => c.id === t.categoryId);
          return {
            id: t.tempId,
            date: t.date,
            description: t.name || t.description,
            amount: t.amount,
            accountName: null,
            categoryName: cat?.name ?? null,
            categoryColor: cat?.color ?? null,
            local: true,
          };
        }),
    [transactions, reimburseTargetId, categories]
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
      prev.map((tx) =>
        selectedIds.has(tx.tempId) && !tx.splits?.length ? { ...tx, categoryId } : tx
      )
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
              aria-label={t("csvReview.selectAll")}
              className="shrink-0"
            />
            <span className="shrink-0 sm:w-16">{t("csvReview.colDate")}</span>
            <span className="flex-1">{t("csvReview.colDescription")}</span>
            <span className="text-right shrink-0 sm:w-24">{t("csvReview.colAmount")}</span>
            {/* Spacers matching the per-row note / split / pot / reimbursement buttons */}
            <span className="w-7 shrink-0" />
            <span className="w-7 shrink-0" />
            <span className="w-7 shrink-0" />
            <span className="w-7 shrink-0" />
            <span className="w-44 shrink-0 hidden sm:block">{t("csvReview.colCategory")}</span>
          </div>

          {visible.map((tx) => (
            <div key={tx.tempId}>
              <ImportTransactionRow
                tx={tx}
                categories={categories}
                pots={pots}
                accountId={accountId}
                onCategoryChange={handleCategoryChange}
                onNotesChange={handleNotesChange}
                onPotChange={handlePotChange}
                onToggleReimbursement={handleToggleReimbursement}
                onEditSplit={handleEditSplit}
                onRemoveSplit={handleRemoveSplit}
                isAutoMatched={autoMatchedIds.has(tx.tempId)}
                selected={selectedIds.has(tx.tempId)}
                onToggleSelect={handleToggleSelect}
              />
              {/* Split editor — local state only; nothing is written until import */}
              {splitEditorId === tx.tempId && (
                <div className="border-b bg-muted/30 px-3 py-2">
                  <SplitPartsEditor
                    totalCents={Math.round(Math.abs(tx.amount) * 100)}
                    categories={categories}
                    accountId={accountId}
                    showDescriptions={false}
                    initialRows={
                      tx.splits?.length
                        ? tx.splits.map((s) =>
                            newSplitRow(Math.abs(s.amount).toFixed(2), s.categoryId)
                          )
                        : [newSplitRow("0.00"), newSplitRow(Math.abs(tx.amount).toFixed(2))]
                    }
                    onSave={(rows) =>
                      handleSaveSplit(tx.tempId, rows, tx.amount < 0 ? -1 : 1)
                    }
                    onCancel={() => setSplitEditorId(null)}
                  />
                </div>
              )}
              {/* Batch apply banner - shown directly below the triggering transaction */}
              {batchBanner && batchBanner.triggerTxId === tx.tempId && (
                <div className="px-3 py-2 bg-primary/5 border-b">
                  <div className="flex items-start gap-3">
                    <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm">
                          {plural(
                            batchBanner.matchCount,
                            "csvReview.batchApply.one",
                            "csvReview.batchApply.other",
                            { category: batchBanner.categoryName },
                          )}
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button size="sm" className="h-7" onClick={handleBatchApply}>
                            {t("csvReview.apply")}
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
                            {t("csvReview.createRule")}
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
                                  <SelectItem value="contains">{t("categories.match.contains")}</SelectItem>
                                  <SelectItem value="starts_with">
                                    {t("categories.match.startsWith")}
                                  </SelectItem>
                                  <SelectItem value="exact">{t("categories.match.exact")}</SelectItem>
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
            <span className="font-semibold">{categorizedCount}</span>{" "}
            {t("csvReview.categorized")}
          </span>
        </div>
        {uncategorizedCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            <span>
              <span className="font-semibold">{uncategorizedCount}</span>{" "}
              {t("csvReview.needAttention")}
            </span>
          </div>
        )}
        {(skipped > 0 || pending > 0 || feesApplied > 0 || duplicates > 0) && (
          <div className="text-xs text-muted-foreground ml-auto">
            {[
              duplicates > 0 &&
                plural(duplicates, "csvReview.duplicates.one", "csvReview.duplicates.other"),
              feesApplied > 0 &&
                plural(feesApplied, "csvReview.fees.one", "csvReview.fees.other"),
              pending > 0 &&
                plural(pending, "csvReview.pending.one", "csvReview.pending.other"),
              skipped > 0 &&
                plural(skipped, "csvReview.skipped.one", "csvReview.skipped.other"),
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
            {t("csvReview.selectedCount", { count: selectedIds.size })}
          </span>
          <div className="w-52">
            <CategoryPicker
              categories={categories}
              value={null}
              onChange={handleBulkCategory}
              className="h-8 text-xs"
              placeholder={t("csvReview.setCategory")}
              accountId={accountId}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 ml-auto"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="mr-1 h-3 w-3" />
            {t("common.clear")}
          </Button>
        </div>
      )}

      {/* Pending rules indicator */}
      {pendingRules.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5">
          <p className="text-xs font-medium text-primary mb-1.5">
            {plural(
              pendingRules.length,
              "csvReview.pendingRules.one",
              "csvReview.pendingRules.other",
            )}
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
            {t("csvReview.tabAttention", { count: uncategorizedCount })}
          </TabsTrigger>
          <TabsTrigger value="all">
            {t("csvReview.tabAll", { count: transactions.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attention" className="mt-3">
          {uncategorizedCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 dark:text-emerald-400 mb-2" />
              <p className="text-sm font-medium">{t("csvReview.allCategorized")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("csvReview.switchToAll")}
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
            <p className="font-medium">{t("csvReview.importFailed")}</p>
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
          localExpenses={localExpenses}
        />
      )}

      {/* Footer */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          {t("auth.back")}
        </Button>
        <Button onClick={handleConfirm}>
          {plural(
            transactions.length,
            "csvReview.importCount.one",
            "csvReview.importCount.other",
          )}
          {uncategorizedCount > 0 && (
            <span className="ml-1 opacity-75 hidden sm:inline">
              {t("csvReview.uncategorizedSuffix", { count: uncategorizedCount })}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
