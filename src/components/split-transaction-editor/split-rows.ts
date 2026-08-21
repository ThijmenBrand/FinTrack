import type { SplitRuleLineInput } from "@/hooks/use-transactions";
import type { Transaction } from "@/types/api";

/** One editable split row — amount kept as a raw (nonnegative) magnitude string. */
export interface SplitRow {
  key: string;
  amount: string;
  categoryId: string | null;
  description: string;
}

let rowSeq = 0;
export const newSplitRow = (amount: string, categoryId: string | null = null): SplitRow => ({
  key: `r${++rowSeq}`,
  amount,
  categoryId,
  description: "",
});

/** Cents from a raw magnitude string, always ≥ 0; unparseable input is 0. */
export const splitCents = (raw: string) => Math.round((parseFloat(raw) || 0) * 100);

/**
 * Set one row's amount and let the last *other* row absorb the difference, so
 * the parts keep adding up to the total. With the usual two rows that just
 * means "type one side, the other follows".
 */
export function rebalanceRows(
  rows: SplitRow[],
  key: string,
  amount: string,
  totalCents: number,
): SplitRow[] {
  const absorber = rows.filter((r) => r.key !== key).at(-1)?.key;
  const next = rows.map((r) => (r.key === key ? { ...r, amount } : r));
  if (!absorber) return next;
  const others = next.reduce(
    (sum, r) => (r.key === absorber ? sum : sum + splitCents(r.amount)),
    0,
  );
  return next.map((r) =>
    r.key === absorber
      ? { ...r, amount: (Math.max(0, totalCents - others) / 100).toFixed(2) }
      : r,
  );
}

/** Existing split children as editor rows, in the order the API returned them. */
export function rowsFromSplits(splits: Transaction[]): SplitRow[] {
  return splits.map((s) => ({
    key: `r${++rowSeq}`,
    amount: Math.abs(s.amount).toFixed(2),
    categoryId: s.categoryId,
    description: s.description ?? "",
  }));
}

/**
 * The smallest share a percentage line may carry. The server rejects a line at
 * 0% outright, so a part too small to round to a hundredth of a percent (a
 * couple of cents out of a five-figure amount) would otherwise fail the whole
 * rule with a generic "invalid lines". Floored instead: with at most 20 lines
 * this shifts the total by 0.19% at the very worst, which the last line absorbs.
 */
const MIN_PERCENT = 0.01;

/**
 * Turn edited rows into a split rule's lines. Percentage mode rounds each
 * share to two decimals and lets the last line absorb the rounding leftover
 * so the set sums to exactly 100, mirroring the server's own rounding rule.
 * Fixed mode keeps every row's amount except the last, which becomes the
 * remainder line.
 */
export function buildRuleLines(
  rows: SplitRow[],
  mode: "percentage" | "fixed",
  totalCents: number,
): SplitRuleLineInput[] {
  if (mode === "fixed") {
    return rows.map((r, i) => ({
      categoryId: r.categoryId!,
      sortOrder: i,
      isRemainder: i === rows.length - 1,
      amount: i === rows.length - 1 ? undefined : splitCents(r.amount) / 100,
    }));
  }
  let used = 0;
  return rows.map((r, i) => {
    if (i === rows.length - 1) {
      return {
        categoryId: r.categoryId!,
        sortOrder: i,
        percentage: Math.round((100 - used) * 100) / 100,
      };
    }
    const share = totalCents > 0 ? (splitCents(r.amount) / totalCents) * 100 : 0;
    const pct = Math.max(MIN_PERCENT, Math.round(share * 100) / 100);
    used += pct;
    return { categoryId: r.categoryId!, sortOrder: i, percentage: pct };
  });
}
