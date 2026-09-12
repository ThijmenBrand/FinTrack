"use client";

import { useCallback, useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/** False on the server and during hydration, true from the first client
 *  render onwards. For markup that can only be decided in the browser. */
export function useIsHydrated() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/** Live `matchMedia` result; false on the server and during hydration. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
