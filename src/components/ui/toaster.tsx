"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { useIsHydrated } from "@/hooks/use-browser";
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  type Toast,
  type ToastVariant,
} from "@/lib/toast";

/** How long the exit animation runs before the toast leaves the store. */
const EXIT_MS = 180;
/** Downward drag, in px, that counts as "swipe it away". */
const SWIPE_DISMISS_PX = 56;

const ICONS: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const TONE: Record<ToastVariant, string> = {
  success:
    "border-emerald-500/30 bg-emerald-50 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-950/85 dark:text-emerald-50",
  error:
    "border-destructive/35 bg-red-50 text-red-950 dark:border-destructive/45 dark:bg-red-950/85 dark:text-red-50",
  info: "border-border bg-card text-card-foreground",
};

const ICON_TONE: Record<ToastVariant, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
  info: "text-muted-foreground",
};

const serverSnapshot: Toast[] = [];

function ToastCard({ toast }: { toast: Toast }) {
  const { t } = useI18n();
  const [leaving, setLeaving] = useState(false);
  // Drag offset while a finger is on the card; null when it is not being dragged.
  const [drag, setDrag] = useState<number | null>(null);
  const paused = useRef(false);
  const startY = useRef(0);

  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(() => dismissToast(toast.id), EXIT_MS);
  }, [toast.id]);

  // Auto-dismiss. Hovering, focusing or dragging the card holds it open —
  // a message you are reading should not vanish mid-sentence.
  useEffect(() => {
    if (toast.duration == null) return;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        if (paused.current) {
          arm();
          return;
        }
        close();
      }, toast.duration ?? 0);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [toast.duration, close]);

  const Icon = ICONS[toast.variant];

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocusCapture={() => (paused.current = true)}
      onBlurCapture={() => (paused.current = false)}
      onTouchStart={(e) => {
        paused.current = true;
        startY.current = e.touches[0].clientY;
        setDrag(0);
      }}
      onTouchMove={(e) => {
        // Downward only: an upward drag belongs to the page behind the toast.
        const delta = Math.max(0, e.touches[0].clientY - startY.current);
        setDrag(delta);
      }}
      onTouchEnd={() => {
        paused.current = false;
        if ((drag ?? 0) >= SWIPE_DISMISS_PX) close();
        setDrag(null);
      }}
      onTouchCancel={() => {
        paused.current = false;
        setDrag(null);
      }}
      style={
        drag
          ? { transform: `translateY(${drag}px)`, opacity: Math.max(0, 1 - drag / 160) }
          : undefined
      }
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-3.5 py-3 shadow-lg backdrop-blur-sm",
        TONE[toast.variant],
        drag === null && "transition-[transform,opacity] duration-200",
        leaving
          ? "animate-out fade-out-0 slide-out-to-bottom-2 duration-150"
          : "animate-in fade-in-0 slide-in-from-bottom-3 duration-200",
      )}
    >
      <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", ICON_TONE[toast.variant])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs leading-snug opacity-80">{toast.description}</p>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              close();
            }}
            className="mt-2 rounded-md text-xs font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={t("common.close")}
        className="-mr-1 -mt-1 shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The one place the app says "that worked" or "that didn't". Mounted once, in
 * the app layout; everything else talks to it through `toast` in
 * `@/lib/toast`.
 *
 * Portalled to <body> so it escapes `<main>`'s scroll container, and lifted
 * clear of the mobile tab bar and the home indicator.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => serverSnapshot);
  const hydrated = useIsHydrated();
  if (!hydrated) return null;

  return createPortal(
    <div
      // `aria-live` on the region, not the cards: the cards mount into it, so
      // a screen reader announces each one as it arrives.
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:items-end md:px-6 md:pb-6"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} toast={item} />
      ))}
    </div>,
    document.body,
  );
}
