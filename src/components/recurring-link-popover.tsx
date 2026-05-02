"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Repeat, X } from "lucide-react";
import { useRecurring } from "@/hooks/use-recurring";
import { useLinkRecurringTransaction } from "@/hooks/use-transactions";
import type { RecurringTx } from "@/types/api";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

interface RecurringLinkPopoverProps {
  transactionId: string;
  transactionAmount: number;
  transactionAccountId: string;
  currentRecurringId: string | null;
  currentRecurringDescription: string | null;
}

export function RecurringLinkPopover({
  transactionId,
  transactionAmount,
  transactionAccountId,
  currentRecurringId,
  currentRecurringDescription,
}: RecurringLinkPopoverProps) {
  const [open, setOpen] = useState(false);
  const { data: recurring = [] } = useRecurring();
  const linkMutation = useLinkRecurringTransaction();

  const isExpense = transactionAmount < 0;
  const candidates = recurring
    .filter((r): r is RecurringTx => r.isActive)
    .filter((r) => (isExpense ? r.type === "expense" : r.type === "income"))
    .sort((a, b) => {
      // Surface plans on the same account first, then by closest amount.
      const aAcct = a.accountId === transactionAccountId ? 0 : 1;
      const bAcct = b.accountId === transactionAccountId ? 0 : 1;
      if (aAcct !== bAcct) return aAcct - bAcct;
      const aDiff = Math.abs(Math.abs(a.amount) - Math.abs(transactionAmount));
      const bDiff = Math.abs(Math.abs(b.amount) - Math.abs(transactionAmount));
      return aDiff - bDiff;
    });

  const handleSelect = (recurringId: string | null) => {
    setOpen(false);
    linkMutation.mutate({ transactionId, recurringTransactionId: recurringId });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-sm rounded-md px-2 py-1 hover:bg-accent transition-colors text-left">
          {currentRecurringDescription ? (
            <>
              <Repeat className="h-3.5 w-3.5 text-primary" />
              <span className="truncate">{currentRecurringDescription}</span>
            </>
          ) : (
            <span className="text-muted-foreground flex items-center gap-1">
              <Repeat className="h-3 w-3" />
              Link to recurring
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        {currentRecurringId && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start mb-1 text-muted-foreground"
            onClick={() => handleSelect(null)}
          >
            <X className="h-3.5 w-3.5 mr-2" />
            Clear link
          </Button>
        )}
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">
            No active recurring {isExpense ? "expenses" : "incomes"} to link to.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {candidates.map((r) => {
              const isSelected = r.id === currentRecurringId;
              return (
                <button
                  key={r.id}
                  onClick={() => handleSelect(r.id)}
                  className={`w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors ${
                    isSelected ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{r.description}</span>
                    <span className="text-xs font-mono tabular-nums shrink-0">
                      {formatCurrency(r.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{r.frequency}</span>
                    {r.accountName && <span>· {r.accountName}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
