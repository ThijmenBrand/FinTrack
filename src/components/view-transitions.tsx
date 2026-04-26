"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

function isInternalNavigationClick(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  if (anchor.dataset.noViewTransition === "true") return false;

  const href = anchor.getAttribute("href");
  if (!href) return false;
  if (href.startsWith("#")) return false;

  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;

  const samePathAndQuery =
    url.pathname === window.location.pathname &&
    url.search === window.location.search;
  if (samePathAndQuery) return false;

  return true;
}

// Cap how long the transition waits for the new page to commit. Without it,
// a slow RSC fetch would hold the old-page snapshot on screen.
const PENDING_NAV_TIMEOUT_MS = 400;

type Pending = {
  resolve: () => void;
  timeout: number;
};

export function ViewTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  const pendingRef = useRef<Pending | null>(null);

  function settlePending() {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    window.clearTimeout(pending.timeout);
    pending.resolve();
  }

  useEffect(() => {
    if (!pendingRef.current) return;
    const pending = pendingRef.current;
    pendingRef.current = null;
    requestAnimationFrame(() => {
      window.clearTimeout(pending.timeout);
      pending.resolve();
    });
  }, [pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (typeof document.startViewTransition !== "function") return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      if (!isInternalNavigationClick(event, anchor)) return;

      const url = new URL(anchor.href, window.location.href);
      const destination = `${url.pathname}${url.search}${url.hash}`;

      event.preventDefault();
      settlePending();
      document.startViewTransition!(
        () =>
          new Promise<void>((resolve) => {
            const timeout = window.setTimeout(() => {
              if (pendingRef.current?.resolve === resolve) {
                pendingRef.current = null;
              }
              resolve();
            }, PENDING_NAV_TIMEOUT_MS);
            pendingRef.current = { resolve, timeout };
            router.push(destination);
          }),
      );
    }

    // Capture phase so we run before Next.js Link's onClick (which calls
    // preventDefault); a bubble-phase listener would always see
    // event.defaultPrevented === true and skip the transition.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
