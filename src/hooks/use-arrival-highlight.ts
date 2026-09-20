"use client";

import { useCallback, useState } from "react";
import { useResetOnChange } from "@/hooks/use-reset-on-change";

/** Long enough to catch the eye once the scroll settles, short enough that the
 *  page stops shouting as soon as you've found the thing. */
const HIGHLIGHT_MS = 2800;
/** Cards above the target (uncategorized rows, split rules) finish loading
 *  after the first paint and can push it out of view; one late check puts it
 *  back, still close enough to the arrival to read as part of it. */
const SETTLE_MS = 500;

function scrollTo(node: HTMLElement) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  node.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}

/**
 * Landing from a deep link: attach `ref` to the element the link points at and
 * it scrolls itself into view, then wears `active` for a couple of seconds so
 * the eye can find it in a long list before the glow fades.
 *
 * `key` is the target's id — null when this element isn't the target. A new id
 * re-arms both, so a second link landing on a different element glows and
 * scrolls again without needing a remount.
 */
export function useArrivalHighlight(
  key: string | null,
  options?: { scroll?: boolean }
) {
  const scroll = options?.scroll ?? true;
  const [active, setActive] = useState(key !== null);
  useResetOnChange(key, () => setActive(key !== null));

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node || key === null) return;

      let frame: number | undefined;
      let settle: number | undefined;
      if (scroll) {
        // After the frame, not during it: the router scrolls a new page back to
        // the top in a layout effect, which runs after this ref is attached and
        // would undo the scroll below.
        frame = requestAnimationFrame(() => {
          scrollTo(node);
          settle = window.setTimeout(() => {
            const { top, bottom } = node.getBoundingClientRect();
            // Only when it has been pushed clean out of sight — anything less
            // and we'd be fighting a reader who started scrolling themselves.
            if (bottom < 0 || top > window.innerHeight) scrollTo(node);
          }, SETTLE_MS);
        });
      }
      const fade = window.setTimeout(() => setActive(false), HIGHLIGHT_MS);

      return () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        clearTimeout(settle);
        clearTimeout(fade);
      };
    },
    [key, scroll]
  );

  return { ref, active };
}
