// Interprets what someone types into the transaction search box. A bare number
// matches an exact amount, `~number` a rough one, a date matches that day. Text
// matching stays on top of it, so "search across everything" holds.

export interface ParsedSearch {
  /** Description/name LIKE term, or null when the input is only meaningful as an amount. */
  text: string | null;
  /** Inclusive bounds on ABS(amount). */
  amount?: { min: number; max: number };
  /** ISO date (YYYY-MM-DD). */
  date?: string;
}

// ponytail: 10% either side. Bump/expose if "~" turns out too tight in practice.
const ROUGH_TOLERANCE = 0.1;

function parseNumber(s: string): number | null {
  // Strip currency and thousands separators; accept both , and . as decimal.
  const cleaned = s.replace(/[€$\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Shared by the free-text search and the `period:` filter, so "28-07-2026"
// means the same day wherever it is typed. Day-first on purpose: the UI is
// Dutch/European, and an ISO string is unambiguous anyway.
export function parseDayInput(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return validDay(iso[1], iso[2], iso[3]);
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) return validDay(dmy[3], dmy[2], dmy[1]);
  return null;
}

// Rejects the impossible (2026-13-40, 30 February) so a typo falls back to a
// plain text search instead of filtering to a day that never existed.
function validDay(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1) return null;
  // Day 0 of the next month is the last day of this one.
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseSearchTerm(raw: string): ParsedSearch {
  const s = raw.trim();
  if (s.startsWith("~")) {
    const n = parseNumber(s.slice(1));
    if (n === null) return { text: s };
    const abs = Math.abs(n);
    const pad = abs * ROUGH_TOLERANCE;
    return { text: null, amount: { min: abs - pad, max: abs + pad } };
  }

  const date = parseDayInput(s);
  if (date) return { text: s, date };

  const n = parseNumber(s);
  if (n !== null) {
    const abs = Math.abs(n);
    return { text: s, amount: { min: abs - 0.005, max: abs + 0.005 } };
  }

  return { text: s };
}
