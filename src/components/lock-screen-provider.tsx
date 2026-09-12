"use client";

/**
 * PWA Lock Screen Provider
 *
 * IMPORTANT: This lock screen is purely a client-side UX convenience feature,
 * similar to a phone lock screen on top of an already-authenticated session.
 * It is NOT a security boundary.
 *
 * The lock state is derived from localStorage timestamps — the underlying
 * session cookie remains valid while the lock screen is displayed. This means
 * the lock can be bypassed by manipulating client-side state (e.g. DevTools,
 * disabling JS, or calling API endpoints directly).
 *
 * The /api/auth/pin/unlock endpoint verifies the PIN server-side, but the
 * unlock() function here simply refreshes the activity timestamp without
 * requiring proof that the server validated the PIN. Any code path that calls
 * unlock() will dismiss the lock screen.
 *
 * If this ever needs to become a true security control, the server must enforce
 * it — e.g. by issuing a short-lived unlock token that middleware checks on
 * every request.
 */

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useSyncExternalStore,
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

// The lock lives in localStorage rather than React state so a reload or a long
// stint in the background comes back locked. It is sampled on a coarse interval
// and whenever the tab becomes visible (timers are throttled or frozen while
// backgrounded, so the visibility check is what catches a long stint there).
// ponytail: one provider means one subscriber; make `notify` a Set if that changes.
let notify = () => {};

function subscribeToIdle(onChange: () => void) {
  notify = onChange;
  const interval = setInterval(onChange, IDLE_CHECK_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") onChange();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    notify = () => {};
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** The user to lock out, or "" while the session should stay unlocked. One
 *  string keeps this to a single store, and so to a single subscriber. */
function readLockedUser() {
  const user = localStorage.getItem(LS_USERNAME_KEY);
  if (!user || localStorage.getItem(LS_HAS_PIN_KEY) !== "true") return "";
  const lastActive = Number(localStorage.getItem(LS_LAST_ACTIVE_KEY));
  if (!lastActive || Date.now() - lastActive < IDLE_TIMEOUT_MS) return "";
  return user;
}

export function LockScreenProvider({ children }: { children: ReactNode }) {
  const username = useSyncExternalStore(subscribeToIdle, readLockedUser, () => "");
  const isLocked = username !== "";
  const { data: pinStatus } = useHasPin();

  // Cache hasPin into localStorage whenever it changes
  useEffect(() => {
    if (pinStatus) {
      localStorage.setItem(LS_HAS_PIN_KEY, JSON.stringify(pinStatus.hasPin));
    }
  }, [pinStatus]);

  // No notify() here: touch runs on every pointerdown and keydown, and while
  // unlocked a fresher timestamp can't change what the store reads.
  const touch = useCallback(() => {
    localStorage.setItem(LS_LAST_ACTIVE_KEY, String(Date.now()));
  }, []);

  // Start the clock on a fresh login, so a session nobody ever touches still
  // locks five minutes after it was opened.
  useEffect(() => {
    if (!localStorage.getItem(LS_LAST_ACTIVE_KEY)) touch();
  }, [touch]);

  // Record activity while unlocked. ponytail: pointer + key only; add scroll/
  // wheel if someone reports locking mid-read on a long page.
  useEffect(() => {
    if (isLocked) return;

    const events = ["pointerdown", "keydown"] as const;
    events.forEach((e) => document.addEventListener(e, touch, { passive: true }));
    return () =>
      events.forEach((e) => document.removeEventListener(e, touch));
  }, [isLocked, touch]);

  // Both of these unlock by rewriting what the store reads.
  const unlock = useCallback(() => {
    touch();
    notify();
  }, [touch]);

  const clearLockState = useCallback(() => {
    localStorage.removeItem(LS_USERNAME_KEY);
    localStorage.removeItem(LS_HAS_PIN_KEY);
    localStorage.removeItem(LS_LAST_ACTIVE_KEY);
    notify();
  }, []);

  return (
    <LockScreenContext.Provider
      value={{ isLocked, username, unlock, clearLockState }}
    >
      {children}
    </LockScreenContext.Provider>
  );
}
