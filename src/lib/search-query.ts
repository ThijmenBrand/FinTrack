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

function parseDate(s: string): string | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
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

  const date = parseDate(s);
  if (date) return { text: s, date };

  const n = parseNumber(s);
  if (n !== null) {
    const abs = Math.abs(n);
    return { text: s, amount: { min: abs - 0.005, max: abs + 0.005 } };
  }

  return { text: s };
}
