"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PotSaldoGraph } from "@/components/pot-saldo-graph";
import { CheckCircle2, Info } from "lucide-react";
import type { ForecastData } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { endOfMonth, todayIso } from "./dates";

/**
 * The page's headline answer: what recurring money does to the balance over the
 * forecast window. Replaces three stat cards that each held one number and a
 * "forecast chart" that was a list of numbers.
 */
export function CashFlowCard({ forecast }: { forecast: ForecastData }) {
  const { t, formatCurrency } = useI18n();
  const { monthlyNet, monthlyRecurringIncome, monthlyRecurringExpenses } = forecast;
  const positive = monthlyNet >= 0;
  const netTone = positive
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";

  // Seed the line at today's real balance, then one point per projected
  // month-end — the balance only moves when a payment lands, so the graph's
  // stepwise line is the honest shape here.
  const points = [
    { date: todayIso(), value: forecast.currentBalance },
    ...forecast.monthlyForecast.map((m) => ({ date: endOfMonth(m.month), value: m.endBalance })),
  ];
  const lowest = Math.min(...points.map((p) => p.value));

  // Warnings are surfaced at the top of the page; the rest are footnotes and
  // belong next to the numbers they comment on, not stacked above them.
  const notes = forecast.advice.filter((a) => a.type !== "warning");

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{t("recurring.cashFlow.title")}</CardTitle>
            <CardDescription>{t("recurring.cashFlow.description")}</CardDescription>
          </div>
          <div className="ml-auto shrink-0 text-right tabular-nums">
            <div className={`whitespace-nowrap text-2xl font-semibold leading-none ${netTone}`}>
              {positive ? "+" : "−"}
              {formatCurrency(Math.abs(monthlyNet))}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                {t("recurring.perMonthShort")}
              </span>
            </div>
            <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
              {t("recurring.cashFlow.in", { amount: formatCurrency(monthlyRecurringIncome) })} ·{" "}
              {t("recurring.cashFlow.out", { amount: formatCurrency(monthlyRecurringExpenses) })}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Side by side on wide screens: the trajectory and the month-by-month
            numbers answer the same question, and stacking them made this card
            twice as tall as anything next to it. */}
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr] lg:items-start">
          <PotSaldoGraph
            lines={[{ points, label: t("recurring.cashFlow.balanceLine") }]}
            showPoints
            height={216}
            ariaLabel={t("recurring.cashFlow.chartLabel", {
              from: formatCurrency(forecast.currentBalance),
              to: formatCurrency(points[points.length - 1].value),
            })}
          />

          <div className="overflow-hidden rounded-md border">
            <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,auto))] gap-x-2 border-b bg-muted/40 px-3 py-1.5 text-right text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="text-left">{t("recurring.cashFlow.colMonth")}</span>
              <span>{t("recurring.cashFlow.colIn")}</span>
              <span>{t("recurring.cashFlow.colOut")}</span>
              <span>{t("recurring.cashFlow.colBalance")}</span>
            </div>
            {forecast.monthlyForecast.map((m) => (
              <div
                key={m.month}
                className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,auto))] gap-x-2 border-b px-3 py-2 text-right text-xs tabular-nums last:border-0"
              >
                <span className="truncate text-left font-medium">{m.label}</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {m.income > 0 ? formatCurrency(m.income, "EUR", 0) : "—"}
                </span>
                <span className="text-red-600 dark:text-red-400">
                  {m.expenses > 0 ? formatCurrency(m.expenses, "EUR", 0) : "—"}
                </span>
                <span
                  className={`font-medium ${m.endBalance < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                >
                  {formatCurrency(m.endBalance, "EUR", 0)}
                </span>
              </div>
            ))}
            {lowest < 0 && (
              <div className="border-t bg-red-500/5 px-3 py-1.5 text-right text-xs text-red-600 dark:text-red-400">
                {t("recurring.cashFlow.dipsTo", { amount: formatCurrency(lowest, "EUR", 0) })}
              </div>
            )}
          </div>
        </div>

        {notes.length > 0 && (
          <ul className="space-y-1.5 border-t pt-3">
            {notes.map((a, i) => {
              const Icon = a.type === "success" ? CheckCircle2 : Info;
              return (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Icon
                    className={`mt-px h-3.5 w-3.5 shrink-0 ${a.type === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                  />
                  <span>{a.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
