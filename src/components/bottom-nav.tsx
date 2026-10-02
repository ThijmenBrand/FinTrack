"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MoreHorizontal,
  Sun,
  Moon,
  Heart,
  Monitor,
  LogOut,
  Settings,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { useIsHydrated } from "@/hooks/use-browser";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  PRIMARY_NAV as mainTabs,
  useSecondaryNav,
  useSessionUser,
} from "@/components/nav-shared";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { UserAvatar } from "@/components/user-avatar";
import { scrollMainToTop } from "@/components/mobile-top-bar";

const THEMES: { value: string; labelKey: MessageKey; icon: LucideIcon }[] = [
  { value: "system", labelKey: "theme.system", icon: Monitor },
  { value: "light", labelKey: "theme.light", icon: Sun },
  { value: "dark", labelKey: "theme.dark", icon: Moon },
  { value: "pink", labelKey: "theme.pink", icon: Heart },
];

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** One tab: the icon sits in a pill that fills in when the tab is current. */
function TabContent({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
}) {
  return (
    <>
      <span
        className={cn(
          "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
          active && "bg-primary/12",
        )}
      >
        <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.25 : 1.75} />
      </span>
      <span
        className={cn(
          "max-w-full truncate px-0.5 text-[11px] leading-none",
          active ? "font-semibold" : "font-medium",
        )}
      >
        {label}
      </span>
    </>
  );
}

const TAB_CLASS =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-[color,transform] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Grouped-list row inside the More sheet. */
const ROW_CLASS =
  "flex min-h-[3.25rem] w-full items-center gap-3 px-4 text-left text-base transition-colors active:bg-muted";

export function BottomNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { user, logout } = useSessionUser();
  const moreItems = useSecondaryNav();
  const mounted = useIsHydrated();
  const close = () => setMoreOpen(false);

  const isMoreActive =
    moreItems.some((item) => isActivePath(pathname, item.href)) ||
    pathname.startsWith("/settings") ||
    pathname === "/profile";

  return (
    <>
      <nav
        className="app-chrome fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden"
        style={{ viewTransitionName: "app-bottom-nav" }}
      >
        <div className="flex h-16 w-full px-1">
          {mainTabs.map((item) => {
            const isActive = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                onClick={(e) => {
                  // Native tab bars: tapping the current tab scrolls it back
                  // to the top first; a second tap (already at the top) goes
                  // to the tab's root, clearing any filters in the URL.
                  const main = document.querySelector("main");
                  if (isActive && main && main.scrollTop > 0) {
                    e.preventDefault();
                    scrollMainToTop();
                  }
                }}
                className={cn(
                  TAB_CLASS,
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <TabContent icon={item.icon} label={t(item.labelKey)} active={isActive} />
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            className={cn(
              TAB_CLASS,
              isMoreActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <TabContent icon={MoreHorizontal} label={t("nav.more")} active={isMoreActive} />
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent className="max-h-[92dvh] bg-muted dark:bg-background">
          <SheetHeader className="px-4 pb-1">
            <SheetTitle className="text-2xl font-bold tracking-tight">{t("nav.more")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("nav.moreDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 overflow-y-auto px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {user && (
              <Link
                href="/profile"
                onClick={close}
                className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors active:bg-muted"
              >
                <UserAvatar
                  name={user.displayName}
                  image={user.imageUrl}
                  className="h-14 w-14 text-xl"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold">
                    {user.displayName}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {t("nav.viewProfile")}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
              </Link>
            )}

            <div className="divide-y overflow-hidden rounded-2xl border bg-card">
              {[
                ...moreItems,
                { labelKey: "nav.settings" as const, href: "/settings", icon: Settings },
              ].map((item) => {
                const isActive = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    aria-current={isActive ? "page" : undefined}
                    className={ROW_CLASS}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <item.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className={cn("flex-1", isActive && "font-semibold text-primary")}>
                      {t(item.labelKey)}
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
                  </Link>
                );
              })}
            </div>

            <fieldset>
              <legend className="mb-2 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("theme.label")}
              </legend>
              <div className="grid grid-cols-4 gap-1 rounded-2xl border bg-card p-1">
                {THEMES.map((option) => {
                  const selected = mounted && theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setTheme(option.value)}
                      className={cn(
                        "flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium transition-colors",
                        selected
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground active:bg-muted",
                      )}
                    >
                      <option.icon
                        className={cn("h-5 w-5", option.value === "pink" && selected && "fill-current")}
                      />
                      {t(option.labelKey)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="overflow-hidden rounded-2xl border bg-card">
              <button
                type="button"
                onClick={logout}
                className={cn(ROW_CLASS, "justify-center font-medium text-destructive")}
              >
                <LogOut className="h-5 w-5" />
                {t("nav.logout")}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
