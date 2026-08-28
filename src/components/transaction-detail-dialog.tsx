"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Split,
} from "lucide-react";
import { CategorizePopover } from "@/components/categorize-popover";
import { RecurringLinkPopover } from "@/components/recurring-link-popover";
import { SplitSection } from "@/components/split-transaction-editor/split-section";
import { SplitBadge } from "@/components/split-badge";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useCategories } from "@/hooks/use-categories";
import { useAccounts } from "@/hooks/use-accounts";
import { useUndoTransfer, type UndoneCounterpart } from "@/hooks/use-transactions";
import { NotesEditor } from "@/components/notes-editor";

import type { Transaction, ReimbursementDetail } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { UserAvatar } from "@/components/user-avatar";
import type { MessageKey } from "@/lib/i18n/translate";

const TYPE_BADGES: Record<
  string,
  { labelKey: MessageKey; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  income: { labelKey: "tx.type.income", variant: "default" },
  expense: { labelKey: "tx.type.expense", variant: "destructive" },
  internal_transfer: { labelKey: "tx.type.internalTransfer", variant: "secondary" },
  reimbursement: { labelKey: "tx.type.reimbursement", variant: "outline" },
};

interface TransactionDetailDialogProps {
  transaction: Transaction | null;
  onOpenChange: (open: boolean) => void;
  onCategorized?: () => void;
  /** Open straight into the split editor — set from the row context menu's "Split…"/"Edit split…". */
  openSplitEditor?: boolean;
}

export function TransactionDetailDialog({
  transaction,
  onOpenChange,
  onCategorized,
  openSplitEditor,
}: TransactionDetailDialogProps) {
  const { t, formatCurrency, formatDate, formatDateTime } = useI18n();
  // Scoped to this transaction's account: on a shared account the row lives in
  // the OWNER's space, and only their category ids are accepted on it.
  const { data: resolvedCategories = [] } = useCategories(transaction?.accountId);
  const { data: accounts = [] } = useAccounts();
  const undoTransfer = useUndoTransfer();
  // The far legs the last undo rewrote. They live on another account and lost
  // their category with the pairing, so they are shown here to be recategorized
  // — otherwise only the half the user was looking at ever gets fixed.
  // Keyed by the row it came from: this dialog is never unmounted between
  // transactions, so an unkeyed result would leak onto the next one opened.
  const [undoResult, setUndoResult] = useState<{
    txId: string;
    legs: UndoneCounterpart[];
  } | null>(null);
  const undone = undoResult && undoResult.txId === transaction?.id ? undoResult.legs : [];
  const account = accounts.find((a) => a.id === transaction?.accountId);
  // Rules are the owner's config; the server drops them from anyone else.
  const canCreateRule = !account || account.role === "owner";

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
  // `undone` also covers callers that pass a stale transaction: once the undo
  // has run, this row is no longer a transfer whatever the prop still says.
  const isTransfer = tx.type === "internal_transfer" && undone.length === 0;
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
                {isTransfer && tx.linkedTransactionId
                  ? t("tx.row.transferTo", {
                      account: tx.linkedAccountName || t("tx.row.anotherAccount"),
                    })
                  : t(typeInfo.labelKey)}
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
            <span className="text-muted-foreground w-20 shrink-0">{t("common.account")}</span>
            <span className="font-medium">{tx.accountName || "—"}</span>
          </div>

          <div className="flex items-center gap-3">
            <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground w-20 shrink-0">{t("common.category")}</span>
            {/* A split parent carries no category of its own — only its parts
                do, and the server rejects categorizing the wrapper. Same badge
                the list rows show, so no surface offers a control that fails. */}
            {tx.isSplitParent ? (
              <SplitBadge className="text-xs" />
            ) : (
              <CategorizePopover
                transactionId={tx.id}
                transactionDescription={tx.name || tx.description}
                currentCategoryId={tx.categoryId}
                currentCategoryName={tx.categoryName}
                currentCategoryColor={tx.categoryColor}
                currentCategoryIcon={tx.categoryIcon}
                categories={resolvedCategories}
                accountId={tx.accountId}
                canCreateRule={canCreateRule}
                onCategorized={handleCategorized}
              />
            )}
          </div>

          {tx.balance !== null && (
            <div className="flex items-center gap-3">
              <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">{t("txDetail.balance")}</span>
              <span className="font-medium font-mono">{formatCurrency(tx.balance)}</span>
            </div>
          )}

          <div className="flex items-start gap-3">
            <StickyNote className="h-4 w-4 text-muted-foreground shrink-0 mt-1.5" />
            <span className="text-muted-foreground w-20 shrink-0 mt-1">{t("common.notes")}</span>
            <NotesEditor key={tx.id} transactionId={tx.id} initialNotes={tx.notes} />
          </div>

          {tx.parentTransactionId ? (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Split className="h-4 w-4 shrink-0" />
              {t("tx.split.childNote")}
            </div>
          ) : (
            (tx.type === "income" || tx.type === "expense") && (
              <SplitSection
                key={tx.id}
                transaction={tx}
                categories={resolvedCategories}
                accountId={tx.accountId}
                canCreateRule={canCreateRule}
                autoOpen={openSplitEditor}
              />
            )
          )}

          {isTransfer && (
            <div className="flex items-center gap-3">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">{t("txDetail.linkedTo")}</span>
              <span className="font-medium truncate">{tx.linkedAccountName || "—"}</span>
              {/* Detection pairs on amount and date alone, so money someone paid
                  you back can land here by accident. */}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 shrink-0 text-xs text-muted-foreground"
                disabled={undoTransfer.isPending}
                onClick={() =>
                  undoTransfer.mutate(tx.id, {
                    // Stays open on purpose — the counterparts below are the
                    // whole point, and closing would hide them.
                    onSuccess: (r) => setUndoResult({ txId: tx.id, legs: r.counterparts }),
                  })
                }
              >
                {t("txDetail.notATransfer")}
              </Button>
            </div>
          )}

          {undone.map((leg) => (
            <UndoneCounterpartRow key={leg.id} leg={leg} />
          ))}

          {tx.groupName && (
            <div className="flex items-center gap-3">
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">{t("txDetail.pot")}</span>
              <Badge variant="outline" className="text-xs gap-1">
                <Package className="h-3 w-3" />
                {tx.groupName}
              </Badge>
            </div>
          )}

          {(tx.type === "expense" || tx.type === "income") && (
            <div className="flex items-center gap-3">
              <Repeat className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground w-20 shrink-0">{t("txDetail.recurring")}</span>
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
                  <span className="font-medium">{t("txDetail.reimburses")}</span>
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
                  <span className="font-medium">{t("txDetail.reimbursements")}</span>
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
                    <span>{t("txDetail.actualCost")}</span>
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
            {tx.createdByName && (
              <UserAvatar
                name={tx.createdByName}
                image={tx.createdByImage}
                className="h-4 w-4 text-[8px]"
              />
            )}
            <span>
              {/* Only set on shared-account rows — a solo account never needs to say who. */}
              {tx.createdByName
                ? t("txDetail.addedBy", {
                    date: formatDateTime(tx.createdAt),
                    name: tx.createdByName,
                  })
                : t("txDetail.added", { date: formatDateTime(tx.createdAt) })}
            </span>
            {tx.isManual && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {t("txDetail.manual")}
              </Badge>
            )}
            {tx.importBatchId && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {t("txDetail.imported")}
              </Badge>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The far leg of a pairing the user just undid. It is a real row on another
 * account that lost its category along with the transfer, and it is almost
 * never in the list behind this dialog — so it gets categorized from here or
 * not at all.
 */
function UndoneCounterpartRow({ leg }: { leg: UndoneCounterpart }) {
  const { t, formatCurrency } = useI18n();
  // The far account has its own owner on a shared setup, and only that owner's
  // category ids are accepted on its rows.
  const { data: categories = [] } = useCategories(leg.accountId);
  const { data: accounts = [] } = useAccounts();
  const role = accounts.find((a) => a.id === leg.accountId)?.role;

  return (
    <div className="flex items-start gap-3 rounded-md border border-dashed p-3">
      <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0 space-y-2">
        <p className="text-xs text-muted-foreground">
          {t("txDetail.otherLegNeedsCategory", {
            amount: formatCurrency(leg.amount),
            account: leg.accountName || t("tx.row.anotherAccount"),
          })}
        </p>
        <CategorizePopover
          transactionId={leg.id}
          transactionDescription={leg.description}
          currentCategoryId={null}
          currentCategoryName={null}
          currentCategoryColor={null}
          categories={categories}
          accountId={leg.accountId}
          canCreateRule={!role || role === "owner"}
        />
      </div>
    </div>
  );
}
