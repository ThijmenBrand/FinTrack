import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * True when a className pins an element's height (`h-7`, `size-8`). The UI
 * primitives grow to phone-sized touch targets below md, but only when the
 * caller left the height alone — a control sized by hand for a dense row keeps
 * that size.
 */
export function setsHeight(className: string | undefined): boolean {
  return /(?:^|\s)(?:h|size)-/.test(className ?? "");
}

const PADDING_SIDE = {
  x: /(?:^|\s)(?:p|px|pl|pr|ps|pe)-/,
  t: /(?:^|\s)(?:p|py|pt)-/,
  b: /(?:^|\s)(?:p|py|pb)-/,
} as const;

/**
 * True when a className sets padding on that side (`px-2`, `pb-3`, `p-0`).
 * Cards tighten to phone padding below md only on the sides the caller left
 * alone, the same way `setsHeight` guards the touch-sized controls.
 */
export function setsPadding(className: string | undefined, side: keyof typeof PADDING_SIDE): boolean {
  return PADDING_SIDE[side].test(className ?? "");
}

const eurFormatter = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

/**
 * Format a currency amount using the nl-NL locale (e.g. "€ 1.234,56").
 * `currency` and `fractionDigits` are only needed by the couple of call
 * sites that render a non-EUR account balance or a rounded axis label —
 * everyone else can call this with just the amount.
 */
export function formatCurrency(
  amount: number,
  currency = "EUR",
  fractionDigits?: number
): string {
  if (currency === "EUR" && fractionDigits === undefined) {
    return eurFormatter.format(amount);
  }
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    ...(fractionDigits !== undefined && {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }),
  }).format(amount);
}

/** Local (not UTC) YYYY-MM-DD for a Date. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
