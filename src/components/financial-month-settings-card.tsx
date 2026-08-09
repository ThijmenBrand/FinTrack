"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarRange, Loader2, Save, Lightbulb } from "lucide-react";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

interface IncomeDaySuggestion {
  day: number;
  totalIncome: number;
  monthsObserved: number;
}

type Mode = "calendar" | "custom";

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

export function FinancialMonthSettingsCard() {
  const { t, plural, ordinal } = useI18n();
  const { data, isLoading } = usePreferences();
  const { data: suggestionData } = useIncomeDaySuggestion();
  const update = useUpdatePreferences();

  const [mode, setMode] = useState<Mode>("calendar");
  const [dayInput, setDayInput] = useState<string>("1");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    if (data.financialMonthStartDay > 1) {
      setMode("custom");
      setDayInput(String(data.financialMonthStartDay));
    } else {
      setMode("calendar");
      setDayInput("1");
    }
  }, [data]);

  const parsedDay = parseInt(dayInput, 10);
  const isValidCustomDay =
    Number.isFinite(parsedDay) && parsedDay >= 1 && parsedDay <= 28;
  const effectiveDay: number | null =
    mode === "calendar" ? 1 : isValidCustomDay ? parsedDay : null;
  const dirty =
    !!data &&
    effectiveDay !== null &&
    data.financialMonthStartDay !== effectiveDay;
  const rawSuggestion = suggestionData?.suggestion ?? null;
  const suggestion =
    rawSuggestion && data?.financialMonthStartDay === rawSuggestion.day
      ? null
      : rawSuggestion;

  const handleSave = async () => {
    if (effectiveDay === null) return;
    setSavedMsg(null);
    await update.mutateAsync({ financialMonthStartDay: effectiveDay });
    setSavedMsg(t("common.saved"));
    setTimeout(() => setSavedMsg(null), 2000);
  };

  const handleUseSuggestion = () => {
    if (!suggestion) return;
    setMode("custom");
    setDayInput(String(suggestion.day));
  };

  const previewEnd =
    effectiveDay === null ? null : effectiveDay === 1 ? 31 : effectiveDay - 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <CalendarRange className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("settings.financialMonth.title")}</CardTitle>
            <CardDescription>{t("settings.financialMonth.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  name="financial-month-mode"
                  checked={mode === "calendar"}
                  onChange={() => setMode("calendar")}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
                />
                <div>
                  <div className="text-sm font-medium">{t("settings.financialMonth.calendar")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.financialMonth.calendarHint")}
                  </div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  name="financial-month-mode"
                  checked={mode === "custom"}
                  onChange={() => setMode("custom")}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
                />
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="text-sm font-medium">{t("settings.financialMonth.custom")}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("settings.financialMonth.customHint")}
                    </div>
                  </div>
                  {mode === "custom" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={28}
                        value={dayInput}
                        onChange={(e) => setDayInput(e.target.value)}
                        onBlur={() => {
                          if (dayInput.trim() === "") return;
                          const v = parseInt(dayInput, 10);
                          if (!Number.isFinite(v)) {
                            setDayInput("");
                            return;
                          }
                          const clamped = Math.max(1, Math.min(28, v));
                          setDayInput(String(clamped));
                        }}
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">
                        {effectiveDay !== null && previewEnd !== null
                          ? t("settings.financialMonth.preview", {
                              from: ordinal(effectiveDay),
                              to: ordinal(previewEnd),
                            })
                          : t("settings.financialMonth.rangeHint")}
                      </span>
                    </div>
                  )}
                </div>
              </label>
            </div>

            {suggestion && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-start gap-2 text-sm">
                  <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                  <div>
                    <div className="font-medium">
                      {t("settings.financialMonth.suggested", { day: ordinal(suggestion.day) })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {plural(
                        suggestion.monthsObserved,
                        "settings.financialMonth.suggestionHint.one",
                        "settings.financialMonth.suggestionHint.other",
                      )}
                    </div>
                  </div>
                </div>
                {effectiveDay !== suggestion.day && (
                  <Button size="sm" variant="outline" onClick={handleUseSuggestion}>
                    {t("settings.financialMonth.useSuggestion")}
                  </Button>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={!dirty || update.isPending}>
                {update.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t("settings.automation.savePreferences")}
              </Button>
              {savedMsg && (
                <span className="text-sm text-green-600 dark:text-green-400">{savedMsg}</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
