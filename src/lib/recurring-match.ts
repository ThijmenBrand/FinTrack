import {
  findMatchingRecurring,
  matchesRule,
  ruleMatchTarget,
} from "@/lib/csv-utils";
import { MAX_PATTERN_LENGTH } from "@/lib/validation";

/**
 * Which recurring plan a transaction belongs to. Pure, so the import preview,
 * a hand-entered row and the backfill all decide it the same way.
 *
 * Two signals, strongest first:
 *
 * 1. The plan's own rule (`matchPattern` / `matchField`) — learned from the
 *    first row linked by hand, or set on the plan's detail page. It ignores
 *    the amount on purpose: HBO Max going from 4.50 to 5.99 is still HBO Max,
 *    and the price history is exactly what the detail page shows.
 * 2. The description + amount guess (`findMatchingRecurring`) every plan has
 *    always had, for plans nobody has taught yet.
 *
 * Both stay inside the plan's own account and direction: a refund from HBO is
 * not a payment to it, and the same subscription on a second account is that
 * account's plan. Neither ever hands a row back to a plan the user unlinked it
 * from by hand (`recurringExcludedPlanId`).
 */
export interface MatchablePlan {
  id: string;
  accountId: string;
  description: string;
  amount: number;
  type: string;
  isActive: boolean;
  matchPattern: string | null;
  matchField: string;
}

export interface MatchableRow {
  accountId: string;
  amount: number;
  name: string | null;
  description: string;
  /** The plan this row was unlinked from by hand; absent on a new row. */
  recurringExcludedPlanId?: string | null;
}

/** True when the plan has a rule and the row's text satisfies it. */
export function matchesPlanRule(
  plan: Pick<MatchablePlan, "matchPattern" | "matchField">,
  name: string | null,
  description: string,
): boolean {
  if (!plan.matchPattern) return false;
  return matchesRule(
    ruleMatchTarget(name, description, plan.matchField),
    plan.matchPattern,
    "contains",
  );
}

// Companies that collect on behalf of a merchant. A name made of nothing
// else ("PayPal Europe S.a.r.l. et Cie S.C.A") is the same on every payment
// they route, whoever the payee is — learning it would claim all of them.
const PAYMENT_PROCESSORS = new Set([
  "adyen", "afterpay", "buckaroo", "ccv", "ideal", "klarna", "mollie",
  "multisafepay", "paypal", "payu", "riverty", "stripe", "sumup", "tikkie",
  "worldline", "zettle",
]);
// The legal-entity and filler words around a processor's name.
const PROCESSOR_FILLER = new Set([
  "ab", "bank", "bv", "cie", "derdengelden", "et", "europe", "financial",
  "gmbh", "holding", "inc", "limited", "ltd", "nederland", "netherlands", "nl",
  "nv", "payment", "payments", "sarl", "sca", "services", "stichting",
]);

/**
 * True when the name is only a payment processor — no merchant in it.
 * "SumUp *Bakker Jansen" names the bakery and stays specific; "Stichting
 * Mollie Payments" does not.
 */
export function isPaymentProcessorName(name: string): boolean {
  const words = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  return (
    words.some((w) => PAYMENT_PROCESSORS.has(w)) &&
    words.every((w) => PAYMENT_PROCESSORS.has(w) || PROCESSOR_FILLER.has(w))
  );
}

/**
 * The rule to learn from a row the user linked by hand: its counterparty
 * name, the stable part of a bank row ("HBO Max") — the description is mostly
 * reference numbers that change every month.
 *
 * Nothing is learned when that name can't single out one payee, because the
 * rule ignores the amount and is applied to the account's whole history at
 * once: a row without a name (its description's first words are "SEPA Incasso
 * algemeen" on every direct debit) or a name that is only a payment processor.
 * The plan then keeps its description + amount guess, and a rule can still be
 * set by hand on its detail page.
 */
export function learnMatchRule(row: {
  name: string | null;
}): { matchPattern: string; matchField: "name" } | null {
  const name = row.name?.trim();
  if (!name || isPaymentProcessorName(name)) return null;
  return { matchPattern: name.slice(0, MAX_PATTERN_LENGTH), matchField: "name" };
}

/**
 * Does this one plan claim this row? The per-plan form of
 * `findRecurringForRow`, for walking a plan's history.
 */
export function rowMatchesPlan(plan: MatchablePlan, row: MatchableRow): boolean {
  if (plan.accountId !== row.accountId) return false;
  if (row.recurringExcludedPlanId === plan.id) return false;
  if (plan.type !== (row.amount < 0 ? "expense" : "income")) return false;
  if (matchesPlanRule(plan, row.name, row.description)) return true;
  return (
    findMatchingRecurring(row.accountId, row.amount, row.description, row.name, [
      { ...plan, isActive: true },
    ]) !== null
  );
}

/**
 * The active plan a new row belongs to, or null. A plan's rule outranks every
 * guess; between several rules (or several guesses) the closest amount wins.
 */
export function findRecurringForRow(
  row: MatchableRow,
  plans: MatchablePlan[],
): string | null {
  const direction = row.amount < 0 ? "expense" : "income";
  if (row.recurringExcludedPlanId) {
    plans = plans.filter((plan) => plan.id !== row.recurringExcludedPlanId);
  }
  let best: { id: string; diff: number } | null = null;
  for (const plan of plans) {
    if (!plan.isActive || plan.accountId !== row.accountId || plan.type !== direction) continue;
    if (!matchesPlanRule(plan, row.name, row.description)) continue;
    const diff = Math.abs(Math.abs(plan.amount) - Math.abs(row.amount));
    if (!best || diff < best.diff) best = { id: plan.id, diff };
  }
  if (best) return best.id;
  return findMatchingRecurring(row.accountId, row.amount, row.description, row.name, plans);
}

/**
 * A looser "this might be one of yours" for the plan's detail page: text only,
 * no amount check, so last year's payments at the old price surface as
 * suggestions to link. Either way round a substring of the plan's description,
 * or its first word (3+ letters) as a whole word — "HBO Max subscription"
 * should still find "HBO MAX EUROPE".
 */
export function looksLikePlan(
  planDescription: string,
  name: string | null,
  description: string,
): boolean {
  const plan = planDescription.trim().toLowerCase();
  if (!plan) return false;
  const haystack = `${name ?? ""} ${description}`.trim().toLowerCase();
  if (!haystack) return false;
  if (haystack.includes(plan) || plan.includes(haystack)) return true;
  const first = plan.split(/[^\p{L}\p{N}]+/u).find(Boolean);
  if (!first || first.length < 3) return false;
  return haystack.split(/[^\p{L}\p{N}]+/u).includes(first);
}
