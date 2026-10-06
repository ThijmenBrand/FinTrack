import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { MobileTopBar } from "@/components/mobile-top-bar";
import { OnboardingTour } from "@/components/onboarding-tour";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { LearnedRuleNotice } from "@/components/learned-rule-notice";
import { ViewTransitions } from "@/components/view-transitions";
import { SessionLockWatcher } from "@/components/session-lock-watcher";
import { requireAuth } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Server-side mirror of the proxy's role routing: admins are backoffice-only.
  const session = await requireAuth();
  if (session.isAdmin) redirect("/backoffice");

  return (
    // h-dvh, not h-screen: on iOS 100vh runs under Safari's toolbar, so the
    // bottom of the page sat behind it.
    <div className="flex h-dvh overflow-hidden">
      <ViewTransitions />
      <Sidebar />
      <MobileTopBar />
      {/* min-w-0: without it a too-wide child widens main instead of being clipped. */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-background">
        {/* Mobile clears the status bar on top and the tab bar below; the
            installed PWA draws edge to edge, so both insets matter there. */}
        <div className="mx-auto max-w-7xl px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:p-6 md:pb-6 lg:p-8">
          {children}
        </div>
      </main>
      <BottomNav />
      <OnboardingTour />
      <PwaInstallPrompt />
      <LearnedRuleNotice />
      <SessionLockWatcher />
    </div>
  );
}
