"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { ForecastData } from "@/types/api";
import { formatDayMonth, relativeDay } from "./dates";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(iso: string): string {
  const [y, m] = iso.slice(0, 10).split("-").map(Number);
  const now = new Date();
  const label = MONTH_LABELS[m - 1];
  return y === now.getFullYear() ? label : `${label} ${y}`;
}

export function UpcomingPayments({
  payments,
}: {
  payments: ForecastData["upcomingPayments"];
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Upcoming</CardTitle>
        <CardDescription>
          {payments.length === 0
            ? "Nothing scheduled"
            : `Next ${payments.length} payment${payments.length === 1 ? "" : "s"}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        {payments.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <CalendarClock className="mb-3 h-9 w-9 text-muted-foreground/30" />
            <p className="max-w-xs text-sm text-muted-foreground">
              Nothing scheduled in the forecast window. Active recurring plans and pots with a
              target date show up here.
            </p>
          </div>
        ) : (
          <ul className="divide-y overflow-hidden border-y sm:rounded-md sm:border-x">
            {payments.map((p, i) => {
              // A month heading appears the first time a month shows up —
              // read off the previous row rather than a running variable.
              const newMonth = p.date.slice(0, 7) !== payments[i - 1]?.date.slice(0, 7);
              const soon = relativeDay(p.date);
              const isIncome = p.type === "income";

              return (
                <li key={i}>
                  {newMonth && (
                    <div className="bg-muted/40 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {monthLabel(p.date)}
                    </div>
                  )}
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDayMonth(p.date)}
                    </div>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: p.categoryColor || "#94a3b8" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{p.description}</div>
                      {soon && <div className="text-xs text-muted-foreground">{soon}</div>}
                    </div>
                    <span
                      className={`shrink-0 text-sm font-medium tabular-nums ${
                        isIncome
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {isIncome ? "+" : "−"}
                      {formatCurrency(Math.abs(p.amount))}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
