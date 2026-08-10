"use client";

import { ArrowLeftRight } from "lucide-react";
import {
  SaveStatus,
  SettingsPanel,
  SettingsToggleRow,
} from "@/components/settings/settings-ui";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { useI18n } from "@/lib/i18n/client";

export function TransactionSection() {
  const { t } = useI18n();
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  return (
    <SettingsPanel
      title="settings.transactions.title"
      description="settings.transactions.description"
      icon={ArrowLeftRight}
      action={<SaveStatus pending={update.isPending} />}
      loading={isLoading}
    >
      <SettingsToggleRow
        id="hide-internal-transfers"
        label={t("settings.transactions.hideInternal")}
        hint={t("settings.transactions.hideInternalHint")}
        checked={data?.hideInternalTransfers ?? false}
        disabled={update.isPending}
        onCheckedChange={(hideInternalTransfers) =>
          update.mutate({ hideInternalTransfers })
        }
      />
      <SettingsToggleRow
        id="count-cross-budget-transfers"
        label={t("settings.transactions.countCrossBudget")}
        hint={t("settings.transactions.countCrossBudgetHint")}
        checked={data?.countCrossBudgetTransfers ?? false}
        disabled={update.isPending}
        onCheckedChange={(countCrossBudgetTransfers) =>
          update.mutate({ countCrossBudgetTransfers })
        }
      />
    </SettingsPanel>
  );
}
