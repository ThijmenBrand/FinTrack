"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useAddToPot } from "@/hooks/use-pots";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PickerDialog } from "@/components/picker-dialog";
import { PickerRow } from "@/components/picker-row";

interface PickerTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  groupId: string | null;
  groupName: string | null;
}

interface PotTransactionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  potId: string;
  potName: string;
  onAdded?: () => void;
}

export function PotTransactionPicker({
  open,
  onOpenChange,
  potId,
  potName,
  onAdded,
}: PotTransactionPickerProps) {
  const [addingId, setAddingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: txData, isLoading: loading } = useQuery({
    queryKey: ["pot-picker-transactions"],
    queryFn: () => apiFetch<{ data: PickerTransaction[] }>("/api/transactions?limit=100&sortBy=date&sortOrder=desc").then(r => r.data),
    enabled: open,
  });
  const transactions = txData ?? [];

  const addToPot = useAddToPot();

  const filtered = search
    ? transactions.filter((t) =>
        t.description.toLowerCase().includes(search.toLowerCase())
      )
    : transactions;

  const handleAdd = async (transactionId: string) => {
    setAddingId(transactionId);
    try {
      await addToPot.mutateAsync({ potId, transactionId });
      onAdded?.();
    } catch (err) {
      console.error("Failed to add to pot:", err);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <PickerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Add to "${potName}"`}
      description="Click a transaction to add it to this pot."
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search transactions..."
      loading={loading}
      isEmpty={filtered.length === 0}
      emptyMessage={search ? "No matching transactions found." : "No recent transactions."}
      listClassName="max-h-[400px]"
    >
      {filtered.map((tx) => {
        const inThisPot = tx.groupId === potId;
        const inOtherPot = tx.groupId && tx.groupId !== potId;
        return (
          <PickerRow
            key={tx.id}
            className={
              inThisPot
                ? "border-primary bg-primary/5 opacity-60"
                : inOtherPot
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:bg-muted/50"
            }
            onClick={() => !inThisPot && !inOtherPot && handleAdd(tx.id)}
            disabled={addingId !== null || !!inThisPot || !!inOtherPot}
            loading={addingId === tx.id}
            leading={<div className="w-4 mr-3 shrink-0" />}
            trailing={
              <span
                className={`text-sm font-mono font-medium shrink-0 ml-3 ${
                  tx.amount >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {tx.amount >= 0 ? "+" : ""}
                {formatCurrency(tx.amount)}
              </span>
            }
          >
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{tx.description}</p>
              {inThisPot && (
                <span className="text-xs text-primary font-medium shrink-0">
                  In pot
                </span>
              )}
              {inOtherPot && (
                <span className="text-xs text-muted-foreground shrink-0">
                  In &quot;{tx.groupName}&quot;
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatDate(tx.date)}
              {tx.accountName ? ` · ${tx.accountName}` : ""}
            </p>
          </PickerRow>
        );
      })}
    </PickerDialog>
  );
}
