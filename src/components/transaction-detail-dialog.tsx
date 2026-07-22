"use client";

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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Wallet,
  Tag,
  StickyNote,
  Clock,
  Hash,
  ArrowLeftRight,
  Receipt,
  Package,
  Repeat,
} from "lucide-react";
import { CategorizePopover } from "@/components/categorize-popover";
import { RecurringLinkPopover } from "@/components/recurring-link-popover";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useCategories } from "@/hooks/use-categories";
import { NotesEditor } from "@/components/notes-editor";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Transaction, ReimbursementDetail, Category } from "@/types/api";

const TYPE_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  income: { label: "Income", variant: "default" },
  expense: { label: "Expense", variant: "destructive" },
  internal_transfer: { label: "Transfer", variant: "secondary" },
  reimbursement: { label: "Reimbursement", variant: "outline" },
};

interface TransactionDetailDialogProps {
  transaction: Transaction | null;
  onOpenChange: (open: boolean) => void;
  categories?: Category[];
  onCategorized?: () => void;
}

export function TransactionDetailDialog({ transaction, onOpenChange, categories, onCategorized }: TransactionDetailDialogProps) {
  const { data: fetchedCategories } = useCategories();
  const resolvedCategories = categories || fetchedCategories || [];

  const { data: reimbursements = [] } = useQuery({
    queryKey: ["transaction-reimbursements", transaction?.id],
    queryFn: () => apiFetch<{ data: ReimbursementDetail[] }>(`/api/transactions?reimbursesExpenseId=${transaction!.id}&limit=50`).then(r => r.data),
    enabled: !!transaction && transaction.reimbursementCount > 0,
  });

  const { data: linkedExpenses = [] } = useQuery({
    queryKey: ["transaction-linked-expenses", transaction?.id],
    queryFn: () => apiFetch<{ expenses: ReimbursementDetail[] }>(`/api/transactions/reimburse/expenses?reimbursementId=${transaction!.id}`).then(r => r.expenses),
    enabled: !!transaction && transaction.type === "reimbursement",
  });

  const handleCategorized = () => {
    onCategorized?.();
  };

  if (!transaction) {
    return (
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle />
            <DialogDescription />
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const tx = transaction;
  const isTransfer = tx.type === "internal_transfer";
  const isReimbursement = tx.type === "reimbursement";
  const hasReimbursements = tx.reimbursementCount > 0;
  const typeInfo = isTransfer
    ? TYPE_BADGES.internal_transfer
    : (TYPE_BADGES[tx.type] || TYPE_BADGES.expense);

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="min-w-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTitle className="text-base font-semibold leading-snug pr-6 truncate cursor-default">
                  {tx.name || tx.description}
                </DialogTitle>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm break-words">
                {tx.name || tx.description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {tx.name && tx.description && tx.description !== tx.name && (
            <p className="text-xs text-muted-foreground pr-6 break-words pt-0.5 line-clamp-2">
              {tx.description}
            </p>
          )}
          <DialogDescription asChild>
            <div className="flex items-center gap-2 pt-1">
              <Badge variant={typeInfo.variant} className="text-xs">
                {isTransfer && tx.linkedAccountName
                  ? `↔ Transfer → ${tx.linkedAccountName}`
                  : typeInfo.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDate(tx.date)}
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-4 gap-1">
          {(() => {
            const shown = hasReimbursements ? tx.effectiveAmount : tx.amount;
            const neutral = isTransfer || isReimbursement || shown === 0;
            const amountColor = neutral
              ? "text-muted-foreground"
              : shown > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400";
            return (
              <>
                <span className={`text-3xl font-bold font-mono tracking-tight ${amountColor}`}>
                  {!neutral && shown > 0 ? "+" : ""}
                  {formatCurrency(shown)}
                </span>
                {hasReimbursements && (
                  <span className="text-sm text-muted-foreground line-through">
                    {formatCurrency(tx.amount)}
                  </span>
                )}
              </>
            );
          })()}
        </div>

        <Separator />

        <div className="grid gap-3 text-sm">
          <div className="flex items-center gap-3">
            <Wallet className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground w-20 shrink-0">Account</span>
            <span className="font-medium">{tx.accountName || "—"}</span>
          </div>

          <div className="flex items-center gap-3">
            <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground w-20 shrink-0">Category</span>
            <CategorizePopover
              transactionId={tx.id}
              transactionDescription={tx.name || tx.description}
              currentCategoryId={tx.categoryId}
              currentCategoryName={tx.categoryName}
              currentCategoryColor={tx.categoryColor}
              currentCategoryIcon={tx.categoryIcon}
              categories={resolvedCategories}
              onCategorized={handleCategorized}
            />
          </div>

          {tx.balance !== null && (
            <div className="flex items-center gap-3">
              <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">Balance</span>
              <span className="font-medium font-mono">{formatCurrency(tx.balance)}</span>
            </div>
          )}

          <div className="flex items-start gap-3">
            <StickyNote className="h-4 w-4 text-muted-foreground shrink-0 mt-1.5" />
            <span className="text-muted-foreground w-20 shrink-0 mt-1">Notes</span>
            <NotesEditor key={tx.id} transactionId={tx.id} initialNotes={tx.notes} />
          </div>

          {isTransfer && tx.linkedAccountName && (
            <div className="flex items-center gap-3">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">Linked to</span>
              <span className="font-medium">{tx.linkedAccountName}</span>
            </div>
          )}

          {tx.groupName && (
            <div className="flex items-center gap-3">
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">Pot</span>
              <Badge variant="outline" className="text-xs gap-1">
                <Package className="h-3 w-3" />
                {tx.groupName}
              </Badge>
            </div>
          )}

          {(tx.type === "expense" || tx.type === "income") && (
            <div className="flex items-center gap-3">
              <Repeat className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">Recurring</span>
              <RecurringLinkPopover
                transactionId={tx.id}
                transactionAmount={tx.amount}
                transactionAccountId={tx.accountId}
                currentRecurringId={tx.recurringTransactionId}
                currentRecurringDescription={tx.recurringDescription}
              />
            </div>
          )}

          {isReimbursement && linkedExpenses.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">Reimburses</span>
                </div>
                <div className="space-y-1.5 pl-6">
                  {linkedExpenses.map((e) => (
                    <div key={e.id} className="flex items-center rounded-md border px-3 py-2">
                      <div className="flex-1 w-0">
                        <p className="text-sm font-medium truncate">{e.description}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(e.date)}</p>
                      </div>
                      <span className="text-sm font-mono font-medium text-red-600 dark:text-red-400 shrink-0 ml-3">
                        {formatCurrency(e.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Reimbursements section for expenses */}
          {hasReimbursements && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">Reimbursements</span>
                </div>
                <div className="space-y-1.5 pl-6">
                  {reimbursements.map((r) => (
                    <div key={r.id} className="flex items-center rounded-md border px-3 py-2">
                      <div className="flex-1 w-0">
                        <p className="text-sm font-medium truncate">{r.description}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(r.date)}</p>
                      </div>
                      <span className="text-sm font-mono font-medium text-emerald-600 dark:text-emerald-400 shrink-0 ml-3">
                        +{formatCurrency(r.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 px-1">
                    <span>Your actual cost</span>
                    <span className="font-mono font-semibold text-foreground">
                      {formatCurrency(tx.effectiveAmount)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>Added {new Intl.DateTimeFormat("nl-NL", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(tx.createdAt))}</span>
            {tx.isManual && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">Manual</Badge>
            )}
            {tx.importBatchId && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">Imported</Badge>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
