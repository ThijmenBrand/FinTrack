"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import {
  SaveStatus,
  SettingsPanel,
  SettingsRow,
  SettingsToggleRow,
} from "@/components/settings/settings-ui";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, isLocale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/** Simple mode and language: the two preferences that change how the app reads. */
export function InterfaceSection() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  const locale = data?.locale ?? "en";

  const onLocaleChange = (value: string) => {
    if (!isLocale(value) || value === locale) return;
    // The cookie mirrors the stored preference so that pages rendered before
    // we know who the user is (login, invite, reset password) match too.
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    // Server components hold the rendered copy, so a refresh is what actually
    // repaints the app in the new language.
    update.mutate({ locale: value }, { onSuccess: () => router.refresh() });
  };

  return (
    <SettingsPanel
      title="settings.interface.title"
      description="settings.interface.description"
      icon={Sparkles}
      action={<SaveStatus pending={update.isPending} />}
      loading={isLoading}
    >
      <SettingsToggleRow
        id="simple-mode"
        label={t("settings.simpleMode.label")}
        hint={t("settings.simpleMode.hint")}
        checked={data?.simpleMode ?? false}
        disabled={update.isPending}
        onCheckedChange={(simpleMode) => update.mutate({ simpleMode })}
      />

      <SettingsRow
        htmlFor="locale-select"
        label={t("settings.language.label")}
        hint={t("settings.language.description")}
        control={
          <Select value={locale} onValueChange={onLocaleChange} disabled={update.isPending}>
            <SelectTrigger id="locale-select" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((code) => (
                <SelectItem key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsPanel>
  );
}
