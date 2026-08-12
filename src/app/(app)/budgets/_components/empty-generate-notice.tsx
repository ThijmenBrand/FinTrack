"use client";

import Link from "next/link";
import { Info, X } from "lucide-react";
import type { EmptyGenerateReason } from "@/lib/auto-budget";
import type { I18n } from "@/lib/i18n/translate";

/**
 * Explains an empty "generate from history" run, with the one action that
 * would make the next run work. Sits under the header, next to the button
 * that produced it.
 */
export function EmptyGenerateNotice({
  reason,
  onLinkAccounts,
  onDismiss,
  i18n,
}: {
  reason: EmptyGenerateReason;
  /** Opens the plan dialog — the only place accounts get attached to a plan. */
  onLinkAccounts?: () => void;
  onDismiss: () => void;
  i18n: I18n;
}) {
  const { t } = i18n;
  const COPY = {
    "no-accounts": {
      title: t("budgets.empty.noAccounts.title"),
      body: t("budgets.empty.noAccounts.body"),
    },
    "no-history": {
      title: t("budgets.empty.noHistory.title"),
      body: t("budgets.empty.noHistory.body"),
    },
    "up-to-date": {
      title: t("budgets.empty.upToDate.title"),
      body: t("budgets.empty.upToDate.body"),
    },
  }[reason];

  const linkClass = "font-medium underline underline-offset-2";
  const action =
    reason === "no-accounts" && onLinkAccounts ? (
      <button type="button" onClick={onLinkAccounts} className={linkClass}>
        {t("budgets.empty.linkAccounts")}
      </button>
    ) : reason === "no-history" ? (
      <Link href="/transactions" className={linkClass}>
        {t("budgets.empty.linkImport")}
      </Link>
    ) : null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium text-amber-950 dark:text-amber-50">
          {COPY.title}
        </p>
        <p className="text-xs text-amber-900 dark:text-amber-200">
          {COPY.body}
          {action && <> {action}</>}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("budgets.empty.dismiss")}
        className="shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-200 dark:text-amber-300 dark:hover:bg-amber-900"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
