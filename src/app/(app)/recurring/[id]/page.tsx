"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { useRecurringDetail, useUpdateRecurring } from "@/hooks/use-recurring";
import { useAccounts } from "@/hooks/use-accounts";
import { useCategories } from "@/hooks/use-categories";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/client";
import { toMonthly } from "@/lib/recurring";
import { TONE_TEXT } from "@/app/(app)/budgets/_components/budget-row";
import { FREQ_LABEL_KEYS } from "../_components/recurring-item";
import { RecurringFormDialog } from "../_components/recurring-form-dialog";
import { PaymentChart } from "../_components/payment-chart";
import { PaymentList } from "../_components/payment-list";
import { MatchRuleEditor } from "../_components/match-rule-editor";

// Same reading column as the list page this one is opened from.
const PAGE = "mx-auto max-w-4xl";
const DT = "text-[10px] uppercase tracking-[0.08em] text-muted-foreground";

export default function RecurringDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, plural, formatCurrency, formatDate } = useI18n();
  const { data, isLoading, error } = useRecurringDetail(id);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const updateRecurring = useUpdateRecurring();
  const [editOpen, setEditOpen] = useState(false);

  const back = (
    <Link
      href="/recurring"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t("recurring.title")}
    </Link>
  );

  if (isLoading) {
    return (
      <div className={PAGE}>
        {back}
        <Skeleton className="mt-4 h-9 w-64" />
        <Skeleton className="mt-2 h-4 w-48" />
        <Skeleton className="mt-8 h-14 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={PAGE}>
        {back}
        <p className="mt-8 text-sm text-muted-foreground">{t("recurring.detail.notFound")}</p>
      </div>
    );
  }

  const { plan, canEdit, transactions, suggestions } = data;
  const incoming = plan.type === "income";
  const freq = FREQ_LABEL_KEYS[plan.frequency] ? t(FREQ_LABEL_KEYS[plan.frequency]) : plan.frequency;
  const tone = incoming ? TONE_TEXT.positive : TONE_TEXT.negative;

  const total = transactions.reduce((s, p) => s + Math.abs(p.amount), 0);
  const average = transactions.length > 0 ? total / transactions.length : 0;
  const latest = transactions[0];

  const handleEdit = async (payload: Record<string, unknown>) => {
    await updateRecurring.mutateAsync({ id: plan.id, ...payload });
    setEditOpen(false);
  };

  return (
    <div className={PAGE}>
      {back}

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: plan.categoryColor || (incoming ? "#10b981" : "#94a3b8") }}
            />
            <h1 className="truncate text-3xl font-semibold tracking-tight">{plan.description}</h1>
            {!plan.isActive && (
              <span className="shrink-0 rounded border px-2 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("recurring.paused")}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            <span className={`font-medium tabular-nums ${tone}`}>
              {incoming ? "+" : "−"}
              {formatCurrency(Math.abs(plan.amount))}
            </span>
            {` · ${freq}`}
            {plan.frequency !== "monthly" &&
              ` (≈ ${formatCurrency(toMonthly(plan.amount, plan.frequency))}${t("recurring.perMonthShort")})`}
            {plan.accountName && ` · ${plan.accountName}`}
            {plan.categoryName && ` · ${plan.categoryName}`}
          </p>
        </div>
        {canEdit && (
          <RecurringFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            editing={plan}
            accounts={accounts}
            categories={categories}
            onSubmit={handleEdit}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="h-3.5 w-3.5" />
                {t("common.edit")}
              </Button>
            }
          />
        )}
      </header>

      <dl className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(8rem,1fr))]">
        <div>
          <dt className={DT}>{incoming ? t("recurring.detail.totalReceived") : t("recurring.detail.totalPaid")}</dt>
          <dd className="text-lg font-medium">{transactions.length > 0 ? formatCurrency(total) : "—"}</dd>
        </div>
        <div>
          <dt className={DT}>{t("recurring.detail.payments")}</dt>
          <dd className="text-lg font-medium">{transactions.length}</dd>
        </div>
        <div>
          <dt className={DT}>{t("recurring.detail.average")}</dt>
          <dd className="text-lg font-medium">{transactions.length > 0 ? formatCurrency(average) : "—"}</dd>
        </div>
        <div>
          <dt className={DT}>{t("recurring.detail.last")}</dt>
          <dd className="text-lg font-medium">
            {latest ? formatCurrency(Math.abs(latest.amount)) : "—"}
            {latest && (
              <span className="block text-xs font-normal text-muted-foreground">{formatDate(latest.date)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className={DT}>{t("recurring.nextPayment")}</dt>
          <dd className="text-lg font-medium">{plan.nextOccurrence ? formatDate(plan.nextOccurrence) : "—"}</dd>
        </div>
      </dl>

      <Card className="mt-6">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{t("recurring.detail.chartTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentChart payments={transactions} planned={Math.abs(plan.amount)} />
        </CardContent>
      </Card>

      <MatchRuleEditor plan={plan} canEdit={canEdit} payments={transactions} />

      {canEdit && suggestions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">{t("recurring.detail.suggestionsTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("recurring.detail.suggestionsBody")}</p>
          <PaymentList planId={plan.id} payments={suggestions} mode="suggest" />
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold">
          {plural(transactions.length, "recurring.detail.linkedTitle.one", "recurring.detail.linkedTitle.other")}
        </h2>
        {transactions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("recurring.detail.linkedEmpty")}</p>
        ) : (
          <PaymentList planId={plan.id} payments={transactions} mode={canEdit ? "linked" : "readonly"} />
        )}
      </section>
    </div>
  );
}
