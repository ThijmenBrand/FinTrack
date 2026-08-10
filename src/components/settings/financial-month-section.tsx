"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarRange, Lightbulb } from "lucide-react";
import {
  SaveStatus,
  SettingsPanel,
  SettingsRow,
} from "@/components/settings/settings-ui";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

interface IncomeDaySuggestion {
  day: number;
  totalIncome: number;
  monthsObserved: number;
}

/** The stored preference is a single day 1–28, so the control is a single list. */
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

function useIncomeDaySuggestion() {
  return useQuery({
    queryKey: ["preferences", "income-day-suggestion"],
    queryFn: () =>
      apiFetch<{ suggestion: IncomeDaySuggestion | null }>(
        "/api/preferences/income-day-suggestion",
      ),
    staleTime: 10 * 60 * 1000,
  });
}

export function FinancialMonthSection() {
  const { t, plural, ordinal } = useI18n();
  const { data, isLoading } = usePreferences();
  const { data: suggestionData } = useIncomeDaySuggestion();
  const update = useUpdatePreferences();

  const day = data?.financialMonthStartDay ?? 1;
  const rawSuggestion = suggestionData?.suggestion ?? null;
  const suggestion = rawSuggestion?.day === day ? null : rawSuggestion;

  return (
    <SettingsPanel
      title="settings.financialMonth.title"
      description="settings.financialMonth.description"
      icon={CalendarRange}
      action={<SaveStatus pending={update.isPending} />}
      loading={isLoading}
      loadingRows={1}
    >
      <SettingsRow
        htmlFor="financial-month-day"
        label={t("settings.financialMonth.startsOn")}
        hint={
          day === 1
            ? t("settings.financialMonth.calendarHint")
            : t("settings.financialMonth.previewRange", {
                from: ordinal(day),
                to: ordinal(day - 1),
              })
        }
        control={
          <Select
            value={String(day)}
            onValueChange={(v) =>
              update.mutate({ financialMonthStartDay: parseInt(v, 10) })
            }
            disabled={update.isPending}
          >
            <SelectTrigger id="financial-month-day" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d === 1
                    ? t("settings.financialMonth.calendar")
                    : t("settings.financialMonth.dayOption", { day: ordinal(d) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {suggestion && (
          // One line, not a callout box: it's a nudge about the control directly
          // above it, and it disappears the moment you take it.
          <button
            type="button"
            onClick={() =>
              update.mutate({ financialMonthStartDay: suggestion.day })
            }
            className="inline-flex items-start gap-1.5 rounded text-left text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {t("settings.financialMonth.suggested", { day: ordinal(suggestion.day) })}{" "}
              <span className="font-normal text-muted-foreground">
                {plural(
                  suggestion.monthsObserved,
                  "settings.financialMonth.suggestionHint.one",
                  "settings.financialMonth.suggestionHint.other",
                )}
              </span>
            </span>
          </button>
        )}
      </SettingsRow>
    </SettingsPanel>
  );
}
