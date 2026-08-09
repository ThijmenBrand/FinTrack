"use client";

import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Upload, PieChart, Wallet, PiggyBank } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import type { MessageKey } from "@/lib/i18n/translate";

export interface NavItem {
  labelKey: MessageKey;
  href: string;
  icon: LucideIcon;
}

/** Primary tabs shown in the bottom bar and top of the sidebar. */
export const PRIMARY_NAV: NavItem[] = [
  { labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard },
  { labelKey: "nav.transactions", href: "/transactions", icon: Upload },
  { labelKey: "nav.insights", href: "/insights", icon: PieChart },
  { labelKey: "nav.budgets", href: "/budgets", icon: Wallet },
];

/** Secondary items — sidebar lists them inline, bottom nav tucks them under "More". */
export const SECONDARY_NAV: NavItem[] = [
  { labelKey: "nav.pots", href: "/pots", icon: PiggyBank },
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
    localStorage.removeItem("lockscreen_last_active");
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return { user, logout };
}
