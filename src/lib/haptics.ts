"use client";

/**
 * Short vibrations that stand in for the taps a native app gives you: the
 * confirmation that a gesture landed, that a destructive action is armed, that
 * a save went through. The Vibration API is Android/Chrome only — iOS Safari
 * ignores it — so every call is best-effort and nothing may depend on it.
 *
 * Patterns are deliberately tiny. Anything longer than ~30ms stops reading as
 * feedback and starts reading as an alarm.
 */

type Pattern = number | number[];

/** `vibrate` throws in a cross-origin iframe and is absent on desktop Safari. */
function buzz(pattern: Pattern) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  // A user who asked for less motion did not ask for a silent phone, but the
  // two preferences travel together often enough to honour it here.
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    // Blocked by permissions policy — nothing to recover.
  }
}

export const haptics = {
  /** A control was pressed: tab bar, segmented control, sheet row. */
  tap: () => buzz(8),
  /** A selection changed: a row entered multi-select, a filter toggled. */
  select: () => buzz(12),
  /** A gesture reached its commit point: pull-to-refresh, swipe threshold. */
  impact: () => buzz(16),
  /** Something was saved or completed. */
  success: () => buzz([12, 40, 12]),
  /** A destructive action is now armed, or a confirmation is required. */
  warn: () => buzz([16, 60, 16]),
  /** Something failed. Distinctly heavier than success, so it reads as "stop". */
  error: () => buzz([24, 60, 24, 60, 24]),
};
