"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Landmark, Tags, Sparkles, RefreshCcw, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

const tabs: { labelKey: MessageKey; href: string; icon: typeof Settings }[] = [
  { labelKey: "settings.tabs.general", href: "/settings/general", icon: Settings },
  { labelKey: "settings.tabs.accounts", href: "/settings/accounts", icon: Landmark },
  { labelKey: "settings.tabs.categories", href: "/settings/categories", icon: Tags },
  { labelKey: "settings.tabs.automation", href: "/settings/automation", icon: Sparkles },
  { labelKey: "settings.tabs.recurring", href: "/settings/recurring", icon: RefreshCcw },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
