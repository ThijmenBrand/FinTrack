"use client";

import { Button } from "@/components/ui/button";
import { Link2, Loader2, Unlink } from "lucide-react";
import type { RecurringPayment } from "@/types/api";
import { useLinkRecurringTransaction } from "@/hooks/use-transactions";
import { useI18n } from "@/lib/i18n/client";
import { TONE_TEXT } from "@/app/(app)/budgets/_components/budget-row";

/**
 * The payments under a plan, or the look-alikes that could be. One list for
 * both so a suggestion and a linked payment read the same; only the action on
 * the right differs.
 */
export function PaymentList({
  planId,
  payments,
  mode,
}: {
  planId: string;
  payments: RecurringPayment[];
  /** "linked" offers unlink, "suggest" offers link, "readonly" neither. */
  mode: "linked" | "suggest" | "readonly";
}) {
  const { t, formatCurrency, formatDate } = useI18n();
  const link = useLinkRecurringTransaction();
  const pendingId = link.isPending ? link.variables?.transactionId : null;

  return (
    <ul className="mt-2 divide-y rounded-lg border">
      {payments.map((p) => {
        // The bank's counterparty is the title when there is one; the memo
        // then trails it, the way the transactions list shows a row.
        const title = p.name || p.description;
        const subtitle = p.name ? p.description : null;
        return (
          <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatDate(p.date)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{title}</span>
              {(subtitle || p.accountName) && (
                <span className="block truncate text-xs text-muted-foreground">
                  {[subtitle, p.accountName].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 text-sm font-medium tabular-nums ${p.amount < 0 ? TONE_TEXT.negative : TONE_TEXT.positive}`}
            >
              {p.amount < 0 ? "−" : "+"}
              {formatCurrency(Math.abs(p.amount))}
            </span>
            {mode !== "readonly" && (
              <Button
                variant={mode === "suggest" ? "outline" : "ghost"}
                size="sm"
                className="shrink-0"
                disabled={link.isPending}
                aria-label={
                  mode === "suggest"
                    ? t("recurring.detail.linkLabel", { name: title })
                    : t("recurring.detail.unlinkLabel", { name: title })
                }
                onClick={() =>
                  link.mutate({
                    transactionId: p.id,
                    recurringTransactionId: mode === "suggest" ? planId : null,
                  })
                }
              >
                {pendingId === p.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : mode === "suggest" ? (
                  <Link2 className="h-3.5 w-3.5" />
                ) : (
                  <Unlink className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">
                  {mode === "suggest" ? t("recurring.detail.link") : t("recurring.detail.unlink")}
                </span>
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
