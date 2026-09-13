"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 70;
const RESISTANCE = 0.5;

/**
 * Pull down at the top of the page to refetch everything on screen. The app's
 * scroll lives in <main>, not the document, so the browser's own
 * pull-to-refresh never fires — in a standalone PWA there is no reload at all.
 * Touch only; nothing here binds on desktop.
 */
export function PullToRefresh() {
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const scroller = document.querySelector("main");
    if (!scroller) return;

    let startY: number | null = null;
    let startX = 0;
    let pulled = 0;
    let busy = false;

    // Drag the page down with the finger, so the indicator appears in the gap
    // it opens instead of floating on top of the header.
    const offset = (px: number, animate: boolean) => {
      scroller.style.transition = animate ? "transform 200ms" : "";
      scroller.style.transform = px ? `translateY(${px}px)` : "";
    };

    const onStart = (e: TouchEvent) => {
      startY =
        !busy && scroller.scrollTop <= 0 && e.touches.length === 1
          ? e.touches[0].clientY
          : null;
      startX = e.touches[0]?.clientX ?? 0;
      pulled = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const delta = e.touches[0].clientY - startY;
      // A sideways swipe belongs to whatever it started on — a carousel, a
      // scrolling table, the drawer edge. Only claim a clearly vertical drag.
      if (Math.abs(e.touches[0].clientX - startX) > Math.abs(delta)) {
        startY = null;
        pulled = 0;
        setPull(0);
        offset(0, false);
        return;
      }
      if (delta <= 0) {
        // Scrolling down again — hand the gesture back to the container.
        startY = null;
        pulled = 0;
        setPull(0);
        offset(0, false);
        return;
      }
      e.preventDefault(); // otherwise iOS rubber-bands <main> under the indicator
      pulled = Math.min(delta * RESISTANCE, THRESHOLD * 1.5);
      setPull(pulled);
      offset(pulled, false);
    };

    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      if (pulled < THRESHOLD) {
        setPull(0);
        offset(0, true);
        return;
      }
      busy = true;
      setPull(THRESHOLD);
      setRefreshing(true);
      offset(THRESHOLD, true);
      // ponytail: refetch whatever this page currently renders, rather than a
      // hand-maintained key list that drifts every time a hook is added.
      qc.refetchQueries({ type: "active" }).finally(() => {
        busy = false;
        setRefreshing(false);
        setPull(0);
        offset(0, true);
      });
    };

    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: false });
    scroller.addEventListener("touchend", onEnd);
    scroller.addEventListener("touchcancel", onEnd);
    return () => {
      offset(0, false);
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", onEnd);
    };
  }, [qc]);

  if (pull === 0 && !refreshing) return null;

  // Portalled: the indicator is fixed to the viewport, so it must not sit in
  // the caller's flow (a `space-y-*` parent would otherwise shift it).
  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 -top-12 z-50 flex justify-center pt-[env(safe-area-inset-top)]",
        // No transition mid-drag: the indicator must track the finger.
        refreshing && "transition-all duration-200",
      )}
      style={{
        transform: `translateY(${pull}px)`,
        opacity: Math.min(pull / THRESHOLD, 1),
      }}
    >
      <div className="mt-2 rounded-full bg-background p-2 shadow-md">
        <RefreshCw
          className={cn(
            "h-5 w-5 text-muted-foreground",
            refreshing && "animate-spin",
          )}
          style={
            refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }
          }
        />
      </div>
    </div>,
    document.body,
  );
}
