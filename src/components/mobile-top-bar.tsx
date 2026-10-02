"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** The app scrolls inside <main>, not the document. */
export function scrollMainToTop() {
  document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * Mobile navigation bar, iOS style: invisible while the page's own large
 * title is on screen, then a blurred bar with that title in compact form once
 * it scrolls away. Tapping it scrolls back to the top, like tapping the status
 * bar in a native app. The title is read off the page's first <h1>, so pages
 * don't have to register anything.
 */
export function MobileTopBar() {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const heading = main.querySelector("h1");
      setTitle(heading?.textContent?.trim() ?? "");
      const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 0;
      // At rest a large title can already sit partly under the (still
      // transparent) bar; it only moves into the bar once the page scrolls.
      setCondensed(
        main.scrollTop > 0 &&
          (heading ? heading.getBoundingClientRect().bottom <= barBottom : main.scrollTop > 24),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    main.addEventListener("scroll", schedule, { passive: true });
    // Pages stream in behind Suspense, so the <h1> can land after this runs.
    const observer = new MutationObserver(schedule);
    observer.observe(main, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      main.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [pathname]);

  return (
    <div
      ref={barRef}
      aria-hidden={!condensed}
      onClick={condensed ? scrollMainToTop : undefined}
      className={cn(
        "app-chrome fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] transition-[background-color,border-color,backdrop-filter] duration-200 md:hidden",
        condensed
          ? "border-b border-border/60 bg-background/90 backdrop-blur-xl backdrop-saturate-150"
          : "pointer-events-none border-b border-transparent",
      )}
      style={{ viewTransitionName: "app-top-bar" }}
    >
      <div className="flex h-11 items-center justify-center px-16">
        <span
          className={cn(
            "truncate text-[17px] font-semibold tracking-tight transition-all duration-200",
            condensed ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          )}
        >
          {title}
        </span>
      </div>
    </div>
  );
}
