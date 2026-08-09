"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { CategorizePopover } from "@/components/categorize-popover";
import { TransactionDetailDialog } from "@/components/transaction-detail-dialog";
import { useTransactions } from "@/hooks/use-transactions";
import type { CategoryWithDetails, Transaction } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

const LIMIT = 20;

interface UncategorizedTransactionsProps {
  categories: CategoryWithDetails[];
}

export function UncategorizedTransactions({ categories }: UncategorizedTransactionsProps) {
  const { t, formatCurrency } = useI18n();
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const { data, isLoading } = useTransactions({
    uncategorized: true,
    limit: LIMIT,
    page,
    sortBy: "date",
    sortOrder: "desc",
  });
  const txns = data?.data ?? [];
  const total = data?.pagination.total ?? 0;

  if (total === 0) return null;

  return (
    <div className="space-y-3">
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <AlertCircle className="h-4 w-4 text-amber-500" />
        <h2 className="text-lg font-semibold">
          {t("categories.uncategorized.heading", { count: total })}
        </h2>
      </div>

      {expanded && (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="divide-y">
                  {txns.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setSelected(tx)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {tx.name || tx.description}
                        </p>
                        {tx.name && tx.description && tx.description !== tx.name && (
                          <p className="text-xs text-muted-foreground truncate">
                            {tx.description}
                          </p>
                        )}
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
                        {formatCurrency(tx.amount)}
                      </span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <CategorizePopover
                          transactionId={tx.id}
                          transactionDescription={tx.name || tx.description}
                          currentCategoryId={null}
                          currentCategoryName={null}
                          currentCategoryColor={null}
                          categories={categories.map((c) => ({
                            id: c.id,
                            name: c.name,
                            color: c.color,
                            icon: c.icon,
                          }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {total > LIMIT && (
                  <div className="flex items-center justify-between border-t px-4 py-2.5">
                    <p className="text-xs text-muted-foreground">
                      {t("categories.uncategorized.showing", {
                        from: (page - 1) * LIMIT + 1,
                        to: Math.min(page * LIMIT, total),
                        total,
                      })}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                      >
                        {t("common.previous")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page * LIMIT >= total}
                        onClick={() => setPage(page + 1)}
                      >
                        {t("common.next")}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <TransactionDetailDialog
        transaction={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
