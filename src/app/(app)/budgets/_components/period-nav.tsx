"use client";

import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

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
      {onScopeChange && (
        <Tabs
          value={scope}
          onValueChange={(v) => onScopeChange(v as PeriodScope)}
        >
          <TabsList>
            <TabsTrigger value="month">{t("budgets.view.month")}</TabsTrigger>
            <TabsTrigger value="year">{t("budgets.view.year")}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="flex items-center gap-1">
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
        <span className="min-w-[9rem] text-center text-sm">{label}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onNext}
          disabled={nextDisabled}
          aria-label={t("budgets.periodNav.next")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <Link
        href="/recurring"
        className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        {t("budgets.viewForecast")}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
