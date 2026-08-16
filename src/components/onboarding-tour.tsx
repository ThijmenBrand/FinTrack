"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

/** Set by the invite flow; the tour shows once, then clears it. */
export const TOUR_PENDING_KEY = "onboarding_tour_pending";

interface TourStep {
  href: string;
  /** `data-tour` value of the control to spotlight. Omitted = centered card. */
  anchor?: string;
  titleKey: MessageKey;
  bodyKey: MessageKey;
}

/** The real setup order: account → transactions → categories → budget → insights. */
const STEPS: TourStep[] = [
  { href: "/", titleKey: "tour.welcome.title", bodyKey: "tour.welcome.body" },
  {
    href: "/accounts",
    anchor: "account-add",
    titleKey: "tour.account.title",
    bodyKey: "tour.account.body",
  },
  {
    href: "/transactions",
    anchor: "import-csv",
    titleKey: "tour.import.title",
    bodyKey: "tour.import.body",
  },
  {
    href: "/settings/categories",
    anchor: "category-new",
    titleKey: "tour.category.title",
    bodyKey: "tour.category.body",
  },
  {
    href: "/transactions",
    anchor: "tx-category",
    titleKey: "tour.categorize.title",
    bodyKey: "tour.categorize.body",
  },
  {
    href: "/budgets",
    anchor: "budget-add",
    titleKey: "tour.budget.title",
    bodyKey: "tour.budget.body",
  },
  { href: "/insights", titleKey: "tour.insights.title", bodyKey: "tour.insights.body" },
];

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const GAP = 14;
const CARD_W = 340;
/** Rough card height; only used to decide below-vs-above. */
const CARD_H = 260;

/**
 * Card sits under the spotlight when there's room, above it otherwise, and
 * dead centre when there's nothing to point at. Always clamped into view.
 */
export function placeCard(spot: Box | null, vw: number, vh: number): React.CSSProperties {
  const width = Math.min(CARD_W, vw - 24);
  if (!spot) return { width, left: (vw - width) / 2, top: Math.max(24, vh / 2 - 140) };
  const left = Math.min(
    Math.max(12, spot.left + spot.width / 2 - width / 2),
    Math.max(12, vw - width - 12)
  );
  const below = spot.top + spot.height + GAP + CARD_H < vh;
  return below
    ? { width, left, top: spot.top + spot.height + GAP }
    : { width, left, bottom: Math.max(12, vh - spot.top + GAP) };
}

/** First anchor that is actually rendered — sidebar and bottom nav share names. */
function findAnchor(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

export function OnboardingTour() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    if (!localStorage.getItem(TOUR_PENDING_KEY)) return;
    // Let the dashboard paint first, so the tour opens over a real page.
    const id = setTimeout(() => {
      // Clear on show, not on dismiss — a mid-tour reload or closed tab must
      // not bring the modal back at step 1 on every subsequent load.
      localStorage.removeItem(TOUR_PENDING_KEY);
      setOpen(true);
    }, 400);
    return () => clearTimeout(id);
  }, []);

  const step = STEPS[idx];
  const anchor = open ? step.anchor : undefined;

  useEffect(() => {
    if (!anchor) return;
    // ponytail: one poll covers late mounts, scrolling, resizing and route
    // transitions — cheaper to reason about than three observers.
    const id = setInterval(() => {
      const el = findAnchor(anchor);
      if (!el) {
        setBox(null);
        return;
      }
      if (!scrolled.current) {
        scrolled.current = true;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      const r = el.getBoundingClientRect();
      const next = { top: r.top, left: r.left, width: r.width, height: r.height };
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    }, 150);
    return () => clearInterval(id);
  }, [anchor, pathname]);

  if (!open || typeof document === "undefined") return null;

  const last = idx === STEPS.length - 1;
  // `go()` clears the box on every step change, so this only guards the
  // anchor-less steps from inheriting a stale rect.
  const spot = anchor ? box : null;

  const dismiss = () => {
    setOpen(false);
    router.push("/");
  };

  const go = (to: number) => {
    if (to >= STEPS.length) {
      dismiss();
      return;
    }
    scrolled.current = false;
    setBox(null);
    setIdx(to);
    if (STEPS[to].href !== pathname) router.push(STEPS[to].href);
  };

  const cardStyle = placeCard(spot, window.innerWidth, window.innerHeight);

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      {spot ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: spot.top - PAD,
            left: spot.left - PAD,
            width: spot.width + PAD * 2,
            height: spot.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        className="absolute rounded-xl border bg-background p-5 shadow-2xl"
        style={cardStyle}
      >
        <p className="text-xs font-medium text-muted-foreground">
          {t("tour.stepOf", { current: idx + 1, total: STEPS.length })}
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-tight">{t(step.titleKey)}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{t(step.bodyKey)}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {t("tour.skip")}
          </button>
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <button
                type="button"
                onClick={() => go(idx - 1)}
                className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                {t("common.back")}
              </button>
            )}
            <button
              type="button"
              onClick={() => go(idx + 1)}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              {last ? t("common.done") : t("common.next")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
