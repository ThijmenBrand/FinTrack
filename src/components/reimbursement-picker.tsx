"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useReimburseTransaction } from "@/hooks/use-transactions";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PickerDialog } from "@/components/picker-dialog";
import { PickerRow } from "@/components/picker-row";

interface ExpenseTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  /** True when this is another to-be-imported row (id is a tempId, not a DB id). */
  local?: boolean;
}

interface ReimbursementPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit when the reimbursement doesn't exist yet (e.g. CSV import review); provide onSelect instead. */
  transactionId?: string;
  transactionAmount: number;
  transactionDescription: string;
  transactionDate: string;
  accountId: string;
  onLinked?: () => void;
  /** When set, selection is reported to the caller instead of linked via the API. */
  onSelect?: (expense: ExpenseTransaction) => void;
  /** Other to-be-imported expense rows to offer alongside existing DB expenses (import review only). */
  localExpenses?: ExpenseTransaction[];
}

export function ReimbursementPicker({
  open,
  onOpenChange,
  transactionId,
  transactionAmount,
  transactionDescription,
  transactionDate,
  accountId,
  onLinked,
  onSelect,
  localExpenses = [],
}: ReimbursementPickerProps) {
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: expenseData, isLoading: loading } = useQuery({
    queryKey: ["expenses", accountId, debouncedSearch, transactionDate, transactionAmount],
    queryFn: () => {
      // No accountId filter: reimbursements are often paid into a different
      // account than the expense (e.g. spend from Revolut, refunded to main).
      const params = new URLSearchParams({
        type: "expense",
        limit: "50",
        sortBy: "date",
        sortOrder: "desc",
        nearDate: transactionDate,
        nearAmount: String(Math.abs(transactionAmount)),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiFetch<{ data: ExpenseTransaction[] }>(`/api/transactions?${params.toString()}`).then(r => r.data);
    },
    enabled: open,
  });
  const expenses = expenseData ?? [];

  // Sibling import rows are filtered client-side (they never hit the API).
  const q = debouncedSearch.toLowerCase();
  const localMatches = q
    ? localExpenses.filter((e) => e.description.toLowerCase().includes(q))
    : localExpenses;

  const reimburse = useReimburseTransaction();

  const handleSelect = async (expense: ExpenseTransaction) => {
    if (onSelect) {
      onSelect(expense);
      onOpenChange(false);
      return;
    }
    if (!transactionId) return;
    setLinkingId(expense.id);
    try {
      await reimburse.mutateAsync({ transactionId, expenseIds: [expense.id] });
      onLinked?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to link:", err);
    } finally {
      setLinkingId(null);
    }
  };

  const renderExpenseRow = (expense: ExpenseTransaction) => (
    <PickerRow
      key={expense.id}
      className="hover:bg-muted/50"
      onClick={() => handleSelect(expense)}
      disabled={linkingId !== null}
      loading={linkingId === expense.id}
      leading={<div className="w-4 mr-3 shrink-0" />}
      trailing={
        <span className="text-sm font-mono font-medium text-red-600 dark:text-red-400 shrink-0 ml-3">
          {formatCurrency(expense.amount)}
        </span>
      }
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium truncate">{expense.description}</p>
        {expense.categoryName && (
          <span className="flex items-center gap-1 shrink-0">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: expense.categoryColor || "#94a3b8" }}
            />
            <span className="text-xs text-muted-foreground">
              {expense.categoryName}
            </span>
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">
        {formatDate(expense.date)}
        {expense.accountName ? ` · ${expense.accountName}` : ""}
      </p>
    </PickerRow>
  );

  return (
    <PickerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mark as Reimbursement"
      description={
        <>
          Select the expense that &quot;{transactionDescription}&quot; ({formatCurrency(transactionAmount)}) reimburses.
        </>
      }
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search expenses..."
      loading={loading}
      isEmpty={expenses.length === 0 && localMatches.length === 0}
      emptyMessage={debouncedSearch ? "No matching expenses found." : "No recent expenses in this account."}
    >
      {localMatches.length > 0 && (
        <p className="text-xs font-medium text-muted-foreground px-1 pt-1">From this import</p>
      )}
      {localMatches.map(renderExpenseRow)}
      {expenses.length > 0 && localMatches.length > 0 && (
        <p className="text-xs font-medium text-muted-foreground px-1 pt-2">Already recorded</p>
      )}
      {expenses.map(renderExpenseRow)}
    </PickerDialog>
  );
}
