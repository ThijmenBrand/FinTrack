"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Receipt,
} from "lucide-react";
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog";
import { useBudgetHistory } from "@/hooks/use-budgets";
import { formatCurrency } from "@/lib/utils";
import type { Allocation, Transaction, HistoryData } from "@/types/api";

// Deliberately different from the shared formatDate: this list omits the
// year (it's always within the current budget history's own month labels).
function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
  }).format(new Date(dateStr));
}

interface BudgetHistoryDialogProps {
  allocation: Allocation | null;
  onOpenChange: (open: boolean) => void;
}

export function BudgetHistoryDialog({ allocation, onOpenChange }: BudgetHistoryDialogProps) {
  const { data: history, isLoading: loading } = useBudgetHistory(allocation?.categoryId ?? null, !!allocation);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [monthTransactions, setMonthTransactions] = useState<Record<string, Transaction[]>>({});
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null);
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null);

  const toggleMonth = useCallback(
    async (month: string) => {
      if (expandedMonth === month) {
        setExpandedMonth(null);
        return;
      }

      setExpandedMonth(month);

      // Already cached
      if (monthTransactions[month]) return;

      if (!allocation) return;

      // Compute date range for this month
      const [year, monthNum] = month.split("-");
      const dateFrom = `${month}-01`;
      const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
      const dateTo = `${month}-${String(lastDay).padStart(2, "0")}`;

      setLoadingMonth(month);
      try {
        const res = await fetch(
          `/api/transactions?categoryId=${allocation.categoryId}&dateFrom=${dateFrom}&dateTo=${dateTo}&type=expense&limit=100&sortBy=date&sortOrder=desc`
        );
        const data = await res.json();
        setMonthTransactions((prev) => ({
          ...prev,
          [month]: data.data || [],
        }));
      } catch (err) {
        console.error("Failed to fetch transactions:", err);
      } finally {
        setLoadingMonth(null);
      }
    },
    [expandedMonth, monthTransactions, allocation]
  );

  if (!allocation) {
    return (
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle />
            <DialogDescription />
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: allocation.categoryColor || "#94a3b8" }}
            />
            {allocation.categoryName}
          </DialogTitle>
          <DialogDescription>
            Monthly budget: {formatCurrency(allocation.amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !history || history.months.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Receipt className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                No spending history for this category yet.
              </p>
            </div>
          ) : (
            <div className="space-y-2 pb-2">
              {history.months.map((m) => {
                const isExpanded = expandedMonth === m.month;
                const isLoadingTx = loadingMonth === m.month;
                const txList = monthTransactions[m.month];

                const barColor =
                  m.status === "exceeded"
                    ? "#ef4444"
                    : m.status === "warning"
                      ? "#f59e0b"
                      : allocation.categoryColor || "#3b82f6";

                const StatusIcon =
                  m.status === "exceeded"
                    ? XCircle
                    : m.status === "warning"
                      ? AlertTriangle
                      : CheckCircle;

                const statusColor =
                  m.status === "exceeded"
                    ? "text-red-500 dark:text-red-400"
                    : m.status === "warning"
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-green-500 dark:text-green-400";

                return (
                  <div key={m.month} className="rounded-lg border overflow-hidden">
                    <button
                      className="w-full text-left p-3 hover:bg-muted/50 transition-colors"
                      onClick={() => toggleMonth(m.month)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-medium text-sm">{m.label}</span>
                          {m.isCurrent && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              Current
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {m.transactionCount} transaction{m.transactionCount !== 1 ? "s" : ""}
                          </span>
                          <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-1.5 ml-6">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(m.percentage, 100)}%`,
                            backgroundColor: barColor,
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between ml-6 text-sm">
                        <div>
                          <span className="font-semibold">{formatCurrency(m.spent)}</span>
                          <span className="text-muted-foreground">
                            {" "}/ {formatCurrency(allocation.amount)}
                          </span>
                        </div>
                        <span className={`text-xs font-medium ${statusColor}`}>
                          {m.percentage.toFixed(0)}%
                        </span>
                      </div>
                    </button>

                    {/* Expanded transactions */}
                    {isExpanded && (
                      <div className="border-t bg-muted/20">
                        {isLoadingTx ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : txList && txList.length > 0 ? (
                          <div className="divide-y">
                            {txList.map((tx) => (
                              <button
                                key={tx.id}
                                className="w-full flex items-center justify-between pl-9 pr-3 py-2 hover:bg-muted/50 transition-colors text-left"
                                onClick={() => setDetailTransaction(tx)}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="text-xs text-muted-foreground w-12 shrink-0">
                                    {formatDate(tx.date)}
                                  </span>
                                  <span className="text-sm truncate">
                                    {tx.description}
                                  </span>
                                </div>
                                <span className="text-sm font-mono font-medium text-red-600 dark:text-red-400 shrink-0 ml-3">
                                  {formatCurrency(tx.effectiveAmount)}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            No transactions found.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>

      <TransactionDetailDialog
        transaction={detailTransaction}
        onOpenChange={(open) => { if (!open) setDetailTransaction(null); }}
        onCategorized={() => {
          // Clear cached transactions so they re-fetch with updated categories
          setMonthTransactions({});
          if (expandedMonth) {
            const month = expandedMonth;
            setExpandedMonth(null);
            // Re-expand to trigger re-fetch
            setTimeout(() => toggleMonth(month), 0);
          }
        }}
      />
    </Dialog>
  );
}
