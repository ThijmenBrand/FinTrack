"use client";

/**
 * PWA Lock Screen Provider
 *
 * IMPORTANT: This lock screen is purely a client-side UX convenience feature,
 * similar to a phone lock screen on top of an already-authenticated session.
 * It is NOT a security boundary.
 *
 * The lock state is a React useState boolean — the underlying session cookie
 * remains valid while the lock screen is displayed. This means the lock can be
 * bypassed by manipulating client-side state (e.g. DevTools, disabling JS, or
 * calling API endpoints directly).
 *
 * The /api/auth/pin/unlock endpoint verifies the PIN server-side, but the
 * unlock() function here simply sets isLocked to false without requiring proof
 * that the server validated the PIN. Any code path that calls unlock() will
 * dismiss the lock screen.
 *
 * If this ever needs to become a true security control, the server must enforce
 * it — e.g. by issuing a short-lived unlock token that middleware checks on
 * every request.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useHasPin } from "@/hooks/use-pin";

const LS_USERNAME_KEY = "lockscreen_username";
const LS_HAS_PIN_KEY = "lockscreen_has_pin";
const LS_LAST_ACTIVE_KEY = "lockscreen_last_active";
const IDLE_TIMEOUT_MS = 5 * 60_000; // lock after 5 minutes of inactivity
const IDLE_CHECK_MS = 30_000;

interface LockScreenContextValue {
  isLocked: boolean;
  username: string;
  unlock: () => void;
  clearLockState: () => void;
}

const LockScreenContext = createContext<LockScreenContextValue>({
  isLocked: false,
  username: "",
  unlock: () => {},
  clearLockState: () => {},
});

export function useLockScreen() {
  return useContext(LockScreenContext);
}

export function LockScreenProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const [username, setUsername] = useState("");
  const { data: pinStatus } = useHasPin();

  // Cache hasPin into localStorage whenever it changes
  useEffect(() => {
    if (pinStatus) {
      localStorage.setItem(LS_HAS_PIN_KEY, JSON.stringify(pinStatus.hasPin));
    }
  }, [pinStatus]);

  const touch = useCallback(() => {
    localStorage.setItem(LS_LAST_ACTIVE_KEY, String(Date.now()));
  }, []);

  // Lock only when the last recorded activity is older than the idle timeout.
  // Survives reloads and backgrounding because the timestamp lives in localStorage.
  const lockIfIdle = useCallback(() => {
    const storedUsername = localStorage.getItem(LS_USERNAME_KEY);
    if (!storedUsername || localStorage.getItem(LS_HAS_PIN_KEY) !== "true") {
      return;
    }

    const lastActive = Number(localStorage.getItem(LS_LAST_ACTIVE_KEY));
    if (!lastActive) {
      // No history yet (fresh login) — start the clock instead of locking.
      touch();
      return;
    }
    if (Date.now() - lastActive < IDLE_TIMEOUT_MS) return;

    setUsername(storedUsername);
    setIsLocked(true);
  }, [touch]);

  // Check on mount, on a coarse interval, and whenever the tab becomes visible
  // (timers are throttled or frozen while backgrounded, so the visibility check
  // is what catches a long stint in the background).
  useEffect(() => {
    lockIfIdle();

    const interval = setInterval(lockIfIdle, IDLE_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") lockIfIdle();
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [lockIfIdle]);

  // Record activity while unlocked. ponytail: pointer + key only; add scroll/
  // wheel if someone reports locking mid-read on a long page.
  useEffect(() => {
    if (isLocked) return;

    const events = ["pointerdown", "keydown"] as const;
    events.forEach((e) => document.addEventListener(e, touch, { passive: true }));
    return () =>
      events.forEach((e) => document.removeEventListener(e, touch));
  }, [isLocked, touch]);

  const unlock = useCallback(() => {
    touch();
    setIsLocked(false);
  }, [touch]);

  const clearLockState = useCallback(() => {
    localStorage.removeItem(LS_USERNAME_KEY);
    localStorage.removeItem(LS_HAS_PIN_KEY);
    localStorage.removeItem(LS_LAST_ACTIVE_KEY);
    setIsLocked(false);
    setUsername("");
  }, []);

  return (
    <LockScreenContext.Provider
      value={{ isLocked, username, unlock, clearLockState }}
    >
      {children}
    </LockScreenContext.Provider>
  );
}
