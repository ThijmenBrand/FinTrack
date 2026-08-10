"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SaveStatus,
  SettingsHeader,
  SettingsPanel,
  SettingsRow,
  SettingsToggleRow,
} from "@/components/settings/settings-ui";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { useI18n } from "@/lib/i18n/client";

const INTERVAL_OPTIONS = [1, 2, 3, 6];
const LOOKBACK_OPTIONS = [1, 3, 6, 12];

export default function AutomationSettingsPage() {
  const { t, plural } = useI18n();
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  const enabled = data?.autoBudgetEnabled ?? true;
  const interval = data?.autoBudgetIntervalMonths ?? 1;
  const lookback = data?.autoBudgetLookbackMonths ?? 3;

  return (
    <div className="max-w-3xl space-y-6">
      {/* The header names the topic, so the panel below goes bare — a titled
          panel here would say "Budget automation" twice. */}
      <SettingsHeader
        title="settings.automation.title"
        description="settings.automation.description"
        actions={<SaveStatus pending={update.isPending} />}
      />

      <SettingsPanel loading={isLoading} loadingRows={3}>
        <SettingsToggleRow
          id="auto-budget-enabled"
          label={t("settings.automation.enabledLabel")}
          hint={t("settings.automation.enabledHint")}
          checked={enabled}
          disabled={update.isPending}
          onCheckedChange={(autoBudgetEnabled) => update.mutate({ autoBudgetEnabled })}
        />

        <SettingsRow
          htmlFor="auto-budget-cadence"
          label={t("settings.automation.cadenceLabel")}
          hint={t("settings.automation.cadenceHint")}
          control={
            <Select
              value={String(interval)}
              onValueChange={(v) =>
                update.mutate({ autoBudgetIntervalMonths: parseInt(v, 10) })
              }
              disabled={!enabled || update.isPending}
            >
              <SelectTrigger id="auto-budget-cadence" className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {plural(
                      m,
                      "settings.automation.cadenceOption.one",
                      "settings.automation.cadenceOption.other",
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <SettingsRow
          htmlFor="auto-budget-lookback"
          label={t("settings.automation.lookbackLabel")}
          hint={t("settings.automation.lookbackHint")}
          control={
            <Select
              value={String(lookback)}
              onValueChange={(v) =>
                update.mutate({ autoBudgetLookbackMonths: parseInt(v, 10) })
              }
              disabled={update.isPending}
            >
              <SelectTrigger id="auto-budget-lookback" className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOOKBACK_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {plural(
                      m,
                      "settings.automation.lookbackOption.one",
                      "settings.automation.lookbackOption.other",
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsPanel>
    </div>
  );
}
