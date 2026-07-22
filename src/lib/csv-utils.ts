/**
 * Shared CSV parsing and categorization utilities.
 * Used by both the upload API and the client-side review step.
 */

export interface ColumnMapping {
  date: string;
  description: string;
  amount: string;
  name?: string;
  balance?: string;
  counterpartyIban?: string;
}

export interface PreviewTransaction {
  tempId: string;
  date: string;
  name: string | null;
  description: string;
  amount: number;
  balance: number | null;
  type: "income" | "expense" | "internal_transfer" | "reimbursement";
  categoryId: string | null;
  groupId?: string | null;
  /** Expense the row reimburses (chosen during import review); linked at commit. */
  reimbursesExpenseId?: string | null;
  reimbursesDescription?: string | null;
  notes?: string | null;
  suggestedPattern: string;
  counterpartyIban?: string;
  targetAccountId?: string;
  targetAccountName?: string;
  recurringTransactionId?: string | null;
  recurringDescription?: string | null;
}

export interface DedupRow {
  date: string;
  amount: number;
  balance: number | null;
  description: string;
}

/**
 * Split incoming import rows into unique rows and duplicates of transactions
 * already in the account. Re-importing an overlapping CSV export must not
 * double-count: match on (date, amount, bank running balance) when the bank
 * provides a balance column — this is language-independent (e.g. Revolut
 * translates descriptions between exports) — and fall back to
 * (date, amount, description) when it doesn't.
 */
export function splitDuplicates<T extends DedupRow>(
  existing: DedupRow[],
  incoming: T[]
): { unique: T[]; duplicates: T[] } {
  const balanceKey = (t: DedupRow) =>
    `${t.date}|${t.amount.toFixed(2)}|${t.balance!.toFixed(2)}`;
  const descriptionKey = (t: DedupRow) =>
    `${t.date}|${t.amount.toFixed(2)}|${t.description.trim().toLowerCase()}`;

  const byBalance = new Set(
    existing.filter((t) => t.balance != null).map(balanceKey)
  );
  const byDescription = new Set(existing.map(descriptionKey));

  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const t of incoming) {
    // Rows without a balance can legitimately repeat (two identical coffees),
    // so only the exact balance match is trusted when a balance is present.
    const isDup =
      t.balance != null
        ? byBalance.has(balanceKey(t))
        : byDescription.has(descriptionKey(t));
    (isDup ? duplicates : unique).push(t);
  }
  return { unique, duplicates };
}

/**
 * Best-effort match a CSV row against a list of recurring plans. Returns the
 * plan id whose description matches (case-insensitive substring either way)
 * and whose monthly amount is within ±10% (or ±€2, whichever is greater) of
 * the row amount, scoped to the same account and direction. Picks the closest
 * amount when multiple plans match.
 */
export function findMatchingRecurring(
  accountId: string,
  amount: number,
  description: string,
  name: string | null,
  plans: Array<{
    id: string;
    accountId: string;
    description: string;
    amount: number;
    type: string;
    isActive: boolean;
  }>
): string | null {
  const isExpense = amount < 0;
  const direction = isExpense ? "expense" : "income";
  const haystack = `${name ?? ""} ${description}`.toLowerCase();
  const tolerance = Math.max(2, Math.abs(amount) * 0.1);

  let best: { id: string; diff: number } | null = null;
  for (const plan of plans) {
    if (!plan.isActive) continue;
    if (plan.accountId !== accountId) continue;
    if (plan.type !== direction) continue;
    const planDesc = plan.description.trim().toLowerCase();
    if (!planDesc) continue;
    const descMatches =
      haystack.includes(planDesc) || planDesc.includes(haystack.trim());
    if (!descMatches) continue;
    const diff = Math.abs(Math.abs(plan.amount) - Math.abs(amount));
    if (diff > tolerance) continue;
    if (!best || diff < best.diff) {
      best = { id: plan.id, diff };
    }
  }
  return best?.id ?? null;
}

/**
 * Parse amount string, handling various formats:
 * - "1,234.56" (US)
 * - "1.234,56" (EU)
 * - "-$1,234.56" (with currency symbol)
 * - "1234.56" (plain)
 */
export function parseAmount(raw: string): number {
  // Remove currency symbols and whitespace
  let cleaned = raw.replace(/[€$£¥\s]/g, "");
  // Normalize Unicode minus signs (U+2212, en-dash, etc.) to ASCII hyphen-minus
  cleaned = cleaned.replace(/[\u2212\u2013\u2014\u2010\u2011]/g, "-");

  // Detect format: if last separator is comma and has 1-2 digits after, it's EU
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot) {
    // European format: 1.234,56 → remove dots, replace comma with dot
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // US format or plain: remove commas
    cleaned = cleaned.replace(/,/g, "");
  }

  return parseFloat(cleaned);
}

/**
 * Parse date string into ISO format (YYYY-MM-DD).
 * Handles: DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, YYYY-MM-DD, DD.MM.YYYY
 */
export function parseDate(raw: string): string | null {
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.substring(0, 10);
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (EU order first; swap to MM/DD
  // when the middle part can't be a month, e.g. "04/25/2026")
  const euMatch = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (euMatch) {
    let day = Number(euMatch[1]);
    let month = Number(euMatch[2]);
    const year = euMatch[3];
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = String(day).padStart(2, "0");
    const m = String(month).padStart(2, "0");
    return `${year}-${m}-${d}`;
  }

  // Try native Date parsing as fallback
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().substring(0, 10);
  }

  return null;
}

/**
 * Check if a description matches a categorization rule.
 */
export function matchesRule(
  description: string,
  pattern: string,
  matchType: string
): boolean {
  const desc = description.toLowerCase();
  const pat = pattern.toLowerCase();

  switch (matchType) {
    case "exact":
      return desc === pat;
    case "starts_with":
      return desc.startsWith(pat);
    case "contains":
    default:
      return desc.includes(pat);
  }
}

/**
 * Split the bank's "name" (counterparty) and "description" (memo) CSV fields
 * into the two `transactions.name` / `transactions.description` columns.
 *
 * - If both are present → keep them separate so the UI can render two lines.
 * - If only one is present → put it in `description` (keeps single-line
 *   display for old-style imports that only had one column mapped).
 * - If neither is present → returns an empty description; the caller is
 *   responsible for any last-resort fallback.
 */
export function splitNameAndDescription(
  name: string | undefined,
  description: string | undefined,
): { name: string | null; description: string } {
  const n = name?.trim() ?? "";
  const d = description?.trim() ?? "";
  if (n && d) {
    return { name: n, description: d };
  }
  return { name: null, description: n || d };
}

/**
 * Extract a sensible default pattern from a transaction description.
 * Used for suggesting rules when categorizing transactions.
 *
 * E.g. "AH Strijp 8616 >EINDHOVEN25.02.2026..." → "AH Strijp"
 * E.g. "PayPal Europe S.a.r.l..." → "PayPal Europe S.a.r.l..."
 */
export function extractPattern(description: string): string {
  // For BEA (card) transactions: get text before ">"
  const beforeArrow = description.split(">")[0]?.trim();
  if (beforeArrow && beforeArrow.length < description.length) {
    // Remove trailing numbers/spaces (store IDs)
    const cleaned = beforeArrow.replace(/\s+\d+\s*$/, "").trim();
    return cleaned || beforeArrow;
  }

  // Take first 2-3 meaningful words
  const words = description.split(/\s+/).slice(0, 3).join(" ");
  return words;
}
