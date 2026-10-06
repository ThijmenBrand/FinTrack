"use client";

import { useEffect } from "react";
import { goToLockScreen } from "@/lib/api";

const CHECK_EVERY_MS = 60_000;

/**
 * Shows the lock screen as soon as the server has locked the session, rather
 * than at the next request. That matters most in the installed PWA: brought
 * back from the background after an hour, it would otherwise keep showing
 * the balances it had on screen until something was tapped.
 *
 * Asks /api/unlock, which is lock-exempt — checking doesn't count as
 * activity, so an open tab can't keep itself unlocked.
 */
export function SessionLockWatcher() {
  useEffect(() => {
    let inFlight = false;

    async function check() {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch("/api/unlock", { cache: "no-store" });
        if (res.ok && ((await res.json()) as { locked?: boolean }).locked) {
          goToLockScreen();
        }
      } catch {
        // Offline or mid-deploy: the next check, or the next request, will tell.
      } finally {
        inFlight = false;
      }
    }

    const interval = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    // A page restored from the back/forward cache reports in via pageshow.
    window.addEventListener("pageshow", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", check);
    };
  }, []);

  return null;
}
