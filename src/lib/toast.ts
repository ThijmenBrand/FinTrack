"use client";

import { haptics } from "@/lib/haptics";

/**
 * The app-wide "what just happened" channel.
 *
 * Deliberately a plain module store rather than React context: more than half
 * the things worth announcing happen outside a component — a mutation that
 * fails in `QueryClient`'s cache, a background sync, a service-worker update.
 * Those need to reach the screen without a hook, so the store lives here and
 * `<Toaster>` only subscribes to it.
 */

export type ToastVariant = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  variant: ToastVariant;
  /** One line. The thing that happened, in the user's words. */
  title: string;
  /** Optional second line: why, or what to do about it. */
  description?: string;
  /** A way out of the problem — "Try again", "Undo". */
  action?: ToastAction;
  /** Milliseconds on screen. `null` keeps it until dismissed. */
  duration: number | null;
}

type Listener = (toasts: Toast[]) => void;

/** Older toasts are dropped rather than stacked into a wall. */
const MAX_VISIBLE = 3;

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 4000,
  info: 5000,
  // Failures need long enough to read and to reach the retry button.
  error: 8000,
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts() {
  return toasts;
}

export function dismissToast(id: number) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

interface ToastOptions {
  description?: string;
  action?: ToastAction;
  duration?: number | null;
  /**
   * Collapses repeats: a second toast with the same key replaces the first
   * instead of queueing behind it. Bulk actions that fail per row would
   * otherwise bury the screen in identical messages.
   */
  key?: string;
}

const keyedIds = new Map<string, number>();

function push(variant: ToastVariant, title: string, options: ToastOptions = {}) {
  const { key, description, action } = options;
  if (key) {
    const existing = keyedIds.get(key);
    if (existing != null) toasts = toasts.filter((t) => t.id !== existing);
  }

  const toast: Toast = {
    id: nextId++,
    variant,
    title,
    description,
    action,
    duration: options.duration === undefined ? DEFAULT_DURATION[variant] : options.duration,
  };
  if (key) keyedIds.set(key, toast.id);

  toasts = [...toasts, toast].slice(-MAX_VISIBLE);
  emit();

  if (variant === "error") haptics.error();
  else if (variant === "success") haptics.success();

  return toast.id;
}

export const toast = {
  success: (title: string, options?: ToastOptions) => push("success", title, options),
  error: (title: string, options?: ToastOptions) => push("error", title, options),
  info: (title: string, options?: ToastOptions) => push("info", title, options),
  dismiss: dismissToast,
};
