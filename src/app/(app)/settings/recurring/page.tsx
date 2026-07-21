"use client";

import { useState } from "react";
import Link from "next/link";
import { useRecurring, useRecurringForecast, useCreateRecurring, useUpdateRecurring, useDeleteRecurring } from "@/hooks/use-recurring";
import { useAccounts } from "@/hooks/use-accounts";
import { useCategories } from "@/hooks/use-categories";
import type { RecurringTx } from "@/types/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TrendingUp,
  TrendingDown,
  RefreshCcw,
  AlertTriangle,
  CheckCircle,
  Info,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { RecurringFormDialog } from "./_components/recurring-form-dialog";
import { RecurringGroupCard } from "./_components/recurring-group-card";

export default function RecurringPage() {
  const { data: items = [], isLoading: loading } = useRecurring();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: forecast = null } = useRecurringForecast(3);
  const createRecurring = useCreateRecurring();
  const updateRecurring = useUpdateRecurring();
  const deleteRecurring = useDeleteRecurring();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTx | null>(null);

  const openEdit = (item: RecurringTx) => {
    setEditing(item);
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setEditing(null);
  };

  const handleFormSubmit = async (payload: Record<string, unknown>) => {
    await (editing
      ? updateRecurring.mutateAsync({ id: editing.id, ...payload })
      : createRecurring.mutateAsync(payload));
    setDialogOpen(false);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    await deleteRecurring.mutateAsync(id);
  };

  const toggleActive = async (item: RecurringTx) => {
    await updateRecurring.mutateAsync({ id: item.id, isActive: !item.isActive });
  };

  const incomeItems = items.filter((i) => i.type === "income");
  const expenseItems = items.filter((i) => i.type === "expense");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recurring</h1>
          <p className="text-muted-foreground">
            Manage recurring incomes and expenses, and view cash flow forecasts.{" "}
            <Link
              href="/budgets"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Budgets
            </Link>
          </p>
        </div>
        <RecurringFormDialog
          open={dialogOpen}
          onOpenChange={handleDialogOpenChange}
          editing={editing}
          accounts={accounts}
          categories={categories}
          onSubmit={handleFormSubmit}
        />
      </div>

      {/* Smart Advice */}
      {forecast && forecast.advice.length > 0 && (
        <div className="space-y-2">
          {forecast.advice.map((a, i) => {
            const Icon =
              a.type === "warning"
                ? AlertTriangle
                : a.type === "success"
                  ? CheckCircle
                  : Info;
            const adviceClass =
              a.type === "warning"
                ? "advice-warning"
                : a.type === "success"
                  ? "advice-success"
                  : "advice-info";
            return (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${adviceClass}`}
              >
                <Icon className="h-4 w-4 mt-0.5 shrink-0 opacity-80" />
                <span>{a.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Monthly Summary Cards */}
      {forecast && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Monthly Recurring Income
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(forecast.monthlyRecurringIncome)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Monthly Recurring Expenses
              </CardTitle>
              <TrendingDown className="h-4 w-4 text-red-500 dark:text-red-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {formatCurrency(forecast.monthlyRecurringExpenses)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Monthly Net
              </CardTitle>
              <RefreshCcw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${forecast.monthlyNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
              >
                {forecast.monthlyNet >= 0 ? "+" : ""}
                {formatCurrency(forecast.monthlyNet)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cash Flow Forecast Chart */}
        {forecast && forecast.monthlyForecast.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Cash Flow Forecast
              </CardTitle>
              <CardDescription>
                Projected balance based on recurring payments
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {forecast.monthlyForecast.map((m) => (
                  <div key={m.month} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{m.label}</span>
                      <span
                        className={`font-semibold ${m.endBalance >= 0 ? "text-foreground" : "text-red-600 dark:text-red-400"}`}
                      >
                        {formatCurrency(m.endBalance)}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(m.income)}
                      </span>
                      <span className="text-red-500 dark:text-red-400">
                        -{formatCurrency(m.expenses)}
                      </span>
                      <span
                        className={
                          m.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
                        }
                      >
                        Net: {m.net >= 0 ? "+" : ""}
                        {formatCurrency(m.net)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Payments */}
        {forecast && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming Payments</CardTitle>
              <CardDescription>
                Next scheduled recurring payments
              </CardDescription>
            </CardHeader>
            <CardContent>
              {forecast.upcomingPayments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No upcoming payments. Add recurring transactions above.
                </p>
              ) : (
                <div className="space-y-2">
                  {forecast.upcomingPayments.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-1.5 border-b last:border-0"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="text-xs text-muted-foreground w-16 shrink-0">
                          {new Date(p.date).toLocaleDateString("nl-NL", {
                            day: "numeric",
                            month: "short",
                          })}
                        </div>
                        {p.categoryColor && (
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: p.categoryColor }}
                          />
                        )}
                        <span className="text-sm truncate">
                          {p.description}
                        </span>
                      </div>
                      <span
                        className={`text-sm font-medium shrink-0 ml-2 ${p.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
                      >
                        {p.type === "income" ? "+" : "-"}
                        {formatCurrency(Math.abs(p.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recurring Transactions List */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RecurringGroupCard
          type="income"
          items={incomeItems}
          onEdit={openEdit}
          onDelete={handleDelete}
          onToggle={toggleActive}
        />
        <RecurringGroupCard
          type="expense"
          items={expenseItems}
          onEdit={openEdit}
          onDelete={handleDelete}
          onToggle={toggleActive}
        />
      </div>
    </div>
  );
}
