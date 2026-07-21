"use client";

import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Upload, PieChart, Wallet, PiggyBank } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

/** Primary tabs shown in the bottom bar and top of the sidebar. */
export const PRIMARY_NAV: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Transactions", href: "/transactions", icon: Upload },
  { name: "Insights", href: "/insights", icon: PieChart },
  { name: "Budgets", href: "/budgets", icon: Wallet },
];

/** Secondary items — sidebar lists them inline, bottom nav tucks them under "More". */
export const SECONDARY_NAV: NavItem[] = [
  { name: "Pots", href: "/pots", icon: PiggyBank },
];

export interface SessionUser {
  displayUsername: string;
  username: string;
  isAdmin: boolean;
}

/** Derives the typed user off the session and provides a logout that clears lock state. */
export function useSessionUser() {
  const router = useRouter();
  const { data: session } = useSession();

  const user: SessionUser | null = session?.user
    ? {
        displayUsername:
          ((session.user as Record<string, unknown>).displayUsername as string) ||
          session.user.name ||
          "",
        username: ((session.user as Record<string, unknown>).username as string) || "",
        isAdmin: (session.user as Record<string, unknown>).role === "admin",
      }
    : null;

  const logout = async () => {
    localStorage.removeItem("lockscreen_username");
    localStorage.removeItem("lockscreen_has_pin");
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return { user, logout };
}
