"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Loader2, Save } from "lucide-react";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { useI18n } from "@/lib/i18n/client";

const INTERVAL_OPTIONS = [1, 2, 3, 6];
const LOOKBACK_OPTIONS = [1, 3, 6, 12];

export function AutomationSettingsCard() {
  const { t, plural } = useI18n();
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  const [enabled, setEnabled] = useState(true);
  const [interval, setInterval] = useState(1);
  const [lookback, setLookback] = useState(3);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.autoBudgetEnabled);
    setInterval(data.autoBudgetIntervalMonths);
    setLookback(data.autoBudgetLookbackMonths);
  }, [data]);

  const dirty =
    !!data &&
    (data.autoBudgetEnabled !== enabled ||
      data.autoBudgetIntervalMonths !== interval ||
      data.autoBudgetLookbackMonths !== lookback);

  const handleSave = async () => {
    setSavedMsg(null);
    await update.mutateAsync({
      autoBudgetEnabled: enabled,
      autoBudgetIntervalMonths: interval,
      autoBudgetLookbackMonths: lookback,
    });
    setSavedMsg(t("common.saved"));
    setTimeout(() => setSavedMsg(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("settings.automation.title")}</CardTitle>
            <CardDescription>{t("settings.automation.description")}</CardDescription>
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
            <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">{t("settings.automation.enabledLabel")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("settings.automation.enabledHint")}
                </div>
              </div>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("settings.automation.cadenceLabel")}</label>
                <Select
                  value={String(interval)}
                  onValueChange={(v) => setInterval(parseInt(v, 10))}
                  disabled={!enabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {plural(m, "settings.automation.cadenceOption.one", "settings.automation.cadenceOption.other")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("settings.automation.cadenceHint")}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("settings.automation.lookbackLabel")}</label>
                <Select
                  value={String(lookback)}
                  onValueChange={(v) => setLookback(parseInt(v, 10))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOOKBACK_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {plural(m, "settings.automation.lookbackOption.one", "settings.automation.lookbackOption.other")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("settings.automation.lookbackHint")}
                </p>
              </div>
            </div>

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
