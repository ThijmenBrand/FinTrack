"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";

interface ExpenseTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(dateStr));
}

interface ReimbursementPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string;
  transactionAmount: number;
  transactionDescription: string;
  accountId: string;
  onLinked: () => void;
}

export function ReimbursementPicker({
  open,
  onOpenChange,
  transactionId,
  transactionAmount,
  transactionDescription,
  accountId,
  onLinked,
}: ReimbursementPickerProps) {
  const [expenses, setExpenses] = useState<ExpenseTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch("");
    setLinkingId(null);

    fetch(`/api/transactions?type=expense&accountId=${accountId}&limit=50&sortBy=date&sortOrder=desc`)
      .then((res) => res.json())
      .then((data) => {
        setExpenses(data.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, accountId]);

  const filtered = search
    ? expenses.filter((e) =>
        e.description.toLowerCase().includes(search.toLowerCase())
      )
    : expenses;

  const handleSelect = async (expenseId: string) => {
    setLinkingId(expenseId);
    try {
      const res = await fetch("/api/transactions/reimburse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId,
          expenseIds: [expenseId],
        }),
      });
      if (res.ok) {
        onLinked();
        onOpenChange(false);
      }
    } catch (err) {
      console.error("Failed to link:", err);
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark as Reimbursement</DialogTitle>
          <DialogDescription>
            Select the expense that &quot;{transactionDescription}&quot; ({formatCurrency(transactionAmount)}) reimburses.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search expenses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-[350px] overflow-y-auto -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? "No matching expenses found." : "No recent expenses in this account."}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((expense) => (
                <button
                  key={expense.id}
                  className="w-full flex items-center rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                  onClick={() => handleSelect(expense.id)}
                  disabled={linkingId !== null}
                >
                  {linkingId === expense.id ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 mr-3 text-muted-foreground" />
                  ) : (
                    <div className="w-4 mr-3 shrink-0" />
                  )}
                  <div className="flex-1 w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {expense.description}
                      </p>
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
                    </p>
                  </div>
                  <span className="text-sm font-mono font-medium text-red-600 dark:text-red-400 shrink-0 ml-3">
                    {formatCurrency(expense.amount)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
