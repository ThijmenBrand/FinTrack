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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Plus, RefreshCcw } from "lucide-react";
import { RecurringFormDialog } from "./_components/recurring-form-dialog";
import { RecurringList } from "./_components/recurring-list";
import { CashFlowCard } from "./_components/cash-flow-card";
import { UpcomingPayments } from "./_components/upcoming-payments";
import { useI18n } from "@/lib/i18n/client";

export default function RecurringPage() {
  const { t } = useI18n();
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

  // Only warnings get banner treatment. The info/success advice is a footnote
  // on the numbers it describes and lives inside the cash flow card.
  const warnings = forecast?.advice.filter((a) => a.type === "warning") ?? [];

  // The settings layout already owns the <h1> and names this tab, so this is a
  // section heading — not a second page title.
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t("recurring.title")}</h2>
        <p className="text-sm text-muted-foreground">
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
        accounts={accounts}
        categories={categories}
        onSubmit={handleFormSubmit}
      />
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-8">
        {header}
        <Card>
          <CardHeader className="pb-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </CardHeader>
          <CardContent className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-8">
        {header}
        <Card>
          <CardContent className="flex flex-col items-center px-6 py-16 text-center">
            <RefreshCcw className="mb-4 h-10 w-10 text-muted-foreground/30" />
            <h2 className="text-base font-semibold">{t("recurring.emptyTitle")}</h2>
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

  return (
    <div className="space-y-6">
      {header}

      {warnings.length > 0 && (
        <div className="space-y-2">
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

      {forecast && <CashFlowCard forecast={forecast} />}

      {/* The list is what people came to edit, so it takes the wide column and
          sits beside the schedule rather than under a tall one. */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RecurringList
            items={items}
            onEdit={openEdit}
            onDelete={handleDelete}
            onToggle={toggleActive}
          />
        </div>
        {forecast && (
          <div className="lg:col-span-2">
            <UpcomingPayments payments={forecast.upcomingPayments} />
          </div>
        )}
      </div>
    </div>
  );
}
