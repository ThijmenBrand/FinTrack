"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Package, Receipt, Trash2, Loader2, X } from "lucide-react";
import { CategoryPicker } from "@/components/category-picker";
import type { Category } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";

interface TransactionBulkBarProps {
  count: number;
  categories: Category[];
  /** The one account every selected row is on, if they share one — its budget
   *  plan bands to the top of the category list. */
  accountId?: string;
  canAddToPot: boolean;
  canReimburse: boolean;
  categorizePending: boolean;
  deletePending: boolean;
  onCategorize: (categoryId: string | null) => void;
  onAddToPot: () => void;
  onReimburse: () => void;
  onDelete: () => void | Promise<void>;
  onClear: () => void;
}

export function TransactionBulkBar({
  count,
  categories,
  accountId,
  canAddToPot,
  canReimburse,
  categorizePending,
  deletePending,
  onCategorize,
  onAddToPot,
  onReimburse,
  onDelete,
  onClear,
}: TransactionBulkBarProps) {
  const { t } = useI18n();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    // Phones: a floating action bar just above the tab bar, so the actions
    // stay in reach however far down the list the selection was made.
    <div className="relative flex items-center gap-2 flex-wrap rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 max-md:fixed max-md:inset-x-3 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-md:z-40 max-md:rounded-2xl max-md:border-border max-md:bg-card/95 max-md:p-3 max-md:shadow-xl max-md:backdrop-blur-xl max-md:animate-in max-md:slide-in-from-bottom-4 max-md:fade-in">
      <span className="text-sm font-medium max-md:basis-full max-md:py-1.5 max-md:pr-12 max-md:text-[15px] max-md:font-semibold">{t("tx.bulk.selected", { count })}</span>
      <div className="w-48 max-md:order-last max-md:w-full">
        <CategoryPicker
          categories={categories}
          accountId={accountId}
          value={null}
          onChange={(categoryId) => onCategorize(categoryId)}
          onClear={() => onCategorize(null)}
          allowCreate={false}
          disabled={categorizePending}
          placeholder={categorizePending ? t("tx.bulk.applying") : t("tx.bulk.setCategory")}
          className="h-8 text-xs max-md:h-10 max-md:text-sm"
        />
      </div>
      {canAddToPot && (
        <Button variant="outline" size="sm" className="h-8 max-md:h-10" onClick={onAddToPot}>
          <Package className="mr-1.5 h-3.5 w-3.5" />
          {t("tx.bulk.addToPot")}
        </Button>
      )}
      {canReimburse && (
        <Button variant="outline" size="sm" className="h-8 max-md:h-10" onClick={onReimburse}>
          <Receipt className="mr-1.5 h-3.5 w-3.5" />
          {t("tx.bulk.markReimbursement")}
        </Button>
      )}
      {confirmingDelete ? (
        <>
          <Button
            variant="destructive"
            size="sm"
            className="h-8 max-md:h-10"
            disabled={deletePending}
            onClick={async () => {
              await onDelete();
              setConfirmingDelete(false);
            }}
          >
            {deletePending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t("tx.bulk.deleteCount", { count })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 max-md:h-10"
            onClick={() => setConfirmingDelete(false)}
          >
            {t("common.cancel")}
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-md:h-10 text-destructive hover:text-destructive"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t("common.delete")}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        // Phones: a close button in the bar's corner instead of a row of its own.
        className="h-8 ml-auto max-md:absolute max-md:right-2 max-md:top-2 max-md:h-10 max-md:w-10 max-md:rounded-full max-md:p-0"
        onClick={() => {
          onClear();
          setConfirmingDelete(false);
        }}
      >
        <X className="mr-1 h-3.5 w-3.5 max-md:mr-0 max-md:h-5 max-md:w-5" />
        <span className="max-md:sr-only">{t("common.clear")}</span>
      </Button>
    </div>
  );
}
