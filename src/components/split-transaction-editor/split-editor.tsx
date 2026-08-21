"use client";

import { useState } from "react";
import { useSplitTransaction } from "@/hooks/use-transactions";
import type { Category, Transaction } from "@/types/api";
import { SplitPartsEditor } from "./split-parts-editor";
import { splitCents, type SplitRow } from "./split-rows";

type PickerCategory = Pick<Category, "id" | "name" | "color">;

/** The transactions-page wrapper: same editor, saving through the split API. */
export function SplitEditor({
  transaction,
  categories,
  accountId,
  initialRows,
  isEdit,
  onSaved,
  onCancel,
}: {
  transaction: Transaction;
  categories: PickerCategory[];
  accountId: string;
  initialRows: SplitRow[];
  isEdit: boolean;
  onSaved: (rows: SplitRow[]) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const splitTx = useSplitTransaction();
  const sign = transaction.amount < 0 ? -1 : 1;

  const save = (rows: SplitRow[]) => {
    setError(null);
    const splits = rows.map((r) => ({
      amount: (sign * splitCents(r.amount)) / 100,
      categoryId: r.categoryId,
      description: r.description.trim() || undefined,
    }));
    splitTx.mutate(
      { transactionId: transaction.id, splits, isEdit },
      {
        onSuccess: () => onSaved(rows),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  return (
    <SplitPartsEditor
      totalCents={Math.round(Math.abs(transaction.amount) * 100)}
      categories={categories}
      accountId={accountId}
      initialRows={initialRows}
      pending={splitTx.isPending}
      error={error}
      onSave={save}
      onCancel={onCancel}
    />
  );
}
