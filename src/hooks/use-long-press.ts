"use client";

import { useRef } from "react";

/** How far a finger may drift before the hold counts as a scroll instead. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Press-and-hold for touch rows, the way native lists enter selection mode.
 * Mouse presses are ignored — desktop keeps its right-click menu. Spread
 * `handlers` on the row; in its onClick, bail out when `consumeLongPress()` is
 * true, since lifting the finger after a hold still fires a click.
 */
export function useLongPress(onLongPress: () => void, delayMs = 450) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const lastPointerWasTouch = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    origin.current = null;
  };

  return {
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        lastPointerWasTouch.current = e.pointerType !== "mouse";
        fired.current = false;
        if (!lastPointerWasTouch.current || !e.isPrimary) return;
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          fired.current = true;
          origin.current = null;
          navigator.vibrate?.(10);
          onLongPress();
        }, delayMs);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const start = origin.current;
        if (
          start &&
          Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX
        ) {
          cancel();
        }
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
    /** True once per completed hold — the click that ends it is swallowed. */
    consumeLongPress: () => {
      const wasLongPress = fired.current;
      fired.current = false;
      return wasLongPress;
    },
    /** Android fires contextmenu on a hold too; only a mouse should open it. */
    lastPointerWasTouch: () => lastPointerWasTouch.current,
  };
}
