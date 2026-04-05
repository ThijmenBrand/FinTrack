"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Upload,
  Tags,
  PieChart,
  Wallet,
  RefreshCcw,
  Landmark,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Heart,
  Shield,
  LogOut,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useSession, signOut } from "@/lib/auth-client";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Accounts", href: "/accounts", icon: Landmark },
  { name: "Transactions", href: "/transactions", icon: Upload },
  { name: "Categories", href: "/categories", icon: Tags },
  { name: "Insights", href: "/insights", icon: PieChart },
  { name: "Budgets", href: "/budgets", icon: Wallet },
  { name: "Recurring", href: "/recurring", icon: RefreshCcw },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();

  const user = session?.user
    ? {
        displayName: (session.user as Record<string, unknown>).displayName as string || session.user.name || "",
        username: (session.user as Record<string, unknown>).username as string || "",
        isAdmin: (session.user as Record<string, unknown>).role === "admin",
      }
    : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleLogout() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={cn(
        "relative hidden md:flex flex-col border-r bg-sidebar transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Header / Logo */}
      <div className="flex h-16 items-center gap-3 border-b px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Landmark className="h-4 w-4" />
        </div>
        {!collapsed && (
          <span className="text-lg font-semibold tracking-tight text-foreground">
            FinTrack
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}
        {user?.isAdmin && (
          <Link
            href="/admin"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/admin")
                ? "bg-primary/10 text-primary"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Shield className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Admin</span>}
          </Link>
        )}
      </nav>

      {/* User info + theme + logout */}
      <div className="border-t px-3 py-3 space-y-1">
        {/* User display */}
        {user && (
          <Link
            href="/profile"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-accent",
              pathname === "/profile" && "bg-primary/10"
            )}
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <span className="text-sm font-medium text-sidebar-foreground truncate">
                {user.displayName}
              </span>
            )}
          </Link>
        )}

        {/* Theme toggle */}
        <button
          onClick={() => {
            const next = theme === "light" ? "dark" : theme === "dark" ? "pink" : "light";
            setTheme(next);
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {!mounted ? (
            <Sun className="h-4 w-4 shrink-0" />
          ) : theme === "pink" ? (
            <Heart className="h-4 w-4 shrink-0 fill-current" />
          ) : theme === "dark" ? (
            <Moon className="h-4 w-4 shrink-0" />
          ) : (
            <Sun className="h-4 w-4 shrink-0" />
          )}
          {!collapsed && (
            <span>
              {!mounted ? "Theme" : theme === "pink" ? "Pink Mode" : theme === "dark" ? "Dark Mode" : "Light Mode"}
            </span>
          )}
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </button>
    </aside>
  );
}
