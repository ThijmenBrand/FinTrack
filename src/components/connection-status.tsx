"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { useIsHydrated } from "@/hooks/use-browser";
import { toast } from "@/lib/toast";

/**
 * An installed PWA keeps running after the network goes away: pages still
 * render, taps still land, and every request quietly fails. Without this the
 * app looks healthy and simply stops saving things.
 *
 * Offline shows a persistent strip — the one piece of UI that explains why
 * nothing is updating. Coming back online refetches what's on screen, so the
 * stale numbers correct themselves instead of waiting for a navigation.
 */
export function ConnectionStatus() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const hydrated = useIsHydrated();
  const [offline, setOffline] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (offline) {
      wasOffline.current = true;
      return;
    }
    // Only on the way back — not on first load, which is almost always online.
    if (!wasOffline.current) return;
    wasOffline.current = false;
    toast.success(t("net.backOnline"), { duration: 2500, key: "connection" });
    qc.refetchQueries({ type: "active" });
  }, [offline, qc, t]);

  if (!hydrated || !offline) return null;

  return createPortal(
    <div
      role="status"
      className="animate-in slide-in-from-top-2 fade-in-0 fixed inset-x-0 top-0 z-[101] flex items-center justify-center gap-2 bg-warning px-4 py-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] text-center text-xs font-medium text-warning-foreground"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      {t("net.offline")}
    </div>,
    document.body,
  );
}
