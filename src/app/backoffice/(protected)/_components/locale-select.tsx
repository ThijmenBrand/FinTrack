"use client";

import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, isLocale, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/**
 * Admins are backoffice-only (the app layout redirects them here), so the
 * settings page they'd normally switch language on is out of reach — the
 * picker lives in this header instead.
 */
export function BackofficeLocaleSelect({ locale }: { locale: Locale }) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    // ponytail: native select — one control in a header doesn't need the
    // styled Select the settings page uses.
    <select
      aria-label={t("settings.language.label")}
      defaultValue={locale}
      onChange={async (e) => {
        const value = e.target.value;
        if (!isLocale(value)) return;
        // Mirrors the settings page: cookie for pages rendered without a
        // session, stored preference for everything else.
        document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
        await fetch("/api/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: value }),
        });
        router.refresh();
      }}
      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm transition-colors hover:bg-accent"
    >
      {LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
