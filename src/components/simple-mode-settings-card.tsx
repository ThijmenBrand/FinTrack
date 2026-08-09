"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { useI18n } from "@/lib/i18n/client";

export function SimpleModeSettingsCard() {
  const { t } = useI18n();
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("settings.simpleMode.title")}</CardTitle>
            <CardDescription>{t("settings.simpleMode.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : (
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">{t("settings.simpleMode.label")}</div>
              <div className="text-xs text-muted-foreground">
                {t("settings.simpleMode.hint")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={data?.simpleMode ?? false}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ simpleMode: e.target.checked })}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
            />
          </label>
        )}
      </CardContent>
    </Card>
  );
}
