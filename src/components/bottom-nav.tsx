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
  User,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
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
import { UserAvatar } from "@/components/user-avatar";

export function BottomNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const { user, logout } = useSessionUser();
  const moreItems = useSecondaryNav();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isMoreActive =
    moreItems.some((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
    ) ||
    pathname.startsWith("/settings") ||
    pathname === "/profile";

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex md:hidden border-t bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
        style={{ viewTransitionName: "app-bottom-nav" }}
      >
        <div className="flex w-full h-16">
          {mainTabs.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 min-h-[44px] transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-none">
                  {t(item.labelKey)}
                </span>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 min-h-[44px] transition-colors",
              isMoreActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">
              {t("nav.more")}
            </span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("nav.more")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("nav.moreDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="px-6 pb-8 pt-2 space-y-1">
            {moreItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px]",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{t(item.labelKey)}</span>
                </Link>
              );
            })}
            <div className="border-t my-3" />
            <Link
              href="/settings"
              onClick={() => setMoreOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px]",
                pathname.startsWith("/settings")
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted"
              )}
            >
              <Settings className="h-5 w-5" />
              <span>{t("nav.settings")}</span>
            </Link>
            {user && (
              <Link
                href="/profile"
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px]",
                  pathname === "/profile"
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <User className="h-5 w-5" />
                <span>{t("nav.profile")}</span>
              </Link>
            )}
            <div className="border-t my-3" />
            {user && (
              <div className="flex items-center gap-3 rounded-lg px-3 py-2">
                <UserAvatar
                  name={user.displayName}
                  image={user.imageUrl}
                  className="h-8 w-8 text-sm"
                />
                <div>
                  <p className="text-sm font-medium">{user.displayName}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => {
                const next =
                  theme === "light"
                    ? "dark"
                    : theme === "dark"
                      ? "pink"
                      : theme === "pink"
                        ? "system"
                        : "light";
                setTheme(next);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
            >
              {!mounted ? (
                <Sun className="h-5 w-5" />
              ) : theme === "pink" ? (
                <Heart className="h-5 w-5 fill-current" />
              ) : theme === "dark" ? (
                <Moon className="h-5 w-5" />
              ) : theme === "light" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Monitor className="h-5 w-5" />
              )}
              <span>
                {!mounted
                  ? t("theme.label")
                  : theme === "pink"
                    ? t("theme.pinkMode")
                    : theme === "dark"
                      ? t("theme.darkMode")
                      : theme === "light"
                        ? t("theme.lightMode")
                        : t("theme.systemMode")}
              </span>
            </button>
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
            >
              <LogOut className="h-5 w-5" />
              <span>{t("nav.logout")}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
