"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Languages, Loader2 } from "lucide-react";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, isLocale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

export function LanguageSettingsCard() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  const locale = data?.locale ?? "en";

  const onChange = (value: string) => {
    if (!isLocale(value) || value === locale) return;
    // The cookie mirrors the stored preference so that pages rendered before
    // we know who the user is (login, invite, reset password) match too.
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    // Server components hold the rendered copy, so a refresh is what actually
    // repaints the app in the new language.
    update.mutate({ locale: value }, { onSuccess: () => router.refresh() });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Languages className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("settings.language.title")}</CardTitle>
            <CardDescription>{t("settings.language.description")}</CardDescription>
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
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="locale-select">
              {t("settings.language.label")}
            </label>
            <Select value={locale} onValueChange={onChange} disabled={update.isPending}>
              <SelectTrigger id="locale-select" className="max-w-xs">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
