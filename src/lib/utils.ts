import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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

const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatDate(date: Date | string): string {
  return dateFormatter.format(new Date(date));
}

/** Local (not UTC) YYYY-MM-DD for a Date. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
