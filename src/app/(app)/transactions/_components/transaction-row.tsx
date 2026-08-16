"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CategorizePopover } from "@/components/categorize-popover";
import { PotCategoryPopover } from "@/components/pot-category-popover";
import { CategoryIcon } from "@/components/category-icon";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import {
  Package,
  Plus,
  Minus,
  Pencil,
  Receipt,
  Undo2,
  Target,
  StickyNote,
  Filter,
} from "lucide-react";
import type { Transaction, Category, Pot, PotRangeTotal } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

const TYPE_BADGES: Record<
  string,
  { labelKey: MessageKey; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  income: { labelKey: "tx.type.income", variant: "default" },
  expense: { labelKey: "tx.type.expense", variant: "destructive" },
  internal_transfer: { labelKey: "tx.type.internalTransfer", variant: "secondary" },
  reimbursement: { labelKey: "tx.type.reimbursement", variant: "outline" },
};

type Layout = "table" | "card";

/** Pot badge — links to the pot's detail on the pots page. */
function PotBadge({ groupId, groupName, className }: { groupId: string; groupName: string; className: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/pots?pot=${groupId}`}
      onClick={(e) => e.stopPropagation()}
      title={t("tx.row.viewPot", { name: groupName })}
    >
      <Badge variant="outline" className={`${className} hover:bg-muted transition-colors`}>
        <Package className="h-2.5 w-2.5" />
        {groupName}
      </Badge>
    </Link>
  );
}

interface TransactionRowProps {
  tx: Transaction;
  layout: Layout;
  categories: Category[];
  selected: boolean;
  hasPots: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onAddToPot: () => void;
  onRemoveFromPot: () => void;
  onReimburse: () => void;
  onUnlinkReimbursement: () => void;
  onDelete: () => void | Promise<void>;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/** Amount cell — shared between layouts; handles reimbursement strike-through and in-pot/transfer muting. */
function Amount({ tx }: { tx: Transaction }) {
  const { formatCurrency } = useI18n();
  const isTransfer = tx.type === "internal_transfer";
  const isReimbursement = tx.type === "reimbursement";
  const isInPot = !!tx.groupId;
  if (tx.reimbursementCount > 0) {
    return (
      <>
        <span className="block font-mono text-sm font-medium text-red-600 dark:text-red-400">
          {formatCurrency(tx.effectiveAmount)}
        </span>
        <span className="block text-xs text-muted-foreground line-through">
          {formatCurrency(tx.amount)}
        </span>
      </>
    );
  }
  return (
    <span
      className={`font-mono text-sm font-medium ${isInPot ? "line-through " : ""}${
        isTransfer || isReimbursement || isInPot
          ? "text-muted-foreground"
          : tx.amount >= 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400"
      }`}
    >
      {tx.amount >= 0 ? "+" : ""}
      {formatCurrency(tx.amount)}
    </span>
  );
}

export function TransactionRow({
  tx,
  layout,
  categories,
  selected,
  hasPots,
  onToggleSelect,
  onOpen,
  onAddToPot,
  onRemoveFromPot,
  onReimburse,
  onUnlinkReimbursement,
  onDelete,
  onContextMenu,
}: TransactionRowProps) {
  const { t, formatDate } = useI18n();
  const isTransfer = tx.type === "internal_transfer";
  const isReimbursement = tx.type === "reimbursement";
  const isInPot = !!tx.groupId;
  const hasReimbursements = tx.reimbursementCount > 0;
  const typeInfo = isTransfer
    ? TYPE_BADGES.internal_transfer
    : (TYPE_BADGES[tx.type] || TYPE_BADGES.expense);

  if (layout === "card") {
    return (
      <div
        className={`flex items-center gap-3 px-4 py-3 active:bg-muted/50 cursor-pointer transition-colors ${
          isReimbursement || isInPot ? "opacity-60" : ""
        }`}
        onClick={onOpen}
        onContextMenu={onContextMenu}
      >
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={t("tx.row.selectTransaction")}
          />
        </span>
        <CategoryIcon icon={tx.categoryIcon} color={tx.categoryColor} size="md" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className={`text-sm font-medium truncate ${isInPot ? "line-through" : ""}`}>
              {tx.description}
            </p>
            {tx.groupId && tx.groupName && (
              <PotBadge
                groupId={tx.groupId}
                groupName={tx.groupName}
                className="text-[10px] px-1 py-0 shrink-0 gap-0.5"
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(tx.date)}
            {tx.accountName && ` · ${tx.accountName}`}
          </p>
          {isReimbursement && tx.reimbursesDescription && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {t("tx.row.reimburses", { description: tx.reimbursesDescription })}
            </p>
          )}
          {tx.createdByName && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {t("tx.row.addedBy", { name: tx.createdByName })}
            </p>
          )}
        </div>

        <div className="text-right shrink-0">
          <Amount tx={tx} />
        </div>
      </div>
    );
  }

  return (
    <TableRow
      className={`cursor-pointer ${isReimbursement || isInPot ? "opacity-60" : ""}`}
      onClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={t("tx.row.selectTransaction")}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        <span className={isInPot ? "line-through" : ""}>{formatDate(tx.date)}</span>
      </TableCell>
      <TableCell className="max-w-[150px] sm:max-w-[300px] text-sm font-medium">
        <div className="flex items-center gap-1.5">
          <span className={`truncate ${isInPot ? "line-through" : ""}`}>{tx.name || tx.description}</span>
          {tx.notes && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label={t("tx.row.hasNote")} />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap break-words">
                  {tx.notes}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {tx.groupId && tx.groupName && (
            <PotBadge
              groupId={tx.groupId}
              groupName={tx.groupName}
              className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5"
            />
          )}
        </div>
        {tx.name && tx.description && tx.description !== tx.name && (
          <div className={`text-xs text-muted-foreground truncate mt-0.5 ${isInPot ? "line-through" : ""}`}>
            {tx.description}
          </div>
        )}
        {isReimbursement && tx.reimbursesDescription && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {t("tx.row.reimburses", { description: tx.reimbursesDescription })}
          </div>
        )}
        {/* Only set on shared-account rows — a solo account never needs to say who. */}
        {tx.createdByName && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {t("tx.row.addedBy", { name: tx.createdByName })}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap hidden sm:table-cell">
        <span className={isInPot ? "line-through" : ""}>{tx.accountName || "—"}</span>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <CategorizePopover
          transactionId={tx.id}
          transactionDescription={tx.name || tx.description}
          currentCategoryId={tx.categoryId}
          currentCategoryName={tx.categoryName}
          currentCategoryColor={tx.categoryColor}
          currentCategoryIcon={tx.categoryIcon}
          categories={categories}
        />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center gap-1">
          <Badge variant={typeInfo.variant} className="text-xs">
            {isTransfer && tx.linkedTransactionId
              ? t("tx.row.transferTo", {
                  account: tx.linkedAccountName || t("tx.row.anotherAccount"),
                })
              : t(typeInfo.labelKey)}
          </Badge>
          {hasReimbursements && (
            <Badge variant="outline" className="text-xs gap-0.5">
              <Receipt className="h-3 w-3" />
              {tx.reimbursementCount}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Amount tx={tx} />
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1">
          {hasPots && !tx.groupId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
              title={t("tx.row.addToPot")}
              onClick={onAddToPot}
            >
              <Package className="h-3 w-3" />
            </Button>
          )}
          {tx.groupId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
              title={t("tx.row.removeFromPot")}
              onClick={onRemoveFromPot}
            >
              <Minus className="h-3 w-3" />
            </Button>
          )}
          {(tx.type === "income" || isReimbursement) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
              title={isReimbursement ? t("tx.row.linkToExpenses") : t("tx.row.markReimbursement")}
              onClick={onReimburse}
            >
              <Receipt className="h-3 w-3" />
            </Button>
          )}
          {isReimbursement && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
              title={t("tx.row.unlinkReimbursement")}
              onClick={onUnlinkReimbursement}
            >
              <Undo2 className="h-3 w-3" />
            </Button>
          )}
          <ConfirmDeleteButton onConfirm={onDelete} label={t("tx.row.deleteTransaction")} />
        </div>
      </TableCell>
    </TableRow>
  );
}

interface PotRowProps {
  pot: Pot;
  /** Pot net over the filtered range; falls back to the lifetime net. */
  rangeTotal?: PotRangeTotal;
  layout: Layout;
  categories: Category[];
  onAddTransactions: () => void;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}

export function PotRow({
  pot,
  rangeTotal,
  layout,
  categories,
  onAddTransactions,
  onEdit,
  onDelete,
}: PotRowProps) {
  const { t, plural, formatCurrency, formatDate } = useI18n();
  const progressWidth =
    pot.targetAmount != null && pot.targetAmount > 0
      ? `${Math.min(100, Math.round((pot.fundedAmount / pot.targetAmount) * 100))}%`
      : "0%";

  // Show the range figures so the row reconciles with the totals card above;
  // `isPartial` flags that the filters hide part of the pot.
  const amount = rangeTotal ? rangeTotal.net : pot.netAmount;
  const count = rangeTotal ? rangeTotal.memberCount : pot.transactionCount;
  const partialLabel = rangeTotal?.isPartial
    ? t("tx.row.partialLabel", {
        shown: rangeTotal.memberCount,
        total: rangeTotal.totalMemberCount,
        net: `${pot.netAmount >= 0 ? "+" : ""}${formatCurrency(pot.netAmount)}`,
      })
    : null;

  if (layout === "card") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 border-t-2">
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Package className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{pot.name}</p>
          <p className="text-xs text-muted-foreground">
            {plural(count, "common.transactions.one", "common.transactions.other")}
            {partialLabel && ` · ${t("tx.row.inRangeSuffix")}`}
          </p>
          {pot.targetAmount != null && pot.targetDate && (
            <div className="mt-1 space-y-1">
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Target className="h-2.5 w-2.5" />
                {t("tx.row.targetBy", {
                  funded: formatCurrency(pot.fundedAmount),
                  target: formatCurrency(pot.targetAmount),
                  date: formatDate(pot.targetDate),
                })}
              </p>
              {pot.targetAmount > 0 && (
                <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: progressWidth }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <span
          className={`text-sm font-mono font-semibold shrink-0 ${
            amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
          title={partialLabel ?? undefined}
        >
          {amount >= 0 ? "+" : ""}{formatCurrency(amount)}
        </span>
        <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            onClick={onAddTransactions}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            aria-label={t("tx.row.editPot")}
            onClick={onEdit}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <ConfirmDeleteButton onConfirm={onDelete} label={t("tx.row.deletePot")} />
        </div>
      </div>
    );
  }

  return (
    <TableRow className="bg-muted/40 hover:bg-muted/60 border-t-2">
      <TableCell />
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        —
      </TableCell>
      <TableCell className="text-sm font-semibold">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span>{pot.name}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {t("tx.row.txCount", { count })}
            </Badge>
            {partialLabel && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 font-normal cursor-help">
                      <Filter className="h-2.5 w-2.5" />
                      {t("tx.row.inRange")}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top">{partialLabel}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {pot.targetAmount != null && pot.targetDate && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 font-normal">
                <Target className="h-2.5 w-2.5" />
                {t("tx.row.targetBy", {
                  funded: formatCurrency(pot.fundedAmount),
                  target: formatCurrency(pot.targetAmount),
                  date: formatDate(pot.targetDate),
                })}
              </Badge>
            )}
          </div>
          {pot.targetAmount != null && pot.targetAmount > 0 && (
            <div className="h-1 w-40 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: progressWidth }}
              />
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <PotCategoryPopover
          potId={pot.id}
          potName={pot.name}
          currentCategoryId={pot.categoryId}
          currentCategoryName={pot.categoryName}
          currentCategoryColor={pot.categoryColor}
          categories={categories}
        />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant="outline" className="text-xs">
          {t("tx.row.potBadge")}
        </Badge>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <span
          className={`font-mono text-sm font-semibold ${
            amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
          title={partialLabel ?? undefined}
        >
          {amount >= 0 ? "+" : ""}{formatCurrency(amount)}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title={t("tx.row.addTransactionsToPot")}
            onClick={onAddTransactions}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title={t("tx.row.editPot")}
            onClick={onEdit}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <ConfirmDeleteButton onConfirm={onDelete} label={t("tx.row.deletePot")} />
        </div>
      </TableCell>
    </TableRow>
  );
}
