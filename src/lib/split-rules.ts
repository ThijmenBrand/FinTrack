import { and, eq, inArray, isNull, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { reimbursementLinks, splitRuleLines, splitRules, transactions } from "@/db/schema";
import { canSplitImportRow, matchesRule, ruleMatchTarget } from "@/lib/csv-utils";
import { applySplit } from "@/lib/transaction-split";

export type SplitRuleMode = "percentage" | "fixed";

/** One line of a split rule, in absolute (positive) terms. */
export interface SplitRuleLine {
  categoryId: string;
  percentage?: number | null;
  amount?: number | null;
  isRemainder?: boolean | null;
  sortOrder?: number | null;
}

export interface LoadedSplitRule {
  id: string;
  pattern: string;
  matchType: string;
  matchField: string;
  mode: SplitRuleMode;
  /** Ordered by sortOrder — computeSplitAmounts uses positional order. */
  lines: SplitRuleLine[];
}

/**
 * Turn a rule's lines into concrete split amounts for a parent of
 * `parentAmount`, or null when the rule can't be applied (skip it).
 *
 * Percentage mode: shares of |parentAmount|, cent-rounded, with the leftover
 * cents landing on the last line so the children sum to the parent exactly.
 * Fixed mode: fixed lines keep their amounts and the single remainder line
 * absorbs the difference; if the fixed amounts meet or exceed the total the
 * remainder would be zero or flip sign, so the rule is skipped.
 *
 * All arithmetic runs in integer cents — the only way a sum of rounded floats
 * is exact rather than "exact within epsilon".
 */
export function computeSplitAmounts(
  lines: SplitRuleLine[],
  mode: SplitRuleMode,
  parentAmount: number,
): { amount: number; categoryId: string }[] | null {
  if (lines.length < 2 || !Number.isFinite(parentAmount) || parentAmount === 0) return null;

  const sign = parentAmount < 0 ? -1 : 1;
  const totalCents = Math.round(Math.abs(parentAmount) * 100);
  const cents: number[] = [];

  if (mode === "percentage") {
    let used = 0;
    lines.forEach((line, i) => {
      if (i === lines.length - 1) {
        cents.push(totalCents - used);
        return;
      }
      const c = Math.round((totalCents * (line.percentage ?? 0)) / 100);
      used += c;
      cents.push(c);
    });
  } else {
    const remainderIndex = lines.findIndex((line) => line.isRemainder);
    if (remainderIndex < 0) return null;
    let fixedCents = 0;
    for (const line of lines) {
      if (!line.isRemainder) fixedCents += Math.round((line.amount ?? 0) * 100);
    }
    const remainderCents = totalCents - fixedCents;
    if (remainderCents <= 0) return null;
    lines.forEach((line, i) =>
      cents.push(i === remainderIndex ? remainderCents : Math.round((line.amount ?? 0) * 100)),
    );
  }

  // A zero (or sign-flipped) part would be rejected by applySplit anyway.
  if (cents.some((c) => c <= 0)) return null;

  return cents.map((c, i) => ({ amount: (sign * c) / 100, categoryId: lines[i].categoryId }));
}

/** The user's active split rules, oldest first, each with its lines in order. */
export async function loadSplitRules(userId: string): Promise<LoadedSplitRule[]> {
  const rules = await db
    .select({
      id: splitRules.id,
      pattern: splitRules.pattern,
      matchType: splitRules.matchType,
      matchField: splitRules.matchField,
      mode: splitRules.mode,
    })
    .from(splitRules)
    .where(and(eq(splitRules.userId, userId), eq(splitRules.isActive, true)))
    .orderBy(splitRules.createdAt);
  if (!rules.length) return [];

  // split_rule_lines has no user_id (like reimbursement_links); it is scoped
  // through the rule ids, which were just selected for this user.
  const lines = await db
    .select()
    .from(splitRuleLines)
    .where(inArray(splitRuleLines.ruleId, rules.map((r) => r.id)))
    .orderBy(splitRuleLines.sortOrder);

  return rules.map((rule) => ({
    ...rule,
    lines: lines.filter((l) => l.ruleId === rule.id),
  }));
}

/**
 * First rule whose pattern matches this transaction text, or null. Shared with
 * the import preview so proposal and application agree on what matches.
 */
export function matchSplitRule<T extends { pattern: string; matchType: string; matchField: string }>(
  rules: T[],
  name: string | null | undefined,
  description: string,
): T | null {
  return (
    rules.find((rule) =>
      matchesRule(ruleMatchTarget(name, description, rule.matchField), rule.pattern, rule.matchType),
    ) ?? null
  );
}

/**
 * The split a rule proposes for one pending CSV row, or null when the row
 * isn't splittable, no rule matches, or the rule can't produce valid parts.
 * The proposing rule's id travels with the proposal so the commit can mark the
 * children's category source as "rule" while the user leaves it untouched.
 */
export function proposeSplitForRow(
  rules: LoadedSplitRule[],
  row: {
    type: string;
    amount: number;
    name: string | null;
    description: string;
    groupId?: string | null;
    targetAccountId?: string | null;
  },
): { splits: { amount: number; categoryId: string }[]; splitRuleId: string } | null {
  if (!canSplitImportRow(row)) return null;
  const rule = matchSplitRule(rules, row.name, row.description);
  if (!rule) return null;
  const splits = computeSplitAmounts(rule.lines, rule.mode, row.amount);
  return splits ? { splits, splitRuleId: rule.id } : null;
}

/**
 * A split whose every part was written by a rule, so re-running the rules may
 * safely replace it. A manually split row (any part with a hand-picked
 * category, or no category at all) is the user's own work and is never
 * touched. Names user_id on the correlated row, as the tenant guard requires.
 */
function ruleSplitParent(): SQL {
  return sql`(${transactions.isSplitParent} = 1 AND NOT EXISTS (
    SELECT 1 FROM transactions c
    WHERE c.parent_transaction_id = ${transactions.id}
      AND c.user_id = "transactions"."user_id"
      AND (c.category_source IS NULL OR c.category_source != 'rule')
  ))`;
}

/**
 * Apply split rules to the user's existing transactions (Recalculate All, or a
 * single rule right after it was created or edited). Candidates are
 * income/expense rows that aren't a split child, aren't in a pot, aren't
 * reimbursement-linked, and aren't manually categorized. Returns how many
 * transactions were split.
 *
 * `resplit` widens the set to rows a rule already split (see ruleSplitParent),
 * which is what "apply to existing" has to mean on an EDIT: without it,
 * changing 30/70 to 40/60 left every transaction the rule had already split on
 * the old percentages, with no way to fix them.
 */
export async function applySplitRulesToExisting(
  userId: string,
  opts: { ruleId?: string; resplit?: boolean } = {},
): Promise<number> {
  const { ruleId, resplit = false } = opts;
  // Loaded whole even when narrowed to one rule: precedence is "oldest active
  // rule wins", and the winner has to be decided against the full list.
  const allRules = await loadSplitRules(userId);
  const rules = ruleId ? allRules.filter((r) => r.id === ruleId) : allRules;
  if (!rules.length) return 0;

  const candidates = await db
    .select({
      id: transactions.id,
      name: transactions.name,
      description: transactions.description,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.type, ["income", "expense"]),
        resplit
          ? or(eq(transactions.isSplitParent, false), ruleSplitParent())
          : eq(transactions.isSplitParent, false),
        isNull(transactions.parentTransactionId),
        isNull(transactions.groupId),
        isNull(transactions.reimbursesTransactionId),
        or(
          isNull(transactions.categorySource),
          ne(transactions.categorySource, "manual"),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(reimbursementLinks)
            .where(
              or(
                eq(reimbursementLinks.expenseId, transactions.id),
                eq(reimbursementLinks.reimbursementId, transactions.id),
              ),
            ),
        ),
      ),
    );

  // ponytail: matching in JS over the user's own rows, like the import preview.
  // Per-user datasets are small; push the pattern into SQL if that stops being true.
  let split = 0;
  for (const tx of candidates) {
    const rule = matchSplitRule(rules, tx.name, tx.description);
    if (!rule) continue;
    // Narrowing to one rule must not let it jump the queue: if an older active
    // rule also matches this row, that rule owns it.
    if (ruleId && matchSplitRule(allRules, tx.name, tx.description)?.id !== ruleId) continue;
    const splits = computeSplitAmounts(rule.lines, rule.mode, tx.amount);
    if (!splits) continue;
    const result = await applySplit({
      parentId: tx.id,
      ownerId: userId,
      actorId: userId,
      splits,
      source: "rule",
    });
    if (result.ok) split++;
  }
  return split;
}
