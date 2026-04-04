"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";

interface Pot {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  netAmount: number;
  transactionCount: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

interface AddToPotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pots: Pot[];
  transactionDescription: string;
  onSelect: (potId: string) => Promise<void>;
}

export function AddToPotDialog({
  open,
  onOpenChange,
  pots,
  transactionDescription,
  onSelect,
}: AddToPotDialogProps) {
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const filtered = search
    ? pots.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : pots;

  const handleSelect = async (potId: string) => {
    setAddingId(potId);
    try {
      await onSelect(potId);
      onOpenChange(false);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-sm overflow-hidden">
        <DialogHeader className="min-w-0 overflow-hidden">
          <DialogTitle>Add to Pot</DialogTitle>
          <DialogDescription className="truncate">
            Choose a pot for &quot;{transactionDescription}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search pots..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-[300px] overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No matching pots found.
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((pot) => (
                <button
                  key={pot.id}
                  className="w-full flex items-center rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  onClick={() => handleSelect(pot.id)}
                  disabled={addingId !== null}
                >
                  {addingId === pot.id ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 mr-3 text-muted-foreground" />
                  ) : (
                    pot.categoryColor ? (
                      <span
                        className="h-3 w-3 rounded-full shrink-0 mr-3"
                        style={{ backgroundColor: pot.categoryColor }}
                      />
                    ) : (
                      <div className="w-3 mr-3 shrink-0" />
                    )
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pot.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pot.transactionCount} transaction{pot.transactionCount !== 1 ? "s" : ""}
                      {pot.categoryName ? ` \u00b7 ${pot.categoryName}` : ""}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-mono font-medium shrink-0 ml-3 ${
                      pot.netAmount >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {pot.netAmount >= 0 ? "+" : ""}
                    {formatCurrency(pot.netAmount)}
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
