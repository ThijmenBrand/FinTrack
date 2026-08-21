"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CategoryIcon } from "@/components/category-icon";
import { Split, StickyNote } from "lucide-react";
import type { Transaction } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { Amount } from "./transaction-amount";

/** Non-interactive category display for split children — categorizing them happens in the detail dialog. */
function CategoryLabel({ tx }: { tx: Transaction }) {
  const { t } = useI18n();
  if (!tx.categoryName) {
    return <span className="text-xs text-muted-foreground">{t("tx.bulk.noCategory")}</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-sm truncate">
      <CategoryIcon icon={tx.categoryIcon} color={tx.categoryColor} size="sm" />
      <span className="truncate">{tx.categoryName}</span>
    </span>
  );
}

/**
 * Split children as indented, muted table rows beneath their parent. The empty
 * cells keep the child aligned with the parent's columns — count them against
 * `TransactionRow`'s table layout if a column is ever added there.
 */
export function SplitChildTableRows({
  splits,
  showCreator,
  onOpen,
}: {
  splits: Transaction[];
  showCreator: boolean;
  onOpen: (tx: Transaction) => void;
}) {
  const { t, formatDate } = useI18n();
  return (
    <>
      {splits.map((child) => (
        // Click-only, deliberately: a <tr> can't honestly take role="button",
        // and every other row in this table (see TransactionRow) opens the same
        // way. The card layout's children ARE keyboard-operable — making only
        // these rows focusable would put them in the tab order ahead of the
        // parent rows they hang under.
        <TableRow
          key={child.id}
          className="cursor-pointer bg-muted/30 hover:bg-muted/50"
          onClick={() => onOpen(child)}
        >
          <TableCell />
          {showCreator && <TableCell />}
          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDate(child.date)}
          </TableCell>
          <TableCell className="max-w-[150px] sm:max-w-[300px] text-sm">
            <div className="flex items-center gap-1.5 border-l-2 border-muted-foreground/30 pl-4">
              <Split className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate text-muted-foreground">{child.description}</span>
              {child.notes && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label={t("tx.row.hasNote")} />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap break-words">
                      {child.notes}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </TableCell>
          <TableCell className="hidden sm:table-cell" />
          <TableCell>
            <CategoryLabel tx={child} />
          </TableCell>
          <TableCell className="hidden sm:table-cell" />
          <TableCell className="text-right whitespace-nowrap">
            <Amount tx={child} />
          </TableCell>
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

/** Split children as indented, muted cards beneath their parent (mobile). */
export function SplitChildCards({
  splits,
  onOpen,
}: {
  splits: Transaction[];
  onOpen: (tx: Transaction) => void;
}) {
  const { formatDate } = useI18n();
  return (
    <>
      {splits.map((child) => (
        <div
          key={child.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(child)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(child);
            }
          }}
          className="ml-4 flex items-center gap-2 border-l-2 border-muted-foreground/20 bg-muted/20 py-2.5 pl-4 pr-4 active:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none cursor-pointer transition-colors"
        >
          <Split className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm text-muted-foreground">{child.description}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CategoryLabel tx={child} />
              <span>{formatDate(child.date)}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <Amount tx={child} />
          </div>
        </div>
      ))}
    </>
  );
}
