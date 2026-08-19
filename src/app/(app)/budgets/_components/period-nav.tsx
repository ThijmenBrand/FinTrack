"use client";

import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowRight, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type PeriodScope = "month" | "year";

/**
 * Which slice of the plan is on screen. The month/year switch only exists for
 * yearly plans — a monthly plan has no year to zoom out to — so `onScopeChange`
 * being absent is what hides it.
 */
export function PeriodNav({
  scope,
  onScopeChange,
  label,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: {
  scope: PeriodScope;
  onScopeChange?: (scope: PeriodScope) => void;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* On a phone the stepper is the row; the scope switch drops underneath
          it at full width, where both halves are a comfortable tap. */}
      {onScopeChange && (
        <Tabs
          value={scope}
          onValueChange={(v) => onScopeChange(v as PeriodScope)}
          className="order-last w-full sm:order-none sm:w-auto"
        >
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="month" className="flex-1 sm:flex-none">
              {t("budgets.view.month")}
            </TabsTrigger>
            <TabsTrigger value="year" className="flex-1 sm:flex-none">
              {t("budgets.view.year")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="flex flex-1 items-center gap-1 sm:flex-none">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onPrev}
          disabled={prevDisabled}
          aria-label={t("budgets.periodNav.prev")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-0 flex-1 text-center text-sm sm:min-w-[9rem] sm:flex-none">
          {label}
        </span>
        <Button
          variant="ghost"
          size="icon"
          // Nothing ahead of the live period: hidden rather than greyed out,
          // but kept in the flow so the label doesn't jump.
          className={cn("h-8 w-8", nextDisabled && "invisible")}
          onClick={onNext}
          disabled={nextDisabled}
          aria-label={t("budgets.periodNav.next")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {/* Icon-only on a phone so the stepper keeps the row — the label is the
          accessible name either way. */}
      <Link
        href="/recurring"
        aria-label={t("budgets.viewForecast")}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1 rounded-md text-sm text-primary hover:underline sm:ml-auto sm:h-auto sm:w-auto"
      >
        <TrendingUp className="h-4 w-4 sm:hidden" />
        <span className="hidden sm:inline">{t("budgets.viewForecast")}</span>
        <ArrowRight className="hidden h-3.5 w-3.5 sm:block" />
      </Link>
    </div>
  );
}
