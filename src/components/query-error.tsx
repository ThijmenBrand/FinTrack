"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/error-message";
import { useI18n } from "@/lib/i18n/client";

interface QueryErrorProps {
  /** Whatever the query threw. Shapes the wording. */
  error?: unknown;
  /** Usually `refetch` from the same query. */
  onRetry?: () => void;
  /** `isFetching`, so the retry button can show it is working. */
  retrying?: boolean;
  /** "card" (default) fills a panel; "inline" sits inside a card that already has a header. */
  variant?: "card" | "inline";
  className?: string;
}

/**
 * What a list shows when its data never arrived.
 *
 * The alternative — falling through to the empty state — tells the user they
 * have no transactions when in fact the request failed, and offers them no way
 * to find out otherwise. This says what happened and puts the retry where they
 * are already looking.
 */
export function QueryError({
  error,
  onRetry,
  retrying,
  variant = "card",
  className,
}: QueryErrorProps) {
  const { t } = useI18n();
  const { title, description } = error
    ? describeError(error, t)
    : { title: t("err.loadFailed.title"), description: t("err.loadFailed.body") };

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        variant === "card" ? "rounded-xl border border-dashed px-6 py-12" : "px-4 py-8",
        className,
      )}
    >
      <AlertTriangle className="h-6 w-6 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="mx-auto max-w-xs text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}
