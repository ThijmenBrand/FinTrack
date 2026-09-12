"use client";

import { useState } from "react";

// Nothing can equal this, so the first render always applies once — matching
// the mount run of the effects this replaces.
const FIRST_RENDER = Symbol("first-render");

/**
 * Calls `apply` during render whenever `key` changes, including on mount. Use
 * it to re-seed local state from props instead of doing it in an effect, which
 * renders once with stale values first.
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 */
export function useResetOnChange(key: unknown, apply: () => void) {
  const [lastKey, setLastKey] = useState<unknown>(FIRST_RENDER);
  if (!Object.is(key, lastKey)) {
    setLastKey(key);
    apply();
  }
}
