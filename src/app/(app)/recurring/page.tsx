"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useRecurring,
  useRecurringForecast,
  useCreateRecurring,
  useUpdateRecurring,
  useDeleteRecurring,
} from "@/hooks/use-recurring";
import { useAccounts } from "@/hooks/use-accounts";
import { useCategories } from "@/hooks/use-categories";
import type { RecurringTx } from "@/types/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Plus, RefreshCcw } from "lucide-react";
import { RecurringFormDialog } from "./_components/recurring-form-dialog";
import { RecurringList } from "./_components/recurring-list";
import { UpcomingPayments } from "./_components/upcoming-payments";
import { useI18n } from "@/lib/i18n/client";
import { TONE_TEXT } from "@/app/(app)/budgets/_components/budget-row";

// One reading column. The page is a list with a headline above it, and rows
// that run the full width of a 7xl shell put the amount a screen away from the
// name it belongs to.
const PAGE = "mx-auto max-w-4xl";

export default function RecurringPage() {
  const { t, formatCurrency } = useI18n();
  const { data: items = [], isLoading: loading } = useRecurring();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: forecast = null } = useRecurringForecast(3);
  const createRecurring = useCreateRecurring();
  const updateRecurring = useUpdateRecurring();
  const deleteRecurring = useDeleteRecurring();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTx | null>(null);
  const [addType, setAddType] = useState<"income" | "expense" | undefined>();

  const openAdd = (type: "income" | "expense") => {
    setEditing(null);
    setAddType(type);
    setDialogOpen(true);
  };

  const openEdit = (item: RecurringTx) => {
    setEditing(item);
    setAddType(undefined);
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditing(null);
      setAddType(undefined);
    }
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

  // Only warnings get banner treatment — a projected overdraft is the one piece
  // of advice worth interrupting the list for.
  const warnings = forecast?.advice.filter((a) => a.type === "warning") ?? [];

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("recurring.title")}</h1>
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
          {t("recurring.subtitlePrefix")}{" "}
          <Link href="/budgets" className="text-primary hover:underline">
            {t("recurring.subtitleLink")}
          </Link>{" "}
          {t("recurring.subtitleSuffix")}
        </p>
      </div>
      <RecurringFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        editing={editing}
        defaultType={addType}
        accounts={accounts}
        categories={categories}
        onSubmit={handleFormSubmit}
      />
    </header>
  );

  if (loading) {
    return (
      <div className={PAGE}>
        {header}
        <Skeleton className="mt-6 h-8 w-72" />
        <div className="mt-6 h-px bg-border" />
        <div className="mt-6 flex gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-32 shrink-0" />
          ))}
        </div>
        <div className="mt-7 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={PAGE}>
        {header}
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center px-6 py-16 text-center">
            <RefreshCcw className="mb-4 h-10 w-10 text-muted-foreground/30" />
            <h3 className="text-base font-semibold">{t("recurring.emptyTitle")}</h3>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              {t("recurring.emptyBody")}
            </p>
            {/* The dialog itself is already mounted in the header — this just
                opens it, so there's only ever one instance on the page. */}
            <Button className="mt-6" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("recurring.add")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const net = forecast?.monthlyNet ?? 0;

  return (
    <div className={PAGE}>
      {header}

      {/* The page's headline answer, as one line of prose-sized numbers:
          what the plans below do to a month. */}
      {forecast && (
        <div className="mt-6 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-medium tabular-nums ${net >= 0 ? TONE_TEXT.positive : TONE_TEXT.negative}`}
            >
              {net >= 0 ? "+" : "−"}
              {formatCurrency(Math.abs(net))}
            </span>
            <span className="text-xs text-muted-foreground">{t("recurring.netPerMonth")}</span>
          </div>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {t("recurring.cashFlow.in", {
              amount: formatCurrency(forecast.monthlyRecurringIncome),
            })}
          </span>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {t("recurring.cashFlow.out", {
              amount: formatCurrency(forecast.monthlyRecurringExpenses),
            })}
          </span>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.map((a, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="my-6 h-px bg-border" />

      {forecast && <UpcomingPayments payments={forecast.upcomingPayments} />}

      <RecurringList
        items={items}
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={handleDelete}
        onToggle={toggleActive}
      />
    </div>
  );
}
