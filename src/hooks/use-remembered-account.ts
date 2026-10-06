"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  parseRememberedAccount,
  readRememberedAccountRaw,
  subscribeRememberedAccount,
} from "@/lib/remembered-account";

/** The account last signed in on this device; null on the server and during
 *  hydration, so gate markup that depends on it behind `useIsHydrated`. */
export function useRememberedAccount() {
  // The raw string is the snapshot — a stable primitive, unlike a fresh object.
  const raw = useSyncExternalStore(
    subscribeRememberedAccount,
    readRememberedAccountRaw,
    () => null,
  );
  return useMemo(() => parseRememberedAccount(raw), [raw]);
}
