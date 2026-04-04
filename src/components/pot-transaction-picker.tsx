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

interface PotTransactionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  potId: string;
  potName: string;
  onAdded: () => void;
}

export function PotTransactionPicker({
  open,
  onOpenChange,
  potId,
  potName,
  onAdded,
}: PotTransactionPickerProps) {
  const [transactions, setTransactions] = useState<PickerTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch("");
    setAddingId(null);

    fetch("/api/transactions?limit=100&sortBy=date&sortOrder=desc")
      .then((res) => res.json())
      .then((data) => {
        setTransactions(data.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = search
    ? transactions.filter((t) =>
        t.description.toLowerCase().includes(search.toLowerCase())
      )
    : transactions;

  const handleAdd = async (transactionId: string) => {
    setAddingId(transactionId);
    try {
      const res = await fetch("/api/pots/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ potId, transactionId }),
      });
      if (res.ok) {
        // Update local state to reflect the change
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === transactionId ? { ...t, groupId: potId, groupName: potName } : t
          )
        );
        onAdded();
      }
    } catch (err) {
      console.error("Failed to add to pot:", err);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to &quot;{potName}&quot;</DialogTitle>
          <DialogDescription>
            Click a transaction to add it to this pot.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? "No matching transactions found." : "No recent transactions."}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((tx) => {
                const inThisPot = tx.groupId === potId;
                const inOtherPot = tx.groupId && tx.groupId !== potId;
                return (
                  <button
                    key={tx.id}
                    className={`w-full flex items-center rounded-lg border px-3 py-2 text-left transition-colors ${
                      inThisPot
                        ? "border-primary bg-primary/5 opacity-60"
                        : inOtherPot
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-muted/50"
                    }`}
                    onClick={() => !inThisPot && !inOtherPot && handleAdd(tx.id)}
                    disabled={addingId !== null || !!inThisPot || !!inOtherPot}
                  >
                    {addingId === tx.id ? (
                      <Loader2 className="h-4 w-4 animate-spin shrink-0 mr-3 text-muted-foreground" />
                    ) : (
                      <div className="w-4 mr-3 shrink-0" />
                    )}
                    <div className="flex-1 w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {tx.description}
                        </p>
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
                        {tx.accountName ? ` \u00b7 ${tx.accountName}` : ""}
                      </p>
                    </div>
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
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
