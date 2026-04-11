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
  useRef,
  type ReactNode,
} from "react";
import { useHasPin } from "@/hooks/use-pin";

const LS_USERNAME_KEY = "lockscreen_username";
const LS_HAS_PIN_KEY = "lockscreen_has_pin";
const LOCK_DELAY_MS = 60_000; // 60 seconds grace period before requiring PIN

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
  const hiddenAtRef = useRef<number | null>(null);

  // Cache hasPin into localStorage whenever it changes
  useEffect(() => {
    if (pinStatus) {
      localStorage.setItem(LS_HAS_PIN_KEY, JSON.stringify(pinStatus.hasPin));
    }
  }, [pinStatus]);

  // On mount: if localStorage has username + hasPin, start locked
  useEffect(() => {
    const storedUsername = localStorage.getItem(LS_USERNAME_KEY);
    const storedHasPin = localStorage.getItem(LS_HAS_PIN_KEY);

    if (storedUsername && storedHasPin === "true") {
      setUsername(storedUsername);
      setIsLocked(true);
    }
  }, []);

  // Lock on visibility change after grace period (tab hidden / app backgrounded)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === "visible") {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;

        if (hiddenAt && Date.now() - hiddenAt >= LOCK_DELAY_MS) {
          const storedUsername = localStorage.getItem(LS_USERNAME_KEY);
          const storedHasPin = localStorage.getItem(LS_HAS_PIN_KEY);

          if (storedUsername && storedHasPin === "true") {
            setUsername(storedUsername);
            setIsLocked(true);
          }
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const unlock = useCallback(() => {
    setIsLocked(false);
  }, []);

  const clearLockState = useCallback(() => {
    localStorage.removeItem(LS_USERNAME_KEY);
    localStorage.removeItem(LS_HAS_PIN_KEY);
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
