import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { ViewTransitions } from "@/components/view-transitions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <ViewTransitions />
      <Sidebar />
      {/* min-w-0: without it a too-wide child widens main instead of being clipped. */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-7xl p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 md:pb-6 lg:p-8">
          {children}
        </div>
      </main>
      <BottomNav />
      <PwaInstallPrompt />
    </div>
  );
}
