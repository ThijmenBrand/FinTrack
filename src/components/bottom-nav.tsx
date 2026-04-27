"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Upload,
  Wallet,
  MoreHorizontal,
  PieChart,
  PiggyBank,
  Sun,
  Moon,
  Heart,
  Shield,
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
import { useSession, signOut } from "@/lib/auth-client";

const mainTabs = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Transactions", href: "/transactions", icon: Upload },
  { name: "Insights", href: "/insights", icon: PieChart },
  { name: "Budgets", href: "/budgets", icon: Wallet },
];

const moreItems = [
  { name: "Pots", href: "/pots", icon: PiggyBank },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();

  const user = session?.user
    ? {
        displayUsername: (session.user as Record<string, unknown>).displayUsername as string || session.user.name || "",
        username: (session.user as Record<string, unknown>).username as string || "",
        isAdmin: (session.user as Record<string, unknown>).role === "admin",
      }
    : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleLogout() {
    localStorage.removeItem("lockscreen_username");
    localStorage.removeItem("lockscreen_has_pin");
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const isMoreActive =
    moreItems.some((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
    ) ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/admin") ||
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
                key={item.name}
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
                  {item.name}
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
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">
              Additional navigation options
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
                  key={item.name}
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
                  <span>{item.name}</span>
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
              <span>Settings</span>
            </Link>
            {user?.isAdmin && (
              <Link
                href="/admin"
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors min-h-[44px]",
                  pathname.startsWith("/admin")
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <Shield className="h-5 w-5" />
                <span>Admin</span>
              </Link>
            )}
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
                <span>Profile</span>
              </Link>
            )}
            <div className="border-t my-3" />
            {user && (
              <div className="flex items-center gap-3 rounded-lg px-3 py-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {user.displayUsername.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{user.displayUsername}</p>
                  <p className="text-xs text-muted-foreground">@{user.username}</p>
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
              ) : (
                <Sun className="h-5 w-5" />
              )}
              <span>
                {!mounted
                  ? "Theme"
                  : theme === "pink"
                    ? "Pink Mode"
                    : theme === "dark"
                      ? "Dark Mode"
                      : "Light Mode"}
              </span>
            </button>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
            >
              <LogOut className="h-5 w-5" />
              <span>Sign Out</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
