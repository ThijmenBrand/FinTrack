"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Landmark, Tags, Sparkles, RefreshCcw, SlidersHorizontal } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

const tabs: { labelKey: MessageKey; href: string; icon: typeof Landmark }[] = [
  { labelKey: "settings.tabs.general", href: "/settings/general", icon: SlidersHorizontal },
  { labelKey: "settings.tabs.accounts", href: "/settings/accounts", icon: Landmark },
  { labelKey: "settings.tabs.categories", href: "/settings/categories", icon: Tags },
  { labelKey: "settings.tabs.automation", href: "/settings/automation", icon: Sparkles },
  { labelKey: "settings.tabs.recurring", href: "/settings/recurring", icon: RefreshCcw },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>

      {/* Bleeds to the viewport edge on mobile so the rail can scroll past the
          page gutter instead of clipping mid-tab. */}
      <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <nav
          aria-label={t("settings.title")}
          className="inline-flex gap-1 rounded-xl border bg-muted/50 p-1"
        >
          {tabs.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium",
                  "transition-colors duration-150 focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <tab.icon
                  className={cn("h-4 w-4 shrink-0", isActive && "text-primary")}
                />
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-8">{children}</div>
    </div>
  );
}
