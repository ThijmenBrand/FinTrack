import { createHash } from "node:crypto";
import type { NormalizedRow } from "@/lib/import/classify";
import { normalizeIban } from "@/lib/csv-utils";
import type { EbBalance, EbTransaction } from "../enable-banking/validate";

/**
 * Turn provider transactions into the source-neutral rows the import pipeline
 * classifies — validating as we go, because this is bank data and therefore
 * untrusted input. A row that doesn't make sense is skipped and counted, never
 * guessed at.
 */

export interface NormalizedBankRow extends NormalizedRow {
  /** Stable per account: `ref:<entry_reference>` or `h:<content hash>:<n>`. */
  externalId: string;
}

export interface NormalizeResult {
  rows: NormalizedBankRow[];
  skipped: { pending: number; currency: number; invalid: number };
}

const MAX_AMOUNT = 1_000_000_000;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 500;

/**
 * Control characters and the bidi overrides that can make a payee name render
 * as something else ("Trojan Source"-style spoofing) — neither belongs in a
 * transaction description.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function cleanText(v: string | null | undefined, max: number): string | null {
  if (!v) return null;
  const cleaned = v.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(v: string | null): string | null {
  if (!v) return null;
  const d = v.slice(0, 10);
  if (!ISO_DATE.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d ? null : d;
}

/** Decimal string → number, refusing anything that isn't plainly a number. */
export function parseDecimal(v: string): number | null {
  const s = v.trim();
  if (!/^[+-]?\d{1,12}(\.\d{1,8})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= MAX_AMOUNT ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function normalizeTransactions(raw: EbTransaction[], accountCurrency: string): NormalizeResult {
  const skipped = { pending: 0, currency: 0, invalid: 0 };
  const rows: Array<Omit<NormalizedBankRow, "externalId"> & { ref: string | null }> = [];

  for (const t of raw) {
    if (t.status && t.status !== "BOOK") {
      skipped.pending++;
      continue;
    }
    if (t.currency.toUpperCase() !== accountCurrency.toUpperCase()) {
      skipped.currency++;
      continue;
    }
    const parsed = parseDecimal(t.amount);
    const date = isoDate(t.bookingDate) ?? isoDate(t.valueDate) ?? isoDate(t.transactionDate);
    if (parsed === null || parsed === 0 || !date) {
      skipped.invalid++;
      continue;
    }
    // The indicator is authoritative; amounts are usually sent unsigned.
    const amount = round2(
      t.creditDebit === "DBIT" ? -Math.abs(parsed) : t.creditDebit === "CRDT" ? Math.abs(parsed) : parsed,
    );
    const outgoing = amount < 0;
    const name = cleanText(outgoing ? t.creditorName : t.debtorName, MAX_NAME);
    const counterpartyIban = normalizeIban(outgoing ? t.creditorIban : t.debtorIban) || null;
    const description =
      cleanText(t.remittance.join(" "), MAX_DESCRIPTION) ?? name ?? "Unknown transaction";

    let balance: number | null = null;
    if (t.balanceAfter && (!t.balanceAfter.currency || t.balanceAfter.currency === t.currency)) {
      const b = parseDecimal(t.balanceAfter.amount);
      balance = b === null ? null : round2(b);
    }

    rows.push({
      date,
      name,
      description,
      amount,
      balance,
      counterpartyIban,
      ref: cleanText(t.entryReference, 200),
    });
  }

  // Rows without the bank's own reference get a content hash. Identical rows
  // on one day (two coffees) are told apart by their position among the
  // identical ones — stable because a sync always re-reads whole days.
  const seen = new Map<string, number>();
  const withIds = rows.map(({ ref, ...row }) => {
    if (ref) return { ...row, externalId: `ref:${ref}` };
    const key = createHash("sha256")
      .update([row.date, row.amount.toFixed(2), row.counterpartyIban ?? "", row.name ?? "", row.description].join("\u0001"))
      .digest("base64url")
      .slice(0, 32);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { ...row, externalId: `h:${key}:${n}` };
  });

  return { rows: withIds, skipped };
}

/**
 * The balance to compare FinTrack's against: booked/closing booked first,
 * then whatever the bank offers. Null when none is in the account's currency.
 */
export function pickBalance(balances: EbBalance[], accountCurrency: string): number | null {
  const preferred = ["CLBD", "ITBD", "XPCD", "ITAV", "CLAV", "OPBD"];
  const usable = balances.filter((b) => !b.currency || b.currency === accountCurrency);
  usable.sort((a, b) => {
    const ia = preferred.indexOf(a.type ?? "");
    const ib = preferred.indexOf(b.type ?? "");
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  for (const b of usable) {
    const n = parseDecimal(b.amount);
    if (n !== null) return round2(n);
  }
  return null;
}
