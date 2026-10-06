import {
  isPaymentProcessorName,
  looksLikePlan,
  rowMatchesPlan,
  type MatchablePlan,
} from "@/lib/recurring-match";

/**
 * Spot a subscription nobody has told FinTrack about: the same merchant,
 * charging about the same amount, on a steady weekly or monthly beat. Pure —
 * the notification evaluator feeds it rows and plans.
 */

export interface DetectRow {
  accountId: string;
  /** YYYY-MM-DD */
  date: string;
  name: string | null;
  description: string;
  /** Signed; only expenses (negative) are considered. */
  amount: number;
  categoryId: string | null;
  recurringExcludedPlanId?: string | null;
}

export interface DetectedSubscription {
  /** Account + merchant key: stable across months, the notification's dedupe key. */
  key: string;
  merchant: string;
  /** Typical charge, positive. */
  amount: number;
  frequency: "weekly" | "monthly";
  accountId: string;
  categoryId: string | null;
  count: number;
  firstDate: string;
  lastDate: string;
}

export const DETECT_RULES = {
  minCharges: 3,
  /** Only the latest run of this many charges is looked at. */
  maxCharges: 6,
  /** Each charge within this share of the run's median amount. */
  amountTolerance: 0.15,
  /** The newest charge must be at most this old — old CSV history never raises anything. */
  maxAgeDays: 10,
  gaps: {
    monthly: [26, 35],
    weekly: [6, 8],
  } as Record<DetectedSubscription["frequency"], [number, number]>,
} as const;

const DAY_MS = 86_400_000;
const daysBetween = (later: string, earlier: string) =>
  Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);

/**
 * The part of a row that names the merchant, normalised so January's
 * "NETFLIX.COM 0123" and February's "Netflix.com 0456" agree: the
 * counterparty name, unless that's only a payment processor (then the memo
 * names the shop), lowercased, without digits and punctuation, first four
 * words. Null when nothing recognisable is left.
 */
export function merchantKey(name: string | null, description: string): string | null {
  const source = name && name.trim() && !isPaymentProcessorName(name) ? name : description;
  const words = source
    .toLowerCase()
    .replace(/\d+/g, " ")
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 1)
    .slice(0, 4);
  const key = words.join(" ");
  return key.length >= 3 ? key : null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The newest unbroken run of charges whose every gap fits `[min, max]` days. */
function trailingRun<T extends { date: string }>(rows: T[], [min, max]: [number, number]): T[] {
  const run = [rows[rows.length - 1]];
  for (let i = rows.length - 2; i >= 0 && run.length < DETECT_RULES.maxCharges; i--) {
    const gap = daysBetween(run[0].date, rows[i].date);
    if (gap < min || gap > max) break;
    run.unshift(rows[i]);
  }
  return run;
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

export function detectSubscriptions(
  rows: DetectRow[],
  plans: MatchablePlan[],
  today: string,
): DetectedSubscription[] {
  const groups = new Map<string, DetectRow[]>();
  for (const row of rows) {
    if (row.amount >= 0) continue;
    const key = merchantKey(row.name, row.description);
    if (!key) continue;
    const groupKey = `${row.accountId}:${key}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  }

  const found: DetectedSubscription[] = [];
  for (const [key, group] of groups) {
    if (group.length < DETECT_RULES.minCharges) continue;
    group.sort((a, b) => a.date.localeCompare(b.date));
    const newest = group[group.length - 1];
    const age = daysBetween(today, newest.date);
    if (age < 0 || age > DETECT_RULES.maxAgeDays) continue;

    for (const frequency of ["monthly", "weekly"] as const) {
      const run = trailingRun(group, DETECT_RULES.gaps[frequency]);
      if (run.length < DETECT_RULES.minCharges) continue;
      const amounts = run.map((r) => -r.amount);
      const typical = median(amounts);
      if (amounts.some((a) => Math.abs(a - typical) > typical * DETECT_RULES.amountTolerance)) continue;

      // Already known — as a plan of this account, active or paused.
      const known = plans.some(
        (p) =>
          p.accountId === newest.accountId &&
          (rowMatchesPlan({ ...p, isActive: true }, newest) ||
            looksLikePlan(p.description, newest.name, newest.description)),
      );
      if (known) break;

      found.push({
        key,
        merchant: (newest.name?.trim() || newest.description.trim()).slice(0, 60),
        amount: Math.round(typical * 100) / 100,
        frequency,
        accountId: newest.accountId,
        categoryId: mostCommon(run.map((r) => r.categoryId)),
        count: run.length,
        firstDate: run[0].date,
        lastDate: newest.date,
      });
      break;
    }
  }
  return found;
}
