"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

interface MonthlyTotal {
  month: string;
  income: number;
  expenses: number;
}

interface MonthlyIncomeExpenseChartProps {
  monthlyTotals: MonthlyTotal[];
}

// Stacked income-vs-expenses bar per month.
export function MonthlyIncomeExpenseChart({
  monthlyTotals,
}: MonthlyIncomeExpenseChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monthly Income vs Expenses</CardTitle>
      </CardHeader>
      <CardContent>
        {monthlyTotals.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No data for this period.
          </p>
        ) : (
          <div className="space-y-1">
            {(() => {
              const maxVal = Math.max(
                ...monthlyTotals.map((m) => Math.max(m.income, m.expenses)),
                1
              );
              return monthlyTotals.map((m) => {
                const monthLabel = new Date(m.month + "-01").toLocaleDateString(
                  "en-US",
                  { month: "short", year: "numeric" }
                );
                return (
                  <div key={m.month} className="space-y-0.5">
                    <div className="flex items-center gap-3">
                      <div className="w-20 text-xs text-right text-muted-foreground">
                        {monthLabel}
                      </div>
                      <div className="flex-1 flex gap-1">
                        <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                          <div
                            className="h-full rounded bg-emerald-500 transition-all duration-500"
                            style={{
                              width: `${(m.income / maxVal) * 100}%`,
                            }}
                          />
                        </div>
                        <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                          <div
                            className="h-full rounded bg-red-400 transition-all duration-500"
                            style={{
                              width: `${(m.expenses / maxVal) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="w-36 text-xs flex gap-2 justify-end">
                        <span className="text-emerald-600 dark:text-emerald-400">
                          +{formatCurrency(m.income)}
                        </span>
                        <span className="text-red-500 dark:text-red-400">
                          -{formatCurrency(m.expenses)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
            <div className="flex items-center gap-4 pt-3 text-xs text-muted-foreground justify-center">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Income
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-red-400" /> Expenses
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
