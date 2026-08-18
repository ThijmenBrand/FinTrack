"use client";

import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Upload, PieChart, Wallet, PiggyBank, RefreshCcw, Landmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { usePreferences } from "@/hooks/use-preferences";
import type { MessageKey } from "@/lib/i18n/translate";

export interface NavItem {
  labelKey: MessageKey;
  href: string;
  icon: LucideIcon;
  /** Sidebar subsection this item lives under. Bottom nav ignores it. */
  section: MessageKey;
  /** Simple mode drops this item. Recurring stays — it feeds the budget. */
  hideInSimple?: boolean;
}

/** Sidebar subsections, in display order. */
export const NAV_SECTIONS: MessageKey[] = [
  "nav.section.overview",
  "nav.section.money",
  "nav.section.planning",
];

/** Primary tabs shown in the bottom bar and top of the sidebar. */
export const PRIMARY_NAV: NavItem[] = [
  { labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard, section: "nav.section.overview" },
  { labelKey: "nav.transactions", href: "/transactions", icon: Upload, section: "nav.section.money" },
  { labelKey: "nav.insights", href: "/insights", icon: PieChart, section: "nav.section.overview" },
  { labelKey: "nav.budgets", href: "/budgets", icon: Wallet, section: "nav.section.planning" },
];

/** Secondary items — sidebar lists them inline, bottom nav tucks them under "More". */
export const SECONDARY_NAV: NavItem[] = [
  { labelKey: "nav.accounts", href: "/accounts", icon: Landmark, section: "nav.section.money" },
  { labelKey: "nav.recurring", href: "/recurring", icon: RefreshCcw, section: "nav.section.planning" },
  { labelKey: "nav.pots", href: "/pots", icon: PiggyBank, section: "nav.section.planning", hideInSimple: true },
];

/** Secondary items minus the ones simple mode hides (currently: pots). */
export function useSecondaryNav(): NavItem[] {
  const { data: prefs } = usePreferences();
  return prefs?.simpleMode
    ? SECONDARY_NAV.filter((i) => !i.hideInSimple)
    : SECONDARY_NAV;
}

export interface SessionUser {
  displayName: string;
  /** Profile picture URL; null renders initials instead. */
  imageUrl: string | null;
  isAdmin: boolean;
}

/** Derives the typed user off the session and provides a logout that clears lock state. */
export function useSessionUser() {
  const router = useRouter();
  // `refetch` re-reads the session — the profile page calls it after an
  // avatar change so the nav picture updates immediately.
  const { data: session, refetch } = useSession();

  const user: SessionUser | null = session?.user
    ? {
        displayName: session.user.name || "",
        imageUrl: session.user.image ?? null,
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

  return { user, logout, refetch };
}
