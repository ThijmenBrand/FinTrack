"use client";

import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  RefreshCcw,
  TrendingUp,
  TrendingDown,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Info,
  Loader2,
  ChevronDown,
} from "lucide-react";

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export default function RecurringPage() {
  const { data: items = [], isLoading: loading } = useRecurring();
  const { data: accounts = [] } = useAccounts();
  const { data: categoriesData = [] } = useCategories();
  const categories = categoriesData;
  const { data: forecast = null } = useRecurringForecast(3);
  const createRecurring = useCreateRecurring();
  const updateRecurring = useUpdateRecurring();
  const deleteRecurring = useDeleteRecurring();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTx | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [expensesOpen, setExpensesOpen] = useState(false);

  // Form
  const [fAccountId, setFAccountId] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fType, setFType] = useState<"income" | "expense">("expense");
  const [fCategoryId, setFCategoryId] = useState("");
  const [fFrequency, setFFrequency] = useState("monthly");
  const [fDayOfWeek, setFDayOfWeek] = useState("1");
  const [fDayOfMonth, setFDayOfMonth] = useState("1");
  const [fStartDate, setFStartDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const resetForm = () => {
    setFAccountId("");
    setFDescription("");
    setFAmount("");
    setFType("expense");
    setFCategoryId("");
    setFFrequency("monthly");
    setFDayOfWeek("1");
    setFDayOfMonth("1");
    setFStartDate(new Date().toISOString().slice(0, 10));
    setEditing(null);
  };

  const openEdit = (item: RecurringTx) => {
    setEditing(item);
    setFAccountId(item.accountId);
    setFDescription(item.description);
    setFAmount(String(Math.abs(item.amount)));
    setFType(item.type as "income" | "expense");
    setFCategoryId(item.categoryId || "");
    setFFrequency(item.frequency);
    setFDayOfWeek(String(item.dayOfWeek ?? 1));
    setFDayOfMonth(String(item.dayOfMonth ?? 1));
    setFStartDate(item.startDate);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    const amount = parseFloat(fAmount);
    if (!amount || !fAccountId || !fDescription) return;

    const payload: Record<string, unknown> = {
      accountId: fAccountId,
      description: fDescription,
      amount,
      type: fType,
      categoryId: fCategoryId || null,
      frequency: fFrequency,
      dayOfWeek: fFrequency === "weekly" ? parseInt(fDayOfWeek) : null,
      dayOfMonth:
        fFrequency === "monthly" || fFrequency === "yearly"
          ? parseInt(fDayOfMonth)
          : null,
      startDate: fStartDate,
    };

    await (editing
      ? updateRecurring.mutateAsync({ id: editing.id, ...payload })
      : createRecurring.mutateAsync(payload));

    setDialogOpen(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    await deleteRecurring.mutateAsync(id);
    setDeleteConfirm(null);
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
            Manage recurring incomes and expenses, and view cash flow forecasts.
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Recurring
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit Recurring Payment" : "Add Recurring Payment"}
              </DialogTitle>
              <DialogDescription>
                {editing
                  ? "Update this recurring income or expense."
                  : "Set up a recurring income or expense for cash flow tracking."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select
                    value={fType}
                    onValueChange={(v) => setFType(v as "income" | "expense")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Account</Label>
                  <Select value={fAccountId} onValueChange={setFAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Rent, Salary, Netflix"
                  value={fDescription}
                  onChange={(e) => setFDescription(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      &euro;
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={fAmount}
                      onChange={(e) => setFAmount(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <Select value={fCategoryId} onValueChange={setFCategoryId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{
                                backgroundColor: c.color || "#94a3b8",
                              }}
                            />
                            {c.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Frequency</Label>
                  <Select value={fFrequency} onValueChange={setFFrequency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {fFrequency === "weekly" && (
                  <div className="grid gap-2">
                    <Label>Day of week</Label>
                    <Select value={fDayOfWeek} onValueChange={setFDayOfWeek}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOW_LABELS.map((label, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(fFrequency === "monthly" || fFrequency === "yearly") && (
                  <div className="grid gap-2">
                    <Label>Day of month</Label>
                    <Input
                      type="number"
                      min="1"
                      max="31"
                      value={fDayOfMonth}
                      onChange={(e) => setFDayOfMonth(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={fStartDate}
                  onChange={(e) => setFStartDate(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!fAccountId || !fDescription || !fAmount}
              >
                {editing ? "Save Changes" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
        {/* Income */}
        <Card>
          <button
            type="button"
            className="w-full"
            onClick={() => setIncomeOpen(!incomeOpen)}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                Recurring Income ({incomeItems.length})
              </CardTitle>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${incomeOpen ? "rotate-180" : ""}`}
              />
            </CardHeader>
          </button>
          {incomeOpen && (
            <CardContent>
              {incomeItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No recurring income set up yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {incomeItems.map((item) => (
                    <RecurringItem
                      key={item.id}
                      item={item}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                      onToggle={toggleActive}
                      deleteConfirm={deleteConfirm}
                      setDeleteConfirm={setDeleteConfirm}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Expenses */}
        <Card>
          <button
            type="button"
            className="w-full"
            onClick={() => setExpensesOpen(!expensesOpen)}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-500 dark:text-red-400" />
                Recurring Expenses ({expenseItems.length})
              </CardTitle>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${expensesOpen ? "rotate-180" : ""}`}
              />
            </CardHeader>
          </button>
          {expensesOpen && (
            <CardContent>
              {expenseItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No recurring expenses set up yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {expenseItems.map((item) => (
                    <RecurringItem
                      key={item.id}
                      item={item}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                      onToggle={toggleActive}
                      deleteConfirm={deleteConfirm}
                      setDeleteConfirm={setDeleteConfirm}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function RecurringItem({
  item,
  onEdit,
  onDelete,
  onToggle,
  deleteConfirm,
  setDeleteConfirm,
}: {
  item: RecurringTx;
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 group ${!item.isActive ? "opacity-50" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {item.description}
          </span>
          {item.categoryName && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
              {item.categoryName}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span>{FREQ_LABELS[item.frequency]}</span>
          <span>&middot;</span>
          <span>{item.accountName}</span>
          {item.nextOccurrence && (
            <>
              <span>&middot;</span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Next:{" "}
                {new Date(item.nextOccurrence).toLocaleDateString("nl-NL", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </>
          )}
        </div>
      </div>
      <span
        className={`text-sm font-semibold shrink-0 ${item.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
      >
        {item.type === "income" ? "+" : ""}
        {formatCurrency(Math.abs(item.amount))}
      </span>
      <div className="flex gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onToggle(item)}
          title={item.isActive ? "Pause" : "Activate"}
        >
          <RefreshCcw
            className={`h-3 w-3 ${item.isActive ? "text-green-500 dark:text-green-400" : "text-muted-foreground"}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onEdit(item)}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        {deleteConfirm === item.id ? (
          <div className="flex gap-0.5">
            <Button
              variant="destructive"
              size="icon"
              className="h-7 w-7"
              onClick={() => onDelete(item.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setDeleteConfirm(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setDeleteConfirm(item.id)}
          >
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </Button>
        )}
      </div>
    </div>
  );
}
