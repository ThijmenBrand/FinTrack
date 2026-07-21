"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, TrendingDown, TrendingUp } from "lucide-react";
import type { RecurringTx } from "@/types/api";
import { RecurringItem } from "./recurring-item";

export function RecurringGroupCard({
  type,
  items,
  onEdit,
  onDelete,
  onToggle,
}: {
  type: "income" | "expense";
  items: RecurringTx[];
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
}) {
  const [open, setOpen] = useState(false);
  const isIncome = type === "income";
  const Icon = isIncome ? TrendingUp : TrendingDown;
  const iconClass = isIncome
    ? "text-emerald-500 dark:text-emerald-400"
    : "text-red-500 dark:text-red-400";
  const label = isIncome ? "Recurring Income" : "Recurring Expenses";
  const emptyLabel = isIncome
    ? "No recurring income set up yet."
    : "No recurring expenses set up yet.";

  return (
    <Card>
      <button type="button" className="w-full" onClick={() => setOpen(!open)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className={`h-4 w-4 ${iconClass}`} />
            {label} ({items.length})
          </CardTitle>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </CardHeader>
      </button>
      {open && (
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {emptyLabel}
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <RecurringItem
                  key={item.id}
                  item={item}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
